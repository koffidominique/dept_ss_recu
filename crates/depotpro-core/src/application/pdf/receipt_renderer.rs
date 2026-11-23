// Rendu A4 fidèle au modèle CI : REÇU DE COMMANDE (Dépôt / Sous-Dépôt de boissons)
use crate::application::reports::AppSettingsDto;

use super::encoding_and_layout::{format_date_french, wrap_text};
use super::primitives::{
    assemble_pdf_bytes, decode_logo_jpeg, draw_line, draw_logo_image, draw_rect_fill,
    draw_rect_fill_stroke, draw_text, draw_text_right, start_page, CONTENT_W, MARGIN, PAGE_H,
    RIGHT,
};
use super::{DocumentPdfInput, DocumentPdfLine};

const ORANGE: (f64, f64, f64) = (0.78, 0.30, 0.035);
const GREEN: (f64, f64, f64) = (0.0, 0.48, 0.34);
const NAVY: (f64, f64, f64) = (0.12, 0.16, 0.23);
const GRAY: (f64, f64, f64) = (0.38, 0.42, 0.49);
const LIGHT: (f64, f64, f64) = (0.96, 0.97, 0.98);
const BORDER: (f64, f64, f64) = (0.78, 0.81, 0.85);

fn amount(value: i64) -> String {
    let digits = value.abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(' ');
        }
        grouped.push(ch);
    }
    if value < 0 {
        format!("- {grouped}")
    } else {
        grouped
    }
}

fn time_part(date: &str) -> String {
    let time = date
        .split_once('T')
        .or_else(|| date.split_once(' '))
        .map(|(_, time)| time)
        .unwrap_or("");
    let time = time.trim_end_matches('Z');
    let time = time
        .split(|ch| ch == '+' || ch == '-')
        .next()
        .unwrap_or(time);
    if time.len() >= 5 {
        format!("{} h {}", &time[..2], &time[3..5])
    } else {
        "—".to_string()
    }
}

fn draw_brand_header(
    cmds: &mut Vec<String>,
    company: &AppSettingsDto,
    doc: &DocumentPdfInput,
    logo: Option<&super::primitives::PdfJpegImage>,
    first_page: bool,
) {
    let x = MARGIN;
    if first_page {
        if let Some(image) = logo {
            let side = 86.0;
            let scale = side / f64::from(image.width.max(image.height));
            let w = f64::from(image.width) * scale;
            let h = f64::from(image.height) * scale;
            draw_rect_fill_stroke(cmds, x, 719.0, side, side, (1.0, 1.0, 1.0), BORDER, 0.8);
            draw_logo_image(cmds, x + (side - w) / 2.0, 719.0 + (side - h) / 2.0, w, h);
        } else {
            draw_rect_fill_stroke(cmds, x, 719.0, 86.0, 86.0, LIGHT, (0.60, 0.65, 0.72), 0.8);
            draw_text(cmds, x + 15.0, 766.0, "EMPLACEMENT", 8.0, true, GRAY);
            draw_text(cmds, x + 23.0, 754.0, "LOGO", 10.0, true, GRAY);
            draw_text(cmds, x + 13.0, 741.0, "(Cachet / Visuel)", 6.0, false, GRAY);
        }

        let brand_x = x + 98.0;
        let name = if company.company_name.trim().is_empty() {
            "NOM DU SOUS-DÉPÔT DE BOISSONS"
        } else {
            company.company_name.trim()
        };
        let title_lines = wrap_text(name, 200.0, 13.5, true);
        let mut title_y = 794.0;
        for line in title_lines.iter().take(2) {
            draw_text(cmds, brand_x, title_y, line, 13.5, true, ORANGE);
            title_y -= 14.5;
        }
        draw_line(
            cmds,
            brand_x,
            title_y + 3.0,
            395.0,
            title_y + 3.0,
            ORANGE,
            0.8,
        );

        let mut info_y = title_y - 8.0;
        let mut infos = Vec::new();
        if let Some(act) = company
            .business_activity
            .as_deref()
            .filter(|v| !v.trim().is_empty())
        {
            infos.push(format!("Activité : {}", act.trim()));
        }
        let commune_quartier = [
            company.commune.as_deref(),
            company.quartier.as_deref(),
            company.city.as_deref(),
            company.address.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(" / ");
        if !commune_quartier.is_empty() {
            infos.push(format!("Commune / Quartier : {commune_quartier}"));
        }
        let phones = [company.phone.as_deref(), company.whatsapp.as_deref()]
            .into_iter()
            .flatten()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>()
            .join(" / ");
        if !phones.is_empty() {
            infos.push(format!("Tél / WhatsApp : {phones}"));
        }
        let rccm_ncc = [
            company
                .rccm
                .as_deref()
                .filter(|v| !v.trim().is_empty())
                .map(|v| format!("RCCM : {}", v.trim())),
            company
                .ncc
                .as_deref()
                .filter(|v| !v.trim().is_empty())
                .map(|v| format!("NCC : {}", v.trim())),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("  |  ");
        if !rccm_ncc.is_empty() {
            infos.push(rccm_ncc);
        } else if let Some(legal) = company
            .company_legal_name
            .as_deref()
            .filter(|v| !v.trim().is_empty())
        {
            infos.push(format!("Raison sociale : {}", legal.trim()));
        }
        for info in infos.iter().take(5) {
            let wrapped = wrap_text(info, 200.0, 6.8, false);
            if let Some(line) = wrapped.first() {
                draw_text(cmds, brand_x, info_y, line, 6.8, false, NAVY);
            }
            info_y -= 9.5;
        }

        let bx = 406.0;
        draw_rect_fill_stroke(cmds, bx, 710.0, 149.0, 95.0, (0.95, 1.0, 0.98), GREEN, 1.4);
        draw_text(cmds, bx + 12.0, 791.0, "REÇU DE COMMANDE", 9.6, true, GREEN);
        let ver_badge = doc
            .version
            .filter(|v| *v > 1)
            .map(|v| format!(" · v{v}"))
            .unwrap_or_default();
        draw_text(
            cmds,
            bx + 10.0,
            778.0,
            &format!("N° Reçu : {}{}", doc.reference, ver_badge),
            6.8,
            true,
            NAVY,
        );
        draw_text(
            cmds,
            bx + 10.0,
            767.0,
            &format!("Date : {}", format_date_french(&doc.date)),
            6.8,
            false,
            NAVY,
        );
        draw_text(
            cmds,
            bx + 10.0,
            756.0,
            &format!("Heure : {}", time_part(&doc.date)),
            6.8,
            false,
            NAVY,
        );
        draw_text(
            cmds,
            bx + 10.0,
            745.0,
            &format!(
                "Caissier(ère) : {}",
                doc.cashier_name.as_deref().unwrap_or("—")
            ),
            6.8,
            false,
            NAVY,
        );
        draw_text(
            cmds,
            bx + 10.0,
            733.0,
            &format!(
                "Réf. Cmd : {}",
                doc.order_reference.as_deref().unwrap_or("—")
            ),
            6.5,
            true,
            NAVY,
        );
        draw_text(
            cmds,
            bx + 10.0,
            721.0,
            &format!("Statut : {}", doc.status_label.as_deref().unwrap_or("—")),
            6.5,
            true,
            GREEN,
        );
        draw_line(cmds, MARGIN, 704.0, RIGHT, 704.0, ORANGE, 1.4);
    } else {
        draw_text(
            cmds,
            MARGIN,
            PAGE_H - 32.0,
            &format!("{} · REÇU {} · SUITE", company.company_name, doc.reference),
            9.0,
            true,
            NAVY,
        );
        draw_line(
            cmds,
            MARGIN,
            PAGE_H - 39.0,
            RIGHT,
            PAGE_H - 39.0,
            ORANGE,
            1.0,
        );
    }
}

fn draw_checkbox(cmds: &mut Vec<String>, x: f64, y: f64, checked: bool, label: &str) {
    draw_rect_fill_stroke(cmds, x, y - 2.0, 8.0, 8.0, (1.0, 1.0, 1.0), NAVY, 0.6);
    if checked {
        draw_line(cmds, x + 1.5, y + 1.0, x + 3.5, y - 1.0, GREEN, 1.2);
        draw_line(cmds, x + 3.5, y - 1.0, x + 7.0, y + 4.5, GREEN, 1.2);
    }
    draw_text(cmds, x + 12.0, y + 1.5, label, 6.4, false, NAVY);
}

fn draw_party_boxes(cmds: &mut Vec<String>, doc: &DocumentPdfInput) {
    let top = 698.0;
    let h = 76.0;
    let left_x = MARGIN;
    let left_w = 264.0;
    let right_x = left_x + left_w + 10.0;
    let right_w = CONTENT_W - left_w - 10.0;
    draw_rect_fill_stroke(
        cmds,
        left_x,
        top - h,
        left_w,
        h,
        (1.0, 1.0, 1.0),
        BORDER,
        0.7,
    );
    draw_rect_fill_stroke(
        cmds,
        right_x,
        top - h,
        right_w,
        h,
        (1.0, 1.0, 1.0),
        BORDER,
        0.7,
    );

    draw_text(
        cmds,
        left_x + 9.0,
        top - 13.0,
        "INFORMATIONS DU CLIENT",
        8.0,
        true,
        ORANGE,
    );
    draw_line(
        cmds,
        left_x + 8.0,
        top - 18.0,
        left_x + left_w - 8.0,
        top - 18.0,
        BORDER,
        0.5,
    );
    let client_display = doc
        .customer_establishment
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|est| {
            format!(
                "{} — {}",
                doc.party_name.as_deref().unwrap_or("—"),
                est.trim()
            )
        })
        .unwrap_or_else(|| doc.party_name.as_deref().unwrap_or("—").to_string());
    draw_text(
        cmds,
        left_x + 9.0,
        top - 30.0,
        &format!("Nom / Établissement : {client_display}"),
        7.0,
        true,
        NAVY,
    );
    let cat_text = doc
        .customer_category
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|c| format!("Type : {c}"))
        .unwrap_or_else(|| "(Maquis, Cave, Bar, Restaurant, Particulier, Événement)".to_string());
    draw_text(cmds, left_x + 9.0, top - 41.0, &cat_text, 5.8, false, GRAY);
    draw_text(
        cmds,
        left_x + 9.0,
        top - 53.0,
        &format!(
            "Contact (+225) : {}",
            doc.party_phone.as_deref().unwrap_or("—")
        ),
        6.5,
        false,
        NAVY,
    );
    let loc_text = doc
        .customer_location
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or(doc.party_details.as_deref())
        .unwrap_or("—");
    let loc_lines = wrap_text(
        &format!("Quartier / Repère : {loc_text}"),
        left_w - 18.0,
        6.4,
        false,
    );
    if let Some(first) = loc_lines.first() {
        draw_text(cmds, left_x + 9.0, top - 65.0, first, 6.4, false, NAVY);
    }

    draw_text(
        cmds,
        right_x + 9.0,
        top - 13.0,
        "MODE DE RETRAIT / LIVRAISON",
        8.0,
        true,
        ORANGE,
    );
    draw_line(
        cmds,
        right_x + 8.0,
        top - 18.0,
        right_x + right_w - 8.0,
        top - 18.0,
        BORDER,
        0.5,
    );
    let is_delivery = doc
        .delivery_mode
        .as_deref()
        .map(|m| m.eq_ignore_ascii_case("delivery"))
        .unwrap_or_else(|| {
            doc.delivery_date.is_some()
                || doc
                    .secondary_party_details
                    .as_deref()
                    .map(|t| {
                        !t.to_lowercase().contains("enlèvement")
                            && !t.to_lowercase().contains("au sous-dépôt")
                    })
                    .unwrap_or(false)
        });
    draw_checkbox(
        cmds,
        right_x + 9.0,
        top - 30.0,
        !is_delivery,
        "Enlèvement sur place (au sous-dépôt)",
    );
    draw_checkbox(
        cmds,
        right_x + 9.0,
        top - 42.0,
        is_delivery,
        "Livraison à domicile / sur site",
    );
    let courier = doc
        .courier_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(if is_delivery {
            "À assigner"
        } else {
            "— (retrait sur place)"
        });
    draw_text(
        cmds,
        right_x + 9.0,
        top - 54.0,
        &format!("Livreur / Tricycle : {courier}"),
        6.4,
        false,
        NAVY,
    );
    let date_time = match (
        doc.delivery_date.as_deref(),
        doc.planned_delivery_time.as_deref(),
    ) {
        (Some(d), Some(t)) if !d.is_empty() && !t.is_empty() => {
            format!("{} à {}", format_date_french(d), t)
        }
        (Some(d), _) if !d.is_empty() => format_date_french(d),
        (_, Some(t)) if !t.is_empty() => t.to_string(),
        _ => doc
            .delivery_landmark
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("—")
            .to_string(),
    };
    draw_text(
        cmds,
        right_x + 9.0,
        top - 66.0,
        &format!("Date / Heure prévue : {date_time}"),
        6.4,
        false,
        NAVY,
    );
}

fn draw_products_header(cmds: &mut Vec<String>, top: f64) {
    let y = top - 28.0;
    draw_rect_fill(cmds, MARGIN, y, CONTENT_W, 28.0, NAVY);
    // 6 colonnes exactes : N° | DÉSIGNATION & FORMAT (CL) | CONDITIONNEMENT | QTÉ | PRIX UNITAIRE (FCFA) | MONTANT TOTAL (FCFA)
    let cols = [
        MARGIN,
        MARGIN + 26.0,
        MARGIN + 230.0,
        MARGIN + 325.0,
        MARGIN + 365.0,
        MARGIN + 438.0,
        RIGHT,
    ];
    for x in cols.iter().skip(1).take(5) {
        draw_line(cmds, *x, y, *x, top, (0.65, 0.68, 0.73), 0.5);
    }
    draw_text(
        cmds,
        MARGIN + 8.0,
        top - 17.0,
        "N°",
        7.0,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 32.0,
        top - 12.0,
        "DÉSIGNATION DE LA BOISSON &",
        6.2,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 92.0,
        top - 22.0,
        "FORMAT (CL)",
        6.2,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 238.0,
        top - 12.0,
        "CONDITIONNEMENT",
        6.0,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 250.0,
        top - 22.0,
        "(CASIER / PACK)",
        5.6,
        false,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 338.0,
        top - 17.0,
        "QTÉ",
        6.6,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 371.0,
        top - 12.0,
        "PRIX UNITAIRE",
        6.0,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 388.0,
        top - 22.0,
        "(FCFA)",
        5.8,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 444.0,
        top - 12.0,
        "MONTANT TOTAL",
        5.8,
        true,
        (1.0, 1.0, 1.0),
    );
    draw_text(
        cmds,
        MARGIN + 467.0,
        top - 22.0,
        "(FCFA)",
        5.8,
        true,
        (1.0, 1.0, 1.0),
    );
}

fn draw_product_row(
    cmds: &mut Vec<String>,
    row_top: f64,
    index: usize,
    line: Option<&DocumentPdfLine>,
) {
    let row_h = 19.5;
    let bottom = row_top - row_h;
    draw_rect_fill(
        cmds,
        MARGIN,
        bottom,
        CONTENT_W,
        row_h,
        if index % 2 == 0 {
            LIGHT
        } else {
            (1.0, 1.0, 1.0)
        },
    );
    let cols = [
        MARGIN,
        MARGIN + 26.0,
        MARGIN + 230.0,
        MARGIN + 325.0,
        MARGIN + 365.0,
        MARGIN + 438.0,
        RIGHT,
    ];
    for x in cols.iter().skip(1).take(5) {
        draw_line(cmds, *x, bottom, *x, row_top, BORDER, 0.45);
    }
    draw_line(cmds, MARGIN, bottom, RIGHT, bottom, BORDER, 0.45);
    draw_text(
        cmds,
        MARGIN + 9.0,
        row_top - 13.0,
        &format!("{}", index + 1),
        7.0,
        false,
        NAVY,
    );
    if let Some(line) = line {
        let label = wrap_text(&line.label, 196.0, 6.5, true);
        if let Some(text) = label.first() {
            draw_text(cmds, MARGIN + 31.0, row_top - 12.5, text, 6.5, true, NAVY);
        }
        let cond = line
            .packaging_info
            .as_deref()
            .or(line.sublabel.as_deref())
            .unwrap_or("—");
        let cond_wrapped = wrap_text(cond, 86.0, 5.7, false);
        if let Some(text) = cond_wrapped.first() {
            draw_text(cmds, MARGIN + 235.0, row_top - 12.5, text, 5.7, false, GRAY);
        }
        draw_text_right(
            cmds,
            MARGIN + 361.0,
            row_top - 13.0,
            &line.quantity,
            6.1,
            false,
            NAVY,
        );
        draw_text_right(
            cmds,
            MARGIN + 433.0,
            row_top - 13.0,
            &line
                .unit_price
                .map(amount)
                .unwrap_or_else(|| "—".to_string()),
            6.1,
            false,
            NAVY,
        );
        draw_text_right(
            cmds,
            RIGHT - 5.0,
            row_top - 13.0,
            &line.total.map(amount).unwrap_or_else(|| "—".to_string()),
            6.2,
            true,
            NAVY,
        );
    }
}

fn draw_packaging_and_finance(cmds: &mut Vec<String>, top: f64, doc: &DocumentPdfInput) -> f64 {
    let left_x = MARGIN;
    let left_w = 260.0;
    let right_x = MARGIN + 270.0;
    let right_w = CONTENT_W - 270.0;
    draw_text(
        cmds,
        left_x,
        top,
        "SUIVI DES CASIERS & BOUTEILLES VIDES (CONSIGNES)",
        6.8,
        true,
        ORANGE,
    );
    draw_text(
        cmds,
        right_x,
        top,
        "DÉCOMPTE FINANCIER (EN FCFA)",
        7.0,
        true,
        ORANGE,
    );
    draw_line(
        cmds,
        left_x,
        top - 4.0,
        left_x + left_w,
        top - 4.0,
        BORDER,
        0.6,
    );
    draw_line(
        cmds,
        right_x,
        top - 4.0,
        right_x + right_w,
        top - 4.0,
        BORDER,
        0.6,
    );

    let table_top = top - 9.0;
    draw_rect_fill(
        cmds,
        left_x,
        table_top - 16.0,
        left_w,
        16.0,
        (1.0, 0.95, 0.78),
    );
    draw_text(
        cmds,
        left_x + 4.0,
        table_top - 11.0,
        "Type d'emballage",
        5.8,
        true,
        ORANGE,
    );
    draw_text(
        cmds,
        left_x + 144.0,
        table_top - 11.0,
        "Sortis",
        5.8,
        true,
        ORANGE,
    );
    draw_text(
        cmds,
        left_x + 182.0,
        table_top - 11.0,
        "Rendus",
        5.8,
        true,
        ORANGE,
    );
    draw_text(
        cmds,
        left_x + 220.0,
        table_top - 11.0,
        "Solde Dû",
        5.8,
        true,
        ORANGE,
    );
    let mut y = table_top - 16.0;
    if doc.packaging_lines.is_empty() {
        draw_line(
            cmds,
            left_x,
            y - 20.0,
            left_x + left_w,
            y - 20.0,
            BORDER,
            0.5,
        );
        draw_text(
            cmds,
            left_x + 5.0,
            y - 13.0,
            "Aucun emballage consigné sur cette commande",
            6.0,
            false,
            GRAY,
        );
        y -= 20.0;
    } else {
        for (idx, item) in doc.packaging_lines.iter().enumerate() {
            let row_height = 24.0;
            let row_y = y - row_height;
            if idx % 2 == 1 {
                draw_rect_fill(cmds, left_x, row_y, left_w, row_height, LIGHT);
            }
            draw_line(cmds, left_x, row_y, left_x + left_w, row_y, BORDER, 0.45);
            let label = wrap_text(&item.label, 128.0, 5.8, false);
            if let Some(text) = label.first() {
                draw_text(cmds, left_x + 4.0, y - 9.0, text, 5.8, true, NAVY);
            }
            let out_qty = item.issued_quantity.unwrap_or(item.expected_quantity);
            let ret_qty = item.returned_quantity.unwrap_or(0);
            let solde = (out_qty - ret_qty).max(0);
            draw_text_right(
                cmds,
                left_x + 168.0,
                y - 9.0,
                &out_qty.to_string(),
                6.0,
                false,
                NAVY,
            );
            draw_text_right(
                cmds,
                left_x + 206.0,
                y - 9.0,
                &ret_qty.to_string(),
                6.0,
                false,
                NAVY,
            );
            draw_text_right(
                cmds,
                left_x + left_w - 5.0,
                y - 9.0,
                &solde.to_string(),
                6.0,
                true,
                NAVY,
            );
            let consignment = match item.unit_deposit_xof {
                Some(unit) => {
                    let total = item
                        .amount
                        .unwrap_or_else(|| unit.saturating_mul(item.expected_quantity));
                    format!(
                        "{} · {} FCFA/u · total {} FCFA",
                        item.status_label,
                        amount(unit),
                        amount(total)
                    )
                }
                None => item.status_label.clone(),
            };
            let second_line = wrap_text(&consignment, 250.0, 5.0, false);
            if let Some(text) = second_line.first() {
                draw_text(cmds, left_x + 4.0, y - 18.0, text, 5.0, false, GRAY);
            }
            y -= row_height;
        }
    }
    draw_text(
        cmds,
        left_x + 2.0,
        y - 9.0,
        "* Retour emballages sous 15 jours max · Montant retour hors total commande (tarif consigne après 15 j).",
        5.0,
        false,
        GRAY,
    );

    let summary_top = top - 9.0;
    let summary_h = (doc.summary_rows.len().max(1) as f64 * 14.5) + 6.0;
    draw_rect_fill_stroke(
        cmds,
        right_x,
        summary_top - summary_h,
        right_w,
        summary_h,
        (1.0, 1.0, 1.0),
        BORDER,
        0.5,
    );
    let mut sy = summary_top - 12.0;
    for (index, row) in doc.summary_rows.iter().enumerate() {
        let is_net = row.tone.as_deref() == Some("success");
        let is_due = row.tone.as_deref() == Some("danger");
        if is_net {
            draw_rect_fill(cmds, right_x + 0.5, sy - 4.0, right_w - 1.0, 14.5, GREEN);
        } else if is_due {
            draw_rect_fill(
                cmds,
                right_x + 0.5,
                sy - 4.0,
                right_w - 1.0,
                14.5,
                (1.0, 0.93, 0.93),
            );
        } else if row.bold {
            draw_rect_fill(cmds, right_x + 0.5, sy - 4.0, right_w - 1.0, 14.5, LIGHT);
        }
        let tone = if is_net {
            (1.0, 1.0, 1.0)
        } else if is_due {
            (0.82, 0.08, 0.08)
        } else if row.tone.as_deref() == Some("warning") {
            ORANGE
        } else {
            NAVY
        };
        let label = wrap_text(&row.label, right_w - 92.0, 6.0, row.bold);
        if let Some(text) = label.first() {
            draw_text(cmds, right_x + 4.0, sy, text, 6.0, row.bold || is_net, tone);
        }
        draw_text_right(
            cmds,
            right_x + right_w - 5.0,
            sy,
            &row.value,
            6.0,
            row.bold || is_net,
            tone,
        );
        sy -= 14.5;
        if index + 1 < doc.summary_rows.len() {
            draw_line(
                cmds,
                right_x + 3.0,
                sy + 4.0,
                right_x + right_w - 3.0,
                sy + 4.0,
                (0.88, 0.90, 0.93),
                0.35,
            );
        }
    }
    top - (summary_h.max((top - y) + 16.0))
}

fn normalize_method(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(' ', "_")
        .replace('-', "_")
}

fn draw_notes_block(cmds: &mut Vec<String>, top: f64, lines: &[String], continuation: bool) -> f64 {
    let height = 22.0 + lines.len() as f64 * 8.0;
    draw_rect_fill_stroke(
        cmds,
        MARGIN,
        top - height,
        CONTENT_W,
        height,
        (1.0, 1.0, 1.0),
        BORDER,
        0.55,
    );
    draw_text(
        cmds,
        MARGIN + 7.0,
        top - 10.0,
        if continuation {
            "OBSERVATIONS ET CONDITIONS (SUITE)"
        } else {
            "OBSERVATIONS ET CONDITIONS"
        },
        6.6,
        true,
        ORANGE,
    );
    draw_line(
        cmds,
        MARGIN + 6.0,
        top - 14.0,
        RIGHT - 6.0,
        top - 14.0,
        BORDER,
        0.4,
    );
    for (index, line) in lines.iter().enumerate() {
        draw_text(
            cmds,
            MARGIN + 7.0,
            top - 22.0 - index as f64 * 8.0,
            line,
            5.8,
            false,
            NAVY,
        );
    }
    top - height
}

fn draw_payment_and_signatures(cmds: &mut Vec<String>, top: f64, doc: &DocumentPdfInput) {
    let payment_y = top - 38.0;
    draw_rect_fill_stroke(
        cmds,
        MARGIN,
        payment_y,
        CONTENT_W,
        35.0,
        (0.98, 0.98, 0.99),
        BORDER,
        0.6,
    );
    draw_text(
        cmds,
        MARGIN + 8.0,
        top - 13.0,
        "Mode de règlement :",
        6.8,
        true,
        NAVY,
    );
    let method_names = [
        ("cash", "Espèces"),
        ("wave", "Wave"),
        ("orange_money", "Orange Money"),
        ("mtn_money", "MTN MoMo"),
        ("moov_money", "Moov Money"),
        ("other", "Autre"),
    ];
    let actual_codes = doc
        .payments
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|p| normalize_method(&p.label))
        .collect::<Vec<_>>();
    let planned = doc
        .planned_payment_channel
        .as_deref()
        .or(doc.planned_payment_method.as_deref())
        .map(normalize_method)
        .unwrap_or_default();
    let known = [
        "cash",
        "espèces",
        "especes",
        "wave",
        "orange_money",
        "mtn_money",
        "mtn_momo",
        "moov_money",
    ];
    let mut x = MARGIN + 92.0;
    for (code, label) in method_names {
        let checked = if actual_codes.is_empty() {
            match code {
                "cash" => planned == "cash" || planned == "especes" || planned == "espèces",
                "wave" => planned.contains("wave"),
                "orange_money" => planned.contains("orange"),
                "mtn_money" => planned.contains("mtn"),
                "moov_money" => planned.contains("moov"),
                "other" => !planned.is_empty() && !known.iter().any(|k| planned.contains(k)),
                _ => false,
            }
        } else {
            match code {
                "cash" => actual_codes
                    .iter()
                    .any(|v| v.contains("cash") || v.contains("espèces") || v.contains("especes")),
                "wave" => actual_codes.iter().any(|v| v.contains("wave")),
                "orange_money" => actual_codes.iter().any(|v| v.contains("orange")),
                "mtn_money" => actual_codes.iter().any(|v| v.contains("mtn")),
                "moov_money" => actual_codes.iter().any(|v| v.contains("moov")),
                "other" => actual_codes
                    .iter()
                    .any(|v| !known.iter().any(|k| v.contains(k))),
                _ => false,
            }
        };
        draw_checkbox(cmds, x, top - 12.0, checked, label);
        x += match code {
            "cash" => 58.0,
            "wave" => 52.0,
            "orange_money" => 78.0,
            "mtn_money" => 68.0,
            "moov_money" => 74.0,
            _ => 46.0,
        };
    }

    draw_text(
        cmds,
        MARGIN + 8.0,
        top - 29.0,
        "Réf. Transaction Mobile Money / Observation :",
        6.3,
        true,
        NAVY,
    );
    let refs = doc
        .external_references
        .as_deref()
        .filter(|r| !r.is_empty())
        .map(|r| r.join(" ; "))
        .unwrap_or_else(|| {
            let pays = doc
                .payments
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .map(|p| p.label.as_str())
                .collect::<Vec<_>>()
                .join(" ; ");
            if pays.is_empty() {
                "—".to_string()
            } else {
                pays
            }
        });
    draw_text(
        cmds,
        MARGIN + 178.0,
        top - 29.0,
        &wrap_text(&refs, CONTENT_W - 186.0, 5.8, false)
            .first()
            .cloned()
            .unwrap_or_else(|| "—".to_string()),
        5.8,
        false,
        GRAY,
    );

    let sig_top = payment_y - 8.0;
    let sig_h = 52.0;
    let sig_w = (CONTENT_W - 10.0) / 2.0;
    draw_rect_fill_stroke(
        cmds,
        MARGIN,
        sig_top - sig_h,
        sig_w,
        sig_h,
        (1.0, 1.0, 1.0),
        BORDER,
        0.65,
    );
    draw_rect_fill_stroke(
        cmds,
        MARGIN + sig_w + 10.0,
        sig_top - sig_h,
        sig_w,
        sig_h,
        (1.0, 1.0, 1.0),
        BORDER,
        0.65,
    );
    draw_text(
        cmds,
        MARGIN + 7.0,
        sig_top - 12.0,
        "Signature & Cachet du Sous-Dépôt :",
        6.6,
        true,
        NAVY,
    );
    draw_text(
        cmds,
        MARGIN + sig_w + 17.0,
        sig_top - 12.0,
        "Signature du Client (Bon pour accord & réception) :",
        6.2,
        true,
        NAVY,
    );
    let footer_y = sig_top - sig_h - 14.0;
    draw_line(
        cmds,
        MARGIN,
        footer_y + 7.0,
        RIGHT,
        footer_y + 7.0,
        BORDER,
        0.45,
    );
    draw_text(
        cmds,
        MARGIN + 52.0,
        footer_y - 1.0,
        "Merci pour votre confiance ! Veuillez vérifier vos quantités et emballages avant de quitter le dépôt.",
        6.1,
        false,
        GRAY,
    );
}

fn draw_receipt_closing(
    pages: &mut Vec<Vec<String>>,
    company: &AppSettingsDto,
    logo: Option<&super::primitives::PdfJpegImage>,
    mut top: f64,
    doc: &DocumentPdfInput,
) {
    let note_lines = doc
        .notes
        .as_deref()
        .unwrap_or("")
        .lines()
        .flat_map(|line| wrap_text(line, CONTENT_W - 16.0, 5.8, false))
        .collect::<Vec<_>>();
    let closing_height = 114.0;
    let note_height = if note_lines.is_empty() {
        0.0
    } else {
        22.0 + note_lines.len() as f64 * 8.0
    };
    if top - note_height - closing_height < MARGIN - 6.0 {
        let mut page_y = 0.0;
        start_page(pages, &mut page_y);
        draw_brand_header(pages.last_mut().unwrap(), company, doc, logo, false);
        top = PAGE_H - 58.0;
    }

    let mut index = 0usize;
    while index < note_lines.len() {
        let available_lines = ((top - MARGIN - closing_height - 22.0) / 8.0)
            .floor()
            .max(1.0) as usize;
        let end = (index + available_lines).min(note_lines.len());
        top = draw_notes_block(
            pages.last_mut().unwrap(),
            top,
            &note_lines[index..end],
            index > 0,
        );
        index = end;
        if index < note_lines.len() {
            let mut page_y = 0.0;
            start_page(pages, &mut page_y);
            draw_brand_header(pages.last_mut().unwrap(), company, doc, logo, false);
            top = PAGE_H - 58.0;
        }
    }

    if top - closing_height < MARGIN - 6.0 {
        let mut page_y = 0.0;
        start_page(pages, &mut page_y);
        draw_brand_header(pages.last_mut().unwrap(), company, doc, logo, false);
        top = PAGE_H - 58.0;
    }
    draw_payment_and_signatures(pages.last_mut().unwrap(), top - 4.0, doc);
}

fn draw_continuation_table_header(cmds: &mut Vec<String>, top: f64) {
    draw_text(
        cmds,
        MARGIN,
        top,
        "DÉTAIL DES BOISSONS — SUITE",
        8.0,
        true,
        ORANGE,
    );
    draw_line(cmds, MARGIN, top - 4.0, RIGHT, top - 4.0, BORDER, 0.6);
    draw_products_header(cmds, top - 9.0);
}

pub fn render_order_receipt_pdf(company: &AppSettingsDto, doc: &DocumentPdfInput) -> Vec<u8> {
    let logo = doc.company_logo_jpeg.as_deref().and_then(decode_logo_jpeg);
    let mut pages: Vec<Vec<String>> = Vec::new();
    let mut y = PAGE_H - MARGIN;
    start_page(&mut pages, &mut y);
    let cmds = pages.last_mut().expect("page initiale créée");
    draw_brand_header(cmds, company, doc, logo.as_ref(), true);
    draw_party_boxes(cmds, doc);
    draw_products_header(cmds, 612.0);
    y = 584.0;

    let product_count = doc.lines.len();
    if product_count <= 10 {
        for index in 0..10 {
            draw_product_row(pages.last_mut().unwrap(), y, index, doc.lines.get(index));
            y -= 19.5;
        }
        let section_top = if doc.packaging_lines.len() > 6 {
            start_page(&mut pages, &mut y);
            draw_brand_header(
                pages.last_mut().unwrap(),
                company,
                doc,
                logo.as_ref(),
                false,
            );
            PAGE_H - 58.0
        } else {
            y - 5.0
        };
        let lower_top = draw_packaging_and_finance(pages.last_mut().unwrap(), section_top, doc);
        draw_receipt_closing(&mut pages, company, logo.as_ref(), lower_top - 4.0, doc);
    } else {
        for index in 0..10 {
            draw_product_row(pages.last_mut().unwrap(), y, index, doc.lines.get(index));
            y -= 19.5;
        }
        let mut next_index = 10usize;
        while next_index < product_count {
            start_page(&mut pages, &mut y);
            draw_brand_header(
                pages.last_mut().unwrap(),
                company,
                doc,
                logo.as_ref(),
                false,
            );
            draw_continuation_table_header(pages.last_mut().unwrap(), PAGE_H - 58.0);
            y = PAGE_H - 95.0;
            let end_index = (next_index + 20).min(product_count);
            for index in next_index..end_index {
                draw_product_row(pages.last_mut().unwrap(), y, index, doc.lines.get(index));
                y -= 19.5;
            }
            next_index = end_index;
            if next_index == product_count {
                let section_top = if doc.packaging_lines.len() > 6 {
                    start_page(&mut pages, &mut y);
                    draw_brand_header(
                        pages.last_mut().unwrap(),
                        company,
                        doc,
                        logo.as_ref(),
                        false,
                    );
                    PAGE_H - 58.0
                } else {
                    y - 5.0
                };
                let lower_top =
                    draw_packaging_and_finance(pages.last_mut().unwrap(), section_top, doc);
                draw_receipt_closing(&mut pages, company, logo.as_ref(), lower_top - 4.0, doc);
            }
        }
    }
    assemble_pdf_bytes(&pages, logo.as_ref())
}
