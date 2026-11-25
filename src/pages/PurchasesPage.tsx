import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import {
  DocumentPrintModal,
  type PrintableDocumentData,
} from '../components/documents/DocumentPrintModal.tsx';
import { ErrorState, LoadingState } from '../components/common/States.tsx';
import { apiClient } from '../services/api/createApiClient.ts';
import type { PurchaseOrder, PurchaseReceipt, PurchaseReceiptResult } from '../types/erp.ts';
import { formatFcfa, formatQty, packagingContentsLabel } from '../utils/format.ts';
import { exportPurchasesCsv } from '../utils/csv.ts';
import {
  usePurchasesMutations,
  usePurchasesQueries,
} from '../features/purchases/hooks/usePurchasesData.ts';
import { PurchasesTable } from '../features/purchases/components/PurchasesTable.tsx';
import { PurchaseOrderModal } from '../features/purchases/components/PurchaseOrderModal.tsx';
import { PurchaseReceiveModal } from '../features/purchases/components/PurchaseReceiveModal.tsx';
import { PurchaseDetailModal } from '../features/purchases/components/PurchaseDetailModal.tsx';
import { PurchaseCancelModal } from '../features/purchases/components/PurchaseCancelModal.tsx';

/* Un CMD reste le CMD même après réception; le REC a son propre constructeur dédié. */
function purchaseProductSnapshot(json?: string | null): string {
  if (!json || json === '{}') return 'Caractéristiques complémentaires non disponibles sur ce CMD historique';
  try {
    const snapshot = JSON.parse(json) as { brand?: string | null; brewery?: string | null; variant?: string | null; volumeMl?: number | null };
    const volume = snapshot.volumeMl
      ? snapshot.volumeMl % 10 === 0 ? `${snapshot.volumeMl / 10} cl` : `${snapshot.volumeMl} ml`
      : null;
    return [snapshot.brewery, snapshot.brand, snapshot.variant, volume]
      .filter(Boolean).join(' · ') || 'Caractéristiques complémentaires non disponibles sur ce CMD historique';
  } catch { return 'Caractéristiques complémentaires non disponibles sur ce CMD historique'; }
}

function purchaseOrderStatusLabel(order: PurchaseOrder): string {
  if (order.approval_status === 'pending_owner_approval') {
    return 'En attente de validation propriétaire';
  }
  switch (order.status) {
    case 'draft':
      return 'Brouillon';
    case 'confirmed':
      return 'Confirmée';
    case 'partial':
      return 'Réception partielle';
    case 'received':
      return 'Réceptionnée';
    case 'cancelled':
      return 'Annulée';
    default:
      return order.status;
  }
}

export function buildPurchaseOrderDoc(order: PurchaseOrder): PrintableDocumentData {
  const linesSubtotal = order.lines.reduce((s, l) => s + l.line_total, 0);
  const discount = order.discount_xof ?? 0;
  const tax = order.tax_xof ?? 0;
  const extraFees = order.extra_fees_xof ?? 0;
  const paidDeposit = order.paid_deposit_xof ?? 0;

  return {
    docType: 'BON DE COMMANDE FOURNISSEUR',
    reference: order.reference,
    orderReference: order.reference,
    linkedDocumentRef: order.reference,
    date: order.created_at,
    statusLabel: purchaseOrderStatusLabel(order),
    cashierName: order.created_by_name ?? null,
    partyTitle: 'FOURNISSEUR',
    partyName: order.supplier_name,
    partyDetails: [
      `Code fournisseur : ${order.supplier_code}`,
      order.supplier_phone ? `Tél. : ${order.supplier_phone}` : null,
      order.supplier_email,
      order.supplier_address,
    ].filter(Boolean).join(' · '),
    partyPhone: order.supplier_phone,
    secondaryPartyTitle: 'LIVRER À & CONDITIONS',
    secondaryPartyName: order.delivery_address || 'Au dépôt principal',
    secondaryPartyDetails: order.payment_terms_label || 'Conditions standard fournisseur',
    paymentTermsLabel: order.payment_terms_label ?? null,
    commercialConditions: order.commercial_conditions ?? null,
    deliveryDate: order.expected_date,
    lines: order.lines.map((l) => ({
      label: l.product_name,
      sublabel: purchaseProductSnapshot(l.product_snapshot_json),
      packagingInfo: packagingContentsLabel(l.packaging_name, l.base_unit, l.coefficient_milli),
      quantity: `${formatQty(l.ordered_quantity_milli)} ${l.packaging_name}`,
      unitPrice: l.unit_price,
      total: l.line_total,
    })),
    packagingLines: order.lines.flatMap((line) => {
      try {
        const snapshot = JSON.parse(line.packaging_snapshot_json) as { components?: Array<{ code: string; name: string; kind: 'bottle' | 'crate'; requiredPieces: number }> };
        return (snapshot.components || []).map((component) => {
          const requirement = order.packaging_requirements.find((item) =>
            item.purchase_order_line_id === line.id && item.code === component.code,
          );
          const statusLabel = order.status === 'cancelled' || requirement?.reservation_status === 'released'
            ? 'Réservation libérée — aucun emballage à préparer'
            : requirement
              ? requirement.reserved_pieces > 0
                ? `${requirement.reserved_pieces} réservé(s) à remettre au fournisseur`
                : 'Réservation consommée — consulter les REC liés pour les remises physiques'
              : 'Détail de réservation non disponible sur ce CMD historique';
          return {
            label: `${component.name} (${component.code})`, kind: component.kind,
            expectedQuantity: component.requiredPieces, statusLabel,
            detail: 'Le CMD ne décrémente pas le stock physique; les remises effectives sont détaillées sur les REC.',
          };
        });
      } catch { return []; }
    }),
    summaryRows: [
      { label: 'Sous-total marchandises', value: formatFcfa(linesSubtotal) },
      ...(discount > 0 ? [{ label: '(-) Remise fournisseur', value: `- ${formatFcfa(discount)}` }] : []),
      ...(tax > 0 ? [{ label: '(+) Taxes / TVA', value: formatFcfa(tax) }] : []),
      ...(extraFees > 0 ? [{ label: '(+) Frais accessoires', value: formatFcfa(extraFees) }] : []),
      { label: 'NET COMMANDE FOURNISSEUR', value: formatFcfa(order.total_amount), bold: true, tone: 'success' as const },
      ...(paidDeposit > 0 ? [{ label: 'Avance / Acompte versé', value: formatFcfa(paidDeposit) }] : []),
      ...(order.received_amount > 0
        ? [{ label: 'Total déjà réceptionné', value: formatFcfa(order.received_amount), tone: 'success' as const }]
        : []),
    ],
    notes: order.notes,
  };
}

export function buildPurchaseReceiptDoc(order: PurchaseOrder, receipt: PurchaseReceipt): PrintableDocumentData {
  const recStatus =
    receipt.status === 'discrepancy'
      ? 'RÉCEPTION AVEC ÉCART'
      : receipt.status === 'partial'
        ? 'RÉCEPTION PARTIELLE'
        : 'RÉCEPTION COMPLÈTE';

  return {
    docType: 'BON DE RÉCEPTION FOURNISSEUR',
    reference: receipt.reference,
    orderReference: order.reference,
    linkedDocumentRef: order.reference,
    date: receipt.created_at,
    statusLabel: `${recStatus} · CMD ${order.reference}`,
    cashierName: receipt.received_by_name ?? null,
    partyTitle: 'FOURNISSEUR',
    partyName: order.supplier_name,
    partyDetails: [order.supplier_code, order.supplier_phone, order.supplier_email, order.supplier_address]
      .filter(Boolean).join(' · '),
    partyPhone: order.supplier_phone,
    secondaryPartyTitle: 'COMMANDE PARENTE & CONTRÔLE',
    secondaryPartyName: order.reference,
    secondaryPartyDetails: receipt.received_by_name ? `Réceptionné par : ${receipt.received_by_name}` : 'Contrôle physique quai dépôt',
    lines: [
      ...receipt.lines.map((line) => {
        const missing = line.missing_quantity_milli ?? 0;
        const damaged = line.damaged_quantity_milli ?? 0;
        const refused = line.refused_quantity_milli ?? 0;
        const ordered = line.received_quantity_milli + missing + damaged + refused;
        return {
          label: line.product_name,
          sublabel: `Conditionnement : ${packagingContentsLabel(line.packaging_name, line.base_unit, line.coefficient_milli)}`,
          quantity: `${formatQty(line.received_quantity_milli)} ${line.packaging_name}`,
          orderedQuantity: `${formatQty(ordered)} ${line.packaging_name}`,
          unitPrice: line.unit_price,
          total: line.amount,
          missingQuantity: missing > 0 ? formatQty(missing) : null,
          damagedQuantity: damaged > 0 ? formatQty(damaged) : null,
          refusedQuantity: refused > 0 ? formatQty(refused) : null,
          discrepancyReason: line.discrepancy_reason,
        };
      }),
    ],
    packagingLines: receipt.packaging_exchanges.map((exchange) => ({
      label: `${exchange.name_snapshot} (${exchange.code_snapshot})`,
      kind: exchange.kind_snapshot,
      expectedQuantity: exchange.pieces_issued,
      issuedQuantity: exchange.pieces_issued,
      statusLabel: 'Remis physiquement au fournisseur',
      detail: 'Échange matériel uniquement; aucune consigne client ni ligne financière.',
    })),
    summaryRows: [
      { label: 'Montant des marchandises reçues', value: formatFcfa(receipt.total_amount), bold: true, tone: 'success' as const },
      { label: 'Dette fournisseur créée à la réception', value: formatFcfa(receipt.total_amount) },
      { label: 'Statut du contrôle', value: recStatus, tone: receipt.status === 'discrepancy' ? 'danger' : 'default' },
    ],
    notes: receipt.notes,
  };
}

export function PurchasesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState<PurchaseOrder | null>(null);
  const [detailTarget, setDetailTarget] = useState<PurchaseOrder | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { ordersQuery, suppliersQuery, productsQuery, supplierDebtsQuery } = usePurchasesQueries(
    Boolean(detailTarget)
  );

  const { createPoMutation, updatePoMutation, receiveMutation, cancelPoMutation } = usePurchasesMutations({
    onCreatedPo: (created: PurchaseOrder) => {
      setCreateOpen(false);
      setErrorMsg(null);
      setPrintDoc(buildPurchaseOrderDoc(created));
    },
    onUpdatedPo: (updated: PurchaseOrder) => {
      setCreateOpen(false);
      setCorrectionTarget(null);
      setErrorMsg(null);
      setPrintDoc(buildPurchaseOrderDoc(updated));
    },
    onReceivedPo: (result: PurchaseReceiptResult) => {
      setReceiveTarget(null);
      setErrorMsg(null);
      setPrintDoc(buildPurchaseReceiptDoc(result.order, result.receipt));
    },
    onCancelledPo: () => {
      setCancelTarget(null);
      setErrorMsg(null);
    },
    onError: setErrorMsg,
  });

  const handlePrintSpecificReceipt = async (order: PurchaseOrder, receiptId: number) => {
    setErrorMsg(null);
    try {
      const fullReceipt = await apiClient.getPurchaseReceiptDetail(receiptId);
      setPrintDoc(buildPurchaseReceiptDoc(order, fullReceipt));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de charger ce bon de réception.');
    }
  };

  const { data: orders, isLoading, error, refetch } = ordersQuery;
  const products = productsQuery.data?.items || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-[#667085] dark:text-slate-400">
          Le bon de commande ne modifie pas le stock : seule une réception validée augmente les
          quantités et génère la dette fournisseur.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!orders || orders.length === 0}
            onClick={() => exportPurchasesCsv(orders || [])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nouveau bon de commande
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error || !orders ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Erreur chargement achats.'}
          onRetry={() => refetch()}
        />
      ) : (
        <PurchasesTable
          orders={orders}
          onInspect={setDetailTarget}
          onPrint={setPrintDoc}
          onCorrect={(order) => { setCorrectionTarget(order); setErrorMsg(null); }}
          onReceive={(order) => {
            setReceiveTarget(order);
            setErrorMsg(null);
          }}
          onCancel={(order) => {
            setCancelTarget(order);
            setErrorMsg(null);
          }}
        />
      )}

      <PurchaseOrderModal
        open={createOpen || Boolean(correctionTarget)}
        onOpenChange={(open) => { if (!open) { setCreateOpen(false); setCorrectionTarget(null); } }}
        correctionTarget={correctionTarget}
        suppliers={suppliersQuery.data}
        products={products}
        error={errorMsg}
        isPending={createPoMutation.isPending || updatePoMutation.isPending}
        onSubmit={(values) => {
          if (values.purchaseOrderId) updatePoMutation.mutate({ ...values, purchaseOrderId: values.purchaseOrderId });
          else createPoMutation.mutate(values);
        }}
      />

      <PurchaseReceiveModal
        target={receiveTarget}
        onClose={() => setReceiveTarget(null)}
        error={errorMsg}
        isPending={receiveMutation.isPending}
        onSubmit={(values) => receiveMutation.mutate(values)}
      />

      <PurchaseDetailModal
        target={detailTarget}
        supplierDebts={supplierDebtsQuery.data}
        onClose={() => setDetailTarget(null)}
        onPrintOrder={(order) => setPrintDoc(buildPurchaseOrderDoc(order))}
        onPrintReceipt={(order, recId) => void handlePrintSpecificReceipt(order, recId)}
      />

      <PurchaseCancelModal
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        error={errorMsg}
        isPending={cancelPoMutation.isPending}
        onSubmit={(values) => cancelPoMutation.mutate(values)}
      />

      <DocumentPrintModal doc={printDoc} onClose={() => setPrintDoc(null)} />
    </div>
  );
}
