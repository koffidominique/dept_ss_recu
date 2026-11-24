import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUiStore } from '../stores/uiStore.ts';
import {
  DocumentPrintModal,
  type PrintableDocumentData,
} from '../components/documents/DocumentPrintModal.tsx';
import { InlineAlert } from '../components/common/InlineAlert.tsx';
import { apiClient } from '../services/api/createApiClient.ts';
import type { CustomerOrderReceiptSnapshot, PreviewAllocation } from '../types/erp.ts';
import { OrderStepClient } from '../features/orders/components/OrderStepClient.tsx';
import { OrderStepLines } from '../features/orders/components/OrderStepLines.tsx';
import { OrderStepPackaging } from '../features/orders/components/OrderStepPackaging.tsx';
import { ReturnedEmptiesPanel } from '../features/orders/components/ReturnedEmptiesPanel.tsx';
import { OrderStepReview } from '../features/orders/components/OrderStepReview.tsx';
import { OrderStepConfirm } from '../features/orders/components/OrderStepConfirm.tsx';
import { OrdersListTable } from '../features/orders/components/OrdersListTable.tsx';
import { SearchInput } from '../components/forms/SearchInput.tsx';
import {
  filterCustomerOrders,
  type OrderListFilter,
} from '../features/dashboard/utils/workQueue.ts';
import { useOrdersWizard } from '../features/orders/hooks/useOrdersWizard.ts';
import {
  buildOrderReceiptFromSnapshot,
  buildPaymentReceiptDoc,
} from '../features/orders/utils/orderPrintDocument.ts';
import { OfflineWorkBanner } from '../features/dashboard/components/WorkQueuePanel.tsx';
import { useConnectionState } from '../features/dashboard/hooks/useConnectionState.ts';

const STEPS = [
  { id: 1, label: '1. Client' },
  { id: 2, label: '2. Lignes produits' },
  { id: 3, label: '3. Emballages physiques' },
  { id: 4, label: '4. Récapitulatif' },
  { id: 5, label: '5. Confirmation' },
] as const;

export function OrdersPage() {
  const currentUser = useUiStore((store) => store.currentUser);
  const isOwner = currentUser?.role === 'owner';
  const {
    step,
    setStep,
    draft,
    setDraft,
    editingOrderId,
    setEditingOrderId,
    activeOrder,
    setActiveOrder,
    error,
    setError,
    clients,
    deposits,
    depositHistory,
    orders,
    variantOptions,
    effectivePreview,
    isServerPreview,
    createMutation,
    actionMutation,
    startEditingDraft,
    hasOpenCashSession,
  } = useOrdersWizard();

  // Filtres de liste conservés dans l'URL : le retour depuis une fiche commande
  // retrouve exactement la même vue (cf. Phase 3, point « conserver les filtres »).
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatut = searchParams.get('statut');
  const validStatuts: OrderListFilter['statut'][] = [
    'tous',
    'a_approuver',
    'a_livrer',
    'solde_du',
    'en_cours',
  ];
  const statut: OrderListFilter['statut'] =
    rawStatut && (validStatuts as string[]).includes(rawStatut)
      ? (rawStatut as OrderListFilter['statut'])
      : 'tous';
  const search = searchParams.get('q') ?? '';

  const updateListFilter = (next: { statut?: OrderListFilter['statut']; q?: string }) => {
    const params: Record<string, string> = {};
    const nextStatut = next.statut ?? statut;
    const nextSearch = next.q ?? search;
    if (nextStatut !== 'tous') params.statut = nextStatut;
    if (nextSearch.trim()) params.q = nextSearch;
    setSearchParams(params, { replace: true });
  };

  const filteredOrders = useMemo(
    () => filterCustomerOrders(orders, { statut, search }),
    [orders, statut, search]
  );

  const { isOnline, offlineSince, serverState } = useConnectionState();
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const [receiptHistory, setReceiptHistory] = useState<CustomerOrderReceiptSnapshot[] | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [isRevisingReceipt, setIsRevisingReceipt] = useState(false);
  const activeClient = clients.find((c) => c.id === draft.customer_id) ?? null;

  const printReceiptSnapshot = (receipt: CustomerOrderReceiptSnapshot) => {
    setPrintDoc(buildOrderReceiptFromSnapshot(receipt));
  };

  const openReceiptHistory = async () => {
    if (!activeOrder) return;
    setError(null);
    try {
      const receipts = await apiClient.listCustomerOrderReceipts(activeOrder.order.id);
      setReceiptHistory(receipts);
      setRevisionReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger l’historique des reçus.');
    }
  };

  const reviseReceipt = async () => {
    if (!activeOrder) return;
    setError(null);
    setIsRevisingReceipt(true);
    try {
      const receipt = await apiClient.reviseCustomerOrderReceipt(activeOrder.order.id, revisionReason);
      const receipts = await apiClient.listCustomerOrderReceipts(activeOrder.order.id);
      setReceiptHistory(receipts);
      setRevisionReason('');
      printReceiptSnapshot(receipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’émettre la version corrigée du reçu.');
    } finally {
      setIsRevisingReceipt(false);
    }
  };

  const issueReceiptForActiveOrder = async () => {
    if (!activeOrder) return;
    setError(null);
    try {
      const receipt = await apiClient.issueCustomerOrderReceipt(activeOrder.order.id);
      printReceiptSnapshot(receipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’émettre le reçu de commande.');
    }
  };

  const handlePrintPaymentReceipt = async (paymentId: number) => {
    setError(null);
    try {
      const snap = await apiClient.getPaymentReceipt(paymentId);
      setPrintDoc(buildPaymentReceiptDoc(snap));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger le reçu de paiement.');
    }
  };

  return (
    <div className="space-y-6">
      <OfflineWorkBanner
        isOnline={isOnline}
        offlineSince={offlineSince}
        serverState={serverState}
      />
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h1 className="font-display text-lg font-semibold">
              Prise de commande clientèle &amp; casiers mixtes
            </h1>
            <p className="text-xs text-[#667085] dark:text-[#94A3B8]">
              Brouillon sauvegardé hors-ligne ·{' '}
              {isServerPreview ? 'Prévisualisation serveur synchronisée' : 'Calcul local'} ·
              Consignes séparées du CA.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={s.id === 5 && !activeOrder}
                onClick={() => setStep(s.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  step === s.id
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-[#667085] dark:text-slate-300 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <InlineAlert variant="error" message={error} onDismiss={() => setError(null)} />
          </div>
        )}

        <div className="mt-4">
          {step === 1 && (
            <>
              <OrderStepClient
                clients={clients}
                customerId={draft.customer_id}
                onSelectCustomer={(id) => setDraft((d) => ({ ...d, customer_id: id }))}
                deposits={deposits}
                depositHistory={depositHistory}
              />
              <div className="mt-4">
                <ReturnedEmptiesPanel
                  deposits={deposits}
                  obligations={customerObligations}
                  clientName={activeClient?.name ?? null}
                  value={draft.returned_empties ?? []}
                  onChange={(returned_empties) => setDraft((d) => ({ ...d, returned_empties }))}
                  disabled={!draft.customer_id}
                />
              </div>
            </>
          )}
          {step === 2 && (
            <OrderStepLines
              lines={draft.lines}
              options={variantOptions}
              onChangeLines={(lines) =>
                setDraft((d) => ({ ...d, lines, custom_allocations: null }))
              }
            />
          )}
          {step === 3 && (
            <OrderStepPackaging
              allocations={effectivePreview.allocations}
              warnings={effectivePreview.warnings}
              isCustomOverride={Boolean(draft.custom_allocations)}
              onChangeAllocations={(next: PreviewAllocation[]) =>
                setDraft((d) => ({ ...d, custom_allocations: next }))
              }
              onResetAuto={() => setDraft((d) => ({ ...d, custom_allocations: null }))}
            />
          )}
          {step === 4 && (
            <OrderStepReview
              client={activeClient}
              preview={effectivePreview}
              paymentMethod={draft.payment_method}
              onChangePaymentMethod={(pm) => setDraft((d) => ({ ...d, payment_method: pm }))}
              plannedPaymentChannel={draft.planned_payment_channel}
              onChangePlannedPaymentChannel={(planned_payment_channel) =>
                setDraft((d) => ({ ...d, planned_payment_channel }))
              }
              discountXof={draft.discount_xof}
              onChangeDiscountXof={(discount_xof) => setDraft((d) => ({ ...d, discount_xof }))}
              deliveryMode={draft.delivery_mode}
              onChangeDeliveryMode={(delivery_mode) => setDraft((d) => ({ ...d, delivery_mode }))}
              courierName={draft.courier_name}
              onChangeCourierName={(courier_name) => setDraft((d) => ({ ...d, courier_name }))}
              plannedDeliveryTime={draft.planned_delivery_time}
              onChangePlannedDeliveryTime={(planned_delivery_time) =>
                setDraft((d) => ({ ...d, planned_delivery_time }))
              }
              deliveryFeeXof={draft.delivery_fee_xof}
              onChangeDeliveryFeeXof={(delivery_fee_xof) =>
                setDraft((d) => ({ ...d, delivery_fee_xof }))
              }
              deliveryAddress={draft.delivery_address}
              onChangeDeliveryAddress={(delivery_address) =>
                setDraft((d) => ({ ...d, delivery_address }))
              }
              deliveryLandmark={draft.delivery_landmark}
              onChangeDeliveryLandmark={(delivery_landmark) =>
                setDraft((d) => ({ ...d, delivery_landmark }))
              }
              notes={draft.notes}
              onChangeNotes={(notes) => setDraft((d) => ({ ...d, notes }))}
              returnedEmpties={draft.returned_empties.map((r) => ({
                packaging_name: r.packaging_name,
                pieces: r.pieces,
              }))}
            />
          )}
          {step === 5 && activeOrder && (
            <OrderStepConfirm
              orderDetail={activeOrder}
              isBusy={actionMutation.isPending}
              isOwner={isOwner}
              hasOpenCashSession={hasOpenCashSession}
              onSubmitForApproval={() =>
                actionMutation.mutate(async () => {
                  await apiClient.submitCommercialDocument('customer_order', activeOrder.order.id);
                  return apiClient.getCustomerOrder(activeOrder.order.id);
                })
              }
              onConfirm={() =>
                actionMutation.mutate(() => apiClient.confirmCustomerOrder(activeOrder.order.id))
              }
              onDeliver={() =>
                actionMutation.mutate(() => apiClient.deliverCustomerOrder(activeOrder.order.id))
              }
              onInvoice={() =>
                actionMutation.mutate(() => apiClient.invoiceCustomerOrder(activeOrder.order.id))
              }
              onPayFull={(requestKey, method) =>
                actionMutation.mutate(() =>
                  apiClient.payCustomerOrder(activeOrder.order.id, {
                    amount_xof: Math.max(
                      1,
                      activeOrder.order.total_to_collect_xof - activeOrder.order.paid_xof,
                    ),
                    method,
                    request_key: requestKey,
                  }),
                )
              }
              onPayCustom={(input) =>
                actionMutation.mutate(() =>
                  apiClient.payCustomerOrder(activeOrder.order.id, input),
                )
              }
              onPrintPaymentReceipt={(paymentId) => void handlePrintPaymentReceipt(paymentId)}
              onCancel={() =>
                actionMutation.mutate(() => apiClient.cancelCustomerOrder(activeOrder.order.id))
              }
              onEditDraft={() => startEditingDraft(activeOrder)}
              onReturnCrate={(assetId, quantity, notes) =>
                actionMutation.mutate(() =>
                  apiClient.returnOrderPackaging(activeOrder.order.id, {
                    packaging_asset_id: assetId,
                    quantity,
                    notes: notes ?? 'Retour casiers vides client',
                  }),
                )
              }
              onResetWizard={() => {
                setEditingOrderId(null);
                setActiveOrder(null);
                setStep(1);
              }}
              onPrintReceipt={() => void issueReceiptForActiveOrder()}
              onViewReceiptHistory={() => void openReceiptHistory()}
            />
          )}
        </div>

        {step < 5 && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 pt-4">
            <button
              type="button"
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
            >
              Précédent
            </button>
            <div className="flex items-center gap-2">
              {step < 4 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(4, s + 1))}
                  className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white"
                >
                  Suivant
                </button>
              ) : (
                <button
                  type="button"
                  disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                  className="rounded-lg bg-[#0D7A4C] px-4 py-2 text-xs font-semibold text-white disabled:bg-[#B7DACB] disabled:text-[#0A3F28] disabled:opacity-100"
                >
                  {editingOrderId ? 'Mettre à jour le brouillon' : 'Valider la commande'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold">
            Commandes récentes
            <span className="ml-2 font-mono-num text-xs font-normal text-[#667085] dark:text-slate-400">
              {filteredOrders.length} / {orders.length}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={(q) => updateListFilter({ q })}
              placeholder="N° commande ou client..."
              ariaLabel="Rechercher une commande par numéro ou client"
              clearable
              className="w-56"
              inputClassName="py-1.5 text-xs"
            />
            <label className="sr-only" htmlFor="orders-status-filter">
              Filtrer les commandes par statut
            </label>
            <select
              id="orders-status-filter"
              value={statut}
              onChange={(e) =>
                updateListFilter({ statut: e.target.value as OrderListFilter['statut'] })
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-2.5 py-1.5 text-xs text-[#182230] dark:text-slate-100"
            >
              <option value="tous">Tous les statuts</option>
              <option value="a_approuver">À approuver</option>
              <option value="a_livrer">À livrer</option>
              <option value="solde_du">Solde dû</option>
              <option value="en_cours">Cycle en cours</option>
            </select>
            {(statut !== 'tous' || search.trim()) && (
              <button
                type="button"
                onClick={() => updateListFilter({ statut: 'tous', q: '' })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-[#667085] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>
        <OrdersListTable
          orders={filteredOrders}
          emptyMessage={
            statut !== 'tous' || search.trim()
              ? 'Aucune commande ne correspond aux filtres actifs. Réinitialisez pour retrouver la liste complète.'
              : undefined
          }
          onOpenOrder={(id) =>
            actionMutation.mutate(async () => {
              const detail = await apiClient.getCustomerOrder(id);
              setStep(5);
              return detail;
            })
          }
        />
      </div>

      {receiptHistory !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-history-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#111A2E]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="receipt-history-title" className="font-display text-base font-semibold">Historique des reçus de commande</h2>
                <p className="mt-1 text-xs text-slate-500">Chaque version est un snapshot immuable. Une correction crée un nouveau numéro et ne remplace jamais les versions précédentes.</p>
              </div>
              <button type="button" onClick={() => setReceiptHistory(null)} className="rounded-lg border px-3 py-1.5 text-xs">Fermer</button>
            </div>
            <div className="mt-4 space-y-2">
              {receiptHistory.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900">Aucun reçu n’a encore été émis pour cette commande.</p>
              ) : receiptHistory.map((receipt) => (
                <div key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div>
                    <p className="text-sm font-semibold">{receipt.receipt_number} · version {receipt.version}</p>
                    <p className="text-xs text-slate-500">Émis le {receipt.issued_at} par {receipt.issued_by_name} ({receipt.issued_by_role})</p>
                    {receipt.revision_reason && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">Motif : {receipt.revision_reason}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => printReceiptSnapshot(receipt)} className="rounded-lg border px-3 py-2 text-xs font-medium">Réimprimer ce snapshot</button>
                </div>
              ))}
            </div>
            {isOwner && receiptHistory.length > 0 && activeOrder && !['draft', 'cancelled'].includes(activeOrder.order.status) && (
              <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                <label htmlFor="receipt-revision-reason" className="block text-xs font-semibold">Émettre une version corrigée (propriétaire)</label>
                <textarea
                  id="receipt-revision-reason"
                  value={revisionReason}
                  onChange={(event) => setRevisionReason(event.target.value)}
                  minLength={8}
                  maxLength={500}
                  rows={3}
                  placeholder="Motif de correction (8 à 500 caractères)"
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
                />
                <button
                  type="button"
                  disabled={isRevisingReceipt || revisionReason.trim().length < 8}
                  onClick={() => void reviseReceipt()}
                  className="mt-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
                >
                  {isRevisingReceipt ? 'Émission…' : 'Créer et imprimer la nouvelle version'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      <DocumentPrintModal doc={printDoc} onClose={() => setPrintDoc(null)} />
    </div>
  );
}
