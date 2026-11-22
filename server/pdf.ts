import type { AppSettings } from '../src/types/erp.ts';

function escapePdfText(input: string): string {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ');
  return normalized.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ` ${w}`;
    } else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function formatMoney(v: unknown): string {
  if (v == null || v === '') return '0 FCFA';
  const num = Number(v);
  if (!Number.isFinite(num)) return String(v);
  const rounded = Math.round(num);
  const abs = Math.abs(rounded).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return rounded < 0 ? `- ${grouped} FCFA` : `${grouped} FCFA`;
}

function formatDateTimeFr(iso: string): { dateStr: string; timeStr: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { dateStr: iso.slice(0, 10), timeStr: '' };
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return { dateStr: `${dd}/${mm}/${yyyy}`, timeStr: `${hh} h ${mi}` };
}

function resolveCompany(input: string | Partial<AppSettings>): Partial<AppSettings> {
  if (typeof input === 'string') {
    return { company_name: input };
  }
  return input ?? { company_name: 'DEPOTPRO' };
}

function renderCiOrderReceiptPdf(
  doc: Record<string, unknown>,
  company: Partial<AppSettings>,
): string[] {
  const pages: string[] = [];
  const reference = String(doc.reference || 'REC-CMD');
  const dateRaw = String(doc.date || new Date().toISOString());
  const { dateStr, timeStr } = formatDateTimeFr(dateRaw);
  const cashierName = String(doc.cashierName || 'Caissier(ère)');
  const version = Number(doc.version ?? 1);

  const companyName = (company.company_name || 'NOM DU SOUS-DÉPÔT DE BOISSONS').toUpperCase();
  const activity =
    company.business_activity || 'Distribution & Vente de Boissons (Gros / Demi-Gros / Détail)';
  const locationLine =
    [company.commune, company.quartier, company.city].filter(Boolean).join(' / ') ||
    company.address ||
    'Abidjan';
  const phoneLine = [company.phone, company.whatsapp].filter(Boolean).join(' / ') || '+225';
  const legalLine = `RCCM : ${company.rccm || '—'}  |  NCC : ${company.ncc || '—'}`;

  const partyName = String(doc.partyName || 'Client');
  const est = doc.customerEstablishment ? ` (${String(doc.customerEstablishment)})` : '';
  const cat = doc.customerCategory ? String(doc.customerCategory) : 'Maquis / Cave / Particulier';
  const phone = doc.partyPhone ? String(doc.partyPhone) : '—';
  const loc = doc.customerLocation
    ? String(doc.customerLocation)
    : doc.deliveryLandmark
      ? String(doc.deliveryLandmark)
      : '—';
  const landmark = doc.deliveryLandmark ? ` · Repère : ${String(doc.deliveryLandmark)}` : '';

  const deliveryMode = String(doc.deliveryMode || 'pickup');
  const isDelivery = deliveryMode === 'delivery';
  const courierName = doc.courierName ? String(doc.courierName) : '—';
  const plannedTime = doc.plannedDeliveryTime
    ? String(doc.plannedDeliveryTime)
    : doc.deliveryDate
      ? String(doc.deliveryDate)
      : 'Immédiate / Au dépôt';

  const lines = Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>) : [];
  const packagingLines = Array.isArray(doc.packagingLines)
    ? (doc.packagingLines as Array<Record<string, unknown>>)
    : [];
  const summaryRows = Array.isArray(doc.summaryRows)
    ? (doc.summaryRows as Array<Record<string, unknown>>)
    : [];
  const extRefs = Array.isArray(doc.externalReferences)
    ? (doc.externalReferences as unknown[]).map(String)
    : [];
  const plannedChannel = String(doc.plannedPaymentChannel || doc.plannedPaymentMethod || 'cash');

  const ops: string[] = [];
  const text = (x: number, y: number, s: string, size = 9, bold = false, rgb = '0.07 0.09 0.13') => {
    ops.push(`BT ${bold ? '/F2' : '/F1'} ${size} Tf ${rgb} rg ${x} ${y} Td (${escapePdfText(s)}) Tj ET`);
  };
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    opts?: { fill?: string; stroke?: string; lw?: number; dash?: string },
  ) => {
    ops.push('q');
    if (opts?.lw) ops.push(`${opts.lw} w`);
    if (opts?.dash) ops.push(`${opts.dash} d`);
    if (opts?.fill && opts?.stroke) {
      ops.push(`${opts.fill} rg ${opts.stroke} RG ${x} ${y} ${w} ${h} re B`);
    } else if (opts?.fill) {
      ops.push(`${opts.fill} rg ${x} ${y} ${w} ${h} re f`);
    } else if (opts?.stroke) {
      ops.push(`${opts.stroke} RG ${x} ${y} ${w} ${h} re S`);
    }
    ops.push('Q');
  };
  const lineH = (x1: number, y: number, x2: number, stroke = '0.82 0.85 0.89', lw = 0.7) => {
    ops.push(`q ${lw} w ${stroke} RG ${x1} ${y} m ${x2} ${y} l S Q`);
  };
  const checkbox = (x: number, y: number, checked: boolean) => {
    rect(x, y, 8, 8, { stroke: '0.2 0.25 0.33', lw: 0.9 });
    if (checked) {
      ops.push(`q 1.2 w 0.02 0.47 0.34 RG ${x + 1.5} ${y + 4} m ${x + 3.5} ${y + 1.8} l ${x + 6.8} ${y + 6.5} l S Q`);
    }
  };

  // --- HEADER ---
  rect(36, 732, 92, 74, { stroke: '0.6 0.65 0.72', lw: 1, dash: '[3 2] 0' });
  text(52, 773, 'EMPLACEMENT', 8, true, '0.4 0.45 0.52');
  text(68, 762, 'LOGO', 8, true, '0.4 0.45 0.52');
  text(48, 750, '(Cachet / Visuel)', 7, false, '0.45 0.5 0.57');

  text(140, 792, companyName.slice(0, 34), 13, true, '0.71 0.33 0.04');
  text(140, 777, `Activite : ${activity.slice(0, 52)}`, 8, false, '0.15 0.2 0.28');
  text(140, 765, `Commune / Quartier : ${locationLine.slice(0, 44)}`, 8, false, '0.15 0.2 0.28');
  text(140, 753, `Tel / WhatsApp : ${phoneLine.slice(0, 44)}`, 8, false, '0.15 0.2 0.28');
  text(140, 741, legalLine.slice(0, 52), 8, false, '0.25 0.3 0.38');

  // Right Green Box: RECU DE COMMANDE
  rect(386, 732, 173, 74, { fill: '0.94 0.99 0.96', stroke: '0.02 0.47 0.34', lw: 1.4 });
  text(406, 790, version > 1 ? `RECU DE COMMANDE (V${version})` : 'RECU DE COMMANDE', 11, true, '0.02 0.47 0.34');
  text(394, 774, `N° Recu : ${reference}`, 8.5, true, '0.07 0.09 0.13');
  text(394, 761, `Date : ${dateStr}   Heure : ${timeStr}`, 8.5, false, '0.15 0.2 0.28');
  text(394, 748, `Caissier(ere) : ${cashierName.slice(0, 26)}`, 8.5, false, '0.15 0.2 0.28');

  lineH(36, 722, 559, '0.85 0.47 0.04', 1.5);

  // --- 2 PARTY / LOGISTICS BOXES ---
  rect(36, 636, 256, 78, { stroke: '0.78 0.82 0.86', lw: 0.8 });
  text(44, 700, 'INFORMATIONS DU CLIENT', 8.5, true, '0.71 0.33 0.04');
  text(44, 686, `Nom / Etab. : ${(partyName + est).slice(0, 40)}`, 8.5, true);
  text(44, 673, `(${cat.slice(0, 46)})`, 7.5, false, '0.4 0.45 0.52');
  text(44, 659, `Contact : ${phone.slice(0, 38)}`, 8.5, false);
  text(44, 646, `Quartier / Repere : ${(loc + landmark).slice(0, 38)}`, 8, false);

  rect(303, 636, 256, 78, { stroke: '0.78 0.82 0.86', lw: 0.8 });
  text(311, 700, 'MODE DE RETRAIT / LIVRAISON', 8.5, true, '0.71 0.33 0.04');
  checkbox(311, 684, !isDelivery);
  text(323, 685, 'Enlevement sur place (au sous-depot)', 8.5, !isDelivery);
  checkbox(311, 670, isDelivery);
  text(323, 671, 'Livraison a domicile / sur site', 8.5, isDelivery);
  text(311, 656, `Livreur / Tricycle : ${courierName.slice(0, 32)}`, 8, false);
  text(311, 644, `Date / Heure prevue : ${plannedTime.slice(0, 30)}`, 8, false);

  // --- 6-COL PRODUCT TABLE ---
  const rowCountPage1 = Math.max(10, Math.min(lines.length, 10));
  const rowH = 19;
  const tableTop = 626;
  const headerH = 22;

  rect(36, tableTop - headerH, 523, headerH, { fill: '0.12 0.16 0.23' });
  text(42, tableTop - 14, 'N°', 8, true, '1 1 1');
  text(68, tableTop - 14, 'DESIGNATION DE LA BOISSON & FORMAT', 8, true, '1 1 1');
  text(290, tableTop - 14, 'CONDITIONNEMENT', 8, true, '1 1 1');
  text(388, tableTop - 14, 'QTE', 8, true, '1 1 1');
  text(428, tableTop - 14, 'PU (FCFA)', 8, true, '1 1 1');
  text(492, tableTop - 14, 'TOTAL (FCFA)', 8, true, '1 1 1');

  for (let i = 0; i < rowCountPage1; i++) {
    const ry = tableTop - headerH - (i + 1) * rowH;
    const fill = i % 2 === 1 ? '0.97 0.98 0.99' : '1 1 1';
    rect(36, ry, 523, rowH, { fill, stroke: '0.84 0.87 0.9', lw: 0.5 });
    text(43, ry + 6, String(i + 1), 8, false, '0.35 0.4 0.48');
    const item = lines[i];
    if (item) {
      text(68, ry + 6, String(item.label || '').slice(0, 38), 8.5, true);
      text(290, ry + 6, String(item.packagingInfo || '').slice(0, 17), 8, false);
      text(390, ry + 6, String(item.quantity || ''), 8.5, true);
      text(428, ry + 6, formatMoney(item.unitPrice).replace(' FCFA', ''), 8, false);
      text(492, ry + 6, formatMoney(item.total).replace(' FCFA', ''), 8.5, true);
    }
  }

  let cursorY = tableTop - headerH - rowCountPage1 * rowH - 14;

  // --- CONSIGNMENTS (LEFT) + FINANCIAL SUMMARY (RIGHT) ---
  text(36, cursorY, 'SUIVI DES CASIERS & BOUTEILLES VIDES (CONSIGNES)', 8, true, '0.71 0.33 0.04');
  text(312, cursorY, 'DECOMPTE FINANCIER (EN FCFA)', 8, true, '0.71 0.33 0.04');

  const pkgTop = cursorY - 6;
  const pkgRowsToRender =
    packagingLines.length > 0
      ? packagingLines.slice(0, 5)
      : [
          { label: 'Casier 24 trous (33 cl)', expectedQuantity: '-', returnedQuantity: '-' },
          { label: 'Casier 12 trous (65 cl)', expectedQuantity: '-', returnedQuantity: '-' },
          { label: 'Casier 20 trous (50 cl)', expectedQuantity: '-', returnedQuantity: '-' },
          { label: 'Bouteilles vides (unite)', expectedQuantity: '-', returnedQuantity: '-' },
        ];

  rect(36, pkgTop - 18, 260, 18, { fill: '0.99 0.94 0.87', stroke: '0.84 0.72 0.58', lw: 0.6 });
  text(42, pkgTop - 12, "Type d'emballage", 7.5, true, '0.45 0.25 0.05');
  text(182, pkgTop - 12, 'Sortis', 7.5, true, '0.45 0.25 0.05');
  text(218, pkgTop - 12, 'Rendus', 7.5, true, '0.45 0.25 0.05');
  text(256, pkgTop - 12, 'Solde Du', 7.5, true, '0.45 0.25 0.05');

  pkgRowsToRender.forEach((p, idx) => {
    const py = pkgTop - 18 - (idx + 1) * 18;
    rect(36, py, 260, 18, { fill: '1 1 1', stroke: '0.84 0.87 0.9', lw: 0.5 });
    const sortis = p.expectedQuantity === '-' ? '' : String(p.expectedQuantity ?? 0);
    const rendus = p.returnedQuantity === '-' ? '' : String(p.returnedQuantity ?? 0);
    const solde =
      p.expectedQuantity === '-'
        ? ''
        : String(Math.max(0, Number(p.expectedQuantity ?? 0) - Number(p.returnedQuantity ?? 0)));
    text(42, py + 5, String(p.label || '').slice(0, 26), 7.5, false);
    text(186, py + 5, sortis, 7.5, false);
    text(224, py + 5, rendus, 7.5, false);
    text(262, py + 5, solde, 7.5, true);
  });

  const pkgBottomY = pkgTop - 18 - pkgRowsToRender.length * 18 - 10;
  text(36, pkgBottomY, '* Tout emballage non restitue est facture au tarif de consigne.', 7, false, '0.4 0.45 0.52');

  const finRows = summaryRows.slice(0, 8);
  finRows.forEach((row, idx) => {
    const fy = pkgTop - (idx + 1) * 18;
    const tone = String(row.tone || '');
    const isNet = tone === 'success';
    const isDue = tone === 'danger';
    const fill = isNet ? '0.02 0.47 0.34' : isDue ? '0.99 0.93 0.93' : idx % 2 === 1 ? '0.97 0.98 0.99' : '1 1 1';
    const fg = isNet ? '1 1 1' : isDue ? '0.72 0.11 0.11' : '0.07 0.09 0.13';
    rect(312, fy, 247, 18, { fill, stroke: '0.82 0.85 0.89', lw: 0.6 });
    text(318, fy + 5, String(row.label || '').slice(0, 28), 8, Boolean(row.bold) || isNet || isDue, fg);
    text(466, fy + 5, String(row.value || '').slice(0, 20), 8, Boolean(row.bold) || isNet || isDue, fg);
  });

  const blockBottom = Math.min(pkgBottomY - 8, pkgTop - finRows.length * 18 - 14);

  // --- PAYMENT CHANNELS BAR ---
  rect(36, blockBottom - 36, 523, 36, { fill: '0.97 0.98 0.99', stroke: '0.82 0.85 0.89', lw: 0.7 });
  text(44, blockBottom - 13, 'Mode de reglement :', 8, true);
  const channels = [
    { code: 'cash', label: 'Especes', x: 136 },
    { code: 'wave', label: 'Wave', x: 196 },
    { code: 'orange_money', label: 'Orange Money', x: 244 },
    { code: 'mtn_money', label: 'MTN MoMo', x: 326 },
    { code: 'moov_money', label: 'Moov Money', x: 396 },
    { code: 'other', label: 'Autre', x: 472 },
  ];
  const knownCodes = new Set(['cash', 'wave', 'orange_money', 'mtn_money', 'moov_money']);
  for (const ch of channels) {
    const isChecked =
      ch.code === 'other'
        ? !knownCodes.has(plannedChannel)
        : plannedChannel === ch.code;
    checkbox(ch.x, blockBottom - 15, isChecked);
    text(ch.x + 11, blockBottom - 13, ch.label, 7.5, isChecked);
  }
  const refLine = extRefs.length > 0 ? extRefs.join(' / ') : doc.revisionReason ? `Revision : ${String(doc.revisionReason)}` : '—';
  text(44, blockBottom - 29, `Ref. Transaction Mobile Money / Observation : ${refLine.slice(0, 62)}`, 8, false);

  // --- SIGNATURES ---
  const sigTop = blockBottom - 44;
  rect(36, sigTop - 48, 256, 48, { stroke: '0.78 0.82 0.86', lw: 0.7 });
  text(44, sigTop - 13, 'Signature & Cachet du Sous-Depot :', 8, true);
  text(44, sigTop - 38, `Etabli par : ${cashierName.slice(0, 28)}`, 7.5, false, '0.45 0.5 0.57');

  rect(303, sigTop - 48, 256, 48, { stroke: '0.78 0.82 0.86', lw: 0.7 });
  text(311, sigTop - 13, 'Signature du Client (Bon pour accord & reception) :', 8, true);
  text(311, sigTop - 38, partyName.slice(0, 32), 7.5, false, '0.45 0.5 0.57');

  // --- FOOTER ON PAGE 1 ---
  const footerY = Math.max(24, sigTop - 64);
  lineH(36, footerY + 10, 559, '0.84 0.87 0.9', 0.6);
  text(
    110,
    footerY,
    'Merci pour votre confiance ! Veuillez verifier vos quantites et emballages avant de quitter le depot.',
    7.5,
    false,
    '0.4 0.45 0.52',
  );

  pages.push(ops.join('\n'));

  // Additional pages if more than 10 product lines
  if (lines.length > 10) {
    const remaining = lines.slice(10);
    const perPage = 30;
    for (let offset = 0; offset < remaining.length; offset += perPage) {
      const chunk = remaining.slice(offset, offset + perPage);
      const pOps: string[] = [];
      pOps.push(`BT /F2 11 Tf 0.02 0.47 0.34 rg 36 800 Td (${escapePdfText(`${companyName} - ${reference} (Suite des lignes)`)}) Tj ET`);
      let py = 772;
      pOps.push(`q 0.12 0.16 0.23 rg 36 ${py - 18} 523 20 re f Q`);
      pOps.push(`BT /F2 8 Tf 1 1 1 rg 42 ${py - 11} Td (N°) Tj ET`);
      pOps.push(`BT /F2 8 Tf 1 1 1 rg 68 ${py - 11} Td (DESIGNATION) Tj ET`);
      pOps.push(`BT /F2 8 Tf 1 1 1 rg 290 ${py - 11} Td (COND.) Tj ET`);
      pOps.push(`BT /F2 8 Tf 1 1 1 rg 388 ${py - 11} Td (QTE) Tj ET`);
      pOps.push(`BT /F2 8 Tf 1 1 1 rg 428 ${py - 11} Td (PU FCFA) Tj ET`);
      pOps.push(`BT /F2 8 Tf 1 1 1 rg 492 ${py - 11} Td (TOTAL FCFA) Tj ET`);
      py -= 20;
      chunk.forEach((item, idx) => {
        const num = 10 + offset + idx + 1;
        py -= 20;
        pOps.push(`q 0.85 0.88 0.91 RG 0.5 w 36 ${py} 523 20 re S Q`);
        pOps.push(`BT /F1 8 Tf 0.2 0.25 0.33 rg 43 ${py + 6} Td (${num}) Tj ET`);
        pOps.push(`BT /F2 8.5 Tf 0.07 0.09 0.13 rg 68 ${py + 6} Td (${escapePdfText(String(item.label || '').slice(0, 38))}) Tj ET`);
        pOps.push(`BT /F1 8 Tf 0.07 0.09 0.13 rg 290 ${py + 6} Td (${escapePdfText(String(item.packagingInfo || '').slice(0, 17))}) Tj ET`);
        pOps.push(`BT /F2 8.5 Tf 0.07 0.09 0.13 rg 390 ${py + 6} Td (${escapePdfText(String(item.quantity || ''))}) Tj ET`);
        pOps.push(`BT /F1 8 Tf 0.07 0.09 0.13 rg 428 ${py + 6} Td (${escapePdfText(formatMoney(item.unitPrice).replace(' FCFA', ''))}) Tj ET`);
        pOps.push(`BT /F2 8.5 Tf 0.07 0.09 0.13 rg 492 ${py + 6} Td (${escapePdfText(formatMoney(item.total).replace(' FCFA', ''))}) Tj ET`);
      });
      pages.push(pOps.join('\n'));
    }
  }

  return pages;
}

function renderStandardCommercialPdf(
  doc: Record<string, unknown>,
  company: Partial<AppSettings>,
): string[] {
  const docType = String(doc.docType || 'DOCUMENT COMMERCIAL');
  const reference = String(doc.reference || 'DOC');
  const dateRaw = String(doc.date || new Date().toISOString());
  const { dateStr, timeStr } = formatDateTimeFr(dateRaw);
  const partyTitle = String(doc.partyTitle || 'TIERS');
  const partyName = doc.partyName ? String(doc.partyName) : '—';
  const partyDetails = doc.partyDetails ? String(doc.partyDetails) : '';
  const partyPhone = doc.partyPhone ? String(doc.partyPhone) : '';
  const notes = doc.notes ? String(doc.notes) : '';
  const cashierName = doc.cashierName ? String(doc.cashierName) : '';
  const statusLabel = doc.statusLabel ? String(doc.statusLabel) : '';

  const lines = Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>) : [];
  const packagingLines = Array.isArray(doc.packagingLines)
    ? (doc.packagingLines as Array<Record<string, unknown>>)
    : [];
  const summaryRows = Array.isArray(doc.summaryRows)
    ? (doc.summaryRows as Array<Record<string, unknown>>)
    : [];
  const payments = Array.isArray(doc.payments) ? (doc.payments as Array<Record<string, unknown>>) : [];

  const ops: string[] = [];
  let y = 795;

  const pushText = (x: number, size: number, bold: boolean, txt: string, rgb = '0.07 0.09 0.13') => {
    ops.push(`BT ${bold ? '/F2' : '/F1'} ${size} Tf ${rgb} rg ${x} ${y} Td (${escapePdfText(txt)}) Tj ET`);
  };

  pushText(40, 14, true, (company.company_name || 'DEPOTPRO').toUpperCase(), '0.71 0.33 0.04');
  pushText(340, 12, true, docType.slice(0, 34), '0.02 0.47 0.34');
  y -= 16;
  pushText(
    40,
    8.5,
    false,
    [company.commune, company.quartier, company.city, company.phone].filter(Boolean).join(' · ') || 'Sous-Depot',
    '0.35 0.4 0.48',
  );
  pushText(340, 9.5, true, `N° : ${reference}  (${dateStr} ${timeStr})`, '0.07 0.09 0.13');
  y -= 14;
  if (statusLabel) {
    pushText(340, 8.5, true, `Statut : ${statusLabel}`, '0.02 0.47 0.34');
  }
  if (cashierName) {
    pushText(40, 8.5, false, `Etabli par : ${cashierName}`, '0.25 0.3 0.38');
  }
  y -= 12;
  ops.push(`q 0.85 0.47 0.04 RG 1.2 w 40 ${y} m 555 ${y} l S Q`);
  y -= 16;

  pushText(40, 9, true, `${partyTitle} : ${partyName}${partyPhone ? ` (${partyPhone})` : ''}`);
  y -= 13;
  if (partyDetails) {
    for (const chunk of wrapText(partyDetails, 86)) {
      pushText(40, 8, false, chunk, '0.35 0.4 0.48');
      y -= 11;
    }
  }
  y -= 6;

  if (lines.length > 0) {
    ops.push(`q 0.12 0.16 0.23 rg 40 ${y - 16} 515 18 re f Q`);
    y -= 12;
    pushText(46, 8, true, 'DESIGNATION', '1 1 1');
    pushText(300, 8, true, 'QTE', '1 1 1');
    pushText(390, 8, true, 'PU FCFA', '1 1 1');
    pushText(475, 8, true, 'TOTAL FCFA', '1 1 1');
    y -= 16;

    for (const line of lines.slice(0, 26)) {
      if (y < 140) break;
      pushText(46, 8.5, true, String(line.label || '').slice(0, 44));
      pushText(300, 8.5, false, String(line.quantity || '').slice(0, 14));
      pushText(390, 8.5, false, line.unitPrice != null ? formatMoney(line.unitPrice).replace(' FCFA', '') : '-');
      pushText(475, 8.5, true, line.total != null ? formatMoney(line.total).replace(' FCFA', '') : '-');
      y -= 13;
      if (line.sublabel) {
        pushText(52, 7.5, false, String(line.sublabel).slice(0, 78), '0.4 0.45 0.52');
        y -= 11;
      }
      if (line.discrepancyReason) {
        pushText(52, 7.5, true, `Motif ecart : ${String(line.discrepancyReason).slice(0, 72)}`, '0.72 0.11 0.11');
        y -= 11;
      }
    }
    y -= 8;
  }

  if (packagingLines.length > 0 && y > 130) {
    pushText(40, 8.5, true, 'EMBALLAGES & CONSIGNATIONS', '0.71 0.33 0.04');
    y -= 13;
    for (const p of packagingLines.slice(0, 6)) {
      if (y < 110) break;
      pushText(46, 8, false, `${String(p.label || '')} · Prevu: ${p.expectedQuantity ?? 0} · Remis/Sortis: ${p.issuedQuantity ?? '-'} · Rendus: ${p.returnedQuantity ?? '-'}`);
      y -= 12;
    }
    y -= 6;
  }

  if (payments.length > 0 && y > 110) {
    pushText(40, 8.5, true, 'REGLEMENTS ENREGISTRES', '0.02 0.47 0.34');
    y -= 13;
    for (const pay of payments.slice(0, 6)) {
      pushText(46, 8.5, false, `${String(pay.label || '')} : ${formatMoney(pay.amount)}`);
      y -= 12;
    }
    y -= 6;
  }

  for (const row of summaryRows) {
    if (y < 60) break;
    pushText(310, 9.5, Boolean(row.bold), `${String(row.label || '')} : ${String(row.value || '')}`);
    y -= 14;
  }

  if (notes && y > 55) {
    y -= 6;
    for (const nLine of notes.split('\n').slice(0, 5)) {
      if (y < 40) break;
      pushText(40, 8, false, nLine.slice(0, 92), '0.35 0.4 0.48');
      y -= 11;
    }
  }

  return [ops.join('\n')];
}

export function buildDocumentPdfBytes(
  doc: Record<string, unknown>,
  companyInput: string | Partial<AppSettings>,
): Buffer {
  const company = resolveCompany(companyInput);
  const docType = String(doc.docType || '').toUpperCase();
  const isOrderReceipt =
    docType.includes('REÇU DE COMMANDE') ||
    docType.includes('RECU DE COMMANDE') ||
    docType.includes('ACCUSÉ DE RÉCEPTION');

  const pageStreams = isOrderReceipt
    ? renderCiOrderReceiptPdf(doc, company)
    : renderStandardCommercialPdf(doc, company);

  // Build PDF 1.4 multi-page structure
  // 1: Catalog, 2: Pages, 3: Font Helvetica (/F1), 4: Font Helvetica-Bold (/F2)
  // Then for each page i: Page object (5 + 2*i) and Content object (6 + 2*i)
  const pageObjIds = pageStreams.map((_, i) => 5 + i * 2);
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageStreams.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
  ];

  pageStreams.forEach((stream, i) => {
    const pageId = 5 + i * 2;
    const contentId = 6 + i * 2;
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}
