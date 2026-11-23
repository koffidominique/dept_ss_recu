// ============================================================================
// Helpers transactionnels pour le retour d'emballages vides clients
// ============================================================================

use sqlx::{Sqlite, Transaction};

use crate::domain::money::Money;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::DepositReturnDto;

pub(crate) async fn fetch_deposit_return_by_id(
    db: &DepotDb,
    return_id: i64,
) -> CoreResult<DepositReturnDto> {
    let ret = sqlx::query_as::<_, DepositReturnDto>(
        "SELECT dr.id, dr.reference, rpt.name AS packaging_name, c.name AS client_name,
                dr.pieces, dr.condition_state, dr.refund_amount, dr.credit_reduction,
                pm.label AS method_label, dr.reason, dr.created_at
         FROM deposit_returns dr
         JOIN returnable_packaging_types rpt ON rpt.id = dr.returnable_id
         LEFT JOIN clients c ON c.id = dr.client_id
         JOIN payment_methods pm ON pm.code = dr.method_code
         WHERE dr.id = ?",
    )
    .bind(return_id)
    .fetch_one(&db.pool)
    .await?;
    Ok(ret)
}

pub(crate) async fn apply_return_credit_reduction_tx(
    tx: &mut Transaction<'_, Sqlite>,
    sale_id: i64,
    credit_reduction: Money,
) -> CoreResult<()> {
    if credit_reduction.value() <= 0 {
        return Ok(());
    }
    let rec: Option<(i64, i64)> =
        sqlx::query_as("SELECT id, remaining_amount FROM customer_receivables WHERE sale_id = ?")
            .bind(sale_id)
            .fetch_optional(&mut **tx)
            .await?;
    let (rec_id, rem) = rec.ok_or_else(|| {
        CoreError::InvalidPayment("Aucune créance associée à cette vente.".to_string())
    })?;
    if credit_reduction.value() > rem {
        return Err(CoreError::InvalidPayment(
            "Réduction de créance supérieure au solde restant.".to_string(),
        ));
    }
    let next_rem = Money(rem)
        .checked_sub_non_negative(credit_reduction, "Solde créance")?
        .value();
    sqlx::query("UPDATE customer_receivables SET remaining_amount = ?, status = ? WHERE id = ?")
        .bind(next_rem)
        .bind(if next_rem == 0 { "paid" } else { "partial" })
        .bind(rec_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub(crate) async fn update_client_packaging_balance_tx(
    tx: &mut Transaction<'_, Sqlite>,
    client_id: Option<i64>,
    _issue_id: i64,
    returnable_id: i64,
    pieces_returned: i64,
    unit_value: i64,
) -> CoreResult<()> {
    let Some(cid) = client_id else {
        return Ok(());
    };
    let deposit_reduction = Money::from_non_negative(unit_value, "Tarif consigne")?
        .checked_mul(pieces_returned, "Réduction dépôt")?;

    sqlx::query(
        "INSERT INTO customer_packaging_accounts (client_id, returnable_id, balance_pieces, deposit_held_amount)
         VALUES (?, ?, 0, 0)
         ON CONFLICT (client_id, returnable_id)
         DO UPDATE SET
           balance_pieces = MAX(0, balance_pieces - ?),
           deposit_held_amount = CASE
               WHEN balance_pieces - ? <= 0 THEN 0
               ELSE MAX(0, deposit_held_amount - ?)
           END",
    )
    .bind(cid)
    .bind(returnable_id)
    .bind(pieces_returned)
    .bind(pieces_returned)
    .bind(deposit_reduction.value())
    .execute(&mut **tx)
    .await?;

    crate::application::orders::packaging_and_returns::sync_customer_deposit_asset_delta_tx(
        tx,
        cid,
        returnable_id,
        -pieces_returned,
        unit_value,
    )
    .await?;
    Ok(())
}
