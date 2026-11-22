import type {
  AppSettings,
  CustomerOrderDetail,
  CustomerOrderReceiptSnapshot,
  PaymentReceiptSnapshot,
  PurchaseDocumentSnapshot,
  PurchaseOrder,
  PurchaseReceipt,
  PurchaseReceiptSnapshot,
} from '../src/types/erp.ts';
import { store, nextId } from './store.ts';
import { nowIso, type PaymentRecord } from './types.ts';

export interface SnapshotActor {
  userId?: string;
  displayName?: string;
  role?: string;
}

export function formatFcfaSpace(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return rounded < 0 ? `- ${grouped} FCFA` : `${grouped} FCFA`;
}

export function formatQtyDisplay(milli: number): string {
  const whole = milli / 1000;
  if (Number.isInteger(whole)) return String(whole);
  return whole.toFixed(3).replace(/\.?0+$/, '');
}

function requestedUnitLabel(unit: string): string {
  switch (unit) {
    case 'unit':
      return 'Unité';
    case 'bottle':
      return 'Bouteille';
    case 'can':
      return 'Canette';
    case 'half_crate':
      return 'Demi-casier';
    case 'crate':
      return 'Casier';
    case 'pack':
      return 'Pack';
    case 'carton':
      return 'Carton';
    case 'pallet':
      return 'Palette';
    case 'custom':
      return 'Conditionnement personnalisé';
    default:
      return unit;
  }
}

export function buildOrderReceiptSnapshotPayload(params: {
  detail: CustomerOrderDetail;
  actor: SnapshotActor;
  version: number;
  receiptNumber: string;
  issuedAt: string;
  revisionReason?: string | null;
  companyOverride?: AppSettings;
  supersedesReceiptNumber?: string | null;
}) {
  const { detail, actor, version, receiptNumber, issuedAt, revisionReason = null, companyOverride, supersedesReceiptNumber = null } = params;
  const order = detail.order;
  const company = companyOverride ?? store.settings;
  const client = store.clients.find((c) => c.id === order.customer_id);
  const orderPayments = store.payments.filter((p) => p.order_id === order.id);

  const partyDetailsParts = [client ? `Code : ${client.code}` : null];
  if (client?.establishment_name?.trim()) partyDetailsParts.push(`Étab. : ${client.establishment_name.trim()}`);
  if (client?.category?.trim()) partyDetailsParts.push(`Catégorie : ${client.category.trim()}`);
  if (client?.phone?.trim()) partyDetailsParts.push(`Tél. : ${client.phone.trim()}`);
  if (client?.address?.trim()) partyDetailsParts.push(`Adresse : ${client.address.trim()}`);
  const locParts = [client?.commune, client?.quartier, client?.city]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  const customerLocation = locParts.length > 0 ? locParts.join(' / ') : client?.address?.trim() || null;

  const pdfLines = detail.lines.map((line) => {
    const unitLabel = requestedUnitLabel(line.requested_unit);
    const perUnit = line.base_quantity > 0 && line.requested_quantity > 0
      ? Math.round(line.base_quantity / line.requested_quantity)
      : 1;
    const condLabel = perUnit > 1 ? `${unitLabel} (${perUnit})` : unitLabel;
    return {
      label: `${line.product_name} · ${line.variant_name}`,
      sublabel: `Équiv. : ${line.base_quantity} ${line.base_unit}${line.notes ? ` · ${line.notes}` : ''}`,
      quantity: String(line.requested_quantity),
      discount: line.discount_xof,
      unitPrice: line.unit_price_xof,
      total: line.line_total_xof,
      packagingInfo: condLabel,
    };
  });

  const issued = ['delivered', 'invoiced', 'paid'].includes(order.status);
  const pdfPackagingLines = detail.allocations.map((alloc) => ({
    label: `${alloc.packaging_name} (cap. ${alloc.capacity})`,
    kind: 'other',
    expectedQuantity: alloc.quantity,
    issuedQuantity: issued ? alloc.quantity : null,
    returnedQuantity: alloc.returned_quantity,
    unitDepositXof: alloc.is_consigned === 1 ? alloc.deposit_amount_xof : null,
    statusLabel: alloc.is_consigned === 1 ? 'Consigné — suivi distinct des boissons' : 'Emballage non consigné',
    detail: `Fourni par : ${alloc.provided_by ?? 'SOUS-DÉPÔT'}`,
    amount: alloc.is_consigned === 1 ? alloc.quantity * alloc.deposit_amount_xof : null,
  }));

  const deliveryFee = order.delivery_fee_xof ?? 0;
  const remainingToPay = Math.max(0, order.total_to_collect_xof - order.paid_xof);
  const summaryRows = [
    { label: 'Total Liquide (Boissons)', value: formatFcfaSpace(order.subtotal_xof), bold: false, tone: null },
    { label: '(+) Consignes emballages', value: formatFcfaSpace(order.deposit_due_xof), bold: false, tone: 'warning' },
    { label: '(+) Frais de livraison', value: formatFcfaSpace(deliveryFee), bold: false, tone: null },
    { label: '(-) Remise accordée', value: formatFcfaSpace(-order.discount_xof), bold: false, tone: null },
    ...(order.tax_xof > 0
      ? [{ label: '(+) Taxes', value: formatFcfaSpace(order.tax_xof), bold: false, tone: null }]
      : []),
    { label: 'NET À PAYER (FCFA)', value: formatFcfaSpace(order.total_to_collect_xof), bold: true, tone: 'success' },
    { label: 'Montant Versé (Avance / Cash)', value: formatFcfaSpace(-order.paid_xof), bold: false, tone: null },
    { label: 'RESTE À PAYER', value: formatFcfaSpace(remainingToPay), bold: true, tone: 'danger' },
  ];

  const externalReferences = orderPayments
    .map((p) => p.external_reference?.trim())
    .filter((v): v is string => Boolean(v));

  const flatPayments = orderPayments.flatMap((p) =>
    p.parts.map((part) => ({
      reference: p.reference,
      paymentNote: p.note,
      externalReference: p.external_reference,
      recordedByName: p.recorded_by_name,
      paidAt: p.created_at,
      methodCode: part.method_code,
      methodLabel: part.method_label,
      amountXof: part.amount,
    })),
  );

  const pdfPayments = flatPayments.map((p) => ({
    label: `${p.methodLabel} (${p.methodCode}) · ${p.reference}${p.externalReference ? ` · Txn ${p.externalReference}` : ''}${p.paymentNote ? ` · ${p.paymentNote}` : ''}`,
    amount: p.amountXof,
  }));

  const statusMap: Record<string, string> = {
    draft: 'BROUILLON',
    confirmed: 'CONFIRMÉE',
    delivered: 'LIVRÉE',
    invoiced: 'FACTURÉE',
    paid: 'SOLDÉE',
    cancelled: 'ANNULÉE',
  };
  const statusLabel = statusMap[order.status] ?? order.status;
  const issuerName = actor.displayName ?? 'Propriétaire';
  const issuerRole = actor.role ?? 'owner';
  const isDelivery = order.delivery_mode === 'delivery';

  const noteLines = [
    `Commande source : ${order.order_number}`,
    `Statut de la commande : ${statusLabel}`,
    `Émis par : ${issuerName} (${issuerRole})`,
    revisionReason ? `Motif révision V${version} : ${revisionReason}` : null,
    order.delivery_address ? `Adresse livraison : ${order.delivery_address}` : null,
    order.notes?.trim() || null,
    'Les consignes correspondent à des emballages récupérables, suivies séparément de la valeur des boissons et régularisées selon les retours physiques.',
  ].filter((v): v is string => Boolean(v));

  const pdfDocument = {
    docType: 'REÇU DE COMMANDE',
    reference: receiptNumber,
    orderReference: order.order_number,
    linkedDocumentRef: order.order_number,
    date: issuedAt,
    statusLabel,
    partyTitle: 'INFORMATIONS CLIENT',
    partyName: client?.name ?? order.customer_name,
    partyDetails: partyDetailsParts.filter(Boolean).join(' · '),
    partyPhone: client?.phone ?? null,
    secondaryPartyTitle: 'LOGISTIQUE & LIVRAISON',
    secondaryPartyName: isDelivery ? 'Livraison à domicile / sur site' : 'Enlèvement au Dépôt',
    secondaryPartyDetails: order.delivery_address || 'Enlèvement sur place (au sous-dépôt)',
    deliveryDate: order.delivery_date,
    cashierName: issuerName,
    plannedPaymentMethod: order.payment_method,
    plannedPaymentChannel: order.planned_payment_channel ?? order.payment_method,
    version,
    issuerRole,
    revisionReason,
    customerEstablishment: client?.establishment_name ?? null,
    customerCategory: client?.category ?? null,
    customerLocation,
    deliveryMode: order.delivery_mode ?? 'pickup',
    courierName: order.courier_name ?? null,
    plannedDeliveryTime: order.planned_delivery_time ?? null,
    deliveryFeeXof: deliveryFee,
    deliveryLandmark: order.delivery_landmark ?? client?.landmark ?? null,
    externalReferences: externalReferences.length > 0 ? externalReferences : null,
    lines: pdfLines,
    packagingLines: pdfPackagingLines,
    summaryRows,
    payments: pdfPayments,
    notes: noteLines.join('\n'),
  };

  return {
    documentType: 'REÇU DE COMMANDE',
    receiptNumber,
    version,
    issuedAt,
    issuer: {
      userId: actor.userId ?? '1',
      name: issuerName,
      role: issuerRole,
    },
    revisionReason,
    supersedesReceiptNumber,
    company,
    customer: client
      ? {
          id: client.id,
          code: client.code,
          name: client.name,
          clientType: client.client_type,
          establishmentName: client.establishment_name ?? null,
          category: client.category ?? null,
          phone: client.phone,
          address: client.address,
          city: client.city,
          commune: client.commune ?? null,
          quartier: client.quartier ?? null,
          landmark: client.landmark ?? null,
          contactPerson: client.contact_person,
        }
      : null,
    orderDetail: detail,
    payments: flatPayments,
    pdfDocument,
  };
}

export function ensureOrderReceiptV1(
  detail: CustomerOrderDetail,
  actor: SnapshotActor,
): CustomerOrderReceiptSnapshot {
  if (
    detail.order.status === 'draft' ||
    detail.order.status === 'cancelled' ||
    detail.order.approval_status === 'pending_owner_approval'
  ) {
    throw Object.assign(
      new Error('Le reçu ne peut être émis qu’après confirmation et avant annulation de la commande.'),
      { status: 400, code: 'VALIDATION_ERROR' },
    );
  }

  const list = store.orderReceipts.get(detail.order.id) ?? [];
  const existingV1 = list.find((r) => r.version === 1);
  if (existingV1) return existingV1;

  const receiptNumber = `REC-${detail.order.order_number}`;
  const issuedAt = nowIso();
  const payload = buildOrderReceiptSnapshotPayload({
    detail,
    actor,
    version: 1,
    receiptNumber,
    issuedAt,
  });

  const snap: CustomerOrderReceiptSnapshot = {
    id: nextId(),
    order_id: detail.order.id,
    version: 1,
    receipt_number: receiptNumber,
    snapshot_json: JSON.stringify(payload),
    issued_at: issuedAt,
    issued_by_user_id: actor.userId ?? '1',
    issued_by_name: actor.displayName ?? 'Propriétaire',
    issued_by_role: actor.role ?? 'owner',
    revision_reason: null,
  };
  list.unshift(snap);
  store.orderReceipts.set(detail.order.id, list);
  return snap;
}

export function ensurePaymentReceiptSnapshot(paymentId: number): PaymentReceiptSnapshot {
  const existing = store.paymentReceipts.get(paymentId);
  if (existing) return existing;

  const pay: PaymentRecord | undefined = store.payments.find((p) => p.id === paymentId);
  if (!pay) {
    throw Object.assign(new Error('Paiement introuvable.'), { status: 404, code: 'NOT_FOUND' });
  }

  const client = pay.client_id ? store.clients.find((c) => c.id === pay.client_id) : null;
  const order = pay.order_id ? store.orders.find((o) => o.order.id === pay.order_id) : null;
  const sale = pay.sale_id ? store.sales.find((s) => s.id === pay.sale_id) : null;

  let afterVal = pay.balance_after_xof;
  let beforeVal = pay.balance_before_xof;
  if (beforeVal == null || afterVal == null) {
    if (order) {
      afterVal = Math.max(0, order.order.total_to_collect_xof - order.order.paid_xof);
      beforeVal = afterVal + pay.total_amount;
    } else if (sale) {
      afterVal = Math.max(0, sale.remaining_amount);
      beforeVal = afterVal + pay.total_amount;
    } else {
      beforeVal = pay.total_amount;
      afterVal = 0;
    }
  }

  const linkedOrderRef = order?.order.order_number ?? null;
  const linkedSaleRef = sale?.reference ?? null;
  const linkedRef = linkedOrderRef ?? linkedSaleRef ?? pay.reference;
  const issuerName = pay.recorded_by_name ?? 'Caissier / Opérateur';
  const issuerRole = pay.recorded_by_role || 'cashier';

  const payerName = client
    ? client.establishment_name?.trim()
      ? `${client.name} (${client.establishment_name.trim()})`
      : client.name
    : 'Client comptoir';
  const payerLocation = client
    ? [client.commune, client.quartier].filter((s) => Boolean(s?.trim())).join(' / ') || null
    : null;
  const partyDetails = [
    client ? `Code : ${client.code}` : null,
    payerLocation,
    client?.phone ? `Tél. : ${client.phone}` : null,
  ].filter(Boolean).join(' · ');

  const kindLabel =
    pay.payment_kind === 'receivable'
      ? 'Règlement de créance client'
      : pay.payment_kind === 'supplier_debt'
        ? 'Règlement dette fournisseur'
        : 'Encaissement client';

  const noteLines = [
    `Nature : ${kindLabel}`,
    `Document lié : ${linkedRef}`,
    `Encaissé par : ${issuerName}`,
    pay.external_reference?.trim()
      ? `Référence transaction externe / Mobile Money : ${pay.external_reference.trim()}`
      : null,
    pay.note?.trim() ? `Observation : ${pay.note.trim()}` : null,
    "Ce reçu atteste uniquement de l'encaissement enregistré à la date et pour le montant ci-dessus.",
  ].filter((v): v is string => Boolean(v));

  const pdfDocument = {
    docType: 'REÇU DE PAIEMENT',
    reference: pay.reference,
    orderReference: linkedOrderRef,
    linkedDocumentRef: linkedRef,
    date: pay.created_at,
    statusLabel: afterVal === 0 ? 'SOLDÉ' : 'ACOMPTE ENCAISSÉ',
    partyTitle: 'PAYEUR / CLIENT',
    partyName: payerName,
    partyDetails: partyDetails || null,
    partyPhone: client?.phone ?? null,
    secondaryPartyTitle: 'DOCUMENT RATTACHÉ',
    secondaryPartyName: linkedRef,
    secondaryPartyDetails: kindLabel,
    cashierName: issuerName,
    issuerRole,
    externalReferences: pay.external_reference?.trim() ? [pay.external_reference.trim()] : null,
    balanceBeforeXof: beforeVal,
    balanceAfterXof: afterVal,
    summaryRows: [
      { label: 'Solde dû avant règlement', value: formatFcfaSpace(beforeVal), bold: false, tone: null },
      { label: 'MONTANT ENCAISSÉ', value: formatFcfaSpace(pay.total_amount), bold: true, tone: 'success' },
      {
        label: 'Solde restant après règlement',
        value: formatFcfaSpace(afterVal),
        bold: true,
        tone: afterVal > 0 ? 'danger' : 'success',
      },
    ],
    payments: pay.parts.map((part) => ({
      label: `${part.method_label} (${part.method_code})${pay.external_reference?.trim() ? ` · Réf. ${pay.external_reference.trim()}` : ''}`,
      amount: part.amount,
    })),
    notes: noteLines.join('\n'),
  };

  const payload = {
    documentType: 'REÇU DE PAIEMENT',
    receiptNumber: pay.reference,
    version: 1,
    issuedAt: pay.created_at,
    issuer: {
      userId: pay.recorded_by_user_id ?? '1',
      name: issuerName,
      role: issuerRole,
    },
    company: store.settings,
    payer: {
      clientId: pay.client_id,
      code: client?.code ?? null,
      name: payerName,
      phone: client?.phone ?? null,
      location: payerLocation,
    },
    linkedDocument: {
      orderId: pay.order_id,
      orderNumber: linkedOrderRef,
      saleId: pay.sale_id,
      saleReference: linkedSaleRef,
      reference: linkedRef,
    },
    payment: {
      id: pay.id,
      reference: pay.reference,
      kind: pay.payment_kind,
      totalAmountXof: pay.total_amount,
      externalReference: pay.external_reference,
      note: pay.note,
      parts: pay.parts.map((p) => ({
        methodCode: p.method_code,
        methodLabel: p.method_label,
        amountXof: p.amount,
      })),
    },
    balanceBeforeXof: beforeVal,
    balanceAfterXof: afterVal,
    pdfDocument,
  };

  const snap: PaymentReceiptSnapshot = {
    id: nextId(),
    payment_id: pay.id,
    version: 1,
    receipt_number: pay.reference,
    snapshot_json: JSON.stringify(payload),
    issued_at: pay.created_at,
    issued_by_user_id: pay.recorded_by_user_id ?? '1',
    issued_by_name: issuerName,
    issued_by_role: issuerRole,
  };
  store.paymentReceipts.set(pay.id, snap);
  return snap;
}

export function persistPurchaseDocumentSnapshot(
  po: PurchaseOrder,
  version: number,
  actor: SnapshotActor,
  revisionReason?: string | null,
): PurchaseDocumentSnapshot {
  const linesSubtotal = po.lines.reduce((s, l) => s + l.line_total, 0);
  const discount = po.discount_xof ?? 0;
  const tax = po.tax_xof ?? 0;
  const extraFees = po.extra_fees_xof ?? 0;
  const paidDeposit = po.paid_deposit_xof ?? 0;
  const issuedAt = nowIso();
  const issuerName = actor.displayName ?? po.created_by_name ?? 'Responsable Achats';
  const issuerRole = actor.role ?? 'owner';

  const summaryRows = [
    { label: 'Sous-total marchandises', value: formatFcfaSpace(linesSubtotal), bold: false, tone: null },
    ...(discount > 0 ? [{ label: '(-) Remise fournisseur', value: formatFcfaSpace(-discount), bold: false, tone: null }] : []),
    ...(tax > 0 ? [{ label: '(+) Taxes / TVA', value: formatFcfaSpace(tax), bold: false, tone: null }] : []),
    ...(extraFees > 0 ? [{ label: '(+) Frais accessoires / Transport', value: formatFcfaSpace(extraFees), bold: false, tone: null }] : []),
    { label: 'NET COMMANDE FOURNISSEUR', value: formatFcfaSpace(po.total_amount), bold: true, tone: 'success' },
    ...(paidDeposit > 0 ? [{ label: 'Avance / Acompte versé', value: formatFcfaSpace(paidDeposit), bold: false, tone: null }] : []),
  ];

  const pdfDocument = {
    docType: 'BON DE COMMANDE FOURNISSEUR',
    reference: po.reference,
    orderReference: po.reference,
    linkedDocumentRef: po.reference,
    date: po.created_at,
    deliveryDate: po.expected_date,
    statusLabel: po.status === 'cancelled' ? 'ANNULÉE' : po.status === 'received' ? 'REÇUE' : po.status === 'partial' ? 'PARTIELLE' : 'CONFIRMÉE',
    partyTitle: 'FOURNISSEUR',
    partyName: po.supplier_name,
    partyDetails: [
      `Code : ${po.supplier_code}`,
      po.supplier_phone ? `Tél. : ${po.supplier_phone}` : null,
      po.supplier_address ? `Adresse : ${po.supplier_address}` : null,
    ].filter(Boolean).join(' · '),
    partyPhone: po.supplier_phone ?? null,
    secondaryPartyTitle: 'LIVRAISON & CONDITIONS',
    secondaryPartyName: po.delivery_address ?? store.settings.address ?? 'Au Dépôt Principal',
    secondaryPartyDetails: po.payment_terms_label ?? 'Conditions standard fournisseur',
    cashierName: issuerName,
    version,
    issuerRole,
    revisionReason: revisionReason ?? null,
    paymentTermsLabel: po.payment_terms_label ?? null,
    commercialConditions: po.commercial_conditions ?? null,
    lines: po.lines.map((l) => ({
      label: `${l.product_name} (${l.packaging_name})`,
      sublabel: `1 ${l.packaging_name} = ${formatQtyDisplay(l.coefficient_milli)} ${l.base_unit}`,
      quantity: `${formatQtyDisplay(l.ordered_quantity_milli)} ${l.packaging_name}`,
      unitPrice: l.unit_price,
      total: l.line_total,
      packagingInfo: l.packaging_name,
    })),
    packagingLines: po.packaging_requirements.map((r) => ({
      label: `${r.name} (${r.code})`,
      kind: r.kind,
      expectedQuantity: r.required_pieces,
      issuedQuantity: null,
      returnedQuantity: null,
      statusLabel: 'Emballages vides à préparer pour remise fournisseur au REC',
      detail: `${r.pieces_per_pack} pièce(s) / unité commandée`,
      amount: null,
    })),
    summaryRows,
    notes: [po.commercial_conditions, po.notes].filter(Boolean).join('\n') || null,
  };

  const payload = {
    documentType: 'BON DE COMMANDE FOURNISSEUR',
    documentNumber: po.reference,
    version,
    issuedAt,
    issuer: { userId: actor.userId ?? '1', name: issuerName, role: issuerRole },
    revisionReason: revisionReason ?? null,
    company: store.settings,
    purchaseOrder: po,
    pdfDocument,
  };

  const snap: PurchaseDocumentSnapshot = {
    id: nextId(),
    purchase_order_id: po.id,
    version,
    document_number: po.reference,
    snapshot_json: JSON.stringify(payload),
    issued_at: issuedAt,
    issued_by_user_id: actor.userId ?? '1',
    issued_by_name: issuerName,
    issued_by_role: issuerRole,
    revision_reason: revisionReason ?? null,
  };
  const existing = store.purchaseDocumentSnapshots.get(po.id) ?? [];
  existing.unshift(snap);
  store.purchaseDocumentSnapshots.set(po.id, existing);
  return snap;
}

export function persistPurchaseReceiptSnapshot(
  po: PurchaseOrder,
  receipt: PurchaseReceipt,
  actor: SnapshotActor,
): PurchaseReceiptSnapshot {
  const statusLabel =
    receipt.status === 'discrepancy'
      ? 'RÉCEPTION AVEC ÉCART'
      : receipt.status === 'partial'
        ? 'RÉCEPTION PARTIELLE'
        : 'RÉCEPTION COMPLÈTE';

  const issuerName = receipt.received_by_name ?? actor.displayName ?? 'Réceptionnaire Dépôt';
  const issuerRole = actor.role ?? 'manager';

  const pdfDocument = {
    docType: 'BON DE RÉCEPTION FOURNISSEUR',
    reference: receipt.reference,
    orderReference: po.reference,
    linkedDocumentRef: po.reference,
    date: receipt.created_at,
    statusLabel,
    partyTitle: 'FOURNISSEUR',
    partyName: po.supplier_name,
    partyDetails: [
      `Code : ${po.supplier_code}`,
      po.supplier_phone ? `Tél. : ${po.supplier_phone}` : null,
      po.supplier_address ? `Adresse : ${po.supplier_address}` : null,
    ].filter(Boolean).join(' · '),
    partyPhone: po.supplier_phone ?? null,
    secondaryPartyTitle: "COMMANDE D'ORIGINE & CONTRÔLE",
    secondaryPartyName: `Bon de commande ${po.reference}`,
    secondaryPartyDetails: `Réceptionné par : ${issuerName}`,
    cashierName: issuerName,
    version: 1,
    issuerRole,
    lines: receipt.lines.map((l) => {
      const poLine = po.lines.find((pl) => pl.id === l.purchase_order_line_id);
      const ordered = poLine ? `${formatQtyDisplay(poLine.ordered_quantity_milli)} ${l.packaging_name}` : '—';
      return {
        label: `${l.product_name} (${l.packaging_name})`,
        sublabel: `Équiv. stock : ${formatQtyDisplay(l.base_quantity_milli)} ${l.base_unit} · Commandé : ${ordered}`,
        quantity: `${formatQtyDisplay(l.received_quantity_milli)} ${l.packaging_name}`,
        unitPrice: l.unit_price,
        total: l.amount,
        orderedQuantity: ordered,
        missingQuantity: (l.missing_quantity_milli ?? 0) > 0 ? formatQtyDisplay(l.missing_quantity_milli ?? 0) : null,
        damagedQuantity: (l.damaged_quantity_milli ?? 0) > 0 ? formatQtyDisplay(l.damaged_quantity_milli ?? 0) : null,
        refusedQuantity: (l.refused_quantity_milli ?? 0) > 0 ? formatQtyDisplay(l.refused_quantity_milli ?? 0) : null,
        discrepancyReason: l.discrepancy_reason,
        packagingInfo: l.packaging_name,
      };
    }),
    packagingLines: receipt.packaging_exchanges.map((ex) => ({
      label: `${ex.name_snapshot} (${ex.code_snapshot})`,
      kind: ex.kind_snapshot,
      expectedQuantity: ex.pieces_issued,
      issuedQuantity: ex.pieces_issued,
      returnedQuantity: null,
      statusLabel: 'Emballages vides remis physiquement au fournisseur',
      detail: 'Échange physique — hors facturation liquide',
      amount: null,
    })),
    summaryRows: [
      { label: 'VALEUR LIQUIDES RÉCEPTIONNÉS', value: formatFcfaSpace(receipt.total_amount), bold: true, tone: 'success' },
      { label: 'Statut du contrôle', value: statusLabel, bold: false, tone: receipt.status === 'discrepancy' ? 'danger' : null },
    ],
    notes: receipt.notes,
  };

  const payload = {
    documentType: 'BON DE RÉCEPTION FOURNISSEUR',
    documentNumber: receipt.reference,
    version: 1,
    issuedAt: receipt.created_at,
    issuer: { userId: actor.userId ?? '1', name: issuerName, role: issuerRole },
    company: store.settings,
    orderReference: po.reference,
    receipt,
    pdfDocument,
  };

  const snap: PurchaseReceiptSnapshot = {
    id: nextId(),
    receipt_id: receipt.id,
    purchase_order_id: po.id,
    version: 1,
    document_number: receipt.reference,
    snapshot_json: JSON.stringify(payload),
    issued_at: receipt.created_at,
    issued_by_user_id: actor.userId ?? '1',
    issued_by_name: issuerName,
    issued_by_role: issuerRole,
  };
  store.purchaseReceiptSnapshots.set(receipt.id, [snap]);
  return snap;
}
