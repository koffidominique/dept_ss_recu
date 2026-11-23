// ============================================================================
// Bons de commande fournisseurs : création, correction, snapshot & annulation
// ============================================================================

use sqlx::{FromRow, Sqlite, Transaction};

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

use super::packaging_exchange::release_order_packaging_reservations_tx;
use super::{
    list_purchase_orders, CancelPurchaseOrderInput, CreatePurchaseOrderInput, PurchaseOrderDto,
    PurchaseOrderLineDto, PurchasePackagingRequirementDto,
};

fn format_fcfa(value: i64) -> String {
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

pub(crate) async fn persist_purchase_document_snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    po_id: i64,
    version: i64,
    revision_reason: Option<&str>,
) -> CoreResult<()> {
    #[derive(FromRow)]
    struct PoHeaderSnapRow {
        id: i64,
        reference: String,
        supplier_id: i64,
        supplier_name: String,
        supplier_code: String,
        supplier_phone: String,
        supplier_address: Option<String>,
        supplier_email: Option<String>,
        status: String,
        total_amount: i64,
        expected_date: Option<String>,
        notes: Option<String>,
        payment_terms_label: Option<String>,
        delivery_address: Option<String>,
        commercial_conditions: Option<String>,
        discount_xof: i64,
        tax_xof: i64,
        extra_fees_xof: i64,
        paid_deposit_xof: i64,
        created_by_name: Option<String>,
        created_at: String,
    }

    let po = sqlx::query_as::<_, PoHeaderSnapRow>(
        "SELECT po.id, po.reference, po.supplier_id, s.name AS supplier_name, s.code AS supplier_code,
                s.phone AS supplier_phone, s.address AS supplier_address, s.email AS supplier_email,
                po.status, po.total_amount, po.expected_date, po.notes, po.payment_terms_label,
                po.delivery_address, po.commercial_conditions, po.discount_xof, po.tax_xof,
                po.extra_fees_xof, po.paid_deposit_xof, po.created_by_name, po.created_at
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.id = ?",
    )
    .bind(po_id)
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

    let lines = sqlx::query_as::<_, PurchaseOrderLineDto>(
        "SELECT id, product_id, packaging_id, product_name, packaging_name, base_unit,
                coefficient_milli, ordered_quantity_milli, received_quantity_milli, unit_price,
                line_total, product_snapshot_json, packaging_snapshot_json
         FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id ASC",
    )
    .bind(po_id)
    .fetch_all(&mut **tx)
    .await?;

    let reqs = sqlx::query_as::<_, PurchasePackagingRequirementDto>(
        "SELECT purchase_order_line_id, returnable_id, code_snapshot AS code, name_snapshot AS name,
                kind_snapshot AS kind, pieces_per_pack, required_pieces, reserved_pieces, issued_pieces, reservation_status
         FROM purchase_order_packaging_requirements
         WHERE purchase_order_line_id IN (SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?)
         ORDER BY id ASC",
    )
    .bind(po_id)
    .fetch_all(&mut **tx)
    .await?;

    let lines_subtotal: i64 = lines.iter().map(|l| l.line_total).sum();
    let pdf_lines = lines
        .iter()
        .map(|l| DocumentPdfLine {
            label: format!("{} ({})", l.product_name, l.packaging_name),
            sublabel: Some(format!(
                "1 {} = {} {}",
                l.packaging_name,
                format_milli(l.coefficient_milli),
                l.base_unit
            )),
            quantity: format!(
                "{} {}",
                format_milli(l.ordered_quantity_milli),
                l.packaging_name
            ),
            unit_price: Some(l.unit_price),
            total: Some(l.line_total),
            packaging_info: Some(l.packaging_name.clone()),
            ..Default::default()
        })
        .collect::<Vec<_>>();

    let pdf_packaging = reqs
        .iter()
        .map(|r| DocumentPdfPackagingLine {
            label: format!("{} ({})", r.name, r.code),
            kind: r.kind.clone(),
            expected_quantity: r.required_pieces,
            issued_quantity: None,
            returned_quantity: None,
            unit_deposit_xof: None,
            status_label: "Emballages vides à préparer pour remise fournisseur au REC".to_string(),
            detail: Some(format!("{} pièce(s) / unité commandée", r.pieces_per_pack)),
            amount: None,
        })
        .collect::<Vec<_>>();

    let mut summary_rows = vec![DocumentPdfSummaryRow {
        label: "Sous-total marchandises".to_string(),
        value: format_fcfa(lines_subtotal),
        bold: false,
        tone: None,
    }];
    if po.discount_xof > 0 {
        summary_rows.push(DocumentPdfSummaryRow {
            label: "(-) Remise fournisseur".to_string(),
            value: format_fcfa(-po.discount_xof),
            bold: false,
            tone: None,
        });
    }
    if po.tax_xof > 0 {
        summary_rows.push(DocumentPdfSummaryRow {
            label: "(+) Taxes / Droits".to_string(),
            value: format_fcfa(po.tax_xof),
            bold: false,
            tone: None,
        });
    }
    if po.extra_fees_xof > 0 {
        summary_rows.push(DocumentPdfSummaryRow {
            label: "(+) Frais annexes / Port".to_string(),
            value: format_fcfa(po.extra_fees_xof),
            bold: false,
            tone: None,
        });
    }
    summary_rows.push(DocumentPdfSummaryRow {
        label: "TOTAL NET COMMANDÉ".to_string(),
        value: format_fcfa(po.total_amount),
        bold: true,
        tone: Some("success".to_string()),
    });
    if po.paid_deposit_xof > 0 {
        summary_rows.push(DocumentPdfSummaryRow {
            label: "Acompte / Avance versée".to_string(),
            value: format_fcfa(po.paid_deposit_xof),
            bold: false,
            tone: None,
        });
        summary_rows.push(DocumentPdfSummaryRow {
            label: "Solde prévisionnel à payer".to_string(),
            value: format_fcfa((po.total_amount - po.paid_deposit_xof).max(0)),
            bold: true,
            tone: Some("warning".to_string()),
        });
    }

    let actor = current_actor();
    let issuer_id = actor.as_ref().map(|a| a.user_id.clone());
    let issuer_name = po
        .created_by_name
        .clone()
        .or_else(|| actor.as_ref().map(|a| a.display_name.clone()))
        .unwrap_or_else(|| "Responsable Achats".to_string());
    let issuer_role = actor
        .as_ref()
        .map(|a| a.role.as_str().to_string())
        .unwrap_or_else(|| "owner".to_string());

    let mut sup_details = vec![format!("Code : {}", po.supplier_code)];
    sup_details.push(format!("Tél. : {}", po.supplier_phone));
    if let Some(addr) = po
        .supplier_address
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        sup_details.push(format!("Adresse : {}", addr.trim()));
    }
    if let Some(mail) = po
        .supplier_email
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        sup_details.push(mail.trim().to_string());
    }

    let doc_number = if version == 1 {
        po.reference.clone()
    } else {
        format!("{}-V{version}", po.reference)
    };
    let delivery_target = po
        .delivery_address
        .clone()
        .or_else(|| settings.address.clone())
        .unwrap_or_else(|| "Livraison au dépôt principal".to_string());

    let pdf_document = DocumentPdfInput {
        doc_type: "BON DE COMMANDE FOURNISSEUR".to_string(),
        reference: doc_number.clone(),
        order_reference: Some(po.reference.clone()),
        date: po.created_at.clone(),
        status_label: Some(match po.status.as_str() {
            "confirmed" => "CONFIRMÉ".to_string(),
            "partial" => "PARTIEL".to_string(),
            "received" => "RÉCEPTIONNÉ".to_string(),
            "cancelled" => "ANNULÉ".to_string(),
            other => other.to_uppercase(),
        }),
        party_title: Some("FOURNISSEUR".to_string()),
        party_name: Some(po.supplier_name.clone()),
        party_details: Some(sup_details.join(" · ")),
        party_phone: Some(po.supplier_phone.clone()),
        secondary_party_title: Some("LIVRAISON & CONDITIONS".to_string()),
        secondary_party_name: Some(delivery_target),
        secondary_party_details: po.payment_terms_label.clone(),
        delivery_date: po.expected_date.clone(),
        cashier_name: Some(issuer_name.clone()),
        version: Some(version),
        issuer_role: Some(issuer_role.clone()),
        revision_reason: revision_reason.map(str::to_string),
        payment_terms_label: po.payment_terms_label.clone(),
        commercial_conditions: po.commercial_conditions.clone(),
        lines: pdf_lines,
        packaging_lines: pdf_packaging,
        summary_rows,
        notes: po.notes.clone(),
        ..Default::default()
    };

    let snapshot = serde_json::json!({
        "documentType": "BON DE COMMANDE FOURNISSEUR",
        "documentNumber": doc_number,
        "version": version,
        "issuedAt": po.created_at,
        "issuer": {
            "userId": issuer_id,
            "name": issuer_name,
            "role": issuer_role,
        },
        "revisionReason": revision_reason,
        "company": settings,
        "supplier": {
            "id": po.supplier_id,
            "code": po.supplier_code,
            "name": po.supplier_name,
            "phone": po.supplier_phone,
            "address": po.supplier_address,
            "email": po.supplier_email,
        },
        "purchaseOrder": {
            "id": po.id,
            "reference": po.reference,
            "expectedDate": po.expected_date,
            "paymentTermsLabel": po.payment_terms_label,
            "deliveryAddress": po.delivery_address,
            "commercialConditions": po.commercial_conditions,
            "discountXof": po.discount_xof,
            "taxXof": po.tax_xof,
            "extraFeesXof": po.extra_fees_xof,
            "paidDepositXof": po.paid_deposit_xof,
            "totalAmountXof": po.total_amount,
            "notes": po.notes,
        },
        "lines": lines,
        "packagingRequirements": reqs,
        "pdfDocument": pdf_document,
    });
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|e| CoreError::Internal(format!("Sérialisation snapshot CMD impossible : {e}")))?;

    sqlx::query(
        "INSERT OR IGNORE INTO purchase_document_snapshots
            (purchase_order_id, version, document_number, snapshot_json, issued_at,
             issued_by_user_id, issued_by_name, issued_by_role, revision_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(po_id)
    .bind(version)
    .bind(&doc_number)
    .bind(&snapshot_json)
    .bind(&po.created_at)
    .bind(issuer_id.as_deref())
    .bind(&issuer_name)
    .bind(&issuer_role)
    .bind(revision_reason)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn create_purchase_order(
    db: &DepotDb,
    input: CreatePurchaseOrderInput,
) -> CoreResult<PurchaseOrderDto> {
    require_current_actor_permission(Permission::PurchasesWrite)?;
    let request_key = input.request_key.trim().to_string();
    if request_key.is_empty() {
        return Err(CoreError::Validation(
            "Clé d'idempotence requise.".to_string(),
        ));
    }
    if input.lines.is_empty() {
        return Err(CoreError::Validation(
            "Ajoutez au moins une ligne de commande.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;
    if let Some((existing_id,)) =
        sqlx::query_as::<_, (i64,)>("SELECT id FROM purchase_orders WHERE request_key = ?")
            .bind(&request_key)
            .fetch_optional(&mut *tx)
            .await?
    {
        tx.rollback().await?;
        return list_purchase_orders(db)
            .await?
            .into_iter()
            .find(|o| o.id == existing_id)
            .ok_or_else(|| CoreError::Internal("Commande introuvable.".to_string()));
    }

    let sup: Option<(i64,)> = sqlx::query_as("SELECT id FROM suppliers WHERE id = ?")
        .bind(input.supplier_id)
        .fetch_optional(&mut *tx)
        .await?;
    if sup.is_none() {
        return Err(CoreError::Validation(
            "Fournisseur introuvable.".to_string(),
        ));
    }

    type PackagingRequirement = (i64, String, String, String, i64, i64);
    type PreparedPurchaseOrderLine = (
        i64,
        i64,
        String,
        String,
        String,
        i64,
        i64,
        i64,
        i64,
        String,
        String,
        Vec<PackagingRequirement>,
    );
    let mut subtotal_amount = Money::ZERO;
    let mut prepared: Vec<PreparedPurchaseOrderLine> = Vec::new();
    let mut staged_packaging_reservations: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::new();

    for l in &input.lines {
        let prod: Option<(i64, String, String)> =
            sqlx::query_as("SELECT id, name, base_unit FROM products WHERE id = ?")
                .bind(l.product_id)
                .fetch_optional(&mut *tx)
                .await?;
        let (pid, pname, base_unit) =
            prod.ok_or_else(|| CoreError::Validation("Produit introuvable.".to_string()))?;

        let pkg: Option<(i64, String, i64)> = sqlx::query_as(
            "SELECT id, name, coefficient_milli FROM product_packagings WHERE id = ? AND product_id = ?",
        )
        .bind(l.packaging_id)
        .bind(pid)
        .fetch_optional(&mut *tx)
        .await?;
        let (pkg_id, pkg_name, coeff_milli) =
            pkg.ok_or_else(|| CoreError::Validation("Conditionnement introuvable.".to_string()))?;

        let qty = Quantity::parse_str(&l.quantity, &format!("Quantité commandée ({pname})"))?;
        if qty.milli_units <= 0 {
            return Err(CoreError::Validation(
                "La quantité commandée doit être > 0.".to_string(),
            ));
        }
        let unit_price = Money::from_non_negative(l.unit_price, &format!("Prix achat ({pname})"))?;
        let line_total = Money(qty.compute_line_fcfa(unit_price.value())?);
        subtotal_amount = subtotal_amount.checked_add(line_total, "Sous-total commande")?;

        let (deposit_mode,): (String,) =
            sqlx::query_as("SELECT mode FROM deposit_packaging_profiles WHERE packaging_id = ?")
                .bind(pkg_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| {
                    CoreError::Validation(format!(
                        "Profil d'emballage non configuré pour {pname} ({pkg_name})."
                    ))
                })?;
        let packaging_components: Vec<(i64, i64, String, String, String)> = if deposit_mode
            == "deposit"
        {
            sqlx::query_as(
                    "SELECT dpc.returnable_id, SUM(dpc.pieces_per_pack), rpt.code, rpt.name, rpt.kind
                     FROM deposit_packaging_components dpc JOIN returnable_packaging_types rpt ON rpt.id = dpc.returnable_id
                     WHERE dpc.packaging_id = ?
                     GROUP BY dpc.returnable_id, rpt.code, rpt.name, rpt.kind",
                )
                .bind(pkg_id)
                .fetch_all(&mut *tx)
                .await?
        } else if deposit_mode == "none" {
            Vec::new()
        } else {
            return Err(CoreError::Validation(format!(
                "Profil d'emballage inconnu : {deposit_mode}."
            )));
        };
        if deposit_mode == "deposit" && packaging_components.is_empty() {
            return Err(CoreError::Validation(format!(
                "Le conditionnement {pkg_name} est consigné mais ne possède aucun composant d'emballage configuré."
            )));
        }
        let mut requirements = Vec::with_capacity(packaging_components.len());
        for (returnable_id, pieces_per_pack, code, name, kind) in packaging_components {
            let numerator = (qty.milli_units as i128)
                .checked_mul(pieces_per_pack as i128)
                .ok_or_else(|| {
                    CoreError::Validation("Débordement du calcul d'emballages.".into())
                })?;
            if numerator % 1000 != 0 {
                return Err(CoreError::Validation(format!(
                    "La quantité commandée pour {pname} produit une quantité physique fractionnaire d'emballages ({code})."
                )));
            }
            let required = i64::try_from(numerator / 1000)
                .map_err(|_| CoreError::Validation("Débordement quantité emballages.".into()))?;
            let physical: i64 = sqlx::query_scalar(
                "SELECT COALESCE((SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?), 0)",
            )
            .bind(returnable_id)
            .fetch_one(&mut *tx)
            .await?;
            let reserved: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(r.reserved_pieces), 0) FROM purchase_order_packaging_requirements r
                 WHERE r.returnable_id = ? AND r.reservation_status IN ('reserved', 'partially_issued')",
            )
            .bind(returnable_id)
            .fetch_one(&mut *tx)
            .await?;
            let staged = *staged_packaging_reservations
                .get(&returnable_id)
                .unwrap_or(&0);
            let available = physical.saturating_sub(reserved).saturating_sub(staged);
            if available < required {
                return Err(CoreError::InsufficientStock(format!(
                    "Emballages fournisseur insuffisants ({code}: disponible {available}, requis {required})."
                )));
            }
            *staged_packaging_reservations
                .entry(returnable_id)
                .or_default() += required;
            requirements.push((returnable_id, code, name, kind, pieces_per_pack, required));
        }
        let (brand, brewery, variant, volume_ml): (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
        ) = sqlx::query_as(
            "SELECT COALESCE(p.brand, br.name), b.name, COALESCE(pv.name, p.variant_label), pv.volume_ml
             FROM products p LEFT JOIN brands br ON br.id = p.brand_id
             LEFT JOIN breweries b ON b.id = COALESCE(p.brewery_id, br.brewery_id)
             LEFT JOIN product_variants pv ON pv.id = COALESCE((SELECT variant_id FROM product_packagings WHERE id = ?), p.variant_id)
             WHERE p.id = ?",
        )
        .bind(pkg_id)
        .bind(pid)
        .fetch_one(&mut *tx)
        .await?;
        let product_snapshot = serde_json::json!({
            "id": pid, "name": &pname, "brand": brand, "brewery": brewery,
            "variant": variant, "volumeMl": volume_ml, "baseUnit": &base_unit
        })
        .to_string();
        let packaging_snapshot = serde_json::json!({
            "id": pkg_id, "name": &pkg_name, "coefficientMilli": coeff_milli,
            "depositRegime": deposit_mode, "components": requirements.iter().map(|(id, code, name, kind, per_pack, pieces)| serde_json::json!({
                "returnableId": id, "code": code, "name": name, "kind": kind,
                "piecesPerPack": per_pack, "requiredPieces": pieces
            })).collect::<Vec<_>>()
        })
        .to_string();
        prepared.push((
            pid,
            pkg_id,
            pname,
            pkg_name,
            base_unit,
            coeff_milli,
            qty.milli_units,
            unit_price.value(),
            line_total.value(),
            product_snapshot,
            packaging_snapshot,
            requirements,
        ));
    }

    let discount = Money::from_non_negative(input.discount_xof.unwrap_or(0), "Remise fournisseur")?;
    if discount > subtotal_amount {
        return Err(CoreError::Validation(
            "La remise fournisseur dépasse le sous-total des lignes.".into(),
        ));
    }
    let tax = Money::from_non_negative(input.tax_xof.unwrap_or(0), "Taxes fournisseur")?;
    let extra_fees = Money::from_non_negative(input.extra_fees_xof.unwrap_or(0), "Frais annexes")?;
    let paid_deposit =
        Money::from_non_negative(input.paid_deposit_xof.unwrap_or(0), "Acompte fournisseur")?;
    let net_total = subtotal_amount
        .checked_sub(discount, "Net après remise")?
        .checked_add(tax, "Total avec taxes")?
        .checked_add(extra_fees, "Total net commande")?;
    if paid_deposit > net_total {
        return Err(CoreError::Validation(
            "L'acompte fournisseur dépasse le montant net commandé.".into(),
        ));
    }

    let created_by_name = current_actor().map(|a| a.display_name);
    let reference = DepotDb::next_sequence(&mut tx, "CMD").await?;
    let expected_date = input
        .expected_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let po_id = sqlx::query(
        "INSERT INTO purchase_orders (reference, request_key, supplier_id, status, total_amount,
             expected_date, notes, payment_terms_label, delivery_address, commercial_conditions,
             discount_xof, tax_xof, extra_fees_xof, paid_deposit_xof, created_by_name)
         VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&reference)
    .bind(&request_key)
    .bind(input.supplier_id)
    .bind(net_total.value())
    .bind(expected_date)
    .bind(
        input
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        input
            .payment_terms_label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        input
            .delivery_address
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        input
            .commercial_conditions
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(discount.value())
    .bind(tax.value())
    .bind(extra_fees.value())
    .bind(paid_deposit.value())
    .bind(created_by_name.as_deref())
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    for p in prepared {
        let line_id = sqlx::query(
            "INSERT INTO purchase_order_lines (purchase_order_id, product_id, packaging_id, product_name, packaging_name, base_unit, coefficient_milli, ordered_quantity_milli, unit_price, line_total, product_snapshot_json, packaging_snapshot_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(po_id)
        .bind(p.0)
        .bind(p.1)
        .bind(&p.2)
        .bind(&p.3)
        .bind(&p.4)
        .bind(p.5)
        .bind(p.6)
        .bind(p.7)
        .bind(p.8)
        .bind(&p.9)
        .bind(&p.10)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();
        for (returnable_id, code, name, kind, pieces_per_pack, required_pieces) in &p.11 {
            sqlx::query(
                "INSERT INTO purchase_order_packaging_requirements (purchase_order_line_id, returnable_id, code_snapshot, name_snapshot, kind_snapshot, pieces_per_pack, required_pieces, reserved_pieces, issued_pieces, reservation_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'reserved')",
            )
            .bind(line_id)
            .bind(returnable_id)
            .bind(code)
            .bind(name)
            .bind(kind)
            .bind(pieces_per_pack)
            .bind(required_pieces)
            .bind(required_pieces)
            .execute(&mut *tx)
            .await?;
        }
    }

    persist_purchase_document_snapshot_tx(&mut tx, po_id, 1, None).await?;

    audit_log_tx(
        &mut tx,
        "CREATE_PO",
        "purchase_orders",
        Some(po_id.to_string()),
        &format!("Commande {reference} — {} FCFA", net_total.value()),
    )
    .await?;
    tx.commit().await?;

    list_purchase_orders(db)
        .await?
        .into_iter()
        .find(|o| o.id == po_id)
        .ok_or_else(|| CoreError::Internal("Commande créée introuvable.".to_string()))
}

pub async fn update_purchase_order(
    db: &DepotDb,
    purchase_order_id: i64,
    input: super::UpdatePurchaseOrderInput,
) -> CoreResult<PurchaseOrderDto> {
    require_current_actor_permission(Permission::PurchasesWrite)?;
    if purchase_order_id <= 0 || input.lines.is_empty() {
        return Err(CoreError::Validation(
            "Bon invalide : ajoutez au moins une ligne.".into(),
        ));
    }
    let (_guard, mut tx) = db.begin_write().await?;
    let state: Option<(String, i64)> = sqlx::query_as(
        "SELECT w.status, po.received_amount FROM purchase_orders po
         LEFT JOIN commercial_document_workflows w ON w.document_type = 'purchase_order' AND w.document_id = po.id
         WHERE po.id = ? AND po.status = 'confirmed'",
    )
    .bind(purchase_order_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (approval_status, received_amount) = state.ok_or_else(|| {
        CoreError::HistoricalImmutable("Seuls les bons confirmés peuvent être corrigés.".into())
    })?;
    if approval_status != "changes_requested" || received_amount != 0 {
        return Err(CoreError::Forbidden(
            "La modification est réservée aux bons renvoyés pour correction et non réceptionnés."
                .into(),
        ));
    }
    let receipt_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM purchase_receipts WHERE purchase_order_id = ?")
            .bind(purchase_order_id)
            .fetch_one(&mut *tx)
            .await?;
    if receipt_count > 0 {
        return Err(CoreError::HistoricalImmutable(
            "Un bon ayant une réception ne peut plus être modifié.".into(),
        ));
    }
    let supplier_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM suppliers WHERE id = ? AND is_active = 1")
            .bind(input.supplier_id)
            .fetch_one(&mut *tx)
            .await?;
    if supplier_exists == 0 {
        return Err(CoreError::Validation(
            "Fournisseur absent ou inactif.".into(),
        ));
    }
    sqlx::query(
        "DELETE FROM purchase_order_packaging_requirements WHERE purchase_order_line_id IN (SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?)",
    )
    .bind(purchase_order_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM purchase_order_lines WHERE purchase_order_id = ?")
        .bind(purchase_order_id)
        .execute(&mut *tx)
        .await?;
    let mut subtotal = Money::ZERO;
    let mut prepared = Vec::with_capacity(input.lines.len());
    let mut staged: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for line in &input.lines {
        let product: Option<(String, String)> =
            sqlx::query_as("SELECT name, base_unit FROM products WHERE id = ? AND is_active = 1")
                .bind(line.product_id)
                .fetch_optional(&mut *tx)
                .await?;
        let (product_name, base_unit) =
            product.ok_or_else(|| CoreError::Validation("Produit absent ou inactif.".into()))?;
        let packaging: Option<(String, i64)> = sqlx::query_as(
            "SELECT name, coefficient_milli FROM product_packagings WHERE id = ? AND product_id = ? AND is_active = 1",
        )
        .bind(line.packaging_id)
        .bind(line.product_id)
        .fetch_optional(&mut *tx)
        .await?;
        let (packaging_name, coefficient) = packaging
            .ok_or_else(|| CoreError::Validation("Conditionnement invalide ou inactif.".into()))?;
        let quantity = Quantity::parse_str(&line.quantity, &format!("Quantité ({product_name})"))?;
        if quantity.milli_units <= 0 {
            return Err(CoreError::Validation(
                "La quantité doit être supérieure à zéro.".into(),
            ));
        }
        let price = Money::from_non_negative(line.unit_price, &format!("Prix ({product_name})"))?;
        let line_total = Money(quantity.compute_line_fcfa(price.value())?);
        subtotal = subtotal.checked_add(line_total, "Total du bon")?;
        let (mode,): (String,) =
            sqlx::query_as("SELECT mode FROM deposit_packaging_profiles WHERE packaging_id = ?")
                .bind(line.packaging_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| {
                    CoreError::Validation(format!(
                        "Profil d'emballage non configuré pour {product_name} ({packaging_name})."
                    ))
                })?;
        let components: Vec<(i64, i64, String, String, String)> = if mode == "deposit" {
            sqlx::query_as(
                "SELECT dpc.returnable_id, SUM(dpc.pieces_per_pack), rpt.code, rpt.name, rpt.kind
                 FROM deposit_packaging_components dpc JOIN returnable_packaging_types rpt ON rpt.id = dpc.returnable_id
                 WHERE dpc.packaging_id = ?
                 GROUP BY dpc.returnable_id, rpt.code, rpt.name, rpt.kind",
            )
            .bind(line.packaging_id)
            .fetch_all(&mut *tx)
            .await?
        } else if mode == "none" {
            Vec::new()
        } else {
            return Err(CoreError::Validation(format!(
                "Profil d'emballage inconnu : {mode}."
            )));
        };
        if mode == "deposit" && components.is_empty() {
            return Err(CoreError::Validation(format!(
                "Le conditionnement {packaging_name} est consigné mais aucun composant n'est configuré."
            )));
        }
        let mut requirements = Vec::new();
        for (rid, per_pack, code, name, kind) in components {
            let numerator = (quantity.milli_units as i128)
                .checked_mul(per_pack as i128)
                .ok_or_else(|| CoreError::Validation("Débordement quantité emballages.".into()))?;
            if numerator % 1000 != 0 {
                return Err(CoreError::Validation(format!(
                    "La commande corrigée génère une quantité fractionnaire d'emballages ({code})."
                )));
            }
            let pieces = i64::try_from(numerator / 1000)
                .map_err(|_| CoreError::Validation("Débordement quantité emballages.".into()))?;
            let physical: i64 = sqlx::query_scalar(
                "SELECT COALESCE((SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?), 0)",
            )
            .bind(rid)
            .fetch_one(&mut *tx)
            .await?;
            let reserved: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(reserved_pieces), 0) FROM purchase_order_packaging_requirements WHERE returnable_id = ? AND reservation_status IN ('reserved', 'partially_issued')",
            )
            .bind(rid)
            .fetch_one(&mut *tx)
            .await?;
            let available = physical
                .saturating_sub(reserved)
                .saturating_sub(*staged.get(&rid).unwrap_or(&0));
            if available < pieces {
                return Err(CoreError::InsufficientStock(format!(
                    "Emballages fournisseur insuffisants ({code}: disponible {available}, requis {pieces})."
                )));
            }
            *staged.entry(rid).or_default() += pieces;
            requirements.push((rid, code, name, kind, per_pack, pieces));
        }
        let (brand, brewery, variant, volume_ml): (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
        ) = sqlx::query_as(
            "SELECT COALESCE(p.brand, br.name), b.name, COALESCE(pv.name, p.variant_label), pv.volume_ml
             FROM products p LEFT JOIN brands br ON br.id = p.brand_id
             LEFT JOIN breweries b ON b.id = COALESCE(p.brewery_id, br.brewery_id)
             LEFT JOIN product_variants pv ON pv.id = COALESCE((SELECT variant_id FROM product_packagings WHERE id = ?), p.variant_id)
             WHERE p.id = ?",
        )
        .bind(line.packaging_id)
        .bind(line.product_id)
        .fetch_one(&mut *tx)
        .await?;
        let product_snapshot = serde_json::json!({
            "id": line.product_id, "name": &product_name, "brand": brand, "brewery": brewery,
            "variant": variant, "volumeMl": volume_ml, "baseUnit": &base_unit
        })
        .to_string();
        let packaging_snapshot = serde_json::json!({
            "id": line.packaging_id, "name": &packaging_name,
            "coefficientMilli": coefficient, "depositRegime": mode,
            "components": requirements.iter().map(|(id, code, name, kind, per_pack, pieces)| serde_json::json!({
                "returnableId": id, "code": code, "name": name, "kind": kind,
                "piecesPerPack": per_pack, "requiredPieces": pieces
            })).collect::<Vec<_>>()
        })
        .to_string();
        prepared.push((
            line.product_id,
            line.packaging_id,
            product_name,
            packaging_name,
            base_unit,
            coefficient,
            quantity.milli_units,
            price.value(),
            line_total.value(),
            product_snapshot,
            packaging_snapshot,
            requirements,
        ));
    }

    #[allow(clippy::type_complexity)]
    let (
        reference,
        cur_expected_date,
        cur_notes,
        cur_terms,
        cur_delivery_addr,
        cur_conditions,
        cur_discount,
        cur_tax,
        cur_fees,
        cur_deposit,
    ): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        i64,
        i64,
        i64,
    ) = sqlx::query_as(
        "SELECT reference, expected_date, notes, payment_terms_label, delivery_address,
                commercial_conditions, discount_xof, tax_xof, extra_fees_xof, paid_deposit_xof
         FROM purchase_orders WHERE id = ?",
    )
    .bind(purchase_order_id)
    .fetch_one(&mut *tx)
    .await?;

    let discount_val = input.discount_xof.unwrap_or(cur_discount);
    let tax_val = input.tax_xof.unwrap_or(cur_tax);
    let fees_val = input.extra_fees_xof.unwrap_or(cur_fees);
    let deposit_val = input.paid_deposit_xof.unwrap_or(cur_deposit);
    let discount = Money::from_non_negative(discount_val, "Remise fournisseur")?;
    if discount > subtotal {
        return Err(CoreError::Validation(
            "La remise fournisseur dépasse le sous-total des lignes.".into(),
        ));
    }
    let tax = Money::from_non_negative(tax_val, "Taxes fournisseur")?;
    let fees = Money::from_non_negative(fees_val, "Frais annexes")?;
    let paid_deposit = Money::from_non_negative(deposit_val, "Acompte fournisseur")?;
    let total = subtotal
        .checked_sub(discount, "Net après remise")?
        .checked_add(tax, "Total taxes")?
        .checked_add(fees, "Total net commande")?;
    if paid_deposit > total {
        return Err(CoreError::Validation(
            "L'acompte fournisseur dépasse le montant net commandé.".into(),
        ));
    }

    let next_expected = input.expected_date.unwrap_or(cur_expected_date);
    let next_notes = input.notes.unwrap_or(cur_notes);
    let next_terms = input.payment_terms_label.unwrap_or(cur_terms);
    let next_delivery = input.delivery_address.unwrap_or(cur_delivery_addr);
    let next_conditions = input.commercial_conditions.unwrap_or(cur_conditions);

    sqlx::query(
        "UPDATE purchase_orders
         SET supplier_id = ?, total_amount = ?, expected_date = ?, notes = ?,
             payment_terms_label = ?, delivery_address = ?, commercial_conditions = ?,
             discount_xof = ?, tax_xof = ?, extra_fees_xof = ?, paid_deposit_xof = ?
         WHERE id = ?",
    )
    .bind(input.supplier_id)
    .bind(total.value())
    .bind(
        next_expected
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        next_notes
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        next_terms
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        next_delivery
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(
        next_conditions
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(discount.value())
    .bind(tax.value())
    .bind(fees.value())
    .bind(paid_deposit.value())
    .bind(purchase_order_id)
    .execute(&mut *tx)
    .await?;

    for line in prepared {
        let line_id = sqlx::query(
            "INSERT INTO purchase_order_lines (purchase_order_id, product_id, packaging_id, product_name, packaging_name, base_unit, coefficient_milli, ordered_quantity_milli, unit_price, line_total, product_snapshot_json, packaging_snapshot_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(purchase_order_id)
        .bind(line.0)
        .bind(line.1)
        .bind(&line.2)
        .bind(&line.3)
        .bind(&line.4)
        .bind(line.5)
        .bind(line.6)
        .bind(line.7)
        .bind(line.8)
        .bind(&line.9)
        .bind(&line.10)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();
        for (rid, code, name, kind, per_pack, pieces) in &line.11 {
            sqlx::query(
                "INSERT INTO purchase_order_packaging_requirements (purchase_order_line_id, returnable_id, code_snapshot, name_snapshot, kind_snapshot, pieces_per_pack, required_pieces, reserved_pieces, issued_pieces, reservation_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'reserved')",
            )
            .bind(line_id)
            .bind(rid)
            .bind(code)
            .bind(name)
            .bind(kind)
            .bind(per_pack)
            .bind(pieces)
            .bind(pieces)
            .execute(&mut *tx)
            .await?;
        }
    }

    let next_snap_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM purchase_document_snapshots WHERE purchase_order_id = ?",
    )
    .bind(purchase_order_id)
    .fetch_one(&mut *tx)
    .await?;
    persist_purchase_document_snapshot_tx(
        &mut tx,
        purchase_order_id,
        next_snap_version,
        Some("Correction après demande Owner"),
    )
    .await?;

    let actor = crate::application::auth::current_actor().ok_or_else(|| {
        CoreError::Forbidden("Session authentifiée requise pour soumettre la correction.".into())
    })?;
    let submitter = actor.user_id.parse::<i64>().ok();
    let supplier_name: String = sqlx::query_scalar("SELECT name FROM suppliers WHERE id = ?")
        .bind(input.supplier_id)
        .fetch_one(&mut *tx)
        .await?;
    let snapshot_lines: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(
        "SELECT product_name, packaging_name, ordered_quantity_milli, unit_price, line_total
         FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id",
    )
    .bind(purchase_order_id)
    .fetch_all(&mut *tx)
    .await?;
    let snapshot = serde_json::json!({
        "documentType": "purchase_order", "id": purchase_order_id, "number": reference,
        "counterparty": supplier_name, "status": "confirmed", "totalXof": total.value(),
        "items": snapshot_lines.into_iter().map(|(product, packaging, quantity, unit_price, line_total)| serde_json::json!({
            "product": product, "packaging": packaging, "quantityMilli": quantity,
            "unitPriceXof": unit_price, "lineTotalXof": line_total
        })).collect::<Vec<_>>()
    });
    sqlx::query(
        "UPDATE commercial_document_workflows SET status = 'pending_owner_approval', submitted_by = ?,
         submitted_at = datetime('now'), reviewed_by = NULL, reviewed_at = NULL, review_reason = NULL,
         updated_at = datetime('now') WHERE document_type = 'purchase_order' AND document_id = ? AND status = 'changes_requested'",
    )
    .bind(submitter)
    .bind(purchase_order_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO document_approval_events (document_type, document_id, action, actor_user_id, actor_role, reason, snapshot_json)
         VALUES ('purchase_order', ?, 'submitted', ?, ?, 'Correction resoumise après demande Owner', ?)",
    )
    .bind(purchase_order_id)
    .bind(submitter)
    .bind(actor.role.as_str())
    .bind(snapshot.to_string())
    .execute(&mut *tx)
    .await?;
    audit_log_tx(
        &mut tx,
        "UPDATE_PO_AFTER_CORRECTION",
        "purchase_orders",
        Some(purchase_order_id.to_string()),
        &format!(
            "Bon {reference} corrigé et resoumis pour approbation Owner; montant {} FCFA.",
            total.value()
        ),
    )
    .await?;
    tx.commit().await?;
    list_purchase_orders(db)
        .await?
        .into_iter()
        .find(|po| po.id == purchase_order_id)
        .ok_or_else(|| CoreError::Internal("Bon corrigé introuvable.".into()))
}

pub async fn cancel_purchase_order(
    db: &DepotDb,
    purchase_order_id: i64,
    input: CancelPurchaseOrderInput,
) -> CoreResult<PurchaseOrderDto> {
    require_current_actor_permission(Permission::PurchasesWrite)?;
    if purchase_order_id <= 0 {
        return Err(CoreError::Validation(
            "Bon de commande invalide.".to_string(),
        ));
    }
    let reason = input.reason.trim();
    if reason.is_empty() {
        return Err(CoreError::Validation(
            "Le motif d'annulation est obligatoire.".to_string(),
        ));
    }

    let (_guard, mut tx) = db.begin_write().await?;
    let po: Option<(String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT reference, status, received_amount, notes FROM purchase_orders WHERE id = ?",
    )
    .bind(purchase_order_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (po_ref, status, received_amount, prev_notes) =
        po.ok_or_else(|| CoreError::Validation("Bon de commande introuvable.".to_string()))?;

    if status == "cancelled" {
        return Err(CoreError::HistoricalImmutable(
            "Ce bon de commande est déjà annulé.".to_string(),
        ));
    }
    let receipt_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM purchase_receipts WHERE purchase_order_id = ?")
            .bind(purchase_order_id)
            .fetch_one(&mut *tx)
            .await?;

    if status == "partial" || status == "received" || received_amount > 0 || receipt_count > 0 {
        return Err(CoreError::HistoricalImmutable(
            "Impossible d'annuler un bon de commande ayant déjà fait l'objet d'une réception."
                .to_string(),
        ));
    }

    let next_notes = match prev_notes {
        Some(n) if !n.trim().is_empty() => format!("{n} · [Annulé : {reason}]"),
        _ => format!("[Annulé : {reason}]"),
    };

    release_order_packaging_reservations_tx(&mut tx, purchase_order_id).await?;

    sqlx::query("UPDATE purchase_orders SET status = 'cancelled', notes = ? WHERE id = ?")
        .bind(&next_notes)
        .bind(purchase_order_id)
        .execute(&mut *tx)
        .await?;

    audit_log_tx(
        &mut tx,
        "CANCEL_PURCHASE_ORDER",
        "purchase_orders",
        Some(purchase_order_id.to_string()),
        &format!("Annulation {po_ref} — {reason}"),
    )
    .await?;
    tx.commit().await?;

    list_purchase_orders(db)
        .await?
        .into_iter()
        .find(|o| o.id == purchase_order_id)
        .ok_or_else(|| {
            CoreError::Internal("Bon de commande introuvable après annulation.".to_string())
        })
}
