// ============================================================================
// Opérations SQLite : retours partiels d'emballages & suivi des reliquats
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{
    CreatePartialReturnInput, PartialReturnItemDto, PartialReturnOverviewDto,
    PendingPartialReturnDto, UpdatePendingReturnInput,
};

pub async fn get_partial_returns_overview(db: &DepotDb) -> CoreResult<PartialReturnOverviewDto> {
    require_current_actor_permission(Permission::ConsignmentsRead)?;

    let pending_returns = sqlx::query_as::<_, PendingPartialReturnDto>(
        "SELECT ppr.id, ppr.client_id, c.name AS client_name, COALESCE(ppr.sale_id, 0) AS sale_id,
                COALESCE(s.reference, '') AS sale_reference,
                ppr.total_expected_pieces, ppr.total_returned_pieces, ppr.remaining_pieces, ppr.status,
                ppr.created_at, COALESCE(ppr.last_updated_at, ppr.updated_at, ppr.created_at) AS last_updated_at
         FROM pending_partial_returns ppr
         JOIN clients c ON c.id = ppr.client_id
         LEFT JOIN sales s ON s.id = ppr.sale_id
         WHERE ppr.status IN ('pending', 'processing')
         ORDER BY ppr.created_at DESC",
    )
    .fetch_all(&db.pool)
    .await?;

    let recent_partial_returns = sqlx::query_as::<_, PartialReturnItemDto>(
        "SELECT pri.id, pri.return_id, pri.component_type, pri.component_profile_id, pri.crate_type_id,
                pri.pieces_returned AS quantity, pri.condition_state,
                pri.unit_deposit_value AS unit_refund_value,
                pri.line_amount AS total_refund_amount,
                CAST(1 AS BOOLEAN) AS is_accepted
         FROM partial_return_items pri
         ORDER BY pri.id DESC LIMIT 50",
    )
    .fetch_all(&db.pool)
    .await?;

    Ok(PartialReturnOverviewDto {
        pending_returns,
        recent_partial_returns,
    })
}

pub async fn create_partial_return(
    db: &DepotDb,
    input: CreatePartialReturnInput,
) -> CoreResult<Vec<PartialReturnItemDto>> {
    require_current_actor_permission(Permission::ConsignmentsWrite)?;
    let req_key = input.request_key.trim();
    if req_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    if input.items.is_empty() {
        return Err(CoreError::Validation(
            "Ajoutez au moins un composant d'emballage à retourner.".to_string(),
        ));
    }
    let clean_reason = input.reason.trim();
    if clean_reason.is_empty() {
        return Err(CoreError::Validation(
            "Le motif du retour partiel est obligatoire.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;

    let (session_id, _sref, _opening_cash) =
        crate::application::sales::require_open_session_tx(&mut tx).await?;

    let sale: Option<(i64, String)> =
        sqlx::query_as("SELECT s.id, s.status FROM sales s WHERE s.id = ?")
            .bind(input.sale_id)
            .fetch_optional(&mut *tx)
            .await?;

    let (_sale_id, sale_status) = sale
        .ok_or_else(|| CoreError::Validation(format!("Vente ID {} introuvable", input.sale_id)))?;
    if sale_status == "cancelled" {
        return Err(CoreError::Validation(format!(
            "Vente ID {} annulée : retour partiel impossible",
            input.sale_id
        )));
    }

    let fallback_returnable_id: i64 = sqlx::query_scalar(
        "SELECT COALESCE(
            (SELECT di.returnable_id FROM deposit_issues di WHERE di.sale_id = ? AND di.status != 'returned' ORDER BY di.id ASC LIMIT 1),
            (SELECT id FROM returnable_packaging_types ORDER BY id ASC LIMIT 1)
        )",
    )
    .bind(input.sale_id)
    .fetch_optional(&mut *tx)
    .await?
    .flatten()
    .ok_or_else(|| {
        CoreError::Validation(
            "Aucun type d'emballage consigné n'est configuré pour rattacher ce retour partiel."
                .to_string(),
        )
    })?;

    let mut return_items = Vec::new();

    for (idx, item) in input.items.iter().enumerate() {
        if item.quantity <= 0 {
            return Err(CoreError::Validation(
                "La quantité retournée doit être strictement positive.".to_string(),
            ));
        }
        if !matches!(
            item.component_type.as_str(),
            "crate_support" | "bottle" | "cap" | "label" | "crate_assembled" | "other"
        ) {
            return Err(CoreError::Validation(format!(
                "Type de composant invalide : {}",
                item.component_type
            )));
        }

        let comp_row: Option<(i64, i64, i64)> = sqlx::query_as(
            "SELECT id, stock_quantity, deposit_value FROM packaging_component_stock
             WHERE component_type = ? AND component_profile_id IS NOT DISTINCT FROM ? AND crate_type_id IS NOT DISTINCT FROM ?",
        )
        .bind(&item.component_type)
        .bind(item.component_profile_id)
        .bind(item.crate_type_id)
        .fetch_optional(&mut *tx)
        .await?;

        let (stock_before, deposit_value) = comp_row
            .map(|(_id, sq, dv)| (sq, dv))
            .unwrap_or((0, 0));

        let refund_multiplier = match item.condition_state.as_str() {
            "good" => 100,
            "damaged" => 50,
            "lost" => 0,
            _ => 100,
        };

        let unit_refund_value = (deposit_value * refund_multiplier) / 100;
        let total_item_refund = unit_refund_value.saturating_mul(item.quantity);
        let stock_delta = if item.condition_state == "good" {
            item.quantity
        } else {
            0
        };
        let stock_after = stock_before.saturating_add(stock_delta);

        if let Some((comp_id, _, _)) = comp_row {
            sqlx::query(
                "UPDATE packaging_component_stock
                 SET stock_quantity = ?, updated_at = datetime('now')
                 WHERE id = ?",
            )
            .bind(stock_after)
            .bind(comp_id)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO packaging_component_stock (component_type, component_profile_id, crate_type_id, stock_quantity, deposit_value)
                 VALUES (?, ?, ?, ?, 0)",
            )
            .bind(&item.component_type)
            .bind(item.component_profile_id)
            .bind(item.crate_type_id)
            .bind(stock_after)
            .execute(&mut *tx)
            .await?;
        }

        let mov_comp_type = if item.component_type == "crate_assembled" {
            "other"
        } else {
            item.component_type.as_str()
        };
        sqlx::query(
            "INSERT INTO packaging_component_movements (component_type, component_profile_id, crate_type_id,
                                                        movement_type, quantity, stock_before, stock_after, reason)
             VALUES (?, ?, ?, 'return', ?, ?, ?, ?)",
        )
        .bind(mov_comp_type)
        .bind(item.component_profile_id)
        .bind(item.crate_type_id)
        .bind(item.quantity)
        .bind(stock_before)
        .bind(stock_after)
        .bind(clean_reason)
        .execute(&mut *tx)
        .await?;

        let rsb_before: i64 = sqlx::query_scalar(
            "SELECT COALESCE((SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?), 0)",
        )
        .bind(fallback_returnable_id)
        .fetch_one(&mut *tx)
        .await?;
        let rsb_mov_type = match item.condition_state.as_str() {
            "damaged" => "breakage",
            "lost" => "loss",
            _ => "entry",
        };
        let item_req_key = format!("part-ret:{req_key}:{idx}");
        let stock_mov_id = sqlx::query(
            "INSERT INTO returnable_stock_movements (request_key, packaging_id, movement_type, quantity, stock_before, stock_after, reason, customer_id, unit_deposit_value, total_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("mov:{item_req_key}"))
        .bind(fallback_returnable_id)
        .bind(rsb_mov_type)
        .bind(item.quantity)
        .bind(rsb_before)
        .bind(rsb_before)
        .bind(clean_reason)
        .bind(input.client_id)
        .bind(unit_refund_value)
        .bind(total_item_refund)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();

        let ret_ref = DepotDb::next_sequence(&mut tx, "RPR").await?;
        let db_condition = if item.condition_state == "good" {
            "good"
        } else {
            "damaged"
        };
        let return_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO deposit_returns (reference, request_key, client_id, returnable_id, session_id, stock_movement_id, pieces, condition_state, refund_amount, credit_reduction, method_code, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
             RETURNING id",
        )
        .bind(&ret_ref)
        .bind(&item_req_key)
        .bind(input.client_id)
        .bind(fallback_returnable_id)
        .bind(session_id)
        .bind(stock_mov_id)
        .bind(item.quantity)
        .bind(db_condition)
        .bind(total_item_refund)
        .bind(&input.payment_method_code)
        .bind(clean_reason)
        .fetch_one(&mut *tx)
        .await?;

        let item_cond = match item.condition_state.as_str() {
            "good" => "good",
            "damaged" => "damaged",
            "broken" => "broken",
            "lost" => "lost",
            _ => "damaged",
        };
        let item_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO partial_return_items (return_id, line_item_index, component_type, component_profile_id, crate_type_id,
                                                pieces_returned, condition_state, unit_deposit_value, line_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id",
        )
        .bind(return_id)
        .bind(idx as i64)
        .bind(&item.component_type)
        .bind(item.component_profile_id)
        .bind(item.crate_type_id)
        .bind(item.quantity)
        .bind(item_cond)
        .bind(unit_refund_value)
        .bind(total_item_refund)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE customer_packaging_component_balances
             SET balance_pieces = MAX(0, balance_pieces - ?),
                 deposit_held_amount = MAX(0, deposit_held_amount - ?),
                 last_transaction_at = datetime('now')
             WHERE client_id = ?
               AND component_type = ?
               AND component_profile_id IS NOT DISTINCT FROM ?
               AND crate_type_id IS NOT DISTINCT FROM ?",
        )
        .bind(item.quantity)
        .bind(total_item_refund)
        .bind(input.client_id)
        .bind(&item.component_type)
        .bind(item.component_profile_id)
        .bind(item.crate_type_id)
        .execute(&mut *tx)
        .await?;

        return_items.push(PartialReturnItemDto {
            id: item_id,
            return_id,
            component_type: item.component_type.clone(),
            component_profile_id: item.component_profile_id,
            crate_type_id: item.crate_type_id,
            quantity: item.quantity,
            condition_state: item_cond.to_string(),
            unit_refund_value,
            total_refund_amount: total_item_refund,
            is_accepted: true,
        });
    }

    tx.commit().await?;

    Ok(return_items)
}

pub async fn create_pending_partial_return(
    db: &DepotDb,
    client_id: i64,
    sale_id: i64,
    total_expected_pieces: i64,
) -> CoreResult<PendingPartialReturnDto> {
    require_current_actor_permission(Permission::ConsignmentsWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO pending_partial_returns (client_id, sale_id, expected_components, received_components, total_expected_pieces, remaining_pieces, status)
         VALUES (?, ?, '[]', '[]', ?, ?, 'pending')
         RETURNING id",
    )
    .bind(client_id)
    .bind(sale_id)
    .bind(total_expected_pieces)
    .bind(total_expected_pieces)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    let pending_return = sqlx::query_as::<_, PendingPartialReturnDto>(
        "SELECT ppr.id, ppr.client_id, c.name AS client_name, COALESCE(ppr.sale_id, 0) AS sale_id,
                COALESCE(s.reference, '') AS sale_reference,
                ppr.total_expected_pieces, ppr.total_returned_pieces, ppr.remaining_pieces, ppr.status,
                ppr.created_at, COALESCE(ppr.last_updated_at, ppr.updated_at, ppr.created_at) AS last_updated_at
         FROM pending_partial_returns ppr
         JOIN clients c ON c.id = ppr.client_id
         LEFT JOIN sales s ON s.id = ppr.sale_id
         WHERE ppr.id = ?",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await?;

    Ok(pending_return)
}

pub async fn update_pending_return(
    db: &DepotDb,
    input: UpdatePendingReturnInput,
) -> CoreResult<PendingPartialReturnDto> {
    require_current_actor_permission(Permission::ConsignmentsWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;

    let (prev_returned, prev_remaining): (i64, i64) = sqlx::query_as(
        "SELECT ppr.total_returned_pieces, ppr.remaining_pieces
         FROM pending_partial_returns ppr
         WHERE ppr.id = ?",
    )
    .bind(input.pending_return_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        CoreError::Validation(format!(
            "Retour en attente ID {} introuvable",
            input.pending_return_id
        ))
    })?;

    let delta_pieces: i64 = input.items.iter().map(|i| i.quantity.max(0)).sum();
    let new_returned_pieces = prev_returned + delta_pieces;
    let new_remaining = prev_remaining - delta_pieces;

    if new_remaining < 0 {
        return Err(CoreError::Validation(format!(
            "Trop de pièces retournées : restant = {}, retour = {}",
            prev_remaining, delta_pieces
        )));
    }

    let normalized_status = match input.status.as_str() {
        "completed" => "completed",
        "cancelled" => "cancelled",
        "pending" if new_returned_pieces == 0 => "pending",
        _ if new_remaining == 0 => "completed",
        _ => "processing",
    };

    sqlx::query(
        "UPDATE pending_partial_returns
         SET total_returned_pieces = ?, remaining_pieces = ?, status = ?,
             last_updated_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(new_returned_pieces)
    .bind(new_remaining)
    .bind(normalized_status)
    .bind(input.pending_return_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let updated_return = sqlx::query_as::<_, PendingPartialReturnDto>(
        "SELECT ppr.id, ppr.client_id, c.name AS client_name, COALESCE(ppr.sale_id, 0) AS sale_id,
                COALESCE(s.reference, '') AS sale_reference,
                ppr.total_expected_pieces, ppr.total_returned_pieces, ppr.remaining_pieces, ppr.status,
                ppr.created_at, COALESCE(ppr.last_updated_at, ppr.updated_at, ppr.created_at) AS last_updated_at
         FROM pending_partial_returns ppr
         JOIN clients c ON c.id = ppr.client_id
         LEFT JOIN sales s ON s.id = ppr.sale_id
         WHERE ppr.id = ?",
    )
    .bind(input.pending_return_id)
    .fetch_one(&db.pool)
    .await?;

    Ok(updated_return)
}
