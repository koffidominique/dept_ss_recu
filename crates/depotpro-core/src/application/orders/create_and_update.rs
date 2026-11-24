// ============================================================================
// Création (draft) et mise à jour de commandes mixtes
// ============================================================================

use crate::application::auth::{current_actor, require_current_actor_permission, Permission};
use crate::application::sales::audit_log_tx;

use super::packaging_and_returns::apply_customer_empty_return_tx;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::composition::compute_order_totals_with_delivery;
use super::composition_resolve::resolve_preview_lines_tx;
use super::create_helpers::{
    check_min_selling_prices_tx, generate_order_number_tx, resolve_allocations_tx,
    write_lines_and_allocations_tx,
};
use super::dtos::{CreateOrderInput, OrderDetailDto, UpdateOrderInput};
use super::queries::get_order;

pub(crate) fn normalize_order_payment_channel(
    payment_method: Option<&str>,
    planned_channel: Option<&str>,
) -> (Option<&'static str>, Option<String>) {
    let raw = planned_channel
        .or(payment_method)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(val) = raw else {
        return (None, None);
    };
    let lower = val.to_ascii_lowercase();
    match lower.as_str() {
        "wave" => (Some("mobile_money"), Some("wave".to_string())),
        "orange_money" | "orange money" => (Some("mobile_money"), Some("orange_money".to_string())),
        "mtn_money" | "mtn_momo" | "mtn momo" => {
            (Some("mobile_money"), Some("mtn_money".to_string()))
        }
        "moov_money" | "moov money" => (Some("mobile_money"), Some("moov_money".to_string())),
        "mobile_money" | "mobile money" => (Some("mobile_money"), Some("mobile_money".to_string())),
        "cash" | "espèces" | "especes" => (Some("cash"), Some("cash".to_string())),
        "credit" | "crédit" => (Some("credit"), Some("credit".to_string())),
        "mixed" | "mixte" => (Some("mixed"), Some("mixed".to_string())),
        "other" | "autre" => (None, Some("other".to_string())),
        _ => (None, Some(lower)),
    }
}

fn normalize_delivery_mode(raw: Option<&str>, has_address_or_date: bool) -> &'static str {
    match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("delivery" | "livraison") => "delivery",
        Some("pickup" | "retrait" | "enlevement") => "pickup",
        _ => {
            if has_address_or_date {
                "delivery"
            } else {
                "pickup"
            }
        }
    }
}

pub async fn create_order(db: &DepotDb, input: CreateOrderInput) -> CoreResult<OrderDetailDto> {
    require_current_actor_permission(Permission::SalesWrite)?;
    if input.lines.is_empty() {
        return Err(CoreError::Validation(
            "La commande doit contenir au moins une ligne produit.".to_string(),
        ));
    }
    let (_guard, mut tx) = db.begin_write().await?;
    let client_ok: Option<i64> =
        sqlx::query_scalar("SELECT id FROM clients WHERE id = ? AND is_active = 1")
            .bind(input.customer_id)
            .fetch_optional(&mut *tx)
            .await?;
    if client_ok.is_none() {
        return Err(CoreError::NotFound("Client introuvable ou inactif.".into()));
    }

    let (lines, native_caps) = resolve_preview_lines_tx(&mut tx, &input.lines).await?;
    check_min_selling_prices_tx(&mut tx, &lines, input.allow_price_override.unwrap_or(false))
        .await?;
    let allocations =
        resolve_allocations_tx(&mut tx, &lines, &native_caps, input.allocations.as_deref()).await?;
    let delivery_fee = input.delivery_fee_xof.unwrap_or(0).max(0);
    let totals = compute_order_totals_with_delivery(
        &lines,
        &allocations,
        input.discount_xof.unwrap_or(0).max(0),
        input.tax_xof.unwrap_or(0).max(0),
        delivery_fee,
    );
    let order_number = generate_order_number_tx(&mut tx).await?;
    let order_type = input
        .order_type
        .as_deref()
        .filter(|t| matches!(*t, "vente" | "retour" | "mixte"))
        .unwrap_or(if lines.len() > 1 { "mixte" } else { "vente" });
    let actor_id = current_actor().and_then(|a| a.user_id.parse::<i64>().ok());
    let (norm_pm, planned_channel) = normalize_order_payment_channel(
        input.payment_method.as_deref(),
        input.planned_payment_channel.as_deref(),
    );
    let has_delivery_hints = input
        .delivery_address
        .as_deref()
        .is_some_and(|s| !s.trim().is_empty())
        || input
            .courier_name
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty());
    let delivery_mode = normalize_delivery_mode(input.delivery_mode.as_deref(), has_delivery_hints);
    let clean_opt = |opt: &Option<String>| -> Option<String> {
        opt.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };

    let order_id = sqlx::query(
        "INSERT INTO orders (
            order_number, customer_id, order_type, status, subtotal_xof, deposit_total_xof,
            discount_xof, tax_xof, delivery_fee_xof, total_xof, deposit_due_xof, total_to_collect_xof,
            payment_method, planned_payment_channel, delivery_mode, courier_name,
            planned_delivery_time, delivery_date, delivery_address, delivery_landmark, notes, created_by
         ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&order_number)
    .bind(input.customer_id)
    .bind(order_type)
    .bind(totals.subtotal_xof)
    .bind(totals.deposit_total_xof)
    .bind(totals.discount_xof)
    .bind(totals.tax_xof)
    .bind(totals.delivery_fee_xof)
    .bind(totals.total_xof)
    .bind(totals.deposit_due_xof)
    .bind(totals.total_to_collect_xof)
    .bind(norm_pm)
    .bind(planned_channel.as_deref())
    .bind(delivery_mode)
    .bind(clean_opt(&input.courier_name))
    .bind(clean_opt(&input.planned_delivery_time))
    .bind(clean_opt(&input.delivery_date))
    .bind(clean_opt(&input.delivery_address))
    .bind(clean_opt(&input.delivery_landmark))
    .bind(clean_opt(&input.notes))
    .bind(actor_id)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    write_lines_and_allocations_tx(
        &mut tx,
        order_id,
        &lines,
        &input.lines,
        &allocations,
        input.allocations.as_deref(),
    )
    .await?;
    // Vides rapportes au comptoir : appliques DANS la transaction de la
    // commande. Si un retour est invalide, la commande entiere est annulee —
    // c'est voulu : une commande enregistree avec des consignes non deduites
    // laisserait le client avec une dette qu'il vient justement de payer.
    if let Some(retours) = input.returned_empties.as_deref() {
        if !retours.is_empty() {
            let acteur = current_actor();
            if acteur
                .as_ref()
                .map(|a| !a.has_permission(Permission::ConsignmentsWrite))
                .unwrap_or(true)
            {
                return Err(CoreError::Validation(
                    "Le retour d'emballages vides exige la permission consignments:write."
                        .to_string(),
                ));
            }
            for retour in retours {
                if retour.quantity <= 0 {
                    continue;
                }
                apply_customer_empty_return_tx(
                    &mut tx,
                    input.customer_id,
                    None,
                    None,
                    retour.packaging_asset_id,
                    retour.quantity,
                    Some("Retour saisi à la commande"),
                )
                .await?;
            }
        }
    }

    audit_log_tx(
        &mut tx,
        "create_order",
        "order",
        Some(order_id.to_string()),
        &format!(
            "Commande {} créée ({} lignes, {} allocations)",
            order_number,
            lines.len(),
            allocations.len()
        ),
    )
    .await?;
    tx.commit().await?;
    get_order(db, order_id).await
}

pub async fn update_order(
    db: &DepotDb,
    id: i64,
    input: UpdateOrderInput,
) -> CoreResult<OrderDetailDto> {
    require_current_actor_permission(Permission::SalesWrite)?;
    let (_guard, mut tx) = db.begin_write().await?;
    let current: Option<(String, i64, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT status, subtotal_xof, discount_xof, tax_xof, deposit_due_xof, delivery_fee_xof
         FROM orders WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (status, cur_sub, cur_disc, cur_tax, cur_dep, cur_fee) =
        current.ok_or_else(|| CoreError::NotFound("Commande introuvable.".into()))?;
    if status != "draft" {
        return Err(CoreError::Validation(
            "Seule une commande en brouillon (draft) peut être modifiée.".to_string(),
        ));
    }
    let approval_status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM commercial_document_workflows WHERE document_type = 'customer_order' AND document_id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    if matches!(
        approval_status.as_deref(),
        Some("pending_owner_approval" | "approved")
    ) {
        return Err(CoreError::Validation(
            "Une commande soumise ou approuvée ne peut pas être modifiée. Demandez une modification au propriétaire.".into(),
        ));
    }

    let next_discount = input.discount_xof.unwrap_or(cur_disc).max(0);
    let next_tax = input.tax_xof.unwrap_or(cur_tax).max(0);
    let next_fee = input.delivery_fee_xof.unwrap_or(cur_fee).max(0);

    if let Some(ref raw_lines) = input.lines {
        if raw_lines.is_empty() {
            return Err(CoreError::Validation(
                "La commande doit contenir au moins une ligne.".into(),
            ));
        }
        sqlx::query("DELETE FROM order_lines WHERE order_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM order_packaging_allocations WHERE order_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let (lines, native_caps) = resolve_preview_lines_tx(&mut tx, raw_lines).await?;
        check_min_selling_prices_tx(&mut tx, &lines, input.allow_price_override.unwrap_or(false))
            .await?;
        let allocs =
            resolve_allocations_tx(&mut tx, &lines, &native_caps, input.allocations.as_deref())
                .await?;
        let totals =
            compute_order_totals_with_delivery(&lines, &allocs, next_discount, next_tax, next_fee);
        write_lines_and_allocations_tx(
            &mut tx,
            id,
            &lines,
            raw_lines,
            &allocs,
            input.allocations.as_deref(),
        )
        .await?;
        sqlx::query(
            "UPDATE orders SET subtotal_xof = ?, deposit_total_xof = ?, discount_xof = ?, tax_xof = ?,
             delivery_fee_xof = ?, total_xof = ?, deposit_due_xof = ?, total_to_collect_xof = ?, updated_at = datetime('now')
             WHERE id = ?",
        )
        .bind(totals.subtotal_xof)
        .bind(totals.deposit_total_xof)
        .bind(totals.discount_xof)
        .bind(totals.tax_xof)
        .bind(totals.delivery_fee_xof)
        .bind(totals.total_xof)
        .bind(totals.deposit_due_xof)
        .bind(totals.total_to_collect_xof)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    } else if input.discount_xof.is_some()
        || input.tax_xof.is_some()
        || input.delivery_fee_xof.is_some()
    {
        let next_total_xof = (cur_sub + next_tax - next_discount).max(0);
        let next_collect = next_total_xof + cur_dep + next_fee;
        sqlx::query(
            "UPDATE orders SET discount_xof = ?, tax_xof = ?, delivery_fee_xof = ?, total_xof = ?, total_to_collect_xof = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(next_discount)
        .bind(next_tax)
        .bind(next_fee)
        .bind(next_total_xof)
        .bind(next_collect)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    if let Some(cid) = input.customer_id {
        sqlx::query("UPDATE orders SET customer_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(cid)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if input.payment_method.is_some() || input.planned_payment_channel.is_some() {
        let planned_inner = input
            .planned_payment_channel
            .as_ref()
            .and_then(|o| o.as_deref());
        let (norm_pm, channel) =
            normalize_order_payment_channel(input.payment_method.as_deref(), planned_inner);
        sqlx::query(
            "UPDATE orders SET payment_method = ?, planned_payment_channel = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(norm_pm)
        .bind(channel.as_deref())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref mode) = input.delivery_mode {
        let clean_mode = normalize_delivery_mode(Some(mode.as_str()), false);
        sqlx::query(
            "UPDATE orders SET delivery_mode = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(clean_mode)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref val) = input.courier_name {
        sqlx::query(
            "UPDATE orders SET courier_name = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(val.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref val) = input.planned_delivery_time {
        sqlx::query(
            "UPDATE orders SET planned_delivery_time = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(val.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref val) = input.delivery_date {
        sqlx::query(
            "UPDATE orders SET delivery_date = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(val.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref val) = input.delivery_address {
        sqlx::query(
            "UPDATE orders SET delivery_address = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(val.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref val) = input.delivery_landmark {
        sqlx::query(
            "UPDATE orders SET delivery_landmark = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(val.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref val) = input.notes {
        sqlx::query("UPDATE orders SET notes = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(val.as_deref().map(str::trim).filter(|s| !s.is_empty()))
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    get_order(db, id).await
}
