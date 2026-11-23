// ============================================================================
// Retour partiel / avoir client sur une vente validée
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::domain::money::Money;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::returns_helpers::{
    normalize_return_lines, prepare_return_lines_tx, validate_return_refund_method_tx,
};
use super::{
    audit_log_tx, get_sale_detail, require_open_session_tx, CreateSaleReturnInput, SaleDetailDto,
};

pub async fn create_sale_return(
    db: &DepotDb,
    sale_id: i64,
    input: CreateSaleReturnInput,
) -> CoreResult<SaleDetailDto> {
    require_current_actor_permission(Permission::SalesCancelReturn)?;
    if sale_id <= 0 {
        return Err(CoreError::Validation(
            "Identifiant de vente invalide.".to_string(),
        ));
    }
    let request_key = input.request_key.trim().to_string();
    if request_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(CoreError::Validation(
            "Le motif du retour est obligatoire.".to_string(),
        ));
    }
    if input.lines.is_empty() {
        return Err(CoreError::Validation(
            "Sélectionnez au moins un article à retourner.".to_string(),
        ));
    }

    let normalized_lines = normalize_return_lines(&input.lines)?;

    let (_guard, mut tx) = db.begin_write().await?;
    let dup: Option<(i64, i64)> =
        sqlx::query_as("SELECT id, sale_id FROM sales_returns WHERE request_key = ?")
            .bind(&request_key)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((_ret_id, dup_sale_id)) = dup {
        tx.rollback().await?;
        if dup_sale_id != sale_id {
            return Err(CoreError::DuplicateOperation(
                "Cette clé d'idempotence a déjà été utilisée pour une autre vente.".to_string(),
            ));
        }
        return get_sale_detail(db, sale_id).await;
    }

    let (session_id, _sref, opening_cash) = require_open_session_tx(&mut tx).await?;
    let sale: Option<(i64, String, String)> =
        sqlx::query_as("SELECT id, reference, status FROM sales WHERE id = ?")
            .bind(sale_id)
            .fetch_optional(&mut *tx)
            .await?;
    let (_id, sale_ref, status) =
        sale.ok_or_else(|| CoreError::Validation("Vente introuvable.".to_string()))?;
    if status == "cancelled" {
        return Err(CoreError::HistoricalImmutable(
            "Vente annulée : retour impossible.".to_string(),
        ));
    }

    let avo_prefix: String =
        sqlx::query_scalar("SELECT credit_note_prefix FROM app_settings WHERE id = 1")
            .fetch_one(&mut *tx)
            .await?;

    let (total_return, prepared) =
        prepare_return_lines_tx(&mut tx, sale_id, &normalized_lines).await?;

    let mut credit_reduction: i64 = 0;
    let mut refund_amount: i64 = total_return.value();
    let rec: Option<(i64, i64)> = sqlx::query_as(
        "SELECT id, remaining_amount FROM customer_receivables WHERE sale_id = ? AND status IN ('open', 'partial')",
    )
    .bind(sale_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((_rec_id, rem)) = rec {
        if rem > 0 {
            credit_reduction = rem.min(total_return.value());
            refund_amount = total_return
                .checked_sub_non_negative(Money(credit_reduction), "Remboursement retour")?
                .value();
        }
    }

    let check_sum =
        Money(credit_reduction).checked_add(Money(refund_amount), "Ventilation retour")?;
    if check_sum != total_return {
        return Err(CoreError::Internal(
            "Incohérence interne dans la répartition du retour.".to_string(),
        ));
    }

    validate_return_refund_method_tx(
        &mut tx,
        session_id,
        opening_cash,
        &input.refund_method_code,
        refund_amount,
    )
    .await?;

    if let Some((rec_id, rem)) = rec {
        if credit_reduction > 0 {
            let next_rem = rem - credit_reduction;
            sqlx::query(
                "UPDATE customer_receivables SET remaining_amount = ?, status = ? WHERE id = ?",
            )
            .bind(next_rem)
            .bind(if next_rem == 0 { "paid" } else { "partial" })
            .bind(rec_id)
            .execute(&mut *tx)
            .await?;
        }
    }

    let ret_ref = DepotDb::next_sequence(&mut tx, "RET").await?;
    let avo_ref = DepotDb::next_sequence(&mut tx, &avo_prefix).await?;

    let ret_id = sqlx::query(
        "INSERT INTO sales_returns (reference, credit_note_ref, request_key, sale_id, session_id, total_amount, credit_reduction, refund_amount, refund_method_code, restock_approved, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&ret_ref)
    .bind(&avo_ref)
    .bind(&request_key)
    .bind(sale_id)
    .bind(session_id)
    .bind(total_return.value())
    .bind(credit_reduction)
    .bind(refund_amount)
    .bind(if refund_amount > 0 {
        Some(&input.refund_method_code)
    } else {
        None
    })
    .bind(if input.restock_approved { 1_i64 } else { 0_i64 })
    .bind(&reason)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    for (sl_id, pid, base_qty_milli, amt) in &prepared {
        sqlx::query(
            "INSERT INTO sales_return_lines (return_id, sale_line_id, base_quantity_milli, amount)
             VALUES (?, ?, ?, ?)",
        )
        .bind(ret_id)
        .bind(sl_id)
        .bind(base_qty_milli)
        .bind(amt)
        .execute(&mut *tx)
        .await?;

        if input.restock_approved {
            let cur_stock: i64 =
                sqlx::query_scalar("SELECT stock_milli FROM products WHERE id = ?")
                    .bind(pid)
                    .fetch_one(&mut *tx)
                    .await?;
            let next_stock = cur_stock.checked_add(*base_qty_milli).ok_or_else(|| {
                CoreError::Validation("Débordement stock lors du retour.".to_string())
            })?;
            sqlx::query("UPDATE products SET stock_milli = ? WHERE id = ?")
                .bind(next_stock)
                .bind(pid)
                .execute(&mut *tx)
                .await?;
            crate::application::inventory::sync_stock_balance_tx(&mut tx, *pid, next_stock).await?;
            sqlx::query(
                "INSERT INTO stock_movements (product_id, movement_type, quantity_milli, stock_before_milli, stock_after_milli, reason, reference_document)
                 VALUES (?, 'return_in', ?, ?, ?, ?, ?)",
            )
            .bind(pid)
            .bind(base_qty_milli)
            .bind(cur_stock)
            .bind(next_stock)
            .bind(format!("Retour {avo_ref} : {reason}"))
            .bind(&avo_ref)
            .execute(&mut *tx)
            .await?;

            let sold_base_milli: i64 =
                sqlx::query_scalar("SELECT base_quantity_milli FROM sale_lines WHERE id = ?")
                    .bind(sl_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if sold_base_milli > 0 {
                let cum_restocked_milli: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(SUM(srl.base_quantity_milli), 0)
                     FROM sales_return_lines srl
                     JOIN sales_returns sr ON sr.id = srl.return_id
                     WHERE srl.sale_line_id = ? AND sr.restock_approved = 1",
                )
                .bind(sl_id)
                .fetch_one(&mut *tx)
                .await?;
                let prev_restocked_milli = (cum_restocked_milli - *base_qty_milli).max(0);

                let line_issues: Vec<(i64, Option<i64>, i64, i64, i64, i64, i64)> = sqlx::query_as(
                    "SELECT id, client_id, returnable_id, pieces, returned_pieces,
                            lost_pieces + destroyed_pieces + converted_pieces, unit_value
                     FROM deposit_issues
                     WHERE sale_line_id = ? AND status IN ('pending', 'partially_returned')
                     ORDER BY id ASC",
                )
                .bind(sl_id)
                .fetch_all(&mut *tx)
                .await?;

                for (di_id, di_cid, di_rid, di_pieces, di_ret, di_other_out, di_unit_val) in
                    line_issues
                {
                    let prev_pieces = ((di_pieces as i128 * prev_restocked_milli as i128)
                        / sold_base_milli as i128) as i64;
                    let cum_pieces = ((di_pieces as i128 * cum_restocked_milli as i128)
                        / sold_base_milli as i128) as i64;
                    let delta_pieces = (cum_pieces - prev_pieces).max(0);
                    let open_rem = (di_pieces - di_ret - di_other_out).max(0);
                    let settle_pieces = delta_pieces.min(open_rem);
                    if settle_pieces <= 0 {
                        continue;
                    }

                    let next_ret = di_ret + settle_pieces;
                    let next_status = if next_ret + di_other_out >= di_pieces {
                        "settled"
                    } else {
                        "partially_returned"
                    };
                    sqlx::query(
                        "UPDATE deposit_issues
                         SET returned_pieces = ?, status = ?, updated_at = datetime('now')
                         WHERE id = ?",
                    )
                    .bind(next_ret)
                    .bind(next_status)
                    .bind(di_id)
                    .execute(&mut *tx)
                    .await?;

                    if let Some(cid) = di_cid {
                        let dec_amt = settle_pieces.saturating_mul(di_unit_val);
                        sqlx::query(
                            "UPDATE customer_packaging_accounts
                             SET balance_pieces = MAX(0, balance_pieces - ?),
                                 deposit_held_amount = CASE
                                     WHEN balance_pieces - ? <= 0 THEN 0
                                     ELSE MAX(0, deposit_held_amount - ?)
                                 END
                             WHERE client_id = ? AND returnable_id = ?",
                        )
                        .bind(settle_pieces)
                        .bind(settle_pieces)
                        .bind(dec_amt)
                        .bind(cid)
                        .bind(di_rid)
                        .execute(&mut *tx)
                        .await?;

                        crate::application::orders::packaging_and_returns::sync_customer_deposit_asset_delta_tx(
                            &mut tx,
                            cid,
                            di_rid,
                            -settle_pieces,
                            di_unit_val,
                        )
                        .await?;
                    }
                }
            }
        }
    }

    if refund_amount > 0 {
        sqlx::query(
            "INSERT INTO cash_movements (session_id, request_key, kind, method_code, direction, amount, description, reference_document)
             VALUES (?, ?, 'sale_refund', ?, 'out', ?, ?, ?)",
        )
        .bind(session_id)
        .bind(format!("ret-ref:{request_key}"))
        .bind(&input.refund_method_code)
        .bind(refund_amount)
        .bind(format!("Avoir {avo_ref} sur vente {sale_ref}"))
        .bind(&avo_ref)
        .execute(&mut *tx)
        .await?;
    }

    let remaining_qty: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(sl.base_quantity_milli), 0) - COALESCE((SELECT SUM(srl.base_quantity_milli) FROM sales_return_lines srl JOIN sales_returns sr ON sr.id = srl.return_id WHERE sr.sale_id = ?), 0)
         FROM sale_lines sl WHERE sl.sale_id = ?",
    )
    .bind(sale_id)
    .bind(sale_id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("UPDATE sales SET status = ? WHERE id = ?")
        .bind(if remaining_qty <= 0 {
            "returned"
        } else {
            "partially_returned"
        })
        .bind(sale_id)
        .execute(&mut *tx)
        .await?;

    audit_log_tx(
        &mut tx,
        "CREATE_RETURN",
        "sales_returns",
        Some(ret_id.to_string()),
        &format!("Avoir {avo_ref} — {} FCFA", total_return.value()),
    )
    .await?;
    tx.commit().await?;

    get_sale_detail(db, sale_id).await
}
