import type { PrintableDocumentData } from "../../../components/documents/DocumentPrintModal.tsx";
import type {
  AppSettings,
  Client,
  CustomerOrderDetail,
  CustomerOrderReceiptSnapshot,
  PaymentReceiptSnapshot,
} from "../../../types/erp.ts";
import { formatDateTime, formatFcfa, formatQty } from "../../../utils/format.ts";

/* ============================================================================
 * REÇU DE COMMANDE CLIENT (modèle A4 Côte d'Ivoire & snapshots immuables)
 * ============================================================================ */

const STATUS_LABELS: Record<string, string> = {
  draft: "BROUILLON",
  confirmed: "CONFIRMÉE",
  delivered: "LIVRÉE",
  invoiced: "FACTURÉE",
  paid: "SOLDÉE",
  cancelled: "ANNULÉE",
};

const REQUESTED_UNIT_LABELS: Record<string, string> = {
  unit: "Unité",
  bottle: "Bouteille",
  can: "Canette",
  half_crate: "Demi-casier",
  crate: "Casier",
  pack: "Pack",
  carton: "Carton",
  pallet: "Palette",
  custom: "Conditionnement personnalisé",
};

export function buildOrderReceiptDocument(
  order: CustomerOrderDetail,
  client: Client | null,
  agentName: string | null,
  receiptSnapshot?: {
    receiptNumber: string;
    issuedAt: string;
    company?: AppSettings;
    version?: number;
    issuerRole?: string;
    payments?: Array<{
      reference: string;
      paidAt: string;
      methodCode?: string;
      methodLabel: string;
      externalReference?: string | null;
      amountXof: number;
    }>;
    revisionReason?: string | null;
  },
): PrintableDocumentData {
  const { order: o, lines, allocations, links } = order;
  const deliveryFee = o.delivery_fee_xof ?? 0;
  const remainingToPay = Math.max(0, o.total_to_collect_xof - o.paid_xof);
  const paymentStatus =
    o.paid_xof <= 0 ? "NON PAYÉ" : remainingToPay <= 0 ? "SOLDÉ" : "PARTIEL";

  const productLines = lines.map((line) => {
    const unitLabel = REQUESTED_UNIT_LABELS[line.requested_unit] || line.requested_unit;
    const perUnit =
      line.base_quantity > 0 && line.requested_quantity > 0
        ? Math.round(line.base_quantity / line.requested_quantity)
        : 1;
    const assignedPackagings = links
      .filter((link) => link.order_line_id === line.id)
      .map((link) => {
        const allocation = allocations.find((item) => item.id === link.order_packaging_allocation_id);
        return allocation
          ? `${allocation.packaging_name} (${formatQty(link.units_in_packaging)} u.)`
          : null;
      })
      .filter(Boolean);

    return {
      label: `${line.product_name} · ${line.variant_name}`,
      sublabel: [
        `Équiv. : ${formatQty(line.base_quantity)} ${line.base_unit}`,
        assignedPackagings.length ? `Casiers : ${assignedPackagings.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      quantity: `${formatQty(line.requested_quantity)}`,
      packagingInfo:
        perUnit > 1
          ? `${unitLabel} ${perUnit} ${line.base_unit}${perUnit > 1 ? 's' : ''}`
          : unitLabel,
      unitPrice: line.unit_price_xof,
      discount: line.discount_xof,
      total: line.line_total_xof,
    };
  });

  const packagingLines = allocations.map((a) => ({
    label: `${a.packaging_name} (cap. ${formatQty(a.capacity)})`,
    kind: "other" as const,
    expectedQuantity: a.quantity,
    issuedQuantity: ["delivered", "invoiced", "paid"].includes(o.status) ? a.quantity : undefined,
    returnedQuantity: a.returned_quantity,
    unitDepositXof: a.is_consigned ? a.deposit_amount_xof : null,
    statusLabel: a.is_consigned ? "Consigné — retour sous 15 jours" : "Non consigné",
    detail: `Fourni par : ${a.provided_by || "SOUS-DÉPÔT"}`,
    amount: a.is_consigned ? a.quantity * a.deposit_amount_xof : 0,
  }));

  const hasConsignedAllocations = allocations.some((a) => a.is_consigned);
  const returnedPackagingAmount = allocations.reduce(
    (sum, a) => sum + (a.is_consigned ? Math.max(0, a.returned_quantity) * a.deposit_amount_xof : 0),
    0,
  );

  const clientLoc = [client?.commune, client?.quartier, client?.city]
    .filter((s) => Boolean(s?.trim()))
    .join(" / ");

  const clientDetails = client
    ? [
        `Code : ${client.code}`,
        client.establishment_name ? `Étab. : ${client.establishment_name}` : null,
        client.category ? `Cat. : ${client.category}` : null,
        client.phone ? `Tél : ${client.phone}` : null,
        clientLoc || client.address || null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const paymentsList =
    receiptSnapshot?.payments ??
    order.payments?.map((p) => ({
      reference: p.reference,
      paidAt: p.created_at,
      methodCode: p.method_code,
      methodLabel: p.method_label,
      externalReference: p.external_reference,
      amountXof: p.amount_xof,
    })) ??
    [];

  const externalReferences = paymentsList
    .map((p) => p.externalReference?.trim())
    .filter((v): v is string => Boolean(v));

  return {
    docType: "REÇU DE COMMANDE",
    reference: receiptSnapshot?.receiptNumber || o.order_number,
    orderReference: o.order_number,
    linkedDocumentRef: o.order_number,
    date: receiptSnapshot?.issuedAt || o.created_at,
    companySnapshot: receiptSnapshot?.company,
    statusLabel: STATUS_LABELS[o.status] ?? o.status.toUpperCase(),
    version: receiptSnapshot?.version ?? 1,
    issuerRole: receiptSnapshot?.issuerRole ?? null,
    revisionReason: receiptSnapshot?.revisionReason ?? null,
    cashierName: agentName ?? "Caissier / Opérateur",
    plannedPaymentMethod: o.payment_method,
    plannedPaymentChannel: o.planned_payment_channel ?? o.payment_method,
    partyTitle: "INFORMATIONS CLIENT",
    partyName: client?.name || o.customer_name,
    partyDetails: clientDetails,
    partyPhone: client?.phone ?? null,
    customerEstablishment: client?.establishment_name ?? null,
    customerCategory: client?.category ?? null,
    customerLocation: clientLoc || client?.address || null,
    secondaryPartyTitle: "LOGISTIQUE & LIVRAISON",
    secondaryPartyName:
      o.delivery_mode === "delivery" ? "Livraison à Domicile" : "Enlèvement au Dépôt",
    secondaryPartyDetails: o.delivery_address || "Enlèvement sur place (au sous-dépôt)",
    deliveryMode: o.delivery_mode ?? "pickup",
    courierName: o.courier_name ?? null,
    plannedDeliveryTime: o.planned_delivery_time ?? null,
    deliveryFeeXof: deliveryFee,
    deliveryLandmark: o.delivery_landmark ?? client?.landmark ?? null,
    deliveryDate: o.delivery_date,
    externalReferences: externalReferences.length > 0 ? externalReferences : null,
    lines: productLines,
    packagingLines,
    payments: paymentsList.map((payment) => ({
      label: `${payment.methodLabel} · ${payment.reference}${payment.externalReference ? ` · Txn ${payment.externalReference}` : ""} · ${formatDateTime(payment.paidAt)}`,
      amount: payment.amountXof,
    })),
    summaryRows: [
      { label: "Total Liquide (Boissons)", value: formatFcfa(o.subtotal_xof) },
      {
        label: "(+) Consignes emballages",
        value: formatFcfa(o.deposit_due_xof),
        tone: "warning",
      },
      { label: "(+) Frais de livraison", value: formatFcfa(deliveryFee) },
      { label: "(-) Remise accordée", value: `- ${formatFcfa(o.discount_xof)}` },
      ...(o.tax_xof > 0 ? [{ label: "(+) Taxes", value: formatFcfa(o.tax_xof) }] : []),
      {
        label: "NET À PAYER (FCFA)",
        value: formatFcfa(o.total_to_collect_xof),
        bold: true,
        tone: "success",
      },
      {
        label: "Montant Versé (Avance / Cash)",
        value: `- ${formatFcfa(o.paid_xof)}`,
      },
      {
        label: "RESTE À PAYER",
        value: formatFcfa(remainingToPay),
        bold: true,
        tone: "danger",
      },
      ...(hasConsignedAllocations || returnedPackagingAmount > 0
        ? [
            {
              label: "Retour emballages (hors total)",
              value: formatFcfa(returnedPackagingAmount),
              tone: returnedPackagingAmount > 0 ? ("success" as const) : ("default" as const),
            },
          ]
        : []),
    ],
    notes:
      [
        `Commande source : ${o.order_number}`,
        `Statut du paiement : ${paymentStatus}`,
        receiptSnapshot?.revisionReason
          ? `Motif révision : ${receiptSnapshot.revisionReason}`
          : null,
        agentName ? `Émis par : ${agentName}` : null,
        o.notes,
        "Délai de retour des emballages consignés : 15 jours maximum à compter de l’émission. Le montant des retours d’emballages est suivi hors total commande.",
      ]
        .filter(Boolean)
        .join("\n") || null,
  };
}

export function buildOrderReceiptFromSnapshot(
  receipt: CustomerOrderReceiptSnapshot,
): PrintableDocumentData {
  const parsed = JSON.parse(receipt.snapshot_json) as {
    issuedAt?: string;
    version?: number;
    revisionReason?: string | null;
    issuer?: { name?: string; role?: string };
    company?: AppSettings;
    customer?: Partial<Client> & {
      establishmentName?: string | null;
      contactPerson?: string | null;
    };
    orderDetail: CustomerOrderDetail;
    payments?: Array<{
      reference: string;
      paidAt: string;
      methodCode?: string;
      methodLabel: string;
      externalReference?: string | null;
      amountXof: number;
    }>;
    pdfDocument?: PrintableDocumentData;
  };

  if (parsed.pdfDocument) {
    return {
      ...parsed.pdfDocument,
      docType: "REÇU DE COMMANDE",
      companySnapshot: parsed.company,
      cashierName: parsed.pdfDocument.cashierName || parsed.issuer?.name || receipt.issued_by_name,
      version: parsed.version ?? receipt.version,
      revisionReason: parsed.revisionReason ?? receipt.revision_reason ?? null,
    };
  }

  const normalizedClient: Client | null = parsed.customer
    ? ({
        ...parsed.customer,
        establishment_name: parsed.customer.establishmentName ?? parsed.customer.establishment_name ?? null,
        contact_person: parsed.customer.contactPerson ?? parsed.customer.contact_person ?? null,
      } as Client)
    : null;

  return buildOrderReceiptDocument(
    parsed.orderDetail,
    normalizedClient,
    parsed.issuer?.name || receipt.issued_by_name,
    {
      receiptNumber: receipt.receipt_number,
      issuedAt: parsed.issuedAt || receipt.issued_at,
      company: parsed.company,
      version: parsed.version ?? receipt.version,
      issuerRole: parsed.issuer?.role || receipt.issued_by_role,
      payments: parsed.payments,
      revisionReason: parsed.revisionReason ?? receipt.revision_reason ?? null,
    },
  );
}

export function buildPaymentReceiptDoc(
  snapshot: PaymentReceiptSnapshot,
): PrintableDocumentData {
  const parsed = JSON.parse(snapshot.snapshot_json) as {
    company?: AppSettings;
    pdfDocument?: PrintableDocumentData;
  };
  if (parsed.pdfDocument) {
    return {
      ...parsed.pdfDocument,
      docType: "REÇU DE PAIEMENT",
      companySnapshot: parsed.company,
    };
  }
  return {
    docType: "REÇU DE PAIEMENT",
    reference: snapshot.receipt_number,
    date: snapshot.issued_at,
    companySnapshot: parsed.company,
    cashierName: snapshot.issued_by_name,
    lines: [],
    summaryRows: [],
  };
}
