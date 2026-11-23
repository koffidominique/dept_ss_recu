// ============================================================================
// Enregistrement des retours d'emballages vides clients et remboursements
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::application::sales::{audit_log_tx, get_theoretical_cash_tx, require_open_session_tx};
use crate::domain::money::Money;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::return_helpers::{
    apply_return_credit_reduction_tx, fetch_deposit_return_by_id,
    update_client_packaging_balance_tx,
};
use super::{DepositReturnDto, ReturnClientEmptiesInput};

pub async fn return_client_empties(
    db: &DepotDb,
    input: ReturnClientEmptiesInput,
) -> CoreResult<DepositReturnDto> {
    require_current_actor_permission(Permission::ConsignmentsWrite)?;
    let request_key = input.request_key.trim().to_string();
    if request_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    if input.pieces <= 0 {
        return Err(CoreError::Validation(
            "Nombre de pièces retournées invalide.".to_string(),
        ));
    }
    if !matches!(input.condition_state.as_str(), "good" | "damaged") {
        return Err(CoreError::Validation(
            "État d'emballage invalide.".to_string(),
        ));
    }
    let refund_amount = Money::from_non_negative(input.refund_amount, "Montant remboursé")?;
    let credit_reduction = Money::from_non_negative(input.credit_reduction, "Réduction créance")?;
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(CoreError::Validation(
            "Le motif du retour est obligatoire.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;
    if let Some(existing_id) =
        sqlx::query_scalar::<_, i64>("SELECT id FROM deposit_returns WHERE request_key = ?")
            .bind(&request_key)
            .fetch_optional(&mut *tx)
            .await?
    {
        tx.rollback().await?;
        return fetch_deposit_return_by_id(db, existing_id).await;
    }

    let (session_id, _sref, opening_cash) = require_open_session_tx(&mut tx).await?;
    type DepositIssueRow = (
        i64,
        i64,
        Option<i64>,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        String,
        String,
    );
    let issue: Option<DepositIssueRow> = sqlx::query_as(
        "SELECT di.id, di.sale_id, di.client_id, di.returnable_id, di.pieces, di.returned_pieces,
                (di.lost_pieces + di.destroyed_pieces + di.converted_pieces),
                di.converted_pieces,
                di.unit_value, s.status, COALESCE(di.status, 'pending')
         FROM deposit_issues di
         JOIN sales s ON s.id = di.sale_id
         WHERE di.id = ?",
    )
    .bind(input.issue_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (
        issue_id,
        sale_id,
        client_id,
        returnable_id,
        pieces,
        returned_pieces,
        other_out_pieces,
        converted_pieces,
        unit_value,
        sale_status,
        di_status,
    ) = issue.ok_or_else(|| CoreError::Validation("Consigne client introuvable.".to_string()))?;

    if sale_status == "cancelled" {
        return Err(CoreError::HistoricalImmutable(
            "Impossible d'enregistrer un retour d'emballage sur une vente annulée.".to_string(),
        ));
    }
    if di_status == "converted" {
        return Err(CoreError::Validation(
            "Cette obligation a dépassé le délai de restitution et a été convertie en créance financière : enregistrez un retour tardif dans l'onglet Obligations & créances."
                .to_string(),
        ));
    }
    if matches!(di_status.as_str(), "returned" | "settled" | "cancelled") {
        return Err(CoreError::Validation(
            "Cette consigne d'emballage est déjà soldée ou clôturée.".to_string(),
        ));
    }

    let pm: Option<(String, i64, i64)> =
        sqlx::query_as("SELECT code, is_cash, active FROM payment_methods WHERE code = ?")
            .bind(&input.method_code)
            .fetch_optional(&mut *tx)
            .await?;
    let (pm_code, is_cash, pm_active) = pm.ok_or_else(|| {
        CoreError::InvalidPayment(format!(
            "Moyen de paiement introuvable : {}",
            input.method_code
        ))
    })?;
    if pm_active == 0 {
        return Err(CoreError::InvalidPayment(format!(
            "Moyen de paiement inactif : {pm_code}"
        )));
    }

    let remaining_physical = (pieces - returned_pieces - other_out_pieces).max(0);
    if input.pieces > remaining_physical {
        return Err(CoreError::Validation(format!(
            "Nombre de vides retournés ({}) supérieur au reliquat physiquement restituable ({remaining_physical}).",
            input.pieces
        )));
    }
    let max_val = Money::from_non_negative(unit_value, "Tarif consigne")?
        .checked_mul(input.pieces, "Valeur consignée retournée")?;
    let total_counterpart =
        refund_amount.checked_add(credit_reduction, "Contrepartie retour vides")?;
    if total_counterpart > max_val {
        return Err(CoreError::InvalidPayment(format!(
            "La contrepartie ({}) dépasse la valeur consignée ({}).",
            total_counterpart.value(),
            max_val.value()
        )));
    }

    apply_return_credit_reduction_tx(&mut tx, sale_id, credit_reduction).await?;

    if refund_amount.value() > 0 && is_cash == 1 {
        let avail = get_theoretical_cash_tx(&mut tx, session_id, opening_cash).await?;
        if refund_amount.value() > avail {
            return Err(CoreError::InvalidPayment(
                "Espèces en caisse insuffisantes pour rembourser la consigne.".to_string(),
            ));
        }
    }

    let bal: Option<(i64,)> =
        sqlx::query_as("SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?")
            .bind(returnable_id)
            .fetch_optional(&mut *tx)
            .await?;
    let before = bal.map(|b| b.0).unwrap_or(0);
    let after = if input.condition_state == "good" {
        before
            .checked_add(input.pieces)
            .ok_or_else(|| CoreError::Validation("Débordement du stock de vides.".to_string()))?
    } else {
        before
    };

    if input.condition_state == "good" {
        sqlx::query(
            "INSERT INTO returnable_stock_balances (packaging_id, quantity) VALUES (?, ?)
             ON CONFLICT(packaging_id) DO UPDATE SET quantity = excluded.quantity",
        )
        .bind(returnable_id)
        .bind(after)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE packaging_assets SET stock_empty = stock_empty + ? WHERE returnable_id = ?",
        )
        .bind(input.pieces)
        .bind(returnable_id)
        .execute(&mut *tx)
        .await?;
    }

    let mov_type = if input.condition_state == "good" {
        "entry"
    } else {
        "breakage"
    };
    let mov_id = sqlx::query(
        "INSERT INTO returnable_stock_movements (request_key, packaging_id, movement_type, quantity, stock_before, stock_after, reason, reference_document, customer_id, unit_deposit_value, total_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(format!("ret-vides:{request_key}"))
    .bind(returnable_id)
    .bind(mov_type)
    .bind(input.pieces)
    .bind(before)
    .bind(after)
    .bind(format!("Retour client ({}) : {reason}", input.condition_state))
    .bind(format!("VENTE-{sale_id}"))
    .bind(client_id)
    .bind(unit_value)
    .bind(max_val.value())
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    let next_status = if returned_pieces + input.pieces + other_out_pieces >= pieces {
        if converted_pieces > 0 {
            "converted"
        } else {
            "settled"
        }
    } else {
        "partially_returned"
    };
    sqlx::query(
        "UPDATE deposit_issues
         SET returned_pieces = returned_pieces + ?,
             status = ?,
             updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(input.pieces)
    .bind(next_status)
    .bind(issue_id)
    .execute(&mut *tx)
    .await?;

    update_client_packaging_balance_tx(
        &mut tx,
        client_id,
        issue_id,
        returnable_id,
        input.pieces,
        unit_value,
    )
    .await?;

    let reference = DepotDb::next_sequence(&mut tx, "RVE").await?;
    if refund_amount.value() > 0 {
        sqlx::query(
            "INSERT INTO cash_movements (session_id, request_key, kind, method_code, direction, amount, description, reference_document)
             VALUES (?, ?, 'deposit_refund', ?, 'out', ?, ?, ?)",
        )
        .bind(session_id)
        .bind(format!("dep-ref:{request_key}"))
        .bind(&pm_code)
        .bind(refund_amount.value())
        .bind(format!("Remboursement consigne {reference} ({reason})"))
        .bind(&reference)
        .execute(&mut *tx)
        .await?;
    }

    let ret_id = sqlx::query(
        "INSERT INTO deposit_returns (reference, request_key, issue_id, client_id, returnable_id, session_id, stock_movement_id, pieces, condition_state, refund_amount, credit_reduction, method_code, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&reference)
    .bind(&request_key)
    .bind(issue_id)
    .bind(client_id)
    .bind(returnable_id)
    .bind(session_id)
    .bind(mov_id)
    .bind(input.pieces)
    .bind(&input.condition_state)
    .bind(refund_amount.value())
    .bind(credit_reduction.value())
    .bind(&pm_code)
    .bind(&reason)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    audit_log_tx(
        &mut tx,
        "DEPOSIT_RETURN",
        "deposit_returns",
        Some(ret_id.to_string()),
        &format!(
            "{reference} — {} pièces ({})",
            input.pieces, input.condition_state
        ),
    )
    .await?;
    tx.commit().await?;

    fetch_deposit_return_by_id(db, ret_id).await
}
