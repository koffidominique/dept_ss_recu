// ============================================================================
// Annulation complète d'une vente (stock, consignes, créances, caisse)
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{
    audit_log_tx, get_sale_detail, get_theoretical_cash_tx, require_open_session_tx,
    CancelSaleInput, SaleDetailDto,
};

pub async fn cancel_sale(
    db: &DepotDb,
    sale_id: i64,
    input: CancelSaleInput,
) -> CoreResult<SaleDetailDto> {
    require_current_actor_permission(Permission::SalesCancelReturn)?;
    let request_key = input.request_key.trim().to_string();
    if request_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(CoreError::Validation(
            "Le motif d'annulation est obligatoire.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;
    let dup: Option<(i64, i64)> =
        sqlx::query_as("SELECT id, sale_id FROM sales_cancellations WHERE request_key = ?")
            .bind(&request_key)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((_dup_id, dup_sale_id)) = dup {
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
            "Cette vente est déjà annulée.".to_string(),
        ));
    }
    let ret_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sales_returns WHERE sale_id = ?")
        .bind(sale_id)
        .fetch_one(&mut *tx)
        .await?;
    if ret_count > 0 {
        return Err(CoreError::HistoricalImmutable(
            "Impossible d'annuler une vente ayant déjà fait l'objet d'un retour partiel."
                .to_string(),
        ));
    }

    let lines: Vec<(i64, i64)> =
        sqlx::query_as("SELECT product_id, base_quantity_milli FROM sale_lines WHERE sale_id = ?")
            .bind(sale_id)
            .fetch_all(&mut *tx)
            .await?;
    for (pid, qty_milli) in lines {
        let cur_stock: i64 = sqlx::query_scalar("SELECT stock_milli FROM products WHERE id = ?")
            .bind(pid)
            .fetch_one(&mut *tx)
            .await?;
        let next_stock = cur_stock.checked_add(qty_milli).ok_or_else(|| {
            CoreError::Validation("Débordement stock lors de l'annulation.".to_string())
        })?;
        sqlx::query("UPDATE products SET stock_milli = ? WHERE id = ?")
            .bind(next_stock)
            .bind(pid)
            .execute(&mut *tx)
            .await?;
        crate::application::inventory::sync_stock_balance_tx(&mut tx, pid, next_stock).await?;
        sqlx::query(
            "INSERT INTO stock_movements (product_id, movement_type, quantity_milli, stock_before_milli, stock_after_milli, reason, reference_document)
             VALUES (?, 'sale_cancel_in', ?, ?, ?, ?, ?)",
        )
        .bind(pid)
        .bind(qty_milli)
        .bind(cur_stock)
        .bind(next_stock)
        .bind(format!("Annulation vente {sale_ref} : {reason}"))
        .bind(&sale_ref)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "UPDATE customer_receivables SET remaining_amount = 0, status = 'cancelled' WHERE sale_id = ?",
    )
    .bind(sale_id)
    .execute(&mut *tx)
    .await?;

    let deposits: Vec<(i64, Option<i64>, i64, i64, i64, i64, i64, i64, String)> = sqlx::query_as(
        "SELECT id, client_id, returnable_id, pieces, returned_pieces,
                lost_pieces + destroyed_pieces + converted_pieces,
                unit_value, amount, COALESCE(status, 'pending')
         FROM deposit_issues WHERE sale_id = ?",
    )
    .bind(sale_id)
    .fetch_all(&mut *tx)
    .await?;
    for (di_id, cid_opt, rid, pieces, returned_pieces, other_out, unit_value, amount, di_status) in deposits {
        if di_status == "returned" {
            if let Some(cid) = cid_opt {
                let restored_amount = if amount > 0 {
                    amount
                } else {
                    pieces.saturating_mul(unit_value)
                };
                sqlx::query(
                    "INSERT INTO customer_packaging_accounts (client_id, returnable_id, balance_pieces, deposit_held_amount)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(client_id, returnable_id) DO UPDATE SET
                       balance_pieces = balance_pieces + excluded.balance_pieces,
                       deposit_held_amount = deposit_held_amount + excluded.deposit_held_amount",
                )
                .bind(cid)
                .bind(rid)
                .bind(pieces)
                .bind(restored_amount)
                .execute(&mut *tx)
                .await?;

                crate::application::orders::packaging_and_returns::sync_customer_deposit_asset_delta_tx(
                    &mut tx, cid, rid, pieces, unit_value,
                )
                .await?;

                let mut rem_reopen = pieces;
                let settled_priors: Vec<(i64, i64, i64, i64, i64)> = sqlx::query_as(
                    "SELECT di.id, di.pieces, di.returned_pieces,
                            di.lost_pieces + di.destroyed_pieces + di.converted_pieces,
                            COALESCE((SELECT SUM(dr.pieces) FROM deposit_returns dr WHERE dr.issue_id = di.id), 0)
                     FROM deposit_issues di
                     WHERE di.client_id = ? AND di.returnable_id = ? AND di.sale_id != ?
                       AND di.status IN ('settled', 'partially_returned')
                       AND di.returned_pieces > 0
                     ORDER BY di.id DESC",
                )
                .bind(cid)
                .bind(rid)
                .bind(sale_id)
                .fetch_all(&mut *tx)
                .await?;

                for (p_id, p_pieces, p_ret, p_other, explicit_ret) in settled_priors {
                    if rem_reopen <= 0 {
                        break;
                    }
                    let reversible = (p_ret - explicit_ret).max(0);
                    if reversible <= 0 {
                        continue;
                    }
                    let undo = rem_reopen.min(reversible);
                    let next_ret = p_ret - undo;
                    let next_st = if next_ret + p_other >= p_pieces {
                        "settled"
                    } else if next_ret > 0 || p_other > 0 {
                        "partially_returned"
                    } else {
                        "pending"
                    };
                    sqlx::query(
                        "UPDATE deposit_issues
                         SET returned_pieces = ?, status = ?, updated_at = datetime('now')
                         WHERE id = ?",
                    )
                    .bind(next_ret)
                    .bind(next_st)
                    .bind(p_id)
                    .execute(&mut *tx)
                    .await?;
                    rem_reopen -= undo;
                }
            }
            let cur_empty_stock: i64 = sqlx::query_scalar(
                "SELECT COALESCE((SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?), 0)",
            )
            .bind(rid)
            .fetch_one(&mut *tx)
            .await?;
            if cur_empty_stock < pieces {
                return Err(CoreError::Validation(
                    "Stock d'emballages vides insuffisant au sous-dépôt pour annuler le retour associé à cette vente."
                        .to_string(),
                ));
            }
            let next_empty_stock = cur_empty_stock - pieces;
            sqlx::query("UPDATE returnable_stock_balances SET quantity = ? WHERE packaging_id = ?")
                .bind(next_empty_stock)
                .bind(rid)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "UPDATE packaging_assets SET stock_empty = MAX(0, stock_empty - ?) WHERE returnable_id = ?",
            )
            .bind(pieces)
            .bind(rid)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO returnable_stock_movements (request_key, packaging_id, movement_type, quantity, stock_before, stock_after, reason, reference_document, customer_id, unit_deposit_value, total_value)
                 VALUES (?, ?, 'correction_out', ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(format!("cancel-ret:{request_key}:{di_id}"))
            .bind(rid)
            .bind(pieces)
            .bind(cur_empty_stock)
            .bind(next_empty_stock)
            .bind(format!("Annulation retour emballage {sale_ref} : {reason}"))
            .bind(&sale_ref)
            .bind(cid_opt)
            .bind(unit_value)
            .bind(amount)
            .execute(&mut *tx)
            .await?;
        } else {
            if returned_pieces > 0 || other_out > 0 {
                return Err(CoreError::HistoricalImmutable(
                    "Impossible d'annuler cette vente : ses emballages consignés ont déjà fait l'objet d'un retour, d'une perte ou d'une conversion en dette.".to_string(),
                ));
            }
            if let Some(cid) = cid_opt {
                sqlx::query(
                    "UPDATE customer_packaging_accounts
                     SET balance_pieces = MAX(0, balance_pieces - ?),
                         deposit_held_amount = CASE
                             WHEN balance_pieces - ? <= 0 THEN 0
                             ELSE MAX(0, deposit_held_amount - ?)
                         END
                     WHERE client_id = ? AND returnable_id = ?",
                )
                .bind(pieces)
                .bind(pieces)
                .bind(amount)
                .bind(cid)
                .bind(rid)
                .execute(&mut *tx)
                .await?;

                crate::application::orders::packaging_and_returns::sync_customer_deposit_asset_delta_tx(
                    &mut tx, cid, rid, -pieces, unit_value,
                )
                .await?;
            }
        }
        sqlx::query("UPDATE deposit_issues SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
            .bind(di_id)
            .execute(&mut *tx)
            .await?;
    }

    let refunded: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount), 0) FROM payments WHERE sale_id = ? AND payment_kind IN ('sale', 'receivable')",
    )
    .bind(sale_id)
    .fetch_one(&mut *tx)
    .await?;
    let refund_method = input
        .refund_method_code
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("cash")
        .to_string();

    if refunded > 0 {
        let pm: Option<(String, i64, i64)> =
            sqlx::query_as("SELECT code, is_cash, active FROM payment_methods WHERE code = ?")
                .bind(&refund_method)
                .fetch_optional(&mut *tx)
                .await?;
        let (pm_code, is_cash, active) = pm.ok_or_else(|| {
            CoreError::InvalidPayment(format!(
                "Moyen de remboursement introuvable : {refund_method}"
            ))
        })?;
        if active == 0 {
            return Err(CoreError::InvalidPayment(format!(
                "Moyen de remboursement inactif : {pm_code}"
            )));
        }
        if is_cash == 1 {
            let avail = get_theoretical_cash_tx(&mut tx, session_id, opening_cash).await?;
            if refunded > avail {
                return Err(CoreError::InvalidPayment(
                    "Espèces insuffisantes en caisse pour rembourser cette vente.".to_string(),
                ));
            }
        }
        sqlx::query(
            "INSERT INTO cash_movements (session_id, request_key, kind, method_code, direction, amount, description, reference_document)
             VALUES (?, ?, 'sale_refund', ?, 'out', ?, ?, ?)",
        )
        .bind(session_id)
        .bind(format!("cancel-ref:{request_key}"))
        .bind(&pm_code)
        .bind(refunded)
        .bind(format!("Annulation {sale_ref} — {reason}"))
        .bind(&sale_ref)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO sales_cancellations (sale_id, session_id, request_key, reason, refund_method_code, refunded_amount)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(sale_id)
    .bind(session_id)
    .bind(&request_key)
    .bind(&reason)
    .bind(if refunded > 0 { Some(refund_method) } else { None })
    .bind(refunded)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE sales SET status = 'cancelled' WHERE id = ?")
        .bind(sale_id)
        .execute(&mut *tx)
        .await?;

    audit_log_tx(
        &mut tx,
        "CANCEL_SALE",
        "sales",
        Some(sale_id.to_string()),
        &format!("Annulation {sale_ref} ({reason})"),
    )
    .await?;
    tx.commit().await?;

    get_sale_detail(db, sale_id).await
}
