// ============================================================================
// Consultation des bons de commande fournisseurs et de leurs pièces liées
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{
    PurchaseDocumentSnapshotDto, PurchaseOrderDto, PurchaseOrderLineDto, PurchaseOrderRow,
    PurchaseReceiptDetailDto, PurchaseReceiptDto, PurchaseReceiptLineDto,
    PurchaseReceiptSnapshotDto, SupplierDebtDto, SupplierPackagingExchangeLineDto,
};

pub async fn list_purchase_orders(db: &DepotDb) -> CoreResult<Vec<PurchaseOrderDto>> {
    require_current_actor_permission(Permission::PurchasesRead)?;
    let rows = sqlx::query_as::<_, PurchaseOrderRow>(
        "SELECT po.id, po.reference, po.supplier_id, s.name AS supplier_name, s.code AS supplier_code,
                s.phone AS supplier_phone, s.address AS supplier_address, s.email AS supplier_email,
                po.status, w.status AS approval_status, po.total_amount, po.received_amount,
                po.expected_date, po.notes, po.payment_terms_label, po.delivery_address,
                po.commercial_conditions, po.discount_xof, po.tax_xof, po.extra_fees_xof,
                po.paid_deposit_xof, po.created_by_name, po.created_at
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN commercial_document_workflows w ON w.document_type = 'purchase_order' AND w.document_id = po.id
         ORDER BY po.id DESC",
    )
    .fetch_all(&db.pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for po in rows {
        let lines = sqlx::query_as::<_, PurchaseOrderLineDto>(
            "SELECT id, product_id, packaging_id, product_name, packaging_name, base_unit,
                    coefficient_milli, ordered_quantity_milli, received_quantity_milli, unit_price, line_total,
                    product_snapshot_json, packaging_snapshot_json
             FROM purchase_order_lines
             WHERE purchase_order_id = ?
             ORDER BY id ASC",
        )
        .bind(po.id)
        .fetch_all(&db.pool)
        .await?;

        let packaging_requirements = sqlx::query_as::<_, super::PurchasePackagingRequirementDto>(
            "SELECT purchase_order_line_id, returnable_id, code_snapshot AS code, name_snapshot AS name,
                    kind_snapshot AS kind, pieces_per_pack, required_pieces, reserved_pieces, issued_pieces, reservation_status
             FROM purchase_order_packaging_requirements WHERE purchase_order_line_id IN
               (SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?) ORDER BY id ASC",
        )
        .bind(po.id)
        .fetch_all(&db.pool)
        .await?;

        let receipts = sqlx::query_as::<_, PurchaseReceiptDto>(
            "SELECT id, reference, purchase_order_id, total_amount, status, received_by_name, notes, created_at
             FROM purchase_receipts
             WHERE purchase_order_id = ?
             ORDER BY id DESC",
        )
        .bind(po.id)
        .fetch_all(&db.pool)
        .await?;

        let debts = sqlx::query_as::<_, SupplierDebtDto>(
            "SELECT sd.id, sd.receipt_id, sd.supplier_id, s.name AS supplier_name, s.code AS supplier_code,
                    pr.reference AS receipt_reference, po.reference AS order_reference,
                    sd.initial_amount, sd.remaining_amount, sd.due_date, sd.status, sd.created_at
             FROM supplier_debts sd
             JOIN suppliers s ON s.id = sd.supplier_id
             JOIN purchase_receipts pr ON pr.id = sd.receipt_id
             JOIN purchase_orders po ON po.id = pr.purchase_order_id
             WHERE pr.purchase_order_id = ?
             ORDER BY sd.id DESC",
        )
        .bind(po.id)
        .fetch_all(&db.pool)
        .await?;

        result.push(PurchaseOrderDto {
            id: po.id,
            reference: po.reference,
            supplier_id: po.supplier_id,
            supplier_name: po.supplier_name,
            supplier_code: po.supplier_code,
            supplier_phone: po.supplier_phone,
            supplier_address: po.supplier_address,
            supplier_email: po.supplier_email,
            status: po.status,
            approval_status: po.approval_status,
            total_amount: po.total_amount,
            received_amount: po.received_amount,
            expected_date: po.expected_date,
            notes: po.notes,
            payment_terms_label: po.payment_terms_label,
            delivery_address: po.delivery_address,
            commercial_conditions: po.commercial_conditions,
            discount_xof: po.discount_xof,
            tax_xof: po.tax_xof,
            extra_fees_xof: po.extra_fees_xof,
            paid_deposit_xof: po.paid_deposit_xof,
            created_by_name: po.created_by_name,
            created_at: po.created_at,
            lines,
            packaging_requirements,
            receipts,
            debts,
        });
    }
    Ok(result)
}

pub async fn list_purchase_order_receipts(
    db: &DepotDb,
    purchase_order_id: i64,
) -> CoreResult<Vec<PurchaseReceiptDto>> {
    require_current_actor_permission(Permission::PurchasesRead)?;
    Ok(sqlx::query_as::<_, PurchaseReceiptDto>(
        "SELECT id, reference, purchase_order_id, total_amount, status, received_by_name, notes, created_at
         FROM purchase_receipts WHERE purchase_order_id = ? ORDER BY id DESC",
    )
    .bind(purchase_order_id)
    .fetch_all(&db.pool)
    .await?)
}

pub async fn get_purchase_receipt_detail(
    db: &DepotDb,
    receipt_id: i64,
) -> CoreResult<PurchaseReceiptDetailDto> {
    require_current_actor_permission(Permission::PurchasesRead)?;
    let header: Option<(
        i64,
        String,
        i64,
        String,
        String,
        String,
        Option<String>,
        String,
        Option<String>,
        i64,
        Option<String>,
        String,
    )> = sqlx::query_as(
        "SELECT pr.id, pr.reference, pr.purchase_order_id, po.reference, s.name, s.code, s.phone,
                pr.status, pr.received_by_name, pr.total_amount, pr.notes, pr.created_at
         FROM purchase_receipts pr
         JOIN purchase_orders po ON po.id = pr.purchase_order_id
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE pr.id = ?",
    )
    .bind(receipt_id)
    .fetch_optional(&db.pool)
    .await?;

    let (
        id,
        reference,
        purchase_order_id,
        order_reference,
        supplier_name,
        supplier_code,
        supplier_phone,
        status,
        received_by_name,
        total_amount,
        notes,
        created_at,
    ) = header.ok_or_else(|| CoreError::NotFound("Bon de réception introuvable.".into()))?;

    let lines = sqlx::query_as::<_, PurchaseReceiptLineDto>(
        "SELECT prl.purchase_order_line_id, pol.product_name, pol.packaging_name, pol.base_unit,
                pol.coefficient_milli, prl.quantity_milli AS received_quantity_milli,
                prl.missing_quantity_milli, prl.damaged_quantity_milli, prl.refused_quantity_milli,
                prl.base_quantity_milli, prl.unit_price, prl.amount, prl.discrepancy_reason
         FROM purchase_receipt_lines prl
         JOIN purchase_order_lines pol ON pol.id = prl.purchase_order_line_id
         WHERE prl.receipt_id = ? ORDER BY prl.id",
    )
    .bind(receipt_id)
    .fetch_all(&db.pool)
    .await?;

    let packaging_exchanges = sqlx::query_as::<_, SupplierPackagingExchangeLineDto>(
        "SELECT purchase_order_line_id, returnable_id, code_snapshot, name_snapshot, kind_snapshot, pieces_issued
         FROM supplier_packaging_exchange_lines WHERE receipt_id = ? ORDER BY id",
    )
    .bind(receipt_id)
    .fetch_all(&db.pool)
    .await?;

    let snapshot = sqlx::query_as::<_, PurchaseReceiptSnapshotDto>(
        "SELECT id, receipt_id, purchase_order_id, version, document_number, snapshot_json,
                issued_at, issued_by_user_id, issued_by_name, issued_by_role
         FROM purchase_receipt_snapshots WHERE receipt_id = ? ORDER BY version DESC LIMIT 1",
    )
    .bind(receipt_id)
    .fetch_optional(&db.pool)
    .await?;

    Ok(PurchaseReceiptDetailDto {
        id,
        reference,
        purchase_order_id,
        order_reference,
        supplier_name,
        supplier_code,
        supplier_phone,
        status,
        received_by_name,
        total_amount,
        notes,
        created_at,
        lines,
        packaging_exchanges,
        snapshot,
    })
}

pub async fn list_purchase_document_snapshots(
    db: &DepotDb,
    purchase_order_id: i64,
) -> CoreResult<Vec<PurchaseDocumentSnapshotDto>> {
    require_current_actor_permission(Permission::PurchasesRead)?;
    Ok(sqlx::query_as::<_, PurchaseDocumentSnapshotDto>(
        "SELECT id, purchase_order_id, version, document_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role, revision_reason
         FROM purchase_document_snapshots WHERE purchase_order_id = ? ORDER BY version DESC",
    )
    .bind(purchase_order_id)
    .fetch_all(&db.pool)
    .await?)
}
