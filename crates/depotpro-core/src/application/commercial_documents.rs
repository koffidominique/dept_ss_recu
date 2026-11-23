// Commercial document register, KPIs, snapshot inspection, and owner approval workflow.
// Existing sales/orders/purchases tables are the source of truth for business data.
use crate::application::auth::{self, Permission, Role};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentDto {
    pub document_type: String,
    pub document_id: i64,
    pub document_number: String,
    pub counterparty: String,
    pub status: String,
    pub approval_status: Option<String>,
    pub amount_xof: i64,
    pub created_at: String,
    pub phone: Option<String>,
    pub order_reference: Option<String>,
    pub payment_method: Option<String>,
    pub payment_status: Option<String>,
    pub external_reference: Option<String>,
    pub issuer_name: Option<String>,
    pub snapshot_count: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentsQuery {
    pub search: Option<String>,
    pub document_type: Option<String>,
    pub status: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub phone: Option<String>,
    pub order_ref: Option<String>,
    pub external_ref: Option<String>,
    pub payment_method: Option<String>,
    pub payment_status: Option<String>,
    pub reception_status: Option<String>,
    pub min_amount: Option<i64>,
    pub max_amount: Option<i64>,
    pub sort: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub approvals_only: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentsKpisDto {
    pub total_documents: usize,
    pub customer_orders_count: usize,
    pub customer_orders_amount_xof: i64,
    pub purchase_orders_count: usize,
    pub purchase_orders_amount_xof: i64,
    pub receptions_count: usize,
    pub payment_receipts_count: usize,
    pub unpaid_or_partial_amount_xof: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentsPage {
    pub rows: Vec<CommercialDocumentDto>,
    pub total: usize,
    pub pending_count: usize,
    pub kpis: CommercialDocumentsKpisDto,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentSnapshotSummaryDto {
    pub version: i64,
    pub document_number: String,
    pub issued_at: String,
    pub issued_by_name: String,
    pub issued_by_role: String,
    pub revision_reason: Option<String>,
    pub snapshot_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentDetail {
    pub document_type: String,
    pub document_id: i64,
    pub document_number: String,
    pub counterparty: String,
    pub status: String,
    pub amount_xof: i64,
    pub created_at: String,
    pub phone: Option<String>,
    pub order_reference: Option<String>,
    pub payment_method: Option<String>,
    pub payment_status: Option<String>,
    pub external_reference: Option<String>,
    pub issuer_name: Option<String>,
    pub notes: Option<String>,
    pub lines: Vec<CommercialDocumentDetailLine>,
    pub packaging_lines: Vec<CommercialDocumentPackagingLine>,
    pub payments: Vec<CommercialDocumentDetailPayment>,
    pub snapshots: Vec<CommercialDocumentSnapshotSummaryDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentPackagingLine {
    pub label: String,
    pub kind: String,
    pub expected_quantity: i64,
    pub issued_quantity: Option<i64>,
    pub returned_quantity: Option<i64>,
    pub status_label: String,
    pub detail: Option<String>,
    pub amount: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentDetailLine {
    pub label: String,
    pub detail: Option<String>,
    pub quantity_milli: i64,
    pub unit: String,
    pub unit_price_xof: i64,
    pub amount_xof: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialDocumentDetailPayment {
    pub label: String,
    pub amount_xof: i64,
}

fn product_snapshot_description(snapshot_json: &str) -> String {
    let snapshot: serde_json::Value = match serde_json::from_str(snapshot_json) {
        Ok(value) => value,
        Err(_) => {
            return "Caractéristiques complémentaires non disponibles sur cette opération historique"
                .to_string()
        }
    };
    let mut details = Vec::new();
    for key in ["brewery", "brand", "variant"] {
        if let Some(value) = snapshot
            .get(key)
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
        {
            details.push(value.to_string());
        }
    }
    if let Some(volume) = snapshot.get("volumeMl").and_then(serde_json::Value::as_i64) {
        details.push(if volume % 10 == 0 {
            format!("{} cl", volume / 10)
        } else {
            format!("{volume} ml")
        });
    }
    if details.is_empty() {
        "Caractéristiques complémentaires non disponibles sur cette opération historique"
            .to_string()
    } else {
        details.join(" · ")
    }
}

fn format_milli_quantity(value: i64) -> String {
    let whole = value / 1000;
    let fraction = (value % 1000).abs();
    if fraction == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{fraction:03}")
            .trim_end_matches('0')
            .to_string()
    }
}

fn packaging_contents_description(packaging: &str, base_unit: &str, coefficient_milli: i64) -> String {
    let unit = base_unit.to_lowercase();
    let package = packaging.to_lowercase();
    let contents = if unit.contains("canette") || unit.contains("can") {
        "canettes".to_string()
    } else if unit.contains("bouteille") {
        if package == "pack" {
            "bouteilles en plastique".to_string()
        } else {
            "bouteilles".to_string()
        }
    } else {
        format!("{}(s)", base_unit)
    };
    format!(
        "1 {packaging} = {} {contents}",
        format_milli_quantity(coefficient_milli)
    )
}

fn packaging_regime_description(snapshot_json: &str) -> &'static str {
    let snapshot = match serde_json::from_str::<serde_json::Value>(snapshot_json) {
        Ok(value) => value,
        Err(_) => return "Régime d’emballage non disponible sur cette opération historique",
    };
    match snapshot
        .get("depositRegime")
        .and_then(serde_json::Value::as_str)
    {
        Some("deposit") => "Emballage consigné",
        Some("none") => "Non retournable — aucun emballage consigné",
        _ => "Régime d’emballage non disponible sur cette opération historique",
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecisionInput {
    pub action: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalEventDto {
    pub id: i64,
    pub document_type: String,
    pub document_id: i64,
    pub action: String,
    pub actor_user_id: Option<i64>,
    pub actor_role: Option<String>,
    pub reason: Option<String>,
    pub snapshot_json: String,
    pub created_at: String,
}

fn authenticated_actor() -> CoreResult<auth::SessionIdentity> {
    auth::current_actor()
        .ok_or_else(|| CoreError::Forbidden("Session authentifiée requise.".into()))
}

fn actor_db_id(actor: &auth::SessionIdentity) -> Option<i64> {
    actor.user_id.parse::<i64>().ok()
}

/// Résout l'identifiant DB de l'acteur; retourne NULL si l'utilisateur n'existe
/// pas dans la base (évite d'enfreindre les clés étrangères du workflow).
async fn actor_db_id_resolved(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor: &auth::SessionIdentity,
) -> CoreResult<Option<i64>> {
    let Some(candidate) = actor_db_id(actor) else {
        return Ok(None);
    };
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = ?")
        .bind(candidate)
        .fetch_one(&mut **tx)
        .await?;
    Ok((exists > 0).then_some(candidate))
}

fn check_document_type(document_type: &str) -> CoreResult<()> {
    if matches!(document_type, "customer_order" | "purchase_order") {
        Ok(())
    } else {
        Err(CoreError::Validation(
            "Type de document non approuvable.".into(),
        ))
    }
}

async fn document_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    document_type: &str,
    document_id: i64,
) -> CoreResult<serde_json::Value> {
    match document_type {
        "customer_order" => {
            let header: Option<(String, String, i64, i64, i64, Option<String>, String)> =
                sqlx::query_as(
                    "SELECT o.order_number, c.name, o.subtotal_xof, o.discount_xof, o.total_to_collect_xof, o.notes, o.status
                     FROM orders o JOIN clients c ON c.id = o.customer_id WHERE o.id = ?",
                )
                .bind(document_id)
                .fetch_optional(&mut **tx)
                .await?;
            let (number, party, subtotal, discount, total, notes, status) = header
                .ok_or_else(|| CoreError::NotFound("Commande client introuvable.".into()))?;
            let lines: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(
                "SELECT p.name, v.name, ol.base_quantity, ol.unit_price_xof, ol.line_total_xof
                 FROM order_lines ol JOIN products p ON p.id = ol.product_id
                 JOIN product_variants v ON v.id = ol.variant_id
                 WHERE ol.order_id = ? ORDER BY ol.id",
            )
            .bind(document_id)
            .fetch_all(&mut **tx)
            .await?;
            Ok(serde_json::json!({
                "documentType": document_type, "id": document_id, "number": number,
                "counterparty": party, "status": status, "subtotalXof": subtotal,
                "discountXof": discount, "totalXof": total, "notes": notes,
                "items": lines.into_iter().map(|(product, variant, quantity, unit_price, line_total)| serde_json::json!({
                    "product": product, "variant": variant, "quantity": quantity,
                    "unitPriceXof": unit_price, "lineTotalXof": line_total
                })).collect::<Vec<_>>()
            }))
        }
        "purchase_order" => {
            let header: Option<(String, String, i64, Option<String>, String)> = sqlx::query_as(
                "SELECT po.reference, s.name, po.total_amount, po.notes, po.status
                 FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?",
            )
            .bind(document_id)
            .fetch_optional(&mut **tx)
            .await?;
            let (number, party, total, notes, status) = header
                .ok_or_else(|| CoreError::NotFound("Bon fournisseur introuvable.".into()))?;
            let lines: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(
                "SELECT product_name, packaging_name, ordered_quantity_milli, unit_price, line_total
                 FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id",
            )
            .bind(document_id)
            .fetch_all(&mut **tx)
            .await?;
            Ok(serde_json::json!({
                "documentType": document_type, "id": document_id, "number": number,
                "counterparty": party, "status": status, "totalXof": total, "notes": notes,
                "items": lines.into_iter().map(|(product, packaging, quantity_milli, unit_price, line_total)| serde_json::json!({
                    "product": product, "packaging": packaging, "quantityMilli": quantity_milli,
                    "unitPriceXof": unit_price, "lineTotalXof": line_total
                })).collect::<Vec<_>>()
            }))
        }
        _ => Err(CoreError::Validation(
            "Type de document non approuvable.".into(),
        )),
    }
}

const DOCUMENT_UNION_SQL: &str = "
    SELECT 'customer_order' AS document_type, o.id AS document_id,
        o.order_number AS document_number, c.name AS counterparty, o.status AS status,
        w.status AS approval_status, o.total_to_collect_xof AS amount_xof, o.created_at AS created_at,
        c.phone AS phone, o.order_number AS order_reference,
        COALESCE(o.planned_payment_channel, o.payment_method) AS payment_method,
        o.payment_status AS payment_status,
        (SELECT GROUP_CONCAT(DISTINCT p.external_reference) FROM payments p WHERE p.order_id = o.id AND p.external_reference IS NOT NULL) AS external_reference,
        (SELECT cors.issued_by_name FROM customer_order_receipt_snapshots cors WHERE cors.order_id = o.id ORDER BY cors.version DESC LIMIT 1) AS issuer_name,
        (SELECT COUNT(*) FROM customer_order_receipt_snapshots cors WHERE cors.order_id = o.id) AS snapshot_count
    FROM orders o JOIN clients c ON c.id = o.customer_id
    LEFT JOIN commercial_document_workflows w ON w.document_type = 'customer_order' AND w.document_id = o.id
    UNION ALL
    SELECT 'sales_receipt', s.id, s.reference, COALESCE(c.name, 'Client comptoir'), s.status, NULL,
        s.total_amount, s.created_at,
        c.phone, (SELECT o.order_number FROM orders o WHERE o.id = s.order_id),
        (SELECT GROUP_CONCAT(DISTINCT pp.method_code) FROM payments p JOIN payment_parts pp ON pp.payment_id = p.id WHERE p.sale_id = s.id),
        CASE
            WHEN COALESCE((SELECT cr.remaining_amount FROM customer_receivables cr WHERE cr.sale_id = s.id), 0) <= 0 THEN 'paid'
            WHEN s.paid_amount > 0 THEN 'partial'
            ELSE 'unpaid'
        END,
        (SELECT GROUP_CONCAT(DISTINCT p.external_reference) FROM payments p WHERE p.sale_id = s.id AND p.external_reference IS NOT NULL),
        (SELECT p.recorded_by_name FROM payments p WHERE p.sale_id = s.id ORDER BY p.id DESC LIMIT 1),
        0
    FROM sales s LEFT JOIN clients c ON c.id = s.client_id
    UNION ALL
    SELECT 'purchase_order', po.id, po.reference, sp.name, po.status, w.status, po.total_amount, po.created_at,
        sp.phone, po.reference, po.payment_terms_label,
        CASE
            WHEN po.received_amount >= po.total_amount AND po.total_amount > 0 THEN 'paid'
            WHEN po.received_amount > 0 THEN 'partial'
            ELSE 'unpaid'
        END,
        NULL, po.created_by_name,
        (SELECT COUNT(*) FROM purchase_document_snapshots pds WHERE pds.purchase_order_id = po.id)
    FROM purchase_orders po JOIN suppliers sp ON sp.id = po.supplier_id
    LEFT JOIN commercial_document_workflows w ON w.document_type = 'purchase_order' AND w.document_id = po.id
    UNION ALL
    SELECT 'supplier_reception', pr.id, pr.reference, sp.name, pr.status, NULL, pr.total_amount, pr.created_at,
        sp.phone, po.reference, NULL,
        COALESCE((SELECT sd.status FROM supplier_debts sd WHERE sd.receipt_id = pr.id LIMIT 1), 'paid'),
        NULL, pr.received_by_name,
        (SELECT COUNT(*) FROM purchase_receipt_snapshots prs WHERE prs.receipt_id = pr.id)
    FROM purchase_receipts pr JOIN purchase_orders po ON po.id = pr.purchase_order_id
    JOIN suppliers sp ON sp.id = po.supplier_id
    UNION ALL
    SELECT 'payment_receipt', p.id, p.reference, COALESCE(c.name, 'Règlement fournisseur'), p.payment_kind, NULL,
        p.total_amount, p.created_at,
        c.phone,
        COALESCE((SELECT o.order_number FROM orders o WHERE o.id = p.order_id), (SELECT s.reference FROM sales s WHERE s.id = p.sale_id)),
        (SELECT GROUP_CONCAT(DISTINCT pp.method_code) FROM payment_parts pp WHERE pp.payment_id = p.id),
        'paid',
        p.external_reference, p.recorded_by_name,
        (SELECT COUNT(*) FROM payment_receipt_snapshots prs WHERE prs.payment_id = p.id)
    FROM payments p LEFT JOIN clients c ON c.id = p.client_id
    UNION ALL
    SELECT 'credit_note', sr.id, sr.credit_note_ref, COALESCE(c.name, 'Client comptoir'), sr.reason, NULL,
        sr.total_amount, sr.created_at,
        c.phone, s.reference, NULL, NULL, NULL, NULL, 0
    FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
    LEFT JOIN clients c ON c.id = s.client_id
    UNION ALL
    SELECT 'cancellation', sc.id, s.reference, COALESCE(c.name, 'Client comptoir'), 'cancelled', NULL,
        sc.refunded_amount, sc.created_at,
        c.phone, s.reference, sc.refund_method_code, NULL, NULL, NULL, 0
    FROM sales_cancellations sc JOIN sales s ON s.id = sc.sale_id
    LEFT JOIN clients c ON c.id = s.client_id
";

pub async fn list_documents(db: &DepotDb) -> CoreResult<Vec<CommercialDocumentDto>> {
    let scope = if let Some(actor) = auth::current_actor() {
        let sales = actor.has_permission(Permission::SalesRead);
        let purchases = actor.has_permission(Permission::PurchasesRead);
        let reports = actor.has_permission(Permission::ReportsRead);
        if !sales && !purchases && !reports {
            return Err(CoreError::Forbidden(
                "Consultation des documents commerciaux refusée.".into(),
            ));
        }
        (sales || reports, purchases || reports)
    } else {
        (true, true)
    };
    let rows = sqlx::query_as::<_, CommercialDocumentDto>(&format!(
        "SELECT * FROM ({DOCUMENT_UNION_SQL}) ORDER BY created_at DESC, document_id DESC"
    ))
    .fetch_all(&db.pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter(|row| match row.document_type.as_str() {
            "customer_order" | "sales_receipt" | "credit_note" | "cancellation" => scope.0,
            "purchase_order" | "supplier_reception" => scope.1,
            "payment_receipt" => scope.0 || scope.1,
            _ => false,
        })
        .collect())
}

pub async fn get_document_detail(
    db: &DepotDb,
    document_type: &str,
    document_id: i64,
) -> CoreResult<CommercialDocumentDetail> {
    if document_id <= 0 {
        return Err(CoreError::Validation(
            "Identifiant de document invalide.".into(),
        ));
    }
    let actor = auth::current_actor();
    let required = match document_type {
        "customer_order" | "sales_receipt" | "credit_note" | "cancellation" => {
            Permission::SalesRead
        }
        "purchase_order" | "supplier_reception" => Permission::PurchasesRead,
        "payment_receipt" => {
            let kind: Option<String> =
                sqlx::query_scalar("SELECT payment_kind FROM payments WHERE id = ?")
                    .bind(document_id)
                    .fetch_optional(&db.pool)
                    .await?;
            match kind.as_deref() {
                Some("supplier_debt") => Permission::PurchasesRead,
                Some(_) => Permission::SalesRead,
                None => return Err(CoreError::NotFound("Règlement introuvable.".into())),
            }
        }
        _ => return Err(CoreError::Validation("Type de document invalide.".into())),
    };
    if let Some(actor) = actor.as_ref() {
        auth::require_permission(actor, required)?;
    }

    let header = sqlx::query_as::<_, CommercialDocumentDto>(&format!(
        "SELECT d.* FROM ({DOCUMENT_UNION_SQL}) d WHERE d.document_type = ? AND d.document_id = ?"
    ))
    .bind(document_type)
    .bind(document_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| CoreError::NotFound("Document introuvable.".into()))?;

    let mut lines = Vec::new();
    let mut packaging_lines = Vec::new();
    let mut payments = Vec::new();
    let mut snapshots = Vec::new();
    // Affecte dans chaque branche du match ci-dessous (et reinsigne dans la
    // branche sales_receipt pour y joindre les emballages). Initialiser a None
    // serait ecrase avant lecture : signale en -D warnings. Le type doit etre
    // explicite, sinon l'inference echoue en aval sur query_scalar.
    let mut notes: Option<String>;

    match document_type {
        "customer_order" => {
            notes = sqlx::query_scalar("SELECT notes FROM orders WHERE id = ?")
                .bind(document_id)
                .fetch_one(&db.pool)
                .await?;
            lines = sqlx::query_as::<_, (String, String, i64, String, i64, i64)>(
                "SELECT p.name, v.name, ol.requested_quantity * 1000, ol.requested_unit,
                        ol.unit_price_xof, ol.line_total_xof
                 FROM order_lines ol JOIN products p ON p.id = ol.product_id
                 JOIN product_variants v ON v.id = ol.variant_id
                 WHERE ol.order_id = ? ORDER BY ol.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(
                |(label, variant, quantity, unit, price, amount)| CommercialDocumentDetailLine {
                    label,
                    detail: Some(variant),
                    quantity_milli: quantity,
                    unit,
                    unit_price_xof: price,
                    amount_xof: amount,
                },
            )
            .collect();

            payments = sqlx::query_as::<_, (String, i64)>(
                "SELECT COALESCE(pm.label, pp.method_code) || ' · ' || p.reference ||
                        COALESCE(' · Txn ' || p.external_reference, ''), pp.amount
                 FROM payments p JOIN payment_parts pp ON pp.payment_id = p.id
                 LEFT JOIN payment_methods pm ON pm.code = pp.method_code
                 WHERE p.order_id = ? ORDER BY p.id, pp.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(|(label, amount_xof)| CommercialDocumentDetailPayment { label, amount_xof })
            .collect();

            let snap_rows: Vec<(i64, String, String, String, String, Option<String>, String)> =
                sqlx::query_as(
                    "SELECT version, receipt_number, issued_at, issued_by_name, issued_by_role, revision_reason, snapshot_json
                     FROM customer_order_receipt_snapshots WHERE order_id = ? ORDER BY version DESC",
                )
                .bind(document_id)
                .fetch_all(&db.pool)
                .await?;
            snapshots = snap_rows
                .into_iter()
                .map(
                    |(
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        revision_reason,
                        snapshot_json,
                    )| CommercialDocumentSnapshotSummaryDto {
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        revision_reason,
                        snapshot_json,
                    },
                )
                .collect();
        }
        "sales_receipt" => {
            notes = sqlx::query_scalar("SELECT notes FROM sales WHERE id = ?")
                .bind(document_id)
                .fetch_one(&db.pool)
                .await?;
            lines = sqlx::query_as::<
                _,
                (
                    String,
                    String,
                    i64,
                    String,
                    i64,
                    i64,
                    String,
                    i64,
                    i64,
                    String,
                    String,
                ),
            >(
                "SELECT product_name, packaging_name, quantity_milli,
                        COALESCE(sales_unit_label, packaging_name), coefficient_milli, base_quantity_milli,
                        base_unit, unit_price, line_total, product_snapshot_json, packaging_snapshot_json
                 FROM sale_lines WHERE sale_id = ? ORDER BY id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(
                |(
                    label,
                    packaging,
                    quantity,
                    unit,
                    coefficient,
                    base_quantity,
                    base_unit,
                    price,
                    amount,
                    product_snapshot,
                    packaging_snapshot,
                )| {
                    let detail = format!(
                        "Conditionnement : {} · conversion {} {unit} = {} {base_unit} · {} · {}",
                        packaging_contents_description(&packaging, &base_unit, coefficient),
                        format_milli_quantity(quantity),
                        format_milli_quantity(base_quantity),
                        product_snapshot_description(&product_snapshot),
                        packaging_regime_description(&packaging_snapshot)
                    );
                    CommercialDocumentDetailLine {
                        label,
                        detail: Some(detail),
                        quantity_milli: quantity,
                        unit,
                        unit_price_xof: price,
                        amount_xof: amount,
                    }
                },
            )
            .collect();
            let deposits: Vec<(String, String, i64, i64, String, i64, String)> = sqlx::query_as(
                "SELECT COALESCE(json_extract(component.value, '$.kind'), rpt.kind, 'other'),
                        COALESCE(json_extract(component.value, '$.name'), rpt.name, 'Détail non disponible sur cette opération historique'),
                        di.pieces, di.returned_pieces, COALESCE(sl.product_name, ''),
                        CASE
                            WHEN di.status = 'returned' AND di.amount <= 0
                                THEN di.pieces * COALESCE(NULLIF(di.unit_value, 0), rpt.deposit_value, 0)
                            ELSE di.amount
                        END,
                        COALESCE(di.status, 'pending')
                 FROM deposit_issues di
                 LEFT JOIN sale_lines sl ON sl.id = di.sale_line_id
                 LEFT JOIN json_each(sl.packaging_snapshot_json, '$.depositItems') component
                      ON CAST(json_extract(component.value, '$.returnableId') AS INTEGER) = di.returnable_id
                 LEFT JOIN returnable_packaging_types rpt ON rpt.id = di.returnable_id
                 WHERE di.sale_id = ? ORDER BY di.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?;
            let mut returned_packaging_amount: i64 = 0;
            let has_packaging = !deposits.is_empty();
            packaging_lines = deposits
                .into_iter()
                .map(|(kind, name, expected, returned, detail, amount, di_status)| {
                    if di_status == "returned" {
                        returned_packaging_amount += amount;
                        CommercialDocumentPackagingLine {
                            label: format!("{name} (retour client reçu)"),
                            kind,
                            expected_quantity: 0,
                            issued_quantity: Some(0),
                            returned_quantity: Some(expected),
                            status_label: "Retour reçu · hors total commande".to_string(),
                            detail: Some("Réintégré au stock d'emballages vides du sous-dépôt".to_string()),
                            amount: Some(amount),
                        }
                    } else {
                        let remaining = (expected - returned).max(0);
                        CommercialDocumentPackagingLine {
                            label: name,
                            kind,
                            expected_quantity: expected,
                            issued_quantity: Some(expected),
                            returned_quantity: Some(returned),
                            status_label: if remaining > 0 {
                                format!("{remaining} à restituer sous 15 jours")
                            } else {
                                "Restitution complète".to_string()
                            },
                            detail: if detail.is_empty() {
                                None
                            } else {
                                Some(detail)
                            },
                            amount: Some(amount),
                        }
                    }
                })
                .collect();
            if has_packaging {
                let mut note_parts = Vec::new();
                if let Some(existing) = notes.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    note_parts.push(existing.to_string());
                }
                if returned_packaging_amount > 0 {
                    note_parts.push(format!(
                        "Montant retour emballages reçus (hors total commande) : {returned_packaging_amount} FCFA."
                    ));
                }
                note_parts.push(
                    "Délai de retour d'emballages : 15 jours maximum. Le montant du retour d'emballages est suivi hors total commande ; à défaut de restitution dans les 15 jours, la valeur des emballages faisant défaut est exigible."
                        .to_string(),
                );
                notes = Some(note_parts.join("\n"));
            }
            payments = sqlx::query_as::<_, (String, i64)>(
                "SELECT pm.label || ' · ' || p.reference || COALESCE(' · Txn ' || p.external_reference, ''), pp.amount
                 FROM payments p JOIN payment_parts pp ON pp.payment_id = p.id
                 JOIN payment_methods pm ON pm.code = pp.method_code
                 WHERE p.sale_id = ? ORDER BY p.id, pp.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(|(label, amount_xof)| CommercialDocumentDetailPayment { label, amount_xof })
            .collect();
        }
        "purchase_order" => {
            notes = sqlx::query_scalar("SELECT notes FROM purchase_orders WHERE id = ?")
                .bind(document_id)
                .fetch_one(&db.pool)
                .await?;
            lines = sqlx::query_as::<
                _,
                (String, String, i64, String, i64, i64, i64, String, String),
            >(
                "SELECT product_name, packaging_name, ordered_quantity_milli, base_unit, coefficient_milli,
                        unit_price, line_total, product_snapshot_json, packaging_snapshot_json
                 FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(
                |(
                    label,
                    packaging,
                    quantity,
                    base_unit,
                    coefficient,
                    price,
                    amount,
                    product_snapshot,
                    packaging_snapshot,
                )| {
                    let base_quantity = (quantity as i128 * coefficient as i128 / 1000) as i64;
                    let detail = format!(
                        "Conditionnement : {} · conversion {} {packaging} = {} {base_unit} · {} · {}",
                        packaging_contents_description(&packaging, &base_unit, coefficient),
                        format_milli_quantity(quantity),
                        format_milli_quantity(base_quantity),
                        product_snapshot_description(&product_snapshot),
                        packaging_regime_description(&packaging_snapshot)
                    );
                    CommercialDocumentDetailLine {
                        label,
                        detail: Some(detail),
                        quantity_milli: quantity,
                        unit: packaging,
                        unit_price_xof: price,
                        amount_xof: amount,
                    }
                },
            )
            .collect();
            let reservations: Vec<(String, String, i64, String)> = sqlx::query_as(
                "SELECT COALESCE(json_extract(component.value, '$.kind'), 'other'),
                        COALESCE(json_extract(component.value, '$.name'), 'Détail emballage non disponible sur ce CMD historique'),
                        COALESCE(CAST(json_extract(component.value, '$.requiredPieces') AS INTEGER), 0),
                        CASE
                          WHEN req.reservation_status = 'released' THEN 'Réservation libérée — aucun emballage à préparer'
                          WHEN req.reserved_pieces > 0 THEN 'Réservation active — à remettre au fournisseur au REC'
                          WHEN req.reservation_status = 'issued' THEN 'Réservation consommée — consulter les REC liés'
                          WHEN json_extract(pol.packaging_snapshot_json, '$.depositRegime') = 'none' THEN 'Aucun emballage fournisseur requis'
                          WHEN json_extract(component.value, '$.returnableId') IS NULL THEN 'Détail non disponible sur ce CMD historique'
                          ELSE 'État de réservation non disponible sur ce CMD historique' END
                 FROM purchase_order_lines pol
                 LEFT JOIN json_each(pol.packaging_snapshot_json, '$.components') component ON 1 = 1
                 LEFT JOIN purchase_order_packaging_requirements req
                   ON req.purchase_order_line_id = pol.id
                  AND req.returnable_id = CAST(json_extract(component.value, '$.returnableId') AS INTEGER)
                 WHERE pol.purchase_order_id = ?
                   AND (json_extract(component.value, '$.returnableId') IS NOT NULL
                        OR json_extract(pol.packaging_snapshot_json, '$.depositRegime') = 'deposit')
                 ORDER BY pol.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?;
            packaging_lines = reservations
                .into_iter()
                .map(
                    |(kind, label, quantity, status_label)| CommercialDocumentPackagingLine {
                        label,
                        kind,
                        expected_quantity: quantity,
                        issued_quantity: None,
                        returned_quantity: None,
                        status_label,
                        detail: None,
                        amount: None,
                    },
                )
                .collect();
            let snap_rows: Vec<(i64, String, String, String, String, Option<String>, String)> =
                sqlx::query_as(
                    "SELECT version, document_number, issued_at, issued_by_name, issued_by_role, revision_reason, snapshot_json
                     FROM purchase_document_snapshots WHERE purchase_order_id = ? ORDER BY version DESC",
                )
                .bind(document_id)
                .fetch_all(&db.pool)
                .await?;
            snapshots = snap_rows
                .into_iter()
                .map(
                    |(
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        revision_reason,
                        snapshot_json,
                    )| CommercialDocumentSnapshotSummaryDto {
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        revision_reason,
                        snapshot_json,
                    },
                )
                .collect();
        }
        "supplier_reception" => {
            notes = sqlx::query_scalar("SELECT notes FROM purchase_receipts WHERE id = ?")
                .bind(document_id)
                .fetch_one(&db.pool)
                .await?;
            lines = sqlx::query_as::<
                _,
                (
                    String,
                    String,
                    i64,
                    i64,
                    i64,
                    i64,
                    i64,
                    String,
                    i64,
                    i64,
                    i64,
                    Option<String>,
                    String,
                    String,
                ),
            >(
                "SELECT pol.product_name, pol.packaging_name, prl.quantity_milli,
                        prl.missing_quantity_milli, prl.damaged_quantity_milli, prl.refused_quantity_milli,
                        prl.base_quantity_milli, pol.base_unit, pol.coefficient_milli, prl.unit_price,
                        prl.amount, prl.discrepancy_reason, pol.product_snapshot_json, pol.packaging_snapshot_json
                 FROM purchase_receipt_lines prl
                 JOIN purchase_order_lines pol ON pol.id = prl.purchase_order_line_id
                 WHERE prl.receipt_id = ? ORDER BY prl.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(
                |(
                    label,
                    packaging,
                    received_quantity,
                    missing_milli,
                    damaged_milli,
                    refused_milli,
                    base_quantity,
                    base_unit,
                    coefficient,
                    price,
                    amount,
                    discrepancy,
                    product_snapshot,
                    packaging_snapshot,
                )| {
                    let mut parts = vec![
                        Some(format!(
                            "Conditionnement : {} · reçu {} {packaging} = {} {base_unit}",
                            packaging_contents_description(&packaging, &base_unit, coefficient),
                            format_milli_quantity(received_quantity),
                            format_milli_quantity(base_quantity)
                        )),
                        Some(product_snapshot_description(&product_snapshot)),
                        Some(packaging_regime_description(&packaging_snapshot).to_string()),
                    ];
                    if missing_milli > 0 {
                        parts.push(Some(format!("Manquant : {}", format_milli_quantity(missing_milli))));
                    }
                    if damaged_milli > 0 {
                        parts.push(Some(format!("Cassé : {}", format_milli_quantity(damaged_milli))));
                    }
                    if refused_milli > 0 {
                        parts.push(Some(format!("Refusé : {}", format_milli_quantity(refused_milli))));
                    }
                    parts.push(discrepancy.map(|reason| format!("Écart : {reason}")));
                    let detail = parts
                        .into_iter()
                        .flatten()
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>()
                        .join(" · ");
                    CommercialDocumentDetailLine {
                        label,
                        detail: Some(detail),
                        quantity_milli: received_quantity,
                        unit: packaging,
                        unit_price_xof: price,
                        amount_xof: amount,
                    }
                },
            )
            .collect();
            let exchanges: Vec<(String, String, String, i64)> = sqlx::query_as(
                "SELECT name_snapshot, code_snapshot, kind_snapshot, pieces_issued
                 FROM supplier_packaging_exchange_lines WHERE receipt_id = ? ORDER BY id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?;
            packaging_lines = exchanges
                .into_iter()
                .map(|(name, code, kind, pieces)| CommercialDocumentPackagingLine {
                    label: format!("{name} ({code})"),
                    kind,
                    expected_quantity: pieces,
                    issued_quantity: Some(pieces),
                    returned_quantity: None,
                    status_label:
                        "Remis physiquement au fournisseur — échange sans ligne financière"
                            .to_string(),
                    detail: None,
                    amount: None,
                })
                .collect();
            let snap_rows: Vec<(i64, String, String, String, String, String)> = sqlx::query_as(
                "SELECT version, document_number, issued_at, issued_by_name, issued_by_role, snapshot_json
                 FROM purchase_receipt_snapshots WHERE receipt_id = ? ORDER BY version DESC",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?;
            snapshots = snap_rows
                .into_iter()
                .map(
                    |(
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        snapshot_json,
                    )| CommercialDocumentSnapshotSummaryDto {
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        revision_reason: None,
                        snapshot_json,
                    },
                )
                .collect();
        }
        "payment_receipt" => {
            notes = sqlx::query_scalar("SELECT note FROM payments WHERE id = ?")
                .bind(document_id)
                .fetch_one(&db.pool)
                .await?;
            payments = sqlx::query_as::<_, (String, i64)>(
                "SELECT COALESCE(pm.label, pp.method_code), pp.amount FROM payment_parts pp
                 LEFT JOIN payment_methods pm ON pm.code = pp.method_code
                 WHERE pp.payment_id = ? ORDER BY pp.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(|(label, amount_xof)| CommercialDocumentDetailPayment { label, amount_xof })
            .collect();
            let snap_rows: Vec<(i64, String, String, String, String, String)> = sqlx::query_as(
                "SELECT version, receipt_number, issued_at, issued_by_name, issued_by_role, snapshot_json
                 FROM payment_receipt_snapshots WHERE payment_id = ? ORDER BY version DESC",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?;
            snapshots = snap_rows
                .into_iter()
                .map(
                    |(
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        snapshot_json,
                    )| CommercialDocumentSnapshotSummaryDto {
                        version,
                        document_number,
                        issued_at,
                        issued_by_name,
                        issued_by_role,
                        revision_reason: None,
                        snapshot_json,
                    },
                )
                .collect();
        }
        "credit_note" => {
            notes = sqlx::query_scalar("SELECT reason FROM sales_returns WHERE id = ?")
                .bind(document_id)
                .fetch_one(&db.pool)
                .await?;
            lines = sqlx::query_as::<_, (String, String, i64, String, i64, i64)>(
                "SELECT sl.product_name, sl.packaging_name, srl.base_quantity_milli,
                        sl.base_unit, sl.unit_price, srl.amount
                 FROM sales_return_lines srl JOIN sale_lines sl ON sl.id = srl.sale_line_id
                 WHERE srl.return_id = ? ORDER BY srl.id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(
                |(label, detail, quantity, unit, price, amount)| CommercialDocumentDetailLine {
                    label,
                    detail: Some(detail),
                    quantity_milli: quantity,
                    unit,
                    unit_price_xof: price,
                    amount_xof: amount,
                },
            )
            .collect();
        }
        "cancellation" => {
            notes = sqlx::query_scalar("SELECT reason FROM sales_cancellations WHERE id = ?")
                .bind(document_id)
                .fetch_one(&db.pool)
                .await?;
            lines = sqlx::query_as::<_, (String, String, i64, String, i64, i64)>(
                "SELECT product_name, packaging_name, quantity_milli,
                        COALESCE(sales_unit_label, base_unit), unit_price, line_total
                 FROM sale_lines WHERE sale_id = (SELECT sale_id FROM sales_cancellations WHERE id = ?)
                 ORDER BY id",
            )
            .bind(document_id)
            .fetch_all(&db.pool)
            .await?
            .into_iter()
            .map(
                |(label, detail, quantity, unit, price, amount)| CommercialDocumentDetailLine {
                    label,
                    detail: Some(detail),
                    quantity_milli: quantity,
                    unit,
                    unit_price_xof: price,
                    amount_xof: amount,
                },
            )
            .collect();
            let refund: i64 =
                sqlx::query_scalar("SELECT refunded_amount FROM sales_cancellations WHERE id = ?")
                    .bind(document_id)
                    .fetch_one(&db.pool)
                    .await?;
            if refund > 0 {
                payments.push(CommercialDocumentDetailPayment {
                    label: "Montant remboursé".into(),
                    amount_xof: refund,
                });
            }
        }
        _ => unreachable!("validated document type above"),
    }

    Ok(CommercialDocumentDetail {
        document_type: header.document_type,
        document_id: header.document_id,
        document_number: header.document_number,
        counterparty: header.counterparty,
        status: header.status,
        amount_xof: header.amount_xof,
        created_at: header.created_at,
        phone: header.phone,
        order_reference: header.order_reference,
        payment_method: header.payment_method,
        payment_status: header.payment_status,
        external_reference: header.external_reference,
        issuer_name: header.issuer_name,
        notes,
        lines,
        packaging_lines,
        payments,
        snapshots,
    })
}

pub async fn list_documents_page(
    db: &DepotDb,
    query: CommercialDocumentsQuery,
) -> CoreResult<CommercialDocumentsPage> {
    let (sales_scope, purchases_scope) = if let Some(actor) = auth::current_actor() {
        let sales = actor.has_permission(Permission::SalesRead);
        let purchases = actor.has_permission(Permission::PurchasesRead);
        let reports = actor.has_permission(Permission::ReportsRead);
        if !sales && !purchases && !reports {
            return Err(CoreError::Forbidden(
                "Consultation des documents commerciaux refusée.".into(),
            ));
        }
        (sales || reports, purchases || reports)
    } else {
        (true, true)
    };
    let access = "((? = 1 AND d.document_type IN ('customer_order','sales_receipt','credit_note','cancellation'))
        OR (? = 1 AND d.document_type IN ('purchase_order','supplier_reception'))
        OR ((? = 1 OR ? = 1) AND d.document_type = 'payment_receipt'))";

    let search = query.search.as_deref().unwrap_or("").trim().to_lowercase();
    let doc_type = query
        .document_type
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "all")
        .unwrap_or("");
    let status = query
        .status
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "all")
        .unwrap_or("");
    let from = query
        .from
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let to = query
        .to
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let phone = query.phone.as_deref().unwrap_or("").trim().to_lowercase();
    let order_ref = query
        .order_ref
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let external_ref = query
        .external_ref
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let payment_method = query
        .payment_method
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "all")
        .unwrap_or("")
        .to_lowercase();
    let payment_status = query
        .payment_status
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "all")
        .unwrap_or("");
    let reception_status = query
        .reception_status
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "all")
        .unwrap_or("");
    let has_min = query.min_amount.is_some();
    let min_amount = query.min_amount.unwrap_or(0);
    let has_max = query.max_amount.is_some();
    let max_amount = query.max_amount.unwrap_or(i64::MAX);
    let approvals_only = query.approvals_only.unwrap_or(false);

    let where_clause = format!(
        "{access}
        AND (? = '' OR d.document_type = ?)
        AND (? = '' OR LOWER(d.document_number || ' ' || d.counterparty || ' ' || COALESCE(d.phone, '') || ' ' || COALESCE(d.order_reference, '') || ' ' || COALESCE(d.external_reference, '') || ' ' || d.document_type || ' ' || d.status) LIKE '%' || ? || '%')
        AND (? = '' OR d.status = ? OR d.approval_status = ?)
        AND (? = '' OR d.created_at >= ?)
        AND (? = '' OR d.created_at < datetime(?, '+1 day'))
        AND (? = '' OR LOWER(COALESCE(d.phone, '')) LIKE '%' || ? || '%')
        AND (? = '' OR LOWER(COALESCE(d.order_reference, '')) LIKE '%' || ? || '%')
        AND (? = '' OR LOWER(COALESCE(d.external_reference, '')) LIKE '%' || ? || '%')
        AND (? = '' OR LOWER(COALESCE(d.payment_method, '')) LIKE '%' || ? || '%')
        AND (? = '' OR COALESCE(d.payment_status, '') = ?)
        AND (? = '' OR (d.document_type IN ('purchase_order', 'supplier_reception') AND d.status = ?))
        AND (? = 0 OR d.amount_xof >= ?)
        AND (? = 0 OR d.amount_xof <= ?)
        AND (? = 0 OR d.approval_status = 'pending_owner_approval')"
    );

    let count_sql = format!("SELECT COUNT(*) FROM ({DOCUMENT_UNION_SQL}) d WHERE {where_clause}");
    let total = sqlx::query_scalar::<_, i64>(&count_sql)
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .bind(doc_type)
        .bind(doc_type)
        .bind(&search)
        .bind(&search)
        .bind(status)
        .bind(status)
        .bind(status)
        .bind(from)
        .bind(from)
        .bind(to)
        .bind(to)
        .bind(&phone)
        .bind(&phone)
        .bind(&order_ref)
        .bind(&order_ref)
        .bind(&external_ref)
        .bind(&external_ref)
        .bind(&payment_method)
        .bind(&payment_method)
        .bind(payment_status)
        .bind(payment_status)
        .bind(reception_status)
        .bind(reception_status)
        .bind(if has_min { 1_i64 } else { 0 })
        .bind(min_amount)
        .bind(if has_max { 1_i64 } else { 0 })
        .bind(max_amount)
        .bind(if approvals_only { 1_i64 } else { 0 })
        .fetch_one(&db.pool)
        .await?
        .max(0) as usize;

    let pending_sql = format!(
        "SELECT COUNT(*) FROM ({DOCUMENT_UNION_SQL}) d WHERE {access} AND d.approval_status = 'pending_owner_approval'"
    );
    let pending_count = sqlx::query_scalar::<_, i64>(&pending_sql)
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .fetch_one(&db.pool)
        .await?
        .max(0) as usize;

    // Server-side KPI summary across accessible documents
    #[derive(FromRow)]
    struct KpiRow {
        total_documents: i64,
        customer_orders_count: i64,
        customer_orders_amount_xof: i64,
        purchase_orders_count: i64,
        purchase_orders_amount_xof: i64,
        receptions_count: i64,
        payment_receipts_count: i64,
    }
    let kpi_sql = format!(
        "SELECT COUNT(*) AS total_documents,
                COALESCE(SUM(CASE WHEN d.document_type = 'customer_order' THEN 1 ELSE 0 END), 0) AS customer_orders_count,
                COALESCE(SUM(CASE WHEN d.document_type = 'customer_order' AND d.status != 'cancelled' THEN d.amount_xof ELSE 0 END), 0) AS customer_orders_amount_xof,
                COALESCE(SUM(CASE WHEN d.document_type = 'purchase_order' THEN 1 ELSE 0 END), 0) AS purchase_orders_count,
                COALESCE(SUM(CASE WHEN d.document_type = 'purchase_order' AND d.status != 'cancelled' THEN d.amount_xof ELSE 0 END), 0) AS purchase_orders_amount_xof,
                COALESCE(SUM(CASE WHEN d.document_type = 'supplier_reception' THEN 1 ELSE 0 END), 0) AS receptions_count,
                COALESCE(SUM(CASE WHEN d.document_type = 'payment_receipt' THEN 1 ELSE 0 END), 0) AS payment_receipts_count
         FROM ({DOCUMENT_UNION_SQL}) d WHERE {access}"
    );
    let kpi_row = sqlx::query_as::<_, KpiRow>(&kpi_sql)
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .fetch_one(&db.pool)
        .await?;

    let unpaid_orders_xof: i64 = if sales_scope {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(MAX(0, total_to_collect_xof - paid_xof)), 0)
             FROM orders WHERE status NOT IN ('cancelled', 'draft')",
        )
        .fetch_one(&db.pool)
        .await?
    } else {
        0
    };
    let unpaid_standalone_rec_xof: i64 = if sales_scope {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(cr.remaining_amount), 0)
             FROM customer_receivables cr JOIN sales s ON s.id = cr.sale_id
             WHERE s.order_id IS NULL AND cr.status IN ('open', 'partial')",
        )
        .fetch_one(&db.pool)
        .await?
    } else {
        0
    };

    let kpis = CommercialDocumentsKpisDto {
        total_documents: kpi_row.total_documents.max(0) as usize,
        customer_orders_count: kpi_row.customer_orders_count.max(0) as usize,
        customer_orders_amount_xof: kpi_row.customer_orders_amount_xof,
        purchase_orders_count: kpi_row.purchase_orders_count.max(0) as usize,
        purchase_orders_amount_xof: kpi_row.purchase_orders_amount_xof,
        receptions_count: kpi_row.receptions_count.max(0) as usize,
        payment_receipts_count: kpi_row.payment_receipts_count.max(0) as usize,
        unpaid_or_partial_amount_xof: unpaid_orders_xof + unpaid_standalone_rec_xof,
    };

    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(20).clamp(1, 200);
    let offset = i64::from(page.saturating_sub(1)).saturating_mul(i64::from(page_size));
    let order_by = match query.sort.as_deref() {
        Some("oldest") => "d.created_at ASC, d.document_id ASC",
        Some("amount") => "d.amount_xof DESC, d.created_at DESC, d.document_id DESC",
        Some("amount_asc") => "d.amount_xof ASC, d.created_at DESC, d.document_id DESC",
        _ => "d.created_at DESC, d.document_id DESC",
    };
    let rows_sql = format!(
        "SELECT d.* FROM ({DOCUMENT_UNION_SQL}) d WHERE {where_clause} ORDER BY {order_by} LIMIT ? OFFSET ?"
    );
    let rows = sqlx::query_as::<_, CommercialDocumentDto>(&rows_sql)
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .bind(if sales_scope { 1_i64 } else { 0 })
        .bind(if purchases_scope { 1_i64 } else { 0 })
        .bind(doc_type)
        .bind(doc_type)
        .bind(&search)
        .bind(&search)
        .bind(status)
        .bind(status)
        .bind(status)
        .bind(from)
        .bind(from)
        .bind(to)
        .bind(to)
        .bind(&phone)
        .bind(&phone)
        .bind(&order_ref)
        .bind(&order_ref)
        .bind(&external_ref)
        .bind(&external_ref)
        .bind(&payment_method)
        .bind(&payment_method)
        .bind(payment_status)
        .bind(payment_status)
        .bind(reception_status)
        .bind(reception_status)
        .bind(if has_min { 1_i64 } else { 0 })
        .bind(min_amount)
        .bind(if has_max { 1_i64 } else { 0 })
        .bind(max_amount)
        .bind(if approvals_only { 1_i64 } else { 0 })
        .bind(i64::from(page_size))
        .bind(offset)
        .fetch_all(&db.pool)
        .await?;

    Ok(CommercialDocumentsPage {
        rows,
        total,
        pending_count,
        kpis,
        page,
        page_size,
    })
}

pub async fn approval_events(
    db: &DepotDb,
    document_type: &str,
    document_id: i64,
) -> CoreResult<Vec<ApprovalEventDto>> {
    check_document_type(document_type)?;
    if let Some(actor) = auth::current_actor() {
        let required = if document_type == "customer_order" {
            Permission::SalesRead
        } else {
            Permission::PurchasesRead
        };
        if !actor.has_permission(Permission::ReportsRead) {
            auth::require_permission(&actor, required)?;
        }
    }
    Ok(sqlx::query_as::<_, ApprovalEventDto>(
        "SELECT id, document_type, document_id, action, actor_user_id, actor_role, reason, snapshot_json, created_at
         FROM document_approval_events WHERE document_type = ? AND document_id = ? ORDER BY id DESC",
    )
    .bind(document_type)
    .bind(document_id)
    .fetch_all(&db.pool)
    .await?)
}

pub async fn submit_for_approval(
    db: &DepotDb,
    document_type: &str,
    document_id: i64,
) -> CoreResult<()> {
    check_document_type(document_type)?;
    let actor = authenticated_actor()?;
    let permission = if document_type == "customer_order" {
        Permission::SalesWrite
    } else {
        Permission::PurchasesWrite
    };
    auth::require_permission(&actor, permission)?;
    if document_id <= 0 {
        return Err(CoreError::Validation(
            "Identifiant de document invalide.".into(),
        ));
    }
    let (_guard, mut tx) = db.begin_write().await?;
    let exists: i64 = match document_type {
        "customer_order" => {
            sqlx::query_scalar("SELECT COUNT(*) FROM orders WHERE id = ? AND status = 'draft'")
                .bind(document_id)
                .fetch_one(&mut *tx)
                .await?
        }
        "purchase_order" => {
            sqlx::query_scalar(
                "SELECT COUNT(*) FROM purchase_orders WHERE id = ? AND status NOT IN ('cancelled', 'received')",
            )
            .bind(document_id)
            .fetch_one(&mut *tx)
            .await?
        }
        _ => 0,
    };
    if exists == 0 {
        return Err(CoreError::Validation(
            "Le document n'existe pas ou n'est plus modifiable.".into(),
        ));
    }
    let current: Option<String> = sqlx::query_scalar(
        "SELECT status FROM commercial_document_workflows WHERE document_type = ? AND document_id = ?",
    )
    .bind(document_type)
    .bind(document_id)
    .fetch_optional(&mut *tx)
    .await?;
    if matches!(
        current.as_deref(),
        Some("pending_owner_approval" | "approved")
    ) {
        return Err(CoreError::Validation(
            "Ce document est déjà soumis ou approuvé.".into(),
        ));
    }
    let snapshot = document_snapshot(&mut tx, document_type, document_id).await?;
    let submitted_by = actor_db_id_resolved(&mut tx, &actor).await?;
    sqlx::query(
        "INSERT INTO commercial_document_workflows (document_type, document_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, review_reason, updated_at)
         VALUES (?, ?, 'pending_owner_approval', ?, datetime('now'), NULL, NULL, NULL, datetime('now'))
         ON CONFLICT(document_type, document_id) DO UPDATE SET status = 'pending_owner_approval', submitted_by = excluded.submitted_by,
         submitted_at = excluded.submitted_at, reviewed_by = NULL, reviewed_at = NULL, review_reason = NULL, updated_at = datetime('now')",
    )
    .bind(document_type)
    .bind(document_id)
    .bind(submitted_by)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO document_approval_events (document_type, document_id, action, actor_user_id, actor_role, snapshot_json)
         VALUES (?, ?, 'submitted', ?, ?, ?)",
    )
    .bind(document_type)
    .bind(document_id)
    .bind(submitted_by)
    .bind(actor.role.as_str())
    .bind(snapshot.to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn review_document(
    db: &DepotDb,
    document_type: &str,
    document_id: i64,
    input: ReviewDecisionInput,
) -> CoreResult<()> {
    check_document_type(document_type)?;
    let actor = authenticated_actor()?;
    if actor.role != Role::Owner {
        return Err(CoreError::Forbidden(
            "Seul le propriétaire peut statuer sur une approbation.".into(),
        ));
    }
    let action = input.action.trim();
    if !matches!(action, "approved" | "rejected" | "changes_requested") {
        return Err(CoreError::Validation("Décision invalide.".into()));
    }
    let reason = input
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if action != "approved" && reason.is_none() {
        return Err(CoreError::Validation(
            "Un motif est obligatoire pour un rejet ou une demande de modification.".into(),
        ));
    }
    let (_guard, mut tx) = db.begin_write().await?;
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM commercial_document_workflows WHERE document_type = ? AND document_id = ?",
    )
    .bind(document_type)
    .bind(document_id)
    .fetch_optional(&mut *tx)
    .await?;
    if status.as_deref() != Some("pending_owner_approval") {
        return Err(CoreError::Validation(
            "Le document n'est pas en attente d'approbation.".into(),
        ));
    }
    let snapshot = document_snapshot(&mut tx, document_type, document_id).await?;
    let reviewer = actor_db_id(&actor);
    sqlx::query(
        "UPDATE commercial_document_workflows SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_reason = ?, updated_at = datetime('now')
         WHERE document_type = ? AND document_id = ? AND status = 'pending_owner_approval'",
    )
    .bind(action)
    .bind(reviewer)
    .bind(reason)
    .bind(document_type)
    .bind(document_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO document_approval_events (document_type, document_id, action, actor_user_id, actor_role, reason, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(document_type)
    .bind(document_id)
    .bind(action)
    .bind(reviewer)
    .bind(actor.role.as_str())
    .bind(reason)
    .bind(snapshot.to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn require_approval_or_owner(
    document_type: &str,
    document_id: i64,
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> CoreResult<()> {
    // Échec fermé : sans session identifiée, aucune opération sensible n'est permise.
    let Some(actor) = auth::current_actor() else {
        return Err(CoreError::Forbidden(
            "Une session utilisateur est requise pour cette opération.".into(),
        ));
    };
    if actor.role == Role::Owner {
        return Ok(());
    }
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM commercial_document_workflows WHERE document_type = ? AND document_id = ?",
    )
    .bind(document_type)
    .bind(document_id)
    .fetch_optional(&mut **tx)
    .await?;
    if status.as_deref() == Some("approved") {
        Ok(())
    } else {
        Err(CoreError::Forbidden(
            "Validation du propriétaire requise avant l'opération.".into(),
        ))
    }
}

pub async fn record_owner_direct_approval(
    document_type: &str,
    document_id: i64,
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> CoreResult<()> {
    // Échec fermé : sans session identifiée, aucune opération sensible n'est permise.
    let Some(actor) = auth::current_actor() else {
        return Err(CoreError::Forbidden(
            "Une session utilisateur est requise pour cette opération.".into(),
        ));
    };
    if actor.role != Role::Owner {
        return Ok(());
    }
    let current: Option<String> = sqlx::query_scalar(
        "SELECT status FROM commercial_document_workflows WHERE document_type = ? AND document_id = ?",
    )
    .bind(document_type)
    .bind(document_id)
    .fetch_optional(&mut **tx)
    .await?;
    if current.as_deref() == Some("approved") {
        return Ok(());
    }
    let snapshot = document_snapshot(tx, document_type, document_id).await?;
    let user_id = actor_db_id_resolved(tx, &actor).await?;
    sqlx::query(
        "INSERT INTO commercial_document_workflows (document_type, document_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, review_reason, updated_at)
         VALUES (?, ?, 'approved', ?, datetime('now'), ?, datetime('now'), 'Approbation directe par le propriétaire', datetime('now'))
         ON CONFLICT(document_type, document_id) DO UPDATE SET status = 'approved', reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, review_reason = excluded.review_reason, updated_at = datetime('now')",
    )
    .bind(document_type)
    .bind(document_id)
    .bind(user_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO document_approval_events (document_type, document_id, action, actor_user_id, actor_role, reason, snapshot_json)
         VALUES (?, ?, 'approved', ?, ?, 'Approbation directe par le propriétaire', ?)",
    )
    .bind(document_type)
    .bind(document_id)
    .bind(user_id)
    .bind(actor.role.as_str())
    .bind(snapshot.to_string())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
