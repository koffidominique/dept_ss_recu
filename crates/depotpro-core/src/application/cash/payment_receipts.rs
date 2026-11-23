// ============================================================================
// Reçu de paiement client : snapshot immuable et consultation / réimpression
// ============================================================================

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, Transaction};

use crate::application::auth::{current_actor, require_current_actor_permission, Permission};
use crate::application::pdf::{DocumentPdfInput, DocumentPdfPayment, DocumentPdfSummaryRow};
use crate::application::reports::AppSettingsDto;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PaymentReceiptSnapshotDto {
    pub id: i64,
    pub payment_id: i64,
    pub version: i64,
    pub receipt_number: String,
    pub snapshot_json: String,
    pub issued_at: String,
    pub issued_by_user_id: Option<String>,
    pub issued_by_name: String,
    pub issued_by_role: String,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaymentPartSnapshotRow {
    method_code: String,
    method_label: String,
    amount_xof: i64,
}

fn format_fcfa_space(value: i64) -> String {
    let digits = value.abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(' ');
        }
        grouped.push(ch);
    }
    if value < 0 {
        format!("- {grouped} FCFA")
    } else {
        format!("{grouped} FCFA")
    }
}

pub(crate) async fn persist_payment_receipt_snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    payment_id: i64,
    balance_before_xof: Option<i64>,
    balance_after_xof: Option<i64>,
) -> CoreResult<PaymentReceiptSnapshotDto> {
    if let Some(existing) = sqlx::query_as::<_, PaymentReceiptSnapshotDto>(
        "SELECT id, payment_id, version, receipt_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role
         FROM payment_receipt_snapshots WHERE payment_id = ? AND version = 1",
    )
    .bind(payment_id)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(existing);
    }

    #[derive(FromRow)]
    struct PaymentHeaderRow {
        reference: String,
        sale_id: Option<i64>,
        order_id: Option<i64>,
        client_id: Option<i64>,
        payment_kind: String,
        total_amount: i64,
        note: Option<String>,
        external_reference: Option<String>,
        recorded_by_user_id: Option<String>,
        recorded_by_name: Option<String>,
        created_at: String,
    }

    let pay = sqlx::query_as::<_, PaymentHeaderRow>(
        "SELECT reference, sale_id, order_id, client_id, payment_kind, total_amount, note,
                external_reference, recorded_by_user_id, recorded_by_name, created_at
         FROM payments WHERE id = ?",
    )
    .bind(payment_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| CoreError::NotFound("Paiement introuvable.".into()))?;

    let settings = sqlx::query_as::<_, AppSettingsDto>(
        "SELECT company_name, company_legal_name, business_activity, address, phone, whatsapp, email,
                city, commune, quartier, country, rccm, ncc, currency, allow_negative_stock,
                invoice_prefix, sale_prefix, purchase_prefix, order_prefix, receipt_prefix,
                credit_note_prefix, theme, logo_path, setup_completed
         FROM app_settings WHERE id = 1",
    )
    .fetch_one(&mut **tx)
    .await?;

    let parts = sqlx::query_as::<_, PaymentPartSnapshotRow>(
        "SELECT pp.method_code, COALESCE(pm.label, pp.method_code) AS method_label, pp.amount AS amount_xof
         FROM payment_parts pp
         LEFT JOIN payment_methods pm ON pm.code = pp.method_code
         WHERE pp.payment_id = ?
         ORDER BY pp.id ASC",
    )
    .bind(payment_id)
    .fetch_all(&mut **tx)
    .await?;

    let client_info: Option<(
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = if let Some(cid) = pay.client_id {
        sqlx::query_as(
            "SELECT code, name, establishment_name, phone, commune, quartier FROM clients WHERE id = ?",
        )
        .bind(cid)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        None
    };

    let payer_name = client_info
        .as_ref()
        .map(|(_, name, est, _, _, _)| {
            est.as_deref()
                .filter(|v| !v.trim().is_empty())
                .map(|e| format!("{name} ({e})"))
                .unwrap_or_else(|| name.clone())
        })
        .unwrap_or_else(|| "Client comptoir".to_string());
    let payer_phone = client_info
        .as_ref()
        .and_then(|(_, _, _, ph, _, _)| ph.clone());
    let payer_code = client_info.as_ref().map(|(c, _, _, _, _, _)| c.clone());
    let payer_location = client_info.as_ref().and_then(|(_, _, _, _, com, q)| {
        let joined = [com.as_deref(), q.as_deref()]
            .into_iter()
            .flatten()
            .filter(|v| !v.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" / ");
        if joined.is_empty() {
            None
        } else {
            Some(joined)
        }
    });

    let linked_order_ref: Option<String> = if let Some(oid) = pay.order_id {
        sqlx::query_scalar("SELECT order_number FROM orders WHERE id = ?")
            .bind(oid)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    let linked_sale_ref: Option<String> = if let Some(sid) = pay.sale_id {
        sqlx::query_scalar("SELECT reference FROM sales WHERE id = ?")
            .bind(sid)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    let linked_ref = linked_order_ref
        .clone()
        .or(linked_sale_ref.clone())
        .unwrap_or_else(|| pay.reference.clone());

    let (before_val, after_val) = match (balance_before_xof, balance_after_xof) {
        (Some(b), Some(a)) => (b, a),
        _ => {
            if let Some(oid) = pay.order_id {
                let row: Option<(i64, i64)> = sqlx::query_as(
                    "SELECT total_to_collect_xof, paid_xof FROM orders WHERE id = ?",
                )
                .bind(oid)
                .fetch_optional(&mut **tx)
                .await?;
                if let Some((total_c, paid_c)) = row {
                    let after = (total_c - paid_c).max(0);
                    let before = (after + pay.total_amount).max(after);
                    (before, after)
                } else {
                    (pay.total_amount, 0)
                }
            } else if let Some(sid) = pay.sale_id {
                let rem: Option<i64> = sqlx::query_scalar(
                    "SELECT remaining_amount FROM customer_receivables WHERE sale_id = ?",
                )
                .bind(sid)
                .fetch_optional(&mut **tx)
                .await?;
                if let Some(after) = rem {
                    (after + pay.total_amount, after)
                } else {
                    (pay.total_amount, 0)
                }
            } else {
                (pay.total_amount, 0)
            }
        }
    };

    let actor = current_actor();
    let issuer_id = pay
        .recorded_by_user_id
        .clone()
        .or_else(|| actor.as_ref().map(|a| a.user_id.clone()));
    let issuer_name = pay
        .recorded_by_name
        .clone()
        .or_else(|| actor.as_ref().map(|a| a.display_name.clone()))
        .unwrap_or_else(|| "Caissier / Opérateur".to_string());
    let issuer_role = actor
        .as_ref()
        .map(|a| a.role.as_str().to_string())
        .unwrap_or_else(|| "cashier".to_string());

    let pdf_payments = parts
        .iter()
        .map(|p| DocumentPdfPayment {
            label: format!(
                "{} ({}){}",
                p.method_label,
                p.method_code,
                pay.external_reference
                    .as_deref()
                    .filter(|r| !r.trim().is_empty())
                    .map(|r| format!(" · Réf. {r}"))
                    .unwrap_or_default()
            ),
            amount: p.amount_xof,
        })
        .collect::<Vec<_>>();

    let mut party_details = Vec::new();
    if let Some(code) = &payer_code {
        party_details.push(format!("Code : {code}"));
    }
    if let Some(loc) = &payer_location {
        party_details.push(loc.clone());
    }
    if let Some(ph) = &payer_phone {
        party_details.push(format!("Tél. : {ph}"));
    }

    let kind_label = match pay.payment_kind.as_str() {
        "receivable" => "Règlement de créance client",
        "supplier_debt" => "Règlement dette fournisseur",
        _ => "Encaissement client",
    };

    let mut note_lines = vec![
        format!("Nature : {kind_label}"),
        format!("Document lié : {linked_ref}"),
        format!("Encaissé par : {issuer_name}"),
    ];
    if let Some(ext) = pay
        .external_reference
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        note_lines.push(format!(
            "Référence transaction externe / Mobile Money : {ext}"
        ));
    }
    if let Some(n) = pay.note.as_deref().filter(|s| !s.trim().is_empty()) {
        note_lines.push(format!("Observation : {n}"));
    }
    note_lines.push(
        "Ce reçu atteste uniquement de l'encaissement enregistré à la date et pour le montant ci-dessus.".to_string(),
    );

    let pdf_document = DocumentPdfInput {
        doc_type: "REÇU DE PAIEMENT".to_string(),
        reference: pay.reference.clone(),
        order_reference: linked_order_ref.clone(),
        linked_document_ref: Some(linked_ref.clone()),
        date: pay.created_at.clone(),
        status_label: Some(if after_val == 0 {
            "SOLDÉ".to_string()
        } else {
            "ACOMPTE ENCAISSÉ".to_string()
        }),
        party_title: Some("PAYEUR / CLIENT".to_string()),
        party_name: Some(payer_name.clone()),
        party_details: if party_details.is_empty() {
            None
        } else {
            Some(party_details.join(" · "))
        },
        party_phone: payer_phone.clone(),
        secondary_party_title: Some("DOCUMENT RATTACHÉ".to_string()),
        secondary_party_name: Some(linked_ref.clone()),
        secondary_party_details: Some(kind_label.to_string()),
        cashier_name: Some(issuer_name.clone()),
        issuer_role: Some(issuer_role.clone()),
        external_references: pay
            .external_reference
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|s| vec![s.to_string()]),
        balance_before_xof: Some(before_val),
        balance_after_xof: Some(after_val),
        summary_rows: vec![
            DocumentPdfSummaryRow {
                label: "Solde dû avant règlement".to_string(),
                value: format_fcfa_space(before_val),
                bold: false,
                tone: None,
            },
            DocumentPdfSummaryRow {
                label: "MONTANT ENCAISSÉ".to_string(),
                value: format_fcfa_space(pay.total_amount),
                bold: true,
                tone: Some("success".to_string()),
            },
            DocumentPdfSummaryRow {
                label: "Solde restant après règlement".to_string(),
                value: format_fcfa_space(after_val),
                bold: true,
                tone: if after_val > 0 {
                    Some("danger".to_string())
                } else {
                    Some("success".to_string())
                },
            },
        ],
        payments: Some(pdf_payments),
        notes: Some(note_lines.join("\n")),
        ..Default::default()
    };

    let snapshot = serde_json::json!({
        "documentType": "REÇU DE PAIEMENT",
        "receiptNumber": pay.reference,
        "version": 1,
        "issuedAt": pay.created_at,
        "issuer": {
            "userId": issuer_id,
            "name": issuer_name,
            "role": issuer_role,
        },
        "company": settings,
        "payer": {
            "clientId": pay.client_id,
            "code": payer_code,
            "name": payer_name,
            "phone": payer_phone,
            "location": payer_location,
        },
        "linkedDocument": {
            "orderId": pay.order_id,
            "orderNumber": linked_order_ref,
            "saleId": pay.sale_id,
            "saleReference": linked_sale_ref,
            "reference": linked_ref,
        },
        "payment": {
            "id": payment_id,
            "reference": pay.reference,
            "kind": pay.payment_kind,
            "totalAmountXof": pay.total_amount,
            "externalReference": pay.external_reference,
            "note": pay.note,
            "parts": parts,
        },
        "balanceBeforeXof": before_val,
        "balanceAfterXof": after_val,
        "pdfDocument": pdf_document,
    });
    let snapshot_json = serde_json::to_string(&snapshot).map_err(|e| {
        CoreError::Internal(format!("Sérialisation reçu de paiement impossible : {e}"))
    })?;

    sqlx::query(
        "INSERT OR IGNORE INTO payment_receipt_snapshots
            (payment_id, version, receipt_number, snapshot_json, issued_at,
             issued_by_user_id, issued_by_name, issued_by_role)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?)",
    )
    .bind(payment_id)
    .bind(&pay.reference)
    .bind(&snapshot_json)
    .bind(&pay.created_at)
    .bind(&issuer_id)
    .bind(&issuer_name)
    .bind(&issuer_role)
    .execute(&mut **tx)
    .await?;

    let row = sqlx::query_as::<_, PaymentReceiptSnapshotDto>(
        "SELECT id, payment_id, version, receipt_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role
         FROM payment_receipt_snapshots WHERE payment_id = ? AND version = 1",
    )
    .bind(payment_id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(row)
}

pub async fn get_or_issue_payment_receipt(
    db: &DepotDb,
    payment_id: i64,
) -> CoreResult<PaymentReceiptSnapshotDto> {
    require_current_actor_permission(Permission::SalesRead)?;
    if let Some(existing) = sqlx::query_as::<_, PaymentReceiptSnapshotDto>(
        "SELECT id, payment_id, version, receipt_number, snapshot_json, issued_at,
                issued_by_user_id, issued_by_name, issued_by_role
         FROM payment_receipt_snapshots WHERE payment_id = ? ORDER BY version DESC LIMIT 1",
    )
    .bind(payment_id)
    .fetch_optional(&db.pool)
    .await?
    {
        return Ok(existing);
    }

    let (_guard, mut tx) = db.begin_write().await?;
    let snap = persist_payment_receipt_snapshot_tx(&mut tx, payment_id, None, None).await?;
    tx.commit().await?;
    Ok(snap)
}
