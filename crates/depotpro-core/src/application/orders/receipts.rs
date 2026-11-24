// ============================================================================
// Accusé de commande clientèle : émission idempotente et snapshot immuable
// ============================================================================

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, Transaction};

use crate::application::auth::{current_actor, require_current_actor_permission, Permission, Role};
use crate::application::reports::AppSettingsDto;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::dtos::{
    CustomerDepositBalanceDto, OrderDetailDto, OrderLineDto, OrderLinePackagingLinkDto,
    OrderPackagingAllocationDto, OrderSummaryDto,
};
use super::receipt_pdf_input::{build_receipt_pdf_input, CustomerReceiptProfile};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CustomerOrderReceiptSnapshotDto {
    pub id: i64,
    pub order_id: i64,
    pub version: i64,
    pub receipt_number: String,
    pub snapshot_json: String,
    pub issued_at: String,
    pub issued_by_user_id: Option<String>,
    pub issued_by_name: String,
    pub issued_by_role: String,
    pub revision_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCustomerOrderReceiptRevisionInput {
    pub reason: String,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReceiptPaymentSnapshot {
    pub(super) reference: String,
    pub(super) payment_note: Option<String>,
    pub(super) external_reference: Option<String>,
    pub(super) recorded_by_name: Option<String>,
    pub(super) paid_at: String,
    pub(super) method_code: String,
    pub(super) method_label: String,
    pub(super) amount_xof: i64,
}

#[derive(FromRow)]
struct CustomerRow {
    id: i64,
    code: String,
    name: String,
    client_type: String,
    establishment_name: Option<String>,
    category: Option<String>,
    phone: Option<String>,
    address: Option<String>,
    city: Option<String>,
    commune: Option<String>,
    quartier: Option<String>,
    landmark: Option<String>,
    contact_person: Option<String>,
}

async fn load_order_detail_tx(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: i64,
) -> CoreResult<OrderDetailDto> {
    let order = sqlx::query_as::<_, OrderSummaryDto>(
        "SELECT o.id, o.order_number, o.customer_id, c.name AS customer_name, o.order_type, o.status,
                w.status AS approval_status, o.subtotal_xof, o.deposit_total_xof, o.discount_xof, o.tax_xof,
                o.delivery_fee_xof, o.total_xof, o.deposit_due_xof, o.total_to_collect_xof, o.paid_xof,
                o.payment_status, o.payment_method, o.planned_payment_channel, o.delivery_mode,
                o.courier_name, o.planned_delivery_time, o.delivery_date, o.delivery_address,
                o.delivery_landmark, o.notes, o.created_at, o.updated_at
         FROM orders o
         JOIN clients c ON c.id = o.customer_id
         LEFT JOIN commercial_document_workflows w ON w.document_type = 'customer_order' AND w.document_id = o.id
         WHERE o.id = ?",
    )
    .bind(order_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::NotFound("Commande introuvable.".into()))?;

    let lines = sqlx::query_as::<_, OrderLineDto>(
        "SELECT ol.id, ol.order_id, ol.product_id, p.name AS product_name, p.base_unit, ol.variant_id,
                pv.name AS variant_name, pv.compatibility_class, ol.requested_unit,
                ol.requested_quantity, ol.base_quantity, ol.unit_price_xof, ol.line_total_xof,
                ol.discount_xof, ol.notes
         FROM order_lines ol
         JOIN products p ON p.id = ol.product_id
         JOIN product_variants pv ON pv.id = ol.variant_id
         WHERE ol.order_id = ? ORDER BY ol.id ASC",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;

    let allocations = sqlx::query_as::<_, OrderPackagingAllocationDto>(
        "SELECT opa.id, opa.order_id, opa.packaging_asset_id, pa.name AS packaging_name,
                pa.compatibility_class, pa.capacity, opa.quantity, opa.is_consigned,
                opa.deposit_amount_xof, opa.provided_by, opa.returned_quantity, opa.notes
         FROM order_packaging_allocations opa
         JOIN packaging_assets pa ON pa.id = opa.packaging_asset_id
         WHERE opa.order_id = ? ORDER BY opa.id ASC",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;

    let links = sqlx::query_as::<_, OrderLinePackagingLinkDto>(
        "SELECT l.id, l.order_line_id, l.order_packaging_allocation_id, l.units_in_packaging
         FROM order_line_packaging_links l
         JOIN order_lines ol ON ol.id = l.order_line_id
         WHERE ol.order_id = ? ORDER BY l.id ASC",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;

    let customer_deposits = sqlx::query_as::<_, CustomerDepositBalanceDto>(
        "SELECT cdb.id, cdb.customer_id, cdb.packaging_asset_id, pa.name AS packaging_name,
                pa.compatibility_class, pa.deposit_value, cdb.quantity_held, cdb.amount_held_xof,
                cdb.last_movement_at
         FROM customer_deposit_balances cdb
         JOIN packaging_assets pa ON pa.id = cdb.packaging_asset_id
         WHERE cdb.customer_id = ? AND cdb.quantity_held > 0
         ORDER BY pa.name ASC",
    )
    .bind(order.customer_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(OrderDetailDto {
        order,
        lines,
        allocations,
        links,
        customer_deposits,
    })
}

async fn load_settings_tx(tx: &mut Transaction<'_, Sqlite>) -> CoreResult<AppSettingsDto> {
    Ok(sqlx::query_as::<_, AppSettingsDto>(
        "SELECT company_name, company_legal_name, business_activity, address, phone, whatsapp, email,
                city, commune, quartier, country, rccm, ncc, currency, allow_negative_stock,
                invoice_prefix, sale_prefix, purchase_prefix, order_prefix, receipt_prefix,
                credit_note_prefix, theme, logo_path, setup_completed
         FROM app_settings WHERE id = 1",
    )
    .fetch_one(&mut **tx)
    .await?)
}

#[allow(clippy::too_many_arguments)]
async fn build_and_insert_snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: i64,
    version: i64,
    receipt_number: &str,
    issuer_id: Option<&str>,
    issuer_name: &str,
    issuer_role: &str,
    revision_reason: Option<&str>,
    company_override: Option<serde_json::Value>,
    supersedes_receipt_number: Option<&str>,
) -> CoreResult<CustomerOrderReceiptSnapshotDto> {
    let order = load_order_detail_tx(tx, order_id).await?;
    if order.order.status == "draft"
        || order.order.status == "cancelled"
        || order.order.approval_status.as_deref() == Some("pending_owner_approval")
    {
        return Err(CoreError::Validation(
            "Le reçu ne peut être émis qu’après confirmation et avant annulation de la commande."
                .into(),
        ));
    }

    let company_value = match company_override {
        Some(v) => v,
        None => {
            let settings = load_settings_tx(tx).await?;
            serde_json::to_value(settings)
                .map_err(|e| CoreError::Internal(format!("Sérialisation société : {e}")))?
        }
    };

    let customer: CustomerRow = sqlx::query_as(
        "SELECT id, code, name, client_type, establishment_name, category, phone, address, city,
                commune, quartier, landmark, contact_person
         FROM clients WHERE id = ?",
    )
    .bind(order.order.customer_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::NotFound("Client de la commande introuvable.".into()))?;

    let payments: Vec<ReceiptPaymentSnapshot> = sqlx::query_as(
        "SELECT p.reference, p.note AS payment_note, p.external_reference, p.recorded_by_name,
                p.created_at AS paid_at, pp.method_code, COALESCE(pm.label, pp.method_code) AS method_label,
                pp.amount AS amount_xof
         FROM payments p
         JOIN payment_parts pp ON pp.payment_id = p.id
         LEFT JOIN payment_methods pm ON pm.code = pp.method_code
         WHERE p.order_id = ? ORDER BY p.created_at ASC, p.id ASC, pp.id ASC",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;

    let now: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(&mut **tx)
        .await?;

    let customer_profile = CustomerReceiptProfile {
        code: &customer.code,
        name: &customer.name,
        establishment_name: customer.establishment_name.as_deref(),
        category: customer.category.as_deref(),
        phone: customer.phone.as_deref(),
        address: customer.address.as_deref(),
        city: customer.city.as_deref(),
        commune: customer.commune.as_deref(),
        quartier: customer.quartier.as_deref(),
        landmark: customer.landmark.as_deref(),
    };

    let pdf_document = build_receipt_pdf_input(
        &order,
        &customer_profile,
        issuer_name,
        issuer_role,
        receipt_number,
        version,
        revision_reason,
        &now,
        &payments,
    );

    let snapshot = serde_json::json!({
        "documentType": "REÇU DE COMMANDE",
        "receiptNumber": receipt_number,
        "version": version,
        "issuedAt": now,
        "issuer": {
            "userId": issuer_id,
            "name": issuer_name,
            "role": issuer_role,
        },
        "revisionReason": revision_reason,
        "supersedesReceiptNumber": supersedes_receipt_number,
        "company": company_value,
        "customer": {
            "id": customer.id,
            "code": customer.code,
            "name": customer.name,
            "clientType": customer.client_type,
            "establishmentName": customer.establishment_name,
            "category": customer.category,
            "phone": customer.phone,
            "address": customer.address,
            "city": customer.city,
            "commune": customer.commune,
            "quartier": customer.quartier,
            "landmark": customer.landmark,
            "contactPerson": customer.contact_person,
        },
        "orderDetail": order,
        "payments": payments,
        "pdfDocument": pdf_document,
    });
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|e| CoreError::Internal(format!("Sérialisation du reçu impossible : {e}")))?;

    sqlx::query(
        "INSERT OR IGNORE INTO customer_order_receipt_snapshots
            (order_id, version, receipt_number, snapshot_json, issued_at,
             issued_by_user_id, issued_by_name, issued_by_role, revision_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(order_id)
    .bind(version)
    .bind(receipt_number)
    .bind(snapshot_json)
    .bind(&now)
    .bind(issuer_id)
    .bind(issuer_name)
    .bind(issuer_role)
    .bind(revision_reason)
    .execute(&mut **tx)
    .await?;

    sqlx::query_as::<_, CustomerOrderReceiptSnapshotDto>(
        "SELECT id, order_id, version, receipt_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role, revision_reason
         FROM customer_order_receipt_snapshots WHERE order_id = ? AND version = ?",
    )
    .bind(order_id)
    .bind(version)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        CoreError::NotFound("Snapshot du reçu de commande introuvable après émission.".into())
    })
}

pub(crate) async fn ensure_order_receipt_v1_tx(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: i64,
    issuer_id: Option<&str>,
    issuer_name: &str,
    issuer_role: &str,
) -> CoreResult<CustomerOrderReceiptSnapshotDto> {
    if let Some(existing) = sqlx::query_as::<_, CustomerOrderReceiptSnapshotDto>(
        "SELECT id, order_id, version, receipt_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role, revision_reason
         FROM customer_order_receipt_snapshots WHERE order_id = ? AND version = 1",
    )
    .bind(order_id)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(existing);
    }

    let order_number: String = sqlx::query_scalar("SELECT order_number FROM orders WHERE id = ?")
        .bind(order_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| CoreError::NotFound("Commande introuvable.".into()))?;
    let receipt_number = format!("REC-{order_number}");

    build_and_insert_snapshot_tx(
        tx,
        order_id,
        1,
        &receipt_number,
        issuer_id,
        issuer_name,
        issuer_role,
        None,
        None,
        None,
    )
    .await
}

pub async fn issue_or_get_customer_order_receipt(
    db: &DepotDb,
    order_id: i64,
) -> CoreResult<CustomerOrderReceiptSnapshotDto> {
    require_current_actor_permission(Permission::SalesRead)?;
    let actor = current_actor().ok_or_else(|| {
        CoreError::Forbidden("Une session utilisateur est requise pour émettre le reçu.".into())
    })?;
    let (_write_guard, mut tx) = db.begin_write().await?;

    if let Some(existing) = sqlx::query_as::<_, CustomerOrderReceiptSnapshotDto>(
        "SELECT id, order_id, version, receipt_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role, revision_reason
         FROM customer_order_receipt_snapshots WHERE order_id = ? AND version = 1",
    )
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.rollback().await?;
        return Ok(existing);
    }

    let receipt = ensure_order_receipt_v1_tx(
        &mut tx,
        order_id,
        Some(&actor.user_id),
        &actor.display_name,
        actor.role.as_str(),
    )
    .await?;
    tx.commit().await?;
    Ok(receipt)
}

pub async fn list_customer_order_receipt_snapshots(
    db: &DepotDb,
    order_id: i64,
) -> CoreResult<Vec<CustomerOrderReceiptSnapshotDto>> {
    require_current_actor_permission(Permission::SalesRead)?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders WHERE id = ?")
        .bind(order_id)
        .fetch_one(&db.pool)
        .await?;
    if exists == 0 {
        return Err(CoreError::NotFound("Commande introuvable.".into()));
    }
    Ok(sqlx::query_as::<_, CustomerOrderReceiptSnapshotDto>(
        "SELECT id, order_id, version, receipt_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role, revision_reason
         FROM customer_order_receipt_snapshots WHERE order_id = ? ORDER BY version DESC",
    )
    .bind(order_id)
    .fetch_all(&db.pool)
    .await?)
}

/// Crée une nouvelle version explicite du reçu après correction; l'original n'est jamais modifié.
pub async fn create_customer_order_receipt_revision(
    db: &DepotDb,
    order_id: i64,
    reason: String,
) -> CoreResult<CustomerOrderReceiptSnapshotDto> {
    require_current_actor_permission(Permission::SalesWrite)?;
    let actor = current_actor().ok_or_else(|| {
        CoreError::Forbidden("Une session utilisateur est requise pour corriger le reçu.".into())
    })?;
    if actor.role != Role::Owner {
        return Err(CoreError::Forbidden(
            "Seul le propriétaire peut émettre une version corrigée du reçu.".into(),
        ));
    }
    let reason = reason.trim().to_string();
    if reason.len() < 8 || reason.len() > 500 {
        return Err(CoreError::Validation(
            "Le motif de correction doit contenir entre 8 et 500 caractères.".into(),
        ));
    }

    let original = issue_or_get_customer_order_receipt(db, order_id).await?;
    let (_write_guard, mut tx) = db.begin_write().await?;
    let current_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) FROM customer_order_receipt_snapshots WHERE order_id = ?",
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await?;
    let version = current_version + 1;
    let original_snapshot: serde_json::Value = serde_json::from_str(&original.snapshot_json)
        .map_err(|e| CoreError::Internal(format!("Lecture du reçu original impossible : {e}")))?;
    let company_snapshot = original_snapshot.get("company").cloned().ok_or_else(|| {
        CoreError::Validation(
            "L’identité société du reçu original est introuvable; correction refusée.".into(),
        )
    })?;
    let order_number: String = sqlx::query_scalar("SELECT order_number FROM orders WHERE id = ?")
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await?;
    let receipt_number = format!("REC-{order_number}-V{version}");

    let receipt = build_and_insert_snapshot_tx(
        &mut tx,
        order_id,
        version,
        &receipt_number,
        Some(&actor.user_id),
        &actor.display_name,
        actor.role.as_str(),
        Some(&reason),
        Some(company_snapshot),
        Some(&original.receipt_number),
    )
    .await?;
    tx.commit().await?;
    Ok(receipt)
}
