// Construction du modèle PDF client à partir des DTO métier déjà lus par le backend.
use super::dtos::{OrderDetailDto, OrderLineDto};
use super::receipts::ReceiptPaymentSnapshot;
use crate::application::pdf::{
    DocumentPdfInput, DocumentPdfLine, DocumentPdfPackagingLine, DocumentPdfPayment,
    DocumentPdfSummaryRow,
};

pub(super) struct CustomerReceiptProfile<'a> {
    pub code: &'a str,
    pub name: &'a str,
    pub establishment_name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub address: Option<&'a str>,
    pub city: Option<&'a str>,
    pub commune: Option<&'a str>,
    pub quartier: Option<&'a str>,
    pub landmark: Option<&'a str>,
}

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

fn requested_unit_label(unit: &str) -> &str {
    match unit {
        "unit" => "Unité",
        "bottle" => "Bouteille",
        "can" => "Canette",
        "half_crate" => "Demi-casier",
        "crate" => "Casier",
        "pack" => "Pack",
        "carton" => "Carton",
        "pallet" => "Palette",
        "custom" => "Conditionnement personnalisé",
        other => other,
    }
}

fn make_line(line: &OrderLineDto, order: &OrderDetailDto) -> DocumentPdfLine {
    let unit = requested_unit_label(&line.requested_unit);
    let linked_packaging = order
        .links
        .iter()
        .filter(|link| link.order_line_id == line.id)
        .filter_map(|link| {
            order
                .allocations
                .iter()
                .find(|allocation| allocation.id == link.order_packaging_allocation_id)
                .map(|allocation| {
                    format!(
                        "{} unité(s) dans {}",
                        link.units_in_packaging, allocation.packaging_name
                    )
                })
        })
        .collect::<Vec<_>>();
    let mut details = vec![format!(
        "Équiv. : {} {}",
        line.base_quantity, line.base_unit
    )];
    details.extend(linked_packaging);
    if let Some(note) = line.notes.as_deref().filter(|note| !note.trim().is_empty()) {
        details.push(note.trim().to_string());
    }
    let cond_label = if line.base_quantity > 0 && line.requested_quantity > 0 {
        let per_unit = line.base_quantity / line.requested_quantity;
        if per_unit > 1 {
            format!("{unit} ({per_unit})")
        } else {
            unit.to_string()
        }
    } else {
        unit.to_string()
    };

    DocumentPdfLine {
        label: format!("{} · {}", line.product_name, line.variant_name),
        sublabel: Some(details.join(" · ")),
        quantity: line.requested_quantity.to_string(),
        discount: Some(line.discount_xof),
        unit_price: Some(line.unit_price_xof),
        total: Some(line.line_total_xof),
        packaging_info: Some(cond_label),
        ..Default::default()
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_receipt_pdf_input(
    order: &OrderDetailDto,
    customer: &CustomerReceiptProfile<'_>,
    cashier_name: &str,
    issuer_role: &str,
    receipt_number: &str,
    version: i64,
    revision_reason: Option<&str>,
    issued_at: &str,
    payments: &[ReceiptPaymentSnapshot],
) -> DocumentPdfInput {
    let order_summary = &order.order;
    let mut party_details = vec![format!("Code : {}", customer.code)];
    if let Some(est) = customer.establishment_name.filter(|v| !v.trim().is_empty()) {
        party_details.push(format!("Étab. : {}", est.trim()));
    }
    if let Some(cat) = customer.category.filter(|v| !v.trim().is_empty()) {
        party_details.push(format!("Catégorie : {}", cat.trim()));
    }
    if let Some(phone) = customer.phone.filter(|v| !v.trim().is_empty()) {
        party_details.push(format!("Tél. : {}", phone.trim()));
    }
    if let Some(address) = customer.address.filter(|v| !v.trim().is_empty()) {
        party_details.push(format!("Adresse : {}", address.trim()));
    }

    let loc_parts = [
        customer.commune.filter(|v| !v.trim().is_empty()),
        customer.quartier.filter(|v| !v.trim().is_empty()),
        customer.city.filter(|v| !v.trim().is_empty()),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .collect::<Vec<_>>();
    let customer_location = if !loc_parts.is_empty() {
        Some(loc_parts.join(" / "))
    } else {
        customer
            .address
            .filter(|v| !v.trim().is_empty())
            .map(|s| s.trim().to_string())
    };

    let lines = order
        .lines
        .iter()
        .map(|line| make_line(line, order))
        .collect();
    let issued = matches!(
        order_summary.status.as_str(),
        "delivered" | "invoiced" | "paid"
    );
    let returned_packaging_amount_xof: i64 = order
        .allocations
        .iter()
        .filter(|a| a.is_consigned == 1 && a.returned_quantity > 0)
        .map(|a| a.returned_quantity.saturating_mul(a.deposit_amount_xof))
        .sum();
    let has_consigned_packaging = order.allocations.iter().any(|a| a.is_consigned == 1);

    let packaging_lines = order
        .allocations
        .iter()
        .map(|allocation| DocumentPdfPackagingLine {
            label: format!(
                "{} (cap. {})",
                allocation.packaging_name, allocation.capacity
            ),
            kind: "other".to_string(),
            expected_quantity: allocation.quantity,
            issued_quantity: issued.then_some(allocation.quantity),
            returned_quantity: Some(allocation.returned_quantity),
            unit_deposit_xof: (allocation.is_consigned == 1)
                .then_some(allocation.deposit_amount_xof),
            status_label: if allocation.is_consigned == 1 {
                "Consigné — retour sous 15 jours".to_string()
            } else {
                "Emballage non consigné".to_string()
            },
            detail: Some(format!(
                "Fourni par : {}",
                allocation.provided_by.as_deref().unwrap_or("SOUS-DÉPÔT")
            )),
            amount: (allocation.is_consigned == 1)
                .then_some(allocation.quantity * allocation.deposit_amount_xof),
        })
        .collect();

    let mut summary_rows = vec![
        DocumentPdfSummaryRow {
            label: "Total Liquide (Boissons)".to_string(),
            value: format_fcfa(order_summary.subtotal_xof),
            bold: false,
            tone: None,
        },
        DocumentPdfSummaryRow {
            label: "(+) Consignes emballages".to_string(),
            value: format_fcfa(order_summary.deposit_due_xof),
            bold: false,
            tone: Some("warning".to_string()),
        },
        DocumentPdfSummaryRow {
            label: "(+) Frais de livraison".to_string(),
            value: format_fcfa(order_summary.delivery_fee_xof),
            bold: false,
            tone: None,
        },
        DocumentPdfSummaryRow {
            label: "(-) Remise accordée".to_string(),
            value: format_fcfa(-order_summary.discount_xof),
            bold: false,
            tone: None,
        },
    ];
    if order_summary.tax_xof > 0 {
        summary_rows.push(DocumentPdfSummaryRow {
            label: "(+) Taxes".to_string(),
            value: format_fcfa(order_summary.tax_xof),
            bold: false,
            tone: None,
        });
    }
    summary_rows.extend([
        DocumentPdfSummaryRow {
            label: "NET À PAYER (FCFA)".to_string(),
            value: format_fcfa(order_summary.total_to_collect_xof),
            bold: true,
            tone: Some("success".to_string()),
        },
        DocumentPdfSummaryRow {
            label: "Montant Versé (Avance / Cash)".to_string(),
            value: format_fcfa(-order_summary.paid_xof),
            bold: false,
            tone: None,
        },
        DocumentPdfSummaryRow {
            label: "RESTE À PAYER".to_string(),
            value: format_fcfa(
                (order_summary.total_to_collect_xof - order_summary.paid_xof).max(0),
            ),
            bold: true,
            tone: Some("danger".to_string()),
        },
    ]);
    if has_consigned_packaging || returned_packaging_amount_xof > 0 {
        summary_rows.push(DocumentPdfSummaryRow {
            label: "Retour emballages (hors total)".to_string(),
            value: format_fcfa(returned_packaging_amount_xof),
            bold: false,
            tone: Some("warning".to_string()),
        });
    }

    let external_references = payments
        .iter()
        .filter_map(|p| p.external_reference.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    let pdf_payments = payments
        .iter()
        .map(|payment| {
            let ext = payment
                .external_reference
                .as_deref()
                .filter(|r| !r.trim().is_empty())
                .map(|r| format!(" · Txn {r}"))
                .unwrap_or_default();
            DocumentPdfPayment {
                label: format!(
                    "{} ({}) · {}{}{}",
                    payment.method_label,
                    payment.method_code,
                    payment.reference,
                    ext,
                    payment
                        .payment_note
                        .as_deref()
                        .map(|note| format!(" · {note}"))
                        .unwrap_or_default()
                ),
                amount: payment.amount_xof,
            }
        })
        .collect::<Vec<_>>();

    let planned_channel = order_summary
        .planned_payment_channel
        .clone()
        .or_else(|| order_summary.payment_method.clone());

    let status_label = match order_summary.status.as_str() {
        "draft" => "BROUILLON",
        "confirmed" => "CONFIRMÉE",
        "delivered" => "LIVRÉE",
        "invoiced" => "FACTURÉE",
        "paid" => "SOLDÉE",
        "cancelled" => "ANNULÉE",
        other => other,
    };
    let mixed_composition = order
        .links
        .iter()
        .filter_map(|link| {
            let line = order
                .lines
                .iter()
                .find(|line| line.id == link.order_line_id)?;
            let allocation = order
                .allocations
                .iter()
                .find(|allocation| allocation.id == link.order_packaging_allocation_id)?;
            Some(format!(
                "{} {} : {} unité(s) dans {}",
                line.product_name,
                line.variant_name,
                link.units_in_packaging,
                allocation.packaging_name
            ))
        })
        .collect::<Vec<_>>();
    let mut note_lines = [
        Some(format!("Commande source : {}", order_summary.order_number)),
        Some(format!("Statut de la commande : {status_label}")),
        Some(format!("Émis par : {cashier_name} ({issuer_role})")),
        revision_reason.map(|r| format!("Motif révision V{version} : {r}")),
        order_summary
            .delivery_address
            .as_deref()
            .map(|address| format!("Adresse livraison : {address}")),
        (!mixed_composition.is_empty())
            .then(|| format!("Casiers mixtes — {}", mixed_composition.join(" ; "))),
        order_summary.notes.clone(),
    ]
    .into_iter()
    .flatten()
    .filter(|note| !note.trim().is_empty())
    .collect::<Vec<_>>();
    note_lines.push(
        "Délai de retour des emballages : 15 jours maximum. Le montant du retour d'emballages est géré séparément, hors total commande ; passé le délai de 15 jours sans restitution physique, la valeur des emballages non restitués reste exigible."
            .to_string(),
    );
    let notes = note_lines.join("\n");

    let delivery_mode_label = if order_summary.delivery_mode == "delivery" {
        "Livraison à domicile / sur site"
    } else {
        "Enlèvement au Dépôt"
    };

    DocumentPdfInput {
        doc_type: "REÇU DE COMMANDE".to_string(),
        reference: receipt_number.to_string(),
        order_reference: Some(order_summary.order_number.clone()),
        linked_document_ref: Some(order_summary.order_number.clone()),
        date: issued_at.to_string(),
        status_label: Some(status_label.to_string()),
        party_title: Some("INFORMATIONS CLIENT".to_string()),
        party_name: Some(customer.name.to_string()),
        party_details: Some(party_details.join(" · ")),
        party_phone: customer.phone.map(str::to_string),
        secondary_party_title: Some("LOGISTIQUE & LIVRAISON".to_string()),
        secondary_party_name: Some(delivery_mode_label.to_string()),
        secondary_party_details: Some(
            order_summary
                .delivery_address
                .clone()
                .unwrap_or_else(|| "Enlèvement sur place (au sous-dépôt)".to_string()),
        ),
        delivery_date: order_summary.delivery_date.clone(),
        cashier_name: Some(cashier_name.to_string()),
        planned_payment_method: order_summary.payment_method.clone(),
        planned_payment_channel: planned_channel,
        version: Some(version),
        issuer_role: Some(issuer_role.to_string()),
        revision_reason: revision_reason.map(str::to_string),
        customer_establishment: customer.establishment_name.map(str::to_string),
        customer_category: customer.category.map(str::to_string),
        customer_location,
        delivery_mode: Some(order_summary.delivery_mode.clone()),
        courier_name: order_summary.courier_name.clone(),
        planned_delivery_time: order_summary.planned_delivery_time.clone(),
        delivery_fee_xof: Some(order_summary.delivery_fee_xof),
        delivery_landmark: order_summary
            .delivery_landmark
            .clone()
            .or_else(|| customer.landmark.map(str::to_string)),
        external_references: if external_references.is_empty() {
            None
        } else {
            Some(external_references)
        },
        lines,
        packaging_lines,
        summary_rows,
        payments: Some(pdf_payments),
        notes: Some(notes),
        ..Default::default()
    }
}
