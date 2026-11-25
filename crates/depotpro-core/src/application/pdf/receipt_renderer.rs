// Rendu A4 des documents commerciaux DEPOTPRO (référence: reçu de commande CI)
use crate::application::reports::AppSettingsDto;

use super::encoding_and_layout::{format_date_french, wrap_text};
use super::primitives::{
    assemble_pdf_bytes, decode_logo_jpeg, draw_line, draw_logo_image, draw_rect_fill,
    draw_rect_fill_stroke, draw_text, draw_text_right, start_page, CONTENT_W, MARGIN, PAGE_H,
    RIGHT,
};
use super::{DocumentPdfInput, DocumentPdfLine, DocumentPdfPackagingLine};

const ORANGE: (f64, f64, f64) = (0.776, 0.325, 0.035); // #C65309
const GREEN: (f64, f64, f64) = (0.0, 0.502, 0.353); // #00805A
const NAVY: (f64, f64, f64) = (0.122, 0.161, 0.216); // #1F2937
const GRAY: (f64, f64, f64) = (0.278, 0.333, 0.412); // #475569
const LIGHT: (f64, f64, f64) = (0.973, 0.980, 0.988); // #F8FAFC
const BORDER: (f64, f64, f64) = (0.820, 0.835, 0.859); // #D1D5DB
const YELLOW_BG: (f64, f64, f64) = (0.996, 0.953, 0.780); // #FEF3C7
const YELLOW_TXT: (f64, f64, f64) = (0.573, 0.251, 0.055);
const RED_BG: (f64, f64, f64) = (0.996, 0.949, 0.949); // #FEF2F2
const RED_TXT: (f64, f64, f64) = (0.863, 0.149, 0.149);

fn amount(value: i64) -> String {
    let digits = value.abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(' ');
        }
        grouped.push(ch);
    }
    if value < 0 { format!("- {grouped}") } else { grouped }
}

fn time_part(date: &str) -> String {
    let time = date.split_once('T').or_else(|| date.split_once(' ')).map(|(_, t)| t).unwrap_or("");
    let time = time.trim_end_matches('Z');
    let time = time.split(['+', '-']).next().unwrap_or(time);
    if time.len() >= 5 { format!("{} h {}", &time[..2], &time[3..5]) } else { "—".to_string() }
}

fn doc_title(doc: &DocumentPdfInput) -> &str {
    match doc.doc_type.as_str() {
        "BON DE COMMANDE" | "BON DE COMMANDE FOURNISSEUR" => "BON DE COMMANDE FOURNISSEUR",
        "BON DE RÉCEPTION" | "BON DE RÉCEPTION FOURNISSEUR" => "BON DE RÉCEPTION FOURNISSEUR",
        _ => "REÇU DE COMMANDE",
    }
}

fn ref_label(doc: &DocumentPdfInput) -> &str {
    match doc.doc_type.as_str() {
        "BON DE COMMANDE" | "BON DE COMMANDE FOURNISSEUR" => "N° BC",
        "BON DE RÉCEPTION" | "BON DE RÉCEPTION FOURNISSEUR" => "N° BR",
        _ => "N° Reçu",
    }
}

fn is_supplier_doc(doc: &DocumentPdfInput) -> bool {
    matches!(doc.doc_type.as_str(), "BON DE COMMANDE" | "BON DE COMMANDE FOURNISSEUR" | "BON DE RÉCEPTION" | "BON DE RÉCEPTION FOURNISSEUR")
}

fn draw_brand_header(cmds: &mut Vec<String>, company: &AppSettingsDto, doc: &DocumentPdfInput, logo: Option<&super::primitives::PdfJpegImage>, first_page: bool) {
    if !first_page {
        draw_text(cmds, MARGIN, PAGE_H - 32.0, &format!("{} · {} · Suite", company.company_name, doc.reference), 9.0, true, NAVY);
        draw_line(cmds, MARGIN, PAGE_H - 39.0, RIGHT, PAGE_H - 39.0, ORANGE, 1.0);
        return;
    }
    // Logo
    if let Some(image) = logo {
        let side = 82.0;
        let scale = side / f64::from(image.width.max(image.height));
        let w = f64::from(image.width) * scale;
        let h = f64::from(image.height) * scale;
        draw_rect_fill_stroke(cmds, MARGIN, 724.0, side, side, (1.0, 1.0, 1.0), BORDER, 0.8);
        draw_logo_image(cmds, MARGIN + (side - w) / 2.0, 724.0 + (side - h) / 2.0, w, h);
    } else {
        draw_rect_fill_stroke(cmds, MARGIN, 724.0, 82.0, 82.0, (1.0, 1.0, 1.0), (0.6, 0.65, 0.72), 0.8);
        draw_text(cmds, MARGIN + 14.0, 770.0, "EMPLACEMENT", 7.5, true, GRAY);
        draw_text(cmds, MARGIN + 27.0, 759.0, "LOGO", 9.5, true, GRAY);
        draw_text(cmds, MARGIN + 12.0, 747.0, "(Cachet / Visuel)", 5.8, false, GRAY);
    }

    let bx = MARGIN + 94.0;
    let name = if company.company_name.trim().is_empty() { "[NOM DU SOUS-DÉPÔT DE BOISSONS]" } else { company.company_name.trim() };
    let title_lines = wrap_text(name, 210.0, 13.0, true);
    let mut ty = 796.0;
    for line in title_lines.iter().take(2) { draw_text(cmds, bx, ty, line, 13.0, true, ORANGE); ty -= 14.0; }
    draw_line(cmds, bx, ty + 3.0, 395.0, ty + 3.0, ORANGE, 0.8);
    let mut iy = ty - 8.0;
    let activity = company.business_activity.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or("Distribution & Vente de Boissons (Gros / Demi-Gros / Détail)");
    draw_text(cmds, bx, iy, &format!("Activité : {}", activity), 6.8, false, NAVY); iy -= 10.0;
    let loc = [company.commune.as_deref(), company.quartier.as_deref(), company.city.as_deref(), company.country.as_deref()].into_iter().flatten().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join(" / ");
    draw_text(cmds, bx, iy, &format!("Commune / Quartier : {}", if loc.is_empty() { ".........................................................." } else { &loc }), 6.6, false, NAVY); iy -= 10.0;
    if let Some(addr) = company.address.as_deref().filter(|s| !s.trim().is_empty()) { draw_text(cmds, bx, iy, &format!("Adresse : {}", addr), 6.6, false, NAVY); iy -= 10.0; }
    let phones = [company.phone.as_deref(), company.whatsapp.as_deref()].into_iter().flatten().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>();
    let phones = { let mut u = Vec::new(); for p in phones { if !u.contains(&p) { u.push(p); } } u.join(" / ") };
    draw_text(cmds, bx, iy, &format!("Tél / WhatsApp : {}", if phones.is_empty() { "+225 .... ........ / ..........." } else { &phones }), 6.6, false, NAVY); iy -= 10.0;
    let rccm = company.rccm.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or("CI-ABJ-...........");
    let ncc = company.ncc.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or("....................");
    draw_text(cmds, bx, iy, &format!("RCCM : {}  |  NCC : {}", rccm, ncc), 6.4, false, NAVY);

    // Right box
    let rx = 408.0; let rw = 147.0; let rh = 92.0; let ry = 714.0;
    draw_rect_fill_stroke(cmds, rx, ry, rw, rh, (0.941, 0.992, 0.973), GREEN, 1.4);
    let title = doc_title(doc);
    let title_lines = wrap_text(title, rw - 16.0, 9.5, true);
    let mut tby = 793.0;
    for l in title_lines.iter().take(2) { draw_text(cmds, rx + 8.0, tby, l, 9.5, true, GREEN); tby -= 11.0; }
    let mut by = tby - 2.0;
    draw_text(cmds, rx + 8.0, by, &format!("{} : {}", ref_label(doc), doc.reference), 6.8, true, NAVY); by -= 10.5;
    if let Some(linked) = doc.linked_document_ref.as_deref().or(doc.order_reference.as_deref()).filter(|s| !s.trim().is_empty() && *s != doc.reference) {
        draw_text(cmds, rx + 8.0, by, &format!("Réf. liée : {}", linked), 6.4, false, NAVY); by -= 10.0;
    }
    draw_text(cmds, rx + 8.0, by, &format!("Date : {}", format_date_french(&doc.date)), 6.6, false, NAVY); by -= 10.0;
    draw_text(cmds, rx + 8.0, by, &format!("Heure : {}", time_part(&doc.date)), 6.6, false, NAVY); by -= 10.0;
    draw_text(cmds, rx + 8.0, by, &format!("Opérateur : {}", doc.cashier_name.as_deref().unwrap_or("—")), 6.6, false, NAVY); by -= 10.0;
    if let Some(st) = doc.status_label.as_deref().filter(|s| !s.trim().is_empty()) {
        draw_text(cmds, rx + 8.0, by, &format!("Statut : {}", st), 6.4, true, GREEN);
    }

    draw_line(cmds, MARGIN, 706.0, RIGHT, 706.0, ORANGE, 1.5);
}

fn draw_section_box(cmds: &mut Vec<String>, x: f64, top: f64, w: f64, h: f64, title: &str) {
    draw_rect_fill_stroke(cmds, x, top - h, w, h, (1.0, 1.0, 1.0), BORDER, 0.7);
    draw_text(cmds, x + 8.0, top - 12.0, &title.to_uppercase(), 7.8, true, ORANGE);
    draw_line(cmds, x + 6.0, top - 17.0, x + w - 6.0, top - 17.0, BORDER, 0.5);
}

fn draw_checkbox(cmds: &mut Vec<String>, x: f64, y: f64, checked: bool, label: &str) {
    draw_rect_fill_stroke(cmds, x, y - 2.5, 8.0, 8.0, (1.0, 1.0, 1.0), NAVY, 0.6);
    if checked {
        draw_line(cmds, x + 1.5, y + 0.5, x + 3.3, y - 1.3, GREEN, 1.1);
        draw_line(cmds, x + 3.3, y - 1.3, x + 6.8, y + 4.0, GREEN, 1.1);
    }
    draw_text(cmds, x + 11.0, y + 1.0, label, 6.3, false, NAVY);
}

fn normalize_method(label: &str) -> String { label.to_lowercase() }

fn method_checked(doc: &DocumentPdfInput, key: &str) -> bool {
    let actual: Vec<String> = doc.payments.as_deref().unwrap_or(&[]).iter().map(|p| normalize_method(&p.label)).collect();
    let planned = doc.planned_payment_channel.as_deref().or(doc.planned_payment_method.as_deref()).map(normalize_method).unwrap_or_default();
    let hay = if actual.is_empty() { vec![planned] } else { actual };
    let has = |pat: &str| hay.iter().any(|h| h.contains(pat));
    match key {
        "cash" => has("cash") || has("esp"),
        "wave" => has("wave"),
        "orange" => has("orange"),
        "mtn" => has("mtn"),
        "moov" => has("moov"),
        "other" => has("autre") || has("credit") || has("crédit") || has("cheque") || has("chèque") || has("virement"),
        _ => false,
    }
}

fn draw_party_boxes(cmds: &mut Vec<String>, doc: &DocumentPdfInput, top: f64) -> f64 {
    let h = 74.0;
    let gap = 10.0;
    let lw = (CONTENT_W - gap) * 0.52;
    let rw = CONTENT_W - gap - lw;
    let lx = MARGIN;
    let rx = MARGIN + lw + gap;

    if is_supplier_doc(doc) {
        draw_section_box(cmds, lx, top, lw, h, if doc.doc_type.contains("RÉCEPTION") { "Fournisseur / Référence" } else { "Fournisseur" });
        draw_text(cmds, lx + 8.0, top - 30.0, &format!("Nom : {}", doc.party_name.as_deref().unwrap_or("—")), 7.0, true, NAVY);
        draw_text(cmds, lx + 8.0, top - 41.0, &format!("Téléphone : {}", doc.party_phone.as_deref().unwrap_or("—")), 6.5, false, NAVY);
        let details = doc.party_details.as_deref().unwrap_or("—");
        let dl = wrap_text(&format!("Adresse / Infos : {}", details), lw - 16.0, 6.3, false);
        if let Some(l) = dl.first() { draw_text(cmds, lx + 8.0, top - 52.0, l, 6.3, false, NAVY); }
        if doc.doc_type.contains("RÉCEPTION") {
            if let Some(linked) = doc.linked_document_ref.as_deref().or(doc.order_reference.as_deref()) {
                draw_text(cmds, lx + 8.0, top - 63.0, &format!("Bon de commande : {}", linked), 6.3, true, NAVY);
            }
        }
        draw_section_box(cmds, rx, top, rw, h, if doc.doc_type.contains("RÉCEPTION") { "Réception" } else { "Conditions de commande" });
        if doc.doc_type.contains("RÉCEPTION") {
            draw_text(cmds, rx + 8.0, top - 30.0, &format!("Réceptionnaire : {}", doc.cashier_name.as_deref().unwrap_or("—")), 6.6, false, NAVY);
            draw_text(cmds, rx + 8.0, top - 41.0, &format!("Statut : {}", doc.status_label.as_deref().unwrap_or("—")), 6.6, false, NAVY);
            draw_text(cmds, rx + 8.0, top - 52.0, &format!("Date : {}", format_date_french(&doc.date)), 6.6, false, NAVY);
        } else {
            draw_text(cmds, rx + 8.0, top - 30.0, &format!("Date prévue : {}", doc.delivery_date.as_deref().map(format_date_french).unwrap_or_else(|| "—".to_string())), 6.5, false, NAVY);
            draw_text(cmds, rx + 8.0, top - 41.0, &format!("Conditions paiement : {}", doc.payment_terms_label.as_deref().unwrap_or("—")), 6.3, false, NAVY);
            let cc = doc.commercial_conditions.as_deref().unwrap_or("—");
            let ccl = wrap_text(&format!("Conditions commerciales : {}", cc), rw - 16.0, 6.0, false);
            if let Some(l) = ccl.first() { draw_text(cmds, rx + 8.0, top - 52.0, l, 6.0, false, NAVY); }
            draw_text(cmds, rx + 8.0, top - 63.0, &format!("Réf. liée : {}", doc.linked_document_ref.as_deref().unwrap_or("—")), 6.3, false, NAVY);
        }
        return top - h;
    }

    // Client / delivery
    draw_section_box(cmds, lx, top, lw, h, "Informations du client");
    let client_name = doc.party_name.as_deref().unwrap_or("—");
    draw_text(cmds, lx + 8.0, top - 30.0, &format!("Nom / Établissement : {}", client_name), 7.0, true, NAVY);
    let cat = doc.customer_category.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or("(Maquis, Cave, Bar, Restaurant, Particulier, Événement)");
    draw_text(cmds, lx + 8.0, top - 40.0, &format!("Type : {}", cat), 5.8, false, GRAY);
    draw_text(cmds, lx + 8.0, top - 51.0, &format!("Contact (+225) : {}", doc.party_phone.as_deref().unwrap_or("....................................")), 6.4, false, NAVY);
    let loc = doc.customer_location.as_deref().or(doc.party_details.as_deref()).unwrap_or("....................................");
    let locl = wrap_text(&format!("Quartier / Repère : {}", loc), lw - 16.0, 6.2, false);
    if let Some(l) = locl.first() { draw_text(cmds, lx + 8.0, top - 62.0, l, 6.2, false, NAVY); }

    draw_section_box(cmds, rx, top, rw, h, "Mode de retrait / livraison");
    let is_delivery = doc.delivery_mode.as_deref().map(|m| m.eq_ignore_ascii_case("delivery")).unwrap_or(false)
        || doc.courier_name.as_deref().filter(|s| !s.trim().is_empty()).is_some()
        || doc.delivery_fee_xof.unwrap_or(0) > 0;
    draw_checkbox(cmds, rx + 8.0, top - 30.0, !is_delivery, "Enlèvement sur place (au sous-dépôt)");
    draw_checkbox(cmds, rx + 8.0, top - 41.0, is_delivery, "Livraison à domicile / sur site");
    draw_text(cmds, rx + 8.0, top - 53.0, &format!("Livreur / Tricycle : {}", doc.courier_name.as_deref().unwrap_or("....................................")), 6.2, false, NAVY);
    let dt = doc.planned_delivery_time.as_deref().filter(|s| !s.trim().is_empty()).map(|s| s.to_string())
        .or_else(|| doc.delivery_date.as_deref().map(format_date_french))
        .unwrap_or_else(|| "..... / ..... / 20..... à ..... h .....".to_string());
    let dtl = wrap_text(&format!("Date / Heure prévue : {}", dt), rw - 16.0, 6.2, false);
    if let Some(l) = dtl.first() { draw_text(cmds, rx + 8.0, top - 64.0, l, 6.2, false, NAVY); }
    top - h
}

struct Col { label: &'static str, x: f64, w: f64, align_right: bool, align_center: bool }

fn product_columns(doc: &DocumentPdfInput) -> Vec<Col> {
    if doc.doc_type.contains("RÉCEPTION") {
        vec![
            Col { label: "N°", x: MARGIN, w: 24.0, align_right: false, align_center: true },
            Col { label: "DÉSIGNATION / FORMAT", x: MARGIN+24.0, w: 190.0, align_right: false, align_center: false },
            Col { label: "COMMANDÉ", x: MARGIN+214.0, w: 60.0, align_right: false, align_center: true },
            Col { label: "REÇU", x: MARGIN+274.0, w: 60.0, align_right: false, align_center: true },
            Col { label: "MANQUANT", x: MARGIN+334.0, w: 60.0, align_right: false, align_center: true },
            Col { label: "ENDOM./REFUSÉ", x: MARGIN+394.0, w: CONTENT_W-394.0+MARGIN, align_right: false, align_center: true },
        ]
    } else if is_supplier_doc(doc) {
        vec![
            Col { label: "N°", x: MARGIN, w: 24.0, align_right: false, align_center: true },
            Col { label: "DÉSIGNATION / FORMAT", x: MARGIN+24.0, w: 210.0, align_right: false, align_center: false },
            Col { label: "CONDITIONNEMENT", x: MARGIN+234.0, w: 90.0, align_right: false, align_center: true },
            Col { label: "QTÉ", x: MARGIN+324.0, w: 50.0, align_right: false, align_center: true },
            Col { label: "P.U. (FCFA)", x: MARGIN+374.0, w: 70.0, align_right: true, align_center: false },
            Col { label: "MONTANT TOTAL", x: MARGIN+444.0, w: CONTENT_W-444.0+MARGIN, align_right: true, align_center: false },
        ]
    } else {
        vec![
            Col { label: "N°", x: MARGIN, w: 24.0, align_right: false, align_center: true },
            Col { label: "DÉSIGNATION & FORMAT", x: MARGIN+24.0, w: 205.0, align_right: false, align_center: false },
            Col { label: "CONDITIONNEMENT", x: MARGIN+229.0, w: 95.0, align_right: false, align_center: true },
            Col { label: "QTÉ", x: MARGIN+324.0, w: 45.0, align_right: false, align_center: true },
            Col { label: "P.U. (FCFA)", x: MARGIN+369.0, w: 72.0, align_right: true, align_center: false },
            Col { label: "MONTANT TOTAL", x: MARGIN+441.0, w: CONTENT_W-441.0+MARGIN, align_right: true, align_center: false },
        ]
    }
}

fn draw_table_header(cmds: &mut Vec<String>, top: f64, cols: &[Col]) {
    let h = 22.0;
    draw_rect_fill(cmds, MARGIN, top - h, CONTENT_W, h, NAVY);
    for i in 1..cols.len() {
        draw_line(cmds, cols[i].x, top - h, cols[i].x, top, (0.45, 0.50, 0.58), 0.4);
    }
    for c in cols {
        let tx = if c.align_right { c.x + c.w - 4.0 } else if c.align_center { c.x + c.w / 2.0 } else { c.x + 4.0 };
        let ty = top - 14.0;
        if c.align_right { draw_text_right(cmds, c.x + c.w - 4.0, ty, c.label, 6.0, true, (1.0,1.0,1.0)); }
        else if c.align_center { let tw = super::encoding_and_layout::measure_text_width(c.label, 6.0, true); draw_text(cmds, c.x + (c.w - tw)/2.0, ty, c.label, 6.0, true, (1.0,1.0,1.0)); }
        else { draw_text(cmds, tx, ty, c.label, 6.0, true, (1.0,1.0,1.0)); }
    }
}

fn cell_text(doc: &DocumentPdfInput, line: Option<&DocumentPdfLine>, col_idx: usize) -> String {
    let Some(l) = line else { return String::new(); };
    if doc.doc_type.contains("RÉCEPTION") {
        match col_idx {
            1 => l.label.clone(),
            2 => l.ordered_quantity.clone().unwrap_or_else(|| l.quantity.clone()),
            3 => l.quantity.clone(),
            4 => l.missing_quantity.clone().unwrap_or_else(|| "—".to_string()),
            5 => {
                let d = l.damaged_quantity.clone().unwrap_or_default();
                let r = l.refused_quantity.clone().unwrap_or_default();
                let mut parts = Vec::new();
                if !d.is_empty() && d != "0" { parts.push(format!("End.: {d}")); }
                if !r.is_empty() && r != "0" { parts.push(format!("Ref.: {r}")); }
                if parts.is_empty() { "—".to_string() } else { parts.join(" ") }
            }
            _ => String::new(),
        }
    } else {
        match col_idx {
            1 => l.label.clone(),
            2 => l.packaging_info.clone().or(l.sublabel.clone()).unwrap_or_default(),
            3 => l.quantity.clone(),
            4 => l.unit_price.map(amount).unwrap_or_default(),
            5 => l.total.map(amount).unwrap_or_default(),
            _ => String::new(),
        }
    }
}

fn draw_product_row(cmds: &mut Vec<String>, top: f64, idx: usize, doc: &DocumentPdfInput, line: Option<&DocumentPdfLine>, cols: &[Col]) {
    let h = 20.0;
    let bottom = top - h;
    draw_rect_fill(cmds, MARGIN, bottom, CONTENT_W, h, if idx % 2 == 0 { (1.0,1.0,1.0) } else { LIGHT });
    for i in 1..cols.len() { draw_line(cmds, cols[i].x, bottom, cols[i].x, top, BORDER, 0.4); }
    draw_line(cmds, MARGIN, bottom, RIGHT, bottom, BORDER, 0.4);
    // N°
    let no = format!("{}", idx + 1);
    let tw = super::encoding_and_layout::measure_text_width(&no, 6.5, false);
    draw_text(cmds, cols[0].x + (cols[0].w - tw)/2.0, top - 13.0, &no, 6.5, false, GRAY);
    for (ci, c) in cols.iter().enumerate().skip(1) {
        let txt = cell_text(doc, line, ci);
        if txt.is_empty() { continue; }
        let wrapped = wrap_text(&txt, c.w - 6.0, 6.2, ci == 1);
        let t = wrapped.first().cloned().unwrap_or_default();
        if c.align_right { draw_text_right(cmds, c.x + c.w - 4.0, top - 13.0, &t, 6.2, ci == 5, NAVY); }
        else if c.align_center { let tw = super::encoding_and_layout::measure_text_width(&t, 6.2, false); draw_text(cmds, c.x + (c.w - tw)/2.0, top - 13.0, &t, 6.2, false, NAVY); }
        else { draw_text(cmds, c.x + 4.0, top - 13.0, &t, 6.2, ci == 1, NAVY); }
    }
}

fn draw_packaging_table(cmds: &mut Vec<String>, top: f64, doc: &DocumentPdfInput, max_h: f64) -> f64 {
    let title = if doc.doc_type.contains("RÉCEPTION") {
        "CONTRÔLE DES CASIERS VIDES REMIS"
    } else if is_supplier_doc(doc) {
        "CASIERS VIDES À REMETTRE AU FOURNISSEUR"
    } else {
        "SUIVI DES CASIERS & EMBALLAGES RÉUTILISABLES (CONSIGNES)"
    };
    let headers: Vec<&str> = if doc.doc_type.contains("RÉCEPTION") {
        vec!["Type d'emballage", "Exigé", "Remis", "Écart"]
    } else if is_supplier_doc(doc) {
        vec!["Type d'emballage", "Requis", "Préparé", "Manquant"]
    } else {
        vec!["Type d'emballage", "Sortis", "Rendus", "Solde Dû"]
    };
    let table_w = (CONTENT_W - 10.0) * 0.52;
    draw_text(cmds, MARGIN, top - 2.0, title, 7.2, true, ORANGE);
    let header_top = top - 7.0;
    let hh = 16.0;
    draw_rect_fill(cmds, MARGIN, header_top - hh, table_w, hh, YELLOW_BG);
    let cws = [table_w - 150.0, 50.0, 50.0, 50.0];
    let mut cx = MARGIN;
    for (i, h) in headers.iter().enumerate() {
        let w = cws[i];
        if i > 0 { draw_line(cmds, cx, header_top - hh, cx, header_top, BORDER, 0.4); }
        let tx = if i == 0 { cx + 4.0 } else { cx + w/2.0 - super::encoding_and_layout::measure_text_width(h, 6.0, true)/2.0 };
        draw_text(cmds, tx, header_top - 11.0, h, 6.0, true, YELLOW_TXT);
        cx += w;
    }
    draw_line(cmds, MARGIN, header_top - hh, MARGIN + table_w, header_top - hh, BORDER, 0.5);

    let lines = &doc.packaging_lines;
    let min_rows = if is_supplier_doc(doc) { 3 } else { 4 };
    let display_rows = lines.len().max(min_rows);
    let rh = 16.0;
    let mut y = header_top - hh;
    for i in 0..display_rows {
        if (header_top - (y - rh)) > max_h { break; }
        let bottom = y - rh;
        draw_rect_fill(cmds, MARGIN, bottom, table_w, rh, if i % 2 == 0 { (1.0,1.0,1.0) } else { LIGHT });
        let mut cx = MARGIN;
        for j in 0..4 { if j > 0 { draw_line(cmds, cx, bottom, cx, y, BORDER, 0.35); } cx += cws[j]; }
        draw_line(cmds, MARGIN, bottom, MARGIN + table_w, bottom, BORDER, 0.35);
        if let Some(l) = lines.get(i) {
            let vals: Vec<String> = if doc.doc_type.contains("RÉCEPTION") {
                let issued = l.issued_quantity.unwrap_or(0);
                vec![l.label.clone(), l.expected_quantity.to_string(), issued.to_string(), (l.expected_quantity - issued).max(0).to_string()]
            } else if is_supplier_doc(doc) {
                let issued = l.issued_quantity.unwrap_or(0);
                vec![l.label.clone(), l.expected_quantity.to_string(), issued.to_string(), (l.expected_quantity - issued).max(0).to_string()]
            } else {
                let issued = l.issued_quantity.unwrap_or(l.expected_quantity);
                let returned = l.returned_quantity.unwrap_or(0);
                vec![l.label.clone(), issued.to_string(), returned.to_string(), (issued - returned).max(0).to_string()]
            };
            for (j, v) in vals.iter().enumerate() {
                let cw = cws[j];
                let cell_x = MARGIN + cws[..j].iter().sum::<f64>();
                if j == 0 { draw_text(cmds, cell_x + 4.0, y - 11.0, &wrap_text(v, cw-8.0, 6.0, false).first().cloned().unwrap_or_default(), 6.0, false, NAVY); }
                else { let tw = super::encoding_and_layout::measure_text_width(v, 6.2, j==3); draw_text(cmds, cell_x + (cw-tw)/2.0, y - 11.0, v, 6.2, j==3, NAVY); }
            }
        } else if !is_supplier_doc(doc) {
            // default rows like reference
            let defaults = ["Casier 24 trous (33 cl)", "Casier 12 trous (65 cl)", "Casier 20 trous (50 cl)", "Bouteilles vides (unité)"];
            if let Some(d) = defaults.get(i) {
                draw_text(cmds, MARGIN + 4.0, y - 11.0, d, 6.0, false, GRAY);
            }
        }
        y = bottom;
    }
    draw_rect_fill_stroke(cmds, MARGIN, y, table_w, header_top - y, (0.0,0.0,0.0), BORDER, 0.0); // no-op border fix; borders drawn per row
    draw_line(cmds, MARGIN, header_top, MARGIN, y, BORDER, 0.5);
    draw_line(cmds, MARGIN + table_w, header_top, MARGIN + table_w, y, BORDER, 0.5);
    draw_line(cmds, MARGIN, header_top, MARGIN + table_w, header_top, BORDER, 0.5);

    if !is_supplier_doc(doc) {
        draw_text(cmds, MARGIN, y - 9.0, "* Tout emballage non restitué à la livraison est facturé au tarif de consigne en vigueur.", 5.2, false, GRAY);
        y -= 12.0;
    }
    y
}

fn draw_finance_box(cmds: &mut Vec<String>, top: f64, doc: &DocumentPdfInput) -> f64 {
    let box_w = (CONTENT_W - 10.0) * 0.48;
    let box_x = RIGHT - box_w;
    draw_text(cmds, box_x, top - 2.0, "DÉCOMPTE FINANCIER (EN FCFA)", 7.2, true, ORANGE);
    let header_top = top - 7.0;
    let mut y = header_top;
    let row_h = 15.5;
    let rows = &doc.summary_rows;
    draw_rect_fill_stroke(cmds, box_x, header_top - row_h * rows.len().max(1) as f64, box_w, row_h * rows.len().max(1) as f64, (1.0,1.0,1.0), BORDER, 0.6);
    for (i, r) in rows.iter().enumerate() {
        let bottom = y - row_h;
        let is_net = r.tone.as_deref() == Some("success") || r.label.to_lowercase().contains("net à payer");
        let is_due = r.tone.as_deref() == Some("danger") || r.label.to_lowercase().contains("reste à payer");
        if is_net { draw_rect_fill(cmds, box_x, bottom, box_w, row_h, GREEN); }
        else if is_due { draw_rect_fill(cmds, box_x, bottom, box_w, row_h, RED_BG); }
        draw_line(cmds, box_x, bottom, box_x + box_w, bottom, BORDER, 0.4);
        let tc = if is_net { (1.0,1.0,1.0) } else if is_due { RED_TXT } else { NAVY };
        draw_text(cmds, box_x + 6.0, y - 11.0, &r.label, 6.4, is_net || is_due, tc);
        draw_text_right(cmds, box_x + box_w - 6.0, y - 11.0, &r.value, 6.4, is_net || is_due, tc);
        y = bottom;
    }
    if rows.is_empty() { y -= row_h; }
    y
}

fn draw_payment_block(cmds: &mut Vec<String>, top: f64, doc: &DocumentPdfInput) -> f64 {
    let h = 34.0;
    draw_rect_fill_stroke(cmds, MARGIN, top - h, CONTENT_W, h, (0.985, 0.985, 0.985), BORDER, 0.6);
    draw_text(cmds, MARGIN + 8.0, top - 12.0, "Mode de règlement :", 7.0, true, ORANGE);
    let checks = [("cash","Espèces"),("wave","Wave"),("orange","Orange Money"),("mtn","MTN MoMo"),("moov","Moov Money"),("other","Autre")];
    let mut x = MARGIN + 95.0;
    for (k, label) in checks { draw_checkbox(cmds, x, top - 12.5, method_checked(doc, k), label); x += match k { "cash"=>52.0, "wave"=>50.0, "orange"=>78.0, "mtn"=>66.0, "moov"=>66.0, _=>45.0 }; }
    let refs = doc.external_references.as_deref().filter(|v| !v.is_empty()).map(|v| v.join(" ; ")).unwrap_or_else(|| "........................................................................................".to_string());
    draw_text(cmds, MARGIN + 8.0, top - 27.0, "Réf. Transaction Mobile Money / Observation :", 6.2, true, NAVY);
    let rl = wrap_text(&refs, CONTENT_W - 190.0, 5.8, false);
    if let Some(l) = rl.first() { draw_text(cmds, MARGIN + 185.0, top - 27.0, l, 5.8, false, GRAY); }
    top - h
}

fn draw_signatures(cmds: &mut Vec<String>, top: f64, doc: &DocumentPdfInput) -> f64 {
    let h = 52.0;
    let gap = 10.0;
    let w = (CONTENT_W - gap) / 2.0;
    let (left, right) = if doc.doc_type.contains("RÉCEPTION") {
        ("Visa réceptionnaire dépôt :", "Signature livreur / fournisseur :")
    } else if is_supplier_doc(doc) {
        ("Signature du responsable du sous-dépôt :", "Signature / Visa du fournisseur :")
    } else {
        ("Signature & Cachet du Sous-Dépôt :", "Signature du Client (Bon pour accord & réception) :")
    };
    draw_rect_fill_stroke(cmds, MARGIN, top - h, w, h, (1.0,1.0,1.0), BORDER, 0.6);
    draw_rect_fill_stroke(cmds, MARGIN + w + gap, top - h, w, h, (1.0,1.0,1.0), BORDER, 0.6);
    draw_text(cmds, MARGIN + 8.0, top - 12.0, left, 6.8, true, NAVY);
    draw_text(cmds, MARGIN + w + gap + 8.0, top - 12.0, right, 6.4, true, NAVY);
    top - h
}

fn draw_footer(cmds: &mut Vec<String>, doc: &DocumentPdfInput) {
    let y = 42.0;
    draw_line(cmds, MARGIN, y + 8.0, RIGHT, y + 8.0, BORDER, 0.5);
    let footer = if doc.doc_type.contains("RÉCEPTION") {
        "Bon de réception fournisseur — la validation déclenche le mouvement de stock réel. L'impression ne rejoue pas la réception."
    } else if is_supplier_doc(doc) {
        "Bon de commande fournisseur — document d'approvisionnement. La réception physique fait foi pour l'entrée en stock."
    } else {
        "Merci pour votre confiance ! Veuillez vérifier vos quantités et emballages avant de quitter le dépôt."
    };
    let fl = wrap_text(footer, CONTENT_W, 6.0, false);
    if let Some(l) = fl.first() {
        let tw = super::encoding_and_layout::measure_text_width(l, 6.0, false);
        draw_text(cmds, MARGIN + (CONTENT_W - tw)/2.0, y, l, 6.0, false, GRAY);
    }
}

pub fn render_order_receipt_pdf(company: &AppSettingsDto, doc: &DocumentPdfInput) -> Vec<u8> {
    render_commercial_document_pdf(company, doc)
}

pub fn render_commercial_document_pdf(company: &AppSettingsDto, doc: &DocumentPdfInput) -> Vec<u8> {
    let logo = doc.company_logo_jpeg.as_deref().and_then(decode_logo_jpeg);
    let mut pages: Vec<Vec<String>> = Vec::new();
    let mut y = PAGE_H - MARGIN;
    start_page(&mut pages, &mut y);

    draw_brand_header(pages.last_mut().unwrap(), company, doc, logo.as_ref(), true);
    let after_parties = draw_party_boxes(pages.last_mut().unwrap(), doc, 698.0);
    let table_top = after_parties - 14.0;
    draw_text(pages.last_mut().unwrap(), MARGIN, table_top + 2.0, if doc.doc_type.contains("RÉCEPTION") { "CONTRÔLE DES PRODUITS REÇUS" } else if is_supplier_doc(doc) { "PRODUITS COMMANDÉS" } else { "DÉTAIL DES BOISSONS COMMANDÉES" }, 7.5, true, ORANGE);

    let cols = product_columns(doc);
    let header_y = table_top - 4.0;
    draw_table_header(pages.last_mut().unwrap(), header_y, &cols);
    let mut row_y = header_y - 22.0;
    let min_rows = if is_supplier_doc(doc) { 8usize } else { 10usize };
    let total_rows = doc.lines.len().max(min_rows);

    let mut i = 0usize;
    while i < total_rows {
        if row_y - 20.0 < 170.0 && i < total_rows {
            draw_footer(pages.last_mut().unwrap(), doc);
            start_page(&mut pages, &mut y);
            draw_brand_header(pages.last_mut().unwrap(), company, doc, logo.as_ref(), false);
            let cont_top = PAGE_H - 58.0;
            draw_text(pages.last_mut().unwrap(), MARGIN, cont_top, "SUITE DU TABLEAU", 7.5, true, ORANGE);
            let hy = cont_top - 6.0;
            draw_table_header(pages.last_mut().unwrap(), hy, &cols);
            row_y = hy - 22.0;
        }
        draw_product_row(pages.last_mut().unwrap(), row_y, i, doc, doc.lines.get(i), &cols);
        row_y -= 20.0;
        i += 1;
    }

    // Bottom sections: packaging + finance
    let bottom_needed = 220.0;
    if row_y - bottom_needed < 50.0 {
        draw_footer(pages.last_mut().unwrap(), doc);
        start_page(&mut pages, &mut y);
        draw_brand_header(pages.last_mut().unwrap(), company, doc, logo.as_ref(), false);
        row_y = PAGE_H - 58.0;
    }
    let section_top = row_y - 10.0;
    let pack_bottom = draw_packaging_table(pages.last_mut().unwrap(), section_top, doc, 120.0);
    let fin_bottom = draw_finance_box(pages.last_mut().unwrap(), section_top, doc);
    let mut next_y = pack_bottom.min(fin_bottom) - 10.0;

    if next_y - 40.0 < 70.0 {
        draw_footer(pages.last_mut().unwrap(), doc);
        start_page(&mut pages, &mut y);
        draw_brand_header(pages.last_mut().unwrap(), company, doc, logo.as_ref(), false);
        next_y = PAGE_H - 58.0;
    }
    if !is_supplier_doc(doc) || !doc.payments.as_deref().unwrap_or(&[]).is_empty() || doc.planned_payment_method.is_some() || doc.planned_payment_channel.is_some() {
        next_y = draw_payment_block(pages.last_mut().unwrap(), next_y, doc) - 8.0;
    }
    if let Some(notes) = doc.notes.as_deref().filter(|s| !s.trim().is_empty()) {
        if next_y - 24.0 < 70.0 {
            draw_footer(pages.last_mut().unwrap(), doc);
            start_page(&mut pages, &mut y);
            draw_brand_header(pages.last_mut().unwrap(), company, doc, logo.as_ref(), false);
            next_y = PAGE_H - 58.0;
        }
        draw_rect_fill_stroke(pages.last_mut().unwrap(), MARGIN, next_y - 20.0, CONTENT_W, 20.0, (1.0,1.0,1.0), BORDER, 0.5);
        draw_text(pages.last_mut().unwrap(), MARGIN + 6.0, next_y - 13.0, &format!("Observations : {}", wrap_text(notes, CONTENT_W - 80.0, 6.0, false).first().cloned().unwrap_or_default()), 6.0, false, NAVY);
        next_y -= 28.0;
    }
    if next_y - 60.0 < 55.0 {
        draw_footer(pages.last_mut().unwrap(), doc);
        start_page(&mut pages, &mut y);
        draw_brand_header(pages.last_mut().unwrap(), company, doc, logo.as_ref(), false);
        next_y = PAGE_H - 58.0;
    }
    let _ = draw_signatures(pages.last_mut().unwrap(), next_y, doc);
    draw_footer(pages.last_mut().unwrap(), doc);

    assemble_pdf_bytes(&pages, logo.as_ref())
}
