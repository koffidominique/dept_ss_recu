// ============================================================================
// Réception des bons de commande fournisseurs & snapshots immuables
// ============================================================================

use std::collections::HashSet;

use sqlx::{Sqlite, Transaction};

use crate::application::auth::{current_actor, require_current_actor_permission, Permission};
use crate::application::pdf::{
    DocumentPdfInput, DocumentPdfLine, DocumentPdfPackagingLine, DocumentPdfSummaryRow,
};
use crate::application::reports::AppSettingsDto;
use crate::application::sales::audit_log_tx;
use crate::domain::money::Money;
use crate::domain::quantity::Quantity;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::order_queries::get_purchase_receipt_detail;
use super::packaging_exchange::issue_reserved_packaging_tx;
use super::receipt_helpers::apply_receipt_stock_and_cost_tx;
use super::{
    list_purchase_orders, PurchaseReceiptDto, PurchaseReceiptLineDto, PurchaseReceiptResultDto,
    ReceivePurchaseOrderInput, SupplierPackagingExchangeLineDto,
};

fn format_fcfa(value: i64) -> String {
    let digits = value.abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
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

fn format_milli(milli: i64) -> String {
    let whole = milli / 1000;
    let frac = (milli % 1000).abs();
    if frac == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{frac:03}")
            .trim_end_matches('0')
            .to_string()
    }
}

fn parse_optional_non_neg_qty(raw: Option<&str>, label: &str) -> CoreResult<i64> {
    let Some(val) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(0);
    };
    let q = Quantity::parse_str(val, label)?;
    if q.milli_units < 0 {
        return Err(CoreError::Validation(format!("{label} doit être >= 0.")));
    }
    Ok(q.milli_units)
}

async fn persist_purchase_receipt_snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    receipt_id: i64,
    po_id: i64,
) -> CoreResult<()> {
    let (
        rec_ref,
        status,
        received_by_name,
        total_amount,
        notes,
        created_at,
        po_ref,
        supplier_id,
        supplier_name,
        supplier_code,
        supplier_phone,
        supplier_address,
    ): (
        String,
        String,
        Option<String>,
        i64,
        Option<String>,
        String,
        String,
        i64,
        String,
        String,
        String,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT pr.reference, pr.status, pr.received_by_name, pr.total_amount, pr.notes, pr.created_at,
                po.reference, s.id, s.name, s.code, s.phone, s.address
         FROM purchase_receipts pr
         JOIN purchase_orders po ON po.id = pr.purchase_order_id
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE pr.id = ?",
    )
    .bind(receipt_id)
    .fetch_one(&mut **tx)
    .await?;

    let settings = sqlx::query_as::<_, AppSettingsDto>(
        "SELECT company_name, company_legal_name, business_activity, address, phone, whatsapp, email,
                city, commune, quartier, country, rccm, ncc, currency, allow_negative_stock,
                invoice_prefix, sale_prefix, purchase_prefix, order_prefix, receipt_prefix,
                credit_note_prefix, theme, logo_path, setup_completed
         FROM app_settings WHERE id = 1",
    )
    .fetch_one(&mut **tx)
    .await?;

    #[derive(sqlx::FromRow)]
    struct SnapRecLine {
        purchase_order_line_id: i64,
        product_name: String,
        packaging_name: String,
        base_unit: String,
        coefficient_milli: i64,
        ordered_quantity_milli: i64,
        received_quantity_milli: i64,
        missing_quantity_milli: i64,
        damaged_quantity_milli: i64,
        refused_quantity_milli: i64,
        base_quantity_milli: i64,
        unit_price: i64,
        amount: i64,
        discrepancy_reason: Option<String>,
    }

    let lines = sqlx::query_as::<_, SnapRecLine>(
        "SELECT prl.purchase_order_line_id, pol.product_name, pol.packaging_name, pol.base_unit,
                pol.coefficient_milli, pol.ordered_quantity_milli, prl.quantity_milli AS received_quantity_milli,
                prl.missing_quantity_milli, prl.damaged_quantity_milli, prl.refused_quantity_milli,
                prl.base_quantity_milli, prl.unit_price, prl.amount, prl.discrepancy_reason
         FROM purchase_receipt_lines prl
         JOIN purchase_order_lines pol ON pol.id = prl.purchase_order_line_id
         WHERE prl.receipt_id = ? ORDER BY prl.id",
    )
    .bind(receipt_id)
    .fetch_all(&mut **tx)
    .await?;

    let exchanges = sqlx::query_as::<_, SupplierPackagingExchangeLineDto>(
        "SELECT purchase_order_line_id, returnable_id, code_snapshot, name_snapshot, kind_snapshot, pieces_issued
         FROM supplier_packaging_exchange_lines WHERE receipt_id = ? ORDER BY id",
    )
    .bind(receipt_id)
    .fetch_all(&mut **tx)
    .await?;

    let pdf_lines = lines
        .iter()
        .map(|l| DocumentPdfLine {
            label: format!("{} ({})", l.product_name, l.packaging_name),
            sublabel: Some(format!(
                "Équiv. stock : {} {} · Commandé : {} {}",
                format_milli(l.base_quantity_milli),
                l.base_unit,
                format_milli(l.ordered_quantity_milli),
                l.packaging_name
            )),
            quantity: format!(
                "{} {}",
                format_milli(l.received_quantity_milli),
                l.packaging_name
            ),
            unit_price: Some(l.unit_price),
            total: Some(l.amount),
            ordered_quantity: Some(format!(
                "{} {}",
                format_milli(l.ordered_quantity_milli),
                l.packaging_name
            )),
            missing_quantity: (l.missing_quantity_milli > 0)
                .then(|| format_milli(l.missing_quantity_milli)),
            damaged_quantity: (l.damaged_quantity_milli > 0)
                .then(|| format_milli(l.damaged_quantity_milli)),
            refused_quantity: (l.refused_quantity_milli > 0)
                .then(|| format_milli(l.refused_quantity_milli)),
            discrepancy_reason: l.discrepancy_reason.clone(),
            packaging_info: Some(l.packaging_name.clone()),
            ..Default::default()
        })
        .collect::<Vec<_>>();

    let pdf_packaging = exchanges
        .iter()
        .map(|ex| DocumentPdfPackagingLine {
            label: format!("{} ({})", ex.name_snapshot, ex.code_snapshot),
            kind: ex.kind_snapshot.clone(),
            expected_quantity: ex.pieces_issued,
            issued_quantity: Some(ex.pieces_issued),
            returned_quantity: None,
            unit_deposit_xof: None,
            status_label: "Emballages vides remis physiquement au fournisseur".to_string(),
            detail: Some("Échange physique — hors facturation liquide".to_string()),
            amount: None,
        })
        .collect::<Vec<_>>();

    let status_label = match status.as_str() {
        "discrepancy" => "RÉCEPTION AVEC ÉCART",
        "partial" => "RÉCEPTION PARTIELLE",
        _ => "RÉCEPTION COMPLÈTE",
    };

    let mut sup_details = vec![format!("Code : {supplier_code}"), format!("Tél. : {supplier_phone}")];
    if let Some(addr) = supplier_address.as_deref().filter(|s| !s.trim().is_empty()) {
        sup_details.push(format!("Adresse : {}", addr.trim()));
    }

    let actor = current_actor();
    let issuer_id = actor.as_ref().map(|a| a.user_id.clone());
    let issuer_name = received_by_name
        .clone()
        .or_else(|| actor.as_ref().map(|a| a.display_name.clone()))
        .unwrap_or_else(|| "Réceptionnaire Dépôt".to_string());
    let issuer_role = actor
        .as_ref()
        .map(|a| a.role.as_str().to_string())
        .unwrap_or_else(|| "manager".to_string());

    let pdf_document = DocumentPdfInput {
        doc_type: "BON DE RÉCEPTION FOURNISSEUR".to_string(),
        reference: rec_ref.clone(),
        order_reference: Some(po_ref.clone()),
        linked_document_ref: Some(po_ref.clone()),
        date: created_at.clone(),
        status_label: Some(status_label.to_string()),
        party_title: Some("FOURNISSEUR".to_string()),
        party_name: Some(supplier_name.clone()),
        party_details: Some(sup_details.join(" · ")),
        party_phone: Some(supplier_phone.clone()),
        secondary_party_title: Some("COMMANDE D'ORIGINE & CONTRÔLE".to_string()),
        secondary_party_name: Some(format!("Bon de commande {po_ref}")),
        secondary_party_details: Some(format!("Réceptionné par : {issuer_name}")),
        cashier_name: Some(issuer_name.clone()),
        version: Some(1),
        issuer_role: Some(issuer_role.clone()),
        lines: pdf_lines,
        packaging_lines: pdf_packaging,
        summary_rows: vec![
            DocumentPdfSummaryRow {
                label: "VALEUR LIQUIDES RÉCEPTIONNÉS".to_string(),
                value: format_fcfa(total_amount),
                bold: true,
                tone: Some("success".to_string()),
            },
            DocumentPdfSummaryRow {
                label: "Statut du contrôle".to_string(),
                value: status_label.to_string(),
                bold: false,
                tone: (status == "discrepancy").then(|| "danger".to_string()),
            },
        ],
        notes: notes.clone(),
        ..Default::default()
    };

    let receipt_lines_dto: Vec<PurchaseReceiptLineDto> = lines
        .into_iter()
        .map(|l| PurchaseReceiptLineDto {
            purchase_order_line_id: l.purchase_order_line_id,
            product_name: l.product_name,
            packaging_name: l.packaging_name,
            base_unit: l.base_unit,
            coefficient_milli: l.coefficient_milli,
            received_quantity_milli: l.received_quantity_milli,
            missing_quantity_milli: l.missing_quantity_milli,
            damaged_quantity_milli: l.damaged_quantity_milli,
            refused_quantity_milli: l.refused_quantity_milli,
            base_quantity_milli: l.base_quantity_milli,
            unit_price: l.unit_price,
            amount: l.amount,
            discrepancy_reason: l.discrepancy_reason,
        })
        .collect();

    let snapshot = serde_json::json!({
        "documentType": "BON DE RÉCEPTION FOURNISSEUR",
        "documentNumber": rec_ref,
        "version": 1,
        "issuedAt": created_at,
        "issuer": {
            "userId": issuer_id,
            "name": issuer_name,
            "role": issuer_role,
        },
        "company": settings,
        "supplier": {
            "id": supplier_id,
            "code": supplier_code,
            "name": supplier_name,
            "phone": supplier_phone,
            "address": supplier_address,
        },
        "receipt": {
            "id": receipt_id,
            "reference": rec_ref,
            "purchaseOrderId": po_id,
            "orderReference": po_ref,
            "status": status,
            "receivedByName": issuer_name,
            "totalAmountXof": total_amount,
            "notes": notes,
        },
        "lines": receipt_lines_dto,
        "packagingExchanges": exchanges,
        "pdfDocument": pdf_document,
    });
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|e| CoreError::Internal(format!("Sérialisation snapshot REC impossible : {e}")))?;

    sqlx::query(
        "INSERT OR IGNORE INTO purchase_receipt_snapshots
            (receipt_id, purchase_order_id, version, document_number, snapshot_json, issued_at,
             issued_by_user_id, issued_by_name, issued_by_role)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)",
    )
    .bind(receipt_id)
    .bind(po_id)
    .bind(&rec_ref)
    .bind(&snapshot_json)
    .bind(&created_at)
    .bind(issuer_id.as_deref())
    .bind(&issuer_name)
    .bind(&issuer_role)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn receive_purchase_order(
    db: &DepotDb,
    purchase_order_id: i64,
    input: ReceivePurchaseOrderInput,
) -> CoreResult<PurchaseReceiptResultDto> {
    require_current_actor_permission(Permission::PurchasesWrite)?;
    if purchase_order_id <= 0 {
        return Err(CoreError::Validation(
            "Identifiant de bon de commande invalide.".to_string(),
        ));
    }
    let request_key = input.request_key.trim().to_string();
    if request_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    if input.lines.is_empty() {
        return Err(CoreError::Validation(
            "Saisissez au moins une ligne reçue.".to_string(),
        ));
    }

    let mut seen_po_lines: HashSet<i64> = HashSet::with_capacity(input.lines.len());
    struct NormalizedRecLine {
        po_line_id: i64,
        qty: Quantity,
        missing_milli: i64,
        damaged_milli: i64,
        refused_milli: i64,
        disc_reason: Option<String>,
    }
    let mut normalized_lines: Vec<NormalizedRecLine> = Vec::with_capacity(input.lines.len());
    for l in &input.lines {
        if l.purchase_order_line_id <= 0 {
            return Err(CoreError::Validation(
                "Identifiant de ligne de commande invalide.".to_string(),
            ));
        }
        if !seen_po_lines.insert(l.purchase_order_line_id) {
            return Err(CoreError::Validation(format!(
                "Ligne de commande #{} dupliquée dans la même demande de réception. Regroupez les quantités sur une seule ligne.",
                l.purchase_order_line_id
            )));
        }
        let qty = Quantity::parse_str(&l.received_quantity, "Quantité réceptionnée")?;
        let missing_milli =
            parse_optional_non_neg_qty(l.missing_quantity.as_deref(), "Quantité manquante")?;
        let damaged_milli =
            parse_optional_non_neg_qty(l.damaged_quantity.as_deref(), "Quantité cassée / avariée")?;
        let refused_milli =
            parse_optional_non_neg_qty(l.refused_quantity.as_deref(), "Quantité refusée")?;

        if qty.milli_units < 0 {
            return Err(CoreError::Validation(
                "La quantité reçue ne peut pas être négative.".to_string(),
            ));
        }
        let has_incident = missing_milli > 0 || damaged_milli > 0 || refused_milli > 0;
        if qty.milli_units == 0 && !has_incident {
            return Err(CoreError::Validation(
                "La quantité reçue doit être > 0 (ou déclarez un écart manquant/cassé/refusé).".to_string(),
            ));
        }
        let disc_reason = l
            .discrepancy_reason
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if has_incident && disc_reason.is_none() {
            return Err(CoreError::Validation(
                "Un motif d'écart est obligatoire dès qu'une quantité manquante, cassée ou refusée est déclarée.".to_string(),
            ));
        }
        normalized_lines.push(NormalizedRecLine {
            po_line_id: l.purchase_order_line_id,
            qty,
            missing_milli,
            damaged_milli,
            refused_milli,
            disc_reason,
        });
    }

    let (_guard, mut tx) = db.begin_write().await?;
    if let Some(existing) = sqlx::query_as::<_, PurchaseReceiptDto>(
        "SELECT id, reference, purchase_order_id, total_amount, status, received_by_name, notes, created_at
         FROM purchase_receipts WHERE request_key = ?",
    )
    .bind(&request_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.rollback().await?;
        if existing.purchase_order_id != purchase_order_id {
            return Err(CoreError::DuplicateOperation(
                "Cette clé d'idempotence a déjà été utilisée pour un autre bon de commande."
                    .to_string(),
            ));
        }
        return build_receipt_result(db, existing.id, existing.purchase_order_id).await;
    }

    let po: Option<(i64, String, i64, String)> = sqlx::query_as(
        "SELECT id, reference, supplier_id, status FROM purchase_orders WHERE id = ?",
    )
    .bind(purchase_order_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (_po_id, po_ref, supplier_id, po_status) =
        po.ok_or_else(|| CoreError::Validation("Bon de commande introuvable.".to_string()))?;
    if matches!(po_status.as_str(), "cancelled" | "received") {
        return Err(CoreError::HistoricalImmutable(
            "Ce bon de commande est déjà clôturé ou annulé.".to_string(),
        ));
    }
    crate::application::commercial_documents::require_approval_or_owner(
        "purchase_order",
        purchase_order_id,
        &mut tx,
    )
    .await?;
    crate::application::commercial_documents::record_owner_direct_approval(
        "purchase_order",
        purchase_order_id,
        &mut tx,
    )
    .await?;

    let payment_terms_days: i64 =
        sqlx::query_scalar("SELECT payment_terms_days FROM suppliers WHERE id = ?")
            .bind(supplier_id)
            .fetch_one(&mut *tx)
            .await?;

    struct PreparedReceiptLine {
        pol_id: i64,
        pid: i64,
        qty_milli: i64,
        missing_milli: i64,
        damaged_milli: i64,
        refused_milli: i64,
        base_qty_milli: i64,
        unit_price: i64,
        amount: i64,
        disc_reason: Option<String>,
    }
    let mut receipt_total = Money::ZERO;
    let mut prepared: Vec<PreparedReceiptLine> = Vec::with_capacity(normalized_lines.len());
    let mut has_any_discrepancy = false;

    for item in &normalized_lines {
        let pol: Option<(i64, i64, i64, i64, i64, i64)> = sqlx::query_as(
            "SELECT id, product_id, coefficient_milli, ordered_quantity_milli, received_quantity_milli, unit_price
             FROM purchase_order_lines WHERE id = ? AND purchase_order_id = ?",
        )
        .bind(item.po_line_id)
        .bind(purchase_order_id)
        .fetch_optional(&mut *tx)
        .await?;
        let (pol_id, pid, coeff_milli, ordered_milli, received_milli, unit_price) =
            pol.ok_or_else(|| CoreError::Validation("Ligne de commande introuvable.".to_string()))?;

        if received_milli >= ordered_milli {
            return Err(CoreError::Validation(format!(
                "La ligne de commande #{pol_id} a déjà été intégralement réceptionnée."
            )));
        }
        let remaining_milli = ordered_milli - received_milli;
        let cum_received = received_milli
            .checked_add(item.qty.milli_units)
            .ok_or_else(|| CoreError::Validation("Débordement quantité réceptionnée.".to_string()))?;
        if cum_received > ordered_milli {
            return Err(CoreError::Validation(
                "La quantité reçue dépasse la quantité commandée restante.".to_string(),
            ));
        }
        let accounted_milli = item
            .qty
            .milli_units
            .saturating_add(item.missing_milli)
            .saturating_add(item.damaged_milli)
            .saturating_add(item.refused_milli);
        if accounted_milli > remaining_milli {
            return Err(CoreError::Validation(
                "La somme (reçu + manquant + cassé + refusé) dépasse la quantité restante à livrer."
                    .to_string(),
            ));
        }
        if item.missing_milli > 0
            || item.damaged_milli > 0
            || item.refused_milli > 0
            || item.disc_reason.is_some()
        {
            has_any_discrepancy = true;
        }
        let base_qty = item
            .qty
            .multiply_coefficient_to_base(Quantity::from_milli(coeff_milli))?;
        let amount = Money(item.qty.compute_line_fcfa(unit_price)?);
        receipt_total = receipt_total.checked_add(amount, "Total réception")?;
        prepared.push(PreparedReceiptLine {
            pol_id,
            pid,
            qty_milli: item.qty.milli_units,
            missing_milli: item.missing_milli,
            damaged_milli: item.damaged_milli,
            refused_milli: item.refused_milli,
            base_qty_milli: base_qty.milli_units,
            unit_price,
            amount: amount.value(),
            disc_reason: item.disc_reason.clone(),
        });
    }

    let receipt_prefix: String =
        sqlx::query_scalar("SELECT receipt_prefix FROM app_settings WHERE id = 1")
            .fetch_one(&mut *tx)
            .await?;
    let rec_ref = DepotDb::next_sequence(&mut tx, &receipt_prefix).await?;
    let received_by_name = current_actor().map(|a| a.display_name);

    let receipt_id = sqlx::query(
        "INSERT INTO purchase_receipts (reference, request_key, purchase_order_id, total_amount, status, received_by_name, notes)
         VALUES (?, ?, ?, ?, 'complete', ?, ?)",
    )
    .bind(&rec_ref)
    .bind(&request_key)
    .bind(purchase_order_id)
    .bind(receipt_total.value())
    .bind(received_by_name.as_deref())
    .bind(input.notes.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    for p in &prepared {
        let updated = sqlx::query(
            "UPDATE purchase_order_lines
             SET received_quantity_milli = received_quantity_milli + ?
             WHERE id = ? AND purchase_order_id = ? AND received_quantity_milli + ? <= ordered_quantity_milli",
        )
        .bind(p.qty_milli)
        .bind(p.pol_id)
        .bind(purchase_order_id)
        .bind(p.qty_milli)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(CoreError::Validation(
                "La quantité reçue dépasse la quantité commandée restante.".to_string(),
            ));
        }

        sqlx::query(
            "INSERT INTO purchase_receipt_lines (receipt_id, purchase_order_line_id, quantity_milli, missing_quantity_milli, damaged_quantity_milli, refused_quantity_milli, base_quantity_milli, unit_price, amount, discrepancy_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(receipt_id)
        .bind(p.pol_id)
        .bind(p.qty_milli)
        .bind(p.missing_milli)
        .bind(p.damaged_milli)
        .bind(p.refused_milli)
        .bind(p.base_qty_milli)
        .bind(p.unit_price)
        .bind(p.amount)
        .bind(p.disc_reason.as_deref())
        .execute(&mut *tx)
        .await?;

        let (ordered_milli, cumulative_received_milli): (i64, i64) = sqlx::query_as(
            "SELECT ordered_quantity_milli, received_quantity_milli FROM purchase_order_lines WHERE id = ?",
        )
        .bind(p.pol_id)
        .fetch_one(&mut *tx)
        .await?;
        issue_reserved_packaging_tx(
            &mut tx,
            p.pol_id,
            cumulative_received_milli,
            ordered_milli,
            receipt_id,
            &request_key,
            &rec_ref,
            &po_ref,
        )
        .await?;
        if p.base_qty_milli > 0 {
            apply_receipt_stock_and_cost_tx(
                &mut tx,
                p.pid,
                p.base_qty_milli,
                p.amount,
                &rec_ref,
                &po_ref,
            )
            .await?;
        }
    }

    if receipt_total.value() > 0 {
        let due_date = if payment_terms_days > 0 {
            Some(
                (chrono::Utc::now() + chrono::Duration::days(payment_terms_days))
                    .format("%Y-%m-%d")
                    .to_string(),
            )
        } else {
            None
        };

        sqlx::query(
            "INSERT INTO supplier_debts (receipt_id, supplier_id, initial_amount, remaining_amount, due_date, status)
             VALUES (?, ?, ?, ?, ?, 'open')",
        )
        .bind(receipt_id)
        .bind(supplier_id)
        .bind(receipt_total.value())
        .bind(receipt_total.value())
        .bind(due_date)
        .execute(&mut *tx)
        .await?;
    }

    let rem: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(ordered_quantity_milli - received_quantity_milli), 0) FROM purchase_order_lines WHERE purchase_order_id = ?",
    )
    .bind(purchase_order_id)
    .fetch_one(&mut *tx)
    .await?;

    let receipt_status = if has_any_discrepancy {
        "discrepancy"
    } else if rem > 0 {
        "partial"
    } else {
        "complete"
    };
    sqlx::query("UPDATE purchase_receipts SET status = ? WHERE id = ?")
        .bind(receipt_status)
        .bind(receipt_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "UPDATE purchase_orders SET received_amount = received_amount + ?, status = ? WHERE id = ?",
    )
    .bind(receipt_total.value())
    .bind(if rem == 0 { "received" } else { "partial" })
    .bind(purchase_order_id)
    .execute(&mut *tx)
    .await?;

    persist_purchase_receipt_snapshot_tx(&mut tx, receipt_id, purchase_order_id).await?;

    audit_log_tx(
        &mut tx,
        "RECEIVE_PO",
        "purchase_receipts",
        Some(receipt_id.to_string()),
        &format!(
            "Réception {rec_ref} ({receipt_status}) sur {po_ref} — {} FCFA",
            receipt_total.value()
        ),
    )
    .await?;
    tx.commit().await?;

    build_receipt_result(db, receipt_id, purchase_order_id).await
}

async fn build_receipt_result(
    db: &DepotDb,
    receipt_id: i64,
    order_id: i64,
) -> CoreResult<PurchaseReceiptResultDto> {
    let order = list_purchase_orders(db)
        .await?
        .into_iter()
        .find(|o| o.id == order_id)
        .ok_or_else(|| CoreError::Internal("Commande parente du reçu introuvable.".into()))?;
    let receipt = get_purchase_receipt_detail(db, receipt_id).await?;
    Ok(PurchaseReceiptResultDto { order, receipt })
}
