// ============================================================================
// Retours tardifs sur obligations converties et régularisation comptable
// ============================================================================

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::insert_ledger_entry;

/// Enregistre un retour tardif sur une obligation déjà convertie (ou non) :
/// incrémente `returned_pieces`, incrémente le stock d'emballages vides, et
/// régularise la créance par une écriture de crédit (`late_return_credit`),
/// sans jamais modifier les écritures historiques.
pub async fn register_late_return(
    db: &DepotDb,
    deposit_issue_id: i64,
    pieces: i64,
    actor: Option<&str>,
) -> CoreResult<i64> {
    if pieces <= 0 {
        return Err(CoreError::Validation(
            "La quantité retournée doit être strictement positive.".to_string(),
        ));
    }
    let mut g = db.begin_write().await?;
    let tx = &mut g.1;
    let (client_id, rid, status, pieces_due, returned, converted, unit_value): (
        Option<i64>,
        i64,
        String,
        i64,
        i64,
        i64,
        i64,
    ) = sqlx::query_as(
        "SELECT client_id, returnable_id, status, pieces, returned_pieces, converted_pieces, unit_value
         FROM deposit_issues WHERE id = ?",
    )
    .bind(deposit_issue_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::Validation("Obligation introuvable.".to_string()))?;
    if matches!(status.as_str(), "settled" | "cancelled" | "returned") {
        return Err(CoreError::Validation(
            "Cette obligation est déjà soldée ou clôturée.".to_string(),
        ));
    }
    let pending_physical = pieces_due - returned - converted;
    if pieces > pending_physical && converted == 0 {
        return Err(CoreError::Validation(format!(
            "Retour supérieur au reste à restituer (max {pending_physical})."
        )));
    }
    let capped = pieces.min(pending_physical.max(0) + converted);
    if capped <= 0 {
        return Err(CoreError::Validation(
            "Aucune pièce restante à restituer sur cette obligation.".to_string(),
        ));
    }
    let late_regulated = (capped - pending_physical.max(0)).max(0).min(converted);
    let returned_after = returned + capped;

    sqlx::query(
        "UPDATE deposit_issues
         SET returned_pieces = returned_pieces + ?,
             converted_pieces = converted_pieces - ?,
             updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(capped)
    .bind(late_regulated)
    .bind(deposit_issue_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE deposit_issues
         SET status = CASE
             WHEN returned_pieces + lost_pieces + destroyed_pieces + converted_pieces >= pieces
                  AND converted_pieces = 0 THEN 'settled'
             WHEN returned_pieces > 0 AND converted_pieces = 0 THEN 'partially_returned'
             ELSE status
         END
         WHERE id = ?",
    )
    .bind(deposit_issue_id)
    .execute(&mut **tx)
    .await?;

    let before_stock: i64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?), 0)",
    )
    .bind(rid)
    .fetch_one(&mut **tx)
    .await?;
    let after_stock = before_stock.saturating_add(capped);
    let movement_value = capped.saturating_mul(unit_value);

    sqlx::query(
        "INSERT INTO returnable_stock_balances (packaging_id, quantity)
         VALUES (?, ?)
         ON CONFLICT(packaging_id) DO UPDATE SET quantity = excluded.quantity",
    )
    .bind(rid)
    .bind(after_stock)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE packaging_assets SET stock_empty = stock_empty + ? WHERE returnable_id = ?")
        .bind(capped)
        .bind(rid)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "INSERT INTO returnable_stock_movements
            (request_key, packaging_id, movement_type, quantity, stock_before, stock_after,
             reason, customer_id, unit_deposit_value, total_value)
         VALUES (?, ?, 'entry', ?, ?, ?, 'Retour tardif client', ?, ?, ?)",
    )
    .bind(format!("late-ret:{deposit_issue_id}:{returned_after}"))
    .bind(rid)
    .bind(capped)
    .bind(before_stock)
    .bind(after_stock)
    .bind(client_id)
    .bind(unit_value)
    .bind(movement_value)
    .execute(&mut **tx)
    .await?;

    let mut credited = 0i64;
    if let Some(cid) = client_id {
        let physical_deduct = (capped - late_regulated).max(0);
        if physical_deduct > 0 {
            let phys_val = physical_deduct.saturating_mul(unit_value);
            sqlx::query(
                "UPDATE customer_packaging_accounts
                 SET balance_pieces = MAX(0, balance_pieces - ?),
                     deposit_held_amount = CASE
                         WHEN balance_pieces - ? <= 0 THEN 0
                         ELSE MAX(0, deposit_held_amount - ?)
                     END
                 WHERE client_id = ? AND returnable_id = ?",
            )
            .bind(physical_deduct)
            .bind(physical_deduct)
            .bind(phys_val)
            .bind(cid)
            .bind(rid)
            .execute(&mut **tx)
            .await?;
            crate::application::orders::packaging_and_returns::sync_customer_deposit_asset_delta_tx(
                tx, cid, rid, -physical_deduct, unit_value,
            )
            .await?;
        }

        if late_regulated > 0 {
            credited = late_regulated * unit_value;
            if credited > 0 {
                insert_ledger_entry(
                    tx,
                    &format!("late-ret:{deposit_issue_id}:{returned_after}:{credited}"),
                    cid,
                    None,
                    "late_return_credit",
                    credited,
                    "credit",
                    actor,
                    Some(format!(
                        "Retour tardif : {late_regulated} pièce(s) récupérée(s) après conversion."
                    )),
                )
                .await?;
            }
        }
    }
    sqlx::query(
        "INSERT INTO audit_logs (entity_type, entity_id, action, details, actor_name)
         VALUES ('deposit_issues', ?, 'LATE_RETURN', ?, ?)",
    )
    .bind(deposit_issue_id.to_string())
    .bind(format!(
        "Retour tardif : {capped} pièce(s), régularisation : {credited} FCFA"
    ))
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    g.1.commit().await?;
    Ok(credited)
}
