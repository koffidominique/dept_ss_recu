import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Banknote,
  CheckCircle2,
  Clock,
  PackageCheck,
  Pencil,
  Printer,
  RotateCcw,
  Truck,
  XCircle,
} from 'lucide-react';
import { ConfirmationDialog } from '../../../components/common/ConfirmationDialog.tsx';
import type { CustomerOrderDetail } from '../../../types/erp.ts';
import { formatDateTime, formatFcfa, newRequestKey } from '../../../utils/format.ts';
import {
  computeOrderLifecycleStages,
  normalizeOrderSettlementMethod,
} from '../../inventory/utils/phase2OperationsGuards.ts';

interface OrderStepConfirmProps {
  orderDetail: CustomerOrderDetail;
  isBusy: boolean;
  isOwner: boolean;
  hasOpenCashSession?: boolean;
  onSubmitForApproval: () => void;
  onConfirm: () => void;
  onDeliver: () => void;
  onInvoice: () => void;
  onPayFull: (requestKey: string, method: string) => void;
  onPayCustom: (input: {
    amount_xof: number;
    method: string;
    external_reference?: string;
    request_key: string;
  }) => void;
  onPrintPaymentReceipt: (paymentId: number) => void;
  onCancel: () => void;
  onEditDraft: () => void;
  onReturnCrate: (assetId: number, quantity: number, notes?: string) => void;
  onResetWizard: () => void;
  onPrintReceipt: () => void;
  onViewReceiptHistory: () => void;
}

export function OrderStepConfirm({
  orderDetail,
  isBusy,
  isOwner,
  hasOpenCashSession = true,
  onSubmitForApproval,
  onConfirm,
  onDeliver,
  onInvoice,
  onPayFull,
  onPayCustom,
  onPrintPaymentReceipt,
  onCancel,
  onEditDraft,
  onReturnCrate,
  onResetWizard,
  onPrintReceipt,
  onViewReceiptHistory,
}: OrderStepConfirmProps) {
  const { order, lines, allocations } = orderDetail;
  const remainingToPay = Math.max(0, order.total_to_collect_xof - order.paid_xof);
  const defaultSettlementMethod = normalizeOrderSettlementMethod(
    order.planned_payment_channel,
    order.payment_method
  );
  // Le formulaire d'encaissement est indexé sur l'identité métier de la commande
  // (montant restant + canal prévu) : un changement de solde réinitialise donc
  // l'état dérivé sans effet ni `setState` en cascade.
  const settlementSig = `${order.id}:${order.total_to_collect_xof}:${order.paid_xof}:${defaultSettlementMethod}`;
  const [showCustomPay, setShowCustomPayRaw] = useState<{ sig: string } | null>(null);
  const [payAmountDraft, setPayAmountDraft] = useState<{ sig: string; value: number } | null>(
    null
  );
  const [payMethodDraft, setPayMethodDraft] = useState<{ sig: string; value: string } | null>(
    null
  );
  const [externalRefDraft, setExternalRefDraft] = useState<{ sig: string; value: string } | null>(
    null
  );
  const [payKeyState, setPayKeyState] = useState<{
    sig: string | null;
    key: string;
    fingerprint: string | null;
  }>(() => ({ sig: settlementSig, key: newRequestKey('ordpay'), fingerprint: null }));

  const customPayOpen = showCustomPay?.sig === settlementSig;
  const payAmount = payAmountDraft?.sig === settlementSig ? payAmountDraft.value : remainingToPay;
  const payMethod =
    payMethodDraft?.sig === settlementSig ? payMethodDraft.value : defaultSettlementMethod;
  const externalRef = externalRefDraft?.sig === settlementSig ? externalRefDraft.value : '';
  const effectivePayKeyState =
    payKeyState.sig === settlementSig
      ? payKeyState
      : { sig: settlementSig, key: newRequestKey('ordpay'), fingerprint: null };

  const setShowCustomPay = (updater: boolean | ((current: boolean) => boolean)) => {
    setShowCustomPayRaw((prev) => {
      const current = prev?.sig === settlementSig;
      const value = typeof updater === 'function' ? updater(current) : updater;
      return value ? { sig: settlementSig } : null;
    });
  };
  const setPayAmount = (value: number) =>
    setPayAmountDraft({ sig: settlementSig, value: Math.max(1, value || 0) });
  const setPayMethod = (value: string) => setPayMethodDraft({ sig: settlementSig, value });
  const setExternalRef = (value: string) => setExternalRefDraft({ sig: settlementSig, value });
  const [pendingAction, setPendingAction] = useState<'confirm' | 'deliver' | 'cancel' | null>(null);
  const [returnQtyByAsset, setReturnQtyByAsset] = useState<Record<number, number>>({});
  const [returnNoteByAsset, setReturnNoteByAsset] = useState<Record<number, string>>({});
  const consignedAllocations = allocations.filter((a) => a.is_consigned === 1);
  const canManageReturns = ['delivered', 'invoiced', 'paid'].includes(order.status);
  const lifecycleInfo = computeOrderLifecycleStages(
    order.status,
    order.approval_status,
    remainingToPay
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 p-4 text-xs space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Commande #{order.order_number} ({order.status.toUpperCase()})
        </div>
        <p className="text-emerald-900 dark:text-emerald-200">
          Stock à prélever :{' '}
          {lines.map((l) => `${l.product_name} ${l.base_quantity} ${l.base_unit}`).join(', ')}
          {allocations.length > 0
            ? ` — Emballages : ${allocations.map((a) => `${a.quantity} × ${a.packaging_name}`).join(', ')}.`
            : '.'}
        </p>
        <p className="font-semibold text-emerald-900 dark:text-emerald-200">
          CA liquides : {formatFcfa(order.total_xof)} · Consigne :{' '}
          {formatFcfa(order.deposit_due_xof)}
          {(order.delivery_fee_xof ?? 0) > 0 ? ` · Livraison : ${formatFcfa(order.delivery_fee_xof ?? 0)}` : ''} · Net à percevoir :{' '}
          {formatFcfa(order.total_to_collect_xof)} · Déjà payé : {formatFcfa(order.paid_xof)} · Reste : {formatFcfa(remainingToPay)}
        </p>
      </div>

      {/* Frise explicite d'états et transitions de la commande */}
      <div
        aria-label="Étapes du cycle de vie de la commande"
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-3 space-y-2"
      >
        {lifecycleInfo.isCancelled ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-[#BE123C]">
            <Ban className="h-4 w-4 shrink-0" />
            <span>{lifecycleInfo.nextActionHint}</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              {lifecycleInfo.stages.map((stage) => (
                <div
                  key={stage.id}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                    stage.state === 'done'
                      ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-300'
                      : stage.state === 'current'
                        ? 'border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 text-[#1D4ED8] dark:text-[#60A5FA]'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 text-[#667085] dark:text-[#94A3B8]'
                  }`}
                >
                  {stage.state === 'done' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="font-semibold truncate">{stage.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#667085] dark:text-slate-400">
              {lifecycleInfo.nextActionHint}
            </p>
          </>
        )}
      </div>

      {!hasOpenCashSession &&
        remainingToPay > 0 &&
        order.status !== 'cancelled' &&
        order.status !== 'draft' && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Aucune session de caisse ouverte : ouvrez la caisse avant d’enregistrer un encaissement sur cette commande.
            </span>
          </div>
        )}

      {order.approval_status === 'pending_owner_approval' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          En attente de validation du propriétaire. Aucun mouvement de stock n’a encore été enregistré.
        </div>
      )}
      {order.approval_status === 'rejected' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
          Commande rejetée. Consultez l’historique des documents avant toute nouvelle soumission.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {order.status === 'draft' && order.approval_status !== 'pending_owner_approval' && (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                if (isOwner) setPendingAction('confirm');
                else onSubmitForApproval();
              }}
              className="rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
            >
              {isOwner ? 'Confirmer (déduire stock)' : 'Soumettre au propriétaire'}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onEditDraft}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Pencil className="h-3.5 w-3.5" />
              Modifier brouillon
            </button>
          </>
        )}
        {order.status === 'confirmed' && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setPendingAction('deliver')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D7A4C] px-3 py-2 text-xs font-semibold text-white disabled:bg-[#B7DACB] disabled:text-[#0A3F28] disabled:opacity-100 whitespace-nowrap shrink-0"
          >
            <Truck className="h-3.5 w-3.5" />
            Livrer (imputer consignes client)
          </button>
        )}
        {order.status === 'delivered' && (
          <button
            type="button"
            disabled={isBusy}
            onClick={onInvoice}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0"
          >
            Facturer
          </button>
        )}
        {remainingToPay > 0 && order.status !== 'cancelled' && order.status !== 'draft' && (
          <>
            <button
              type="button"
              disabled={isBusy || !hasOpenCashSession}
              onClick={() => {
                const sig = `full:${order.id}:${remainingToPay}:${defaultSettlementMethod}`;
                const effectiveKey =
                  effectivePayKeyState.fingerprint !== null &&
                  effectivePayKeyState.fingerprint !== sig
                    ? newRequestKey('ordpay')
                    : effectivePayKeyState.key;
                setPayKeyState({ sig: settlementSig, key: effectiveKey, fingerprint: sig });
                onPayFull(effectiveKey, defaultSettlementMethod);
              }}
              className="rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
            >
              Encaisser solde ({formatFcfa(remainingToPay)})
            </button>
            <button
              type="button"
              disabled={isBusy || !hasOpenCashSession}
              onClick={() => {
                setPayAmount(remainingToPay);
                setShowCustomPay((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-300 dark:border-blue-800 px-3 py-2 text-xs font-medium text-[#1D4ED8] dark:text-[#60A5FA] disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
            >
              <Banknote className="h-3.5 w-3.5" />
              Acompte / Mobile Money
            </button>
          </>
        )}
        {['draft', 'confirmed'].includes(order.status) && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setPendingAction('cancel')}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-[#BE123C] disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
          >
            <XCircle className="h-3.5 w-3.5" />
            Annuler commande
          </button>
        )}
        <button
          type="button"
          disabled={isBusy || order.status === 'draft' || order.status === 'cancelled' || order.approval_status === 'pending_owner_approval'}
          onClick={onPrintReceipt}
          title={order.status === 'draft' || order.approval_status === 'pending_owner_approval' ? 'Disponible après confirmation de la commande.' : order.status === 'cancelled' ? 'Une commande annulée ne peut pas émettre un reçu.' : undefined}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimer reçu de commande
        </button>
        <button
          type="button"
          disabled={order.status === 'draft'}
          onClick={onViewReceiptHistory}
          className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
        >
          Historique / révisions du reçu
        </button>
        <button
          type="button"
          onClick={onResetWizard}
          className="ml-auto rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0"
        >
          Nouvelle commande
        </button>
      </div>

      {canManageReturns && consignedAllocations.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-amber-950 dark:text-amber-200">
              <PackageCheck className="h-4 w-4" />
              Suivi &amp; restitution des emballages consignés (échéance 15 j max)
            </div>
            <span className="text-[11px] text-[#667085] dark:text-slate-400">
              Restitution physique apurant automatiquement le solde client et le stock de casiers vides
            </span>
          </div>
          <div className="divide-y divide-amber-200/70 dark:divide-amber-900/40">
            {consignedAllocations.map((a) => {
              const remaining = Math.max(0, a.quantity - a.returned_quantity);
              const rawInput = returnQtyByAsset[a.packaging_asset_id] ?? remaining;
              const clampedQty = remaining > 0 ? Math.min(remaining, Math.max(1, rawInput)) : 0;
              const noteVal = returnNoteByAsset[a.packaging_asset_id] ?? '';
              return (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="font-semibold text-[#182230] dark:text-slate-100">
                      {a.packaging_name}
                      <span
                        className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          remaining === 0
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200'
                        }`}
                      >
                        {remaining === 0 ? 'Soldé' : `Reste ${remaining} à restituer`}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#667085] dark:text-slate-400">
                      Rendus : <strong className="font-mono-num">{a.returned_quantity}</strong> /{' '}
                      <strong className="font-mono-num">{a.quantity}</strong> · Valeur unitaire réf. :{' '}
                      <span className="font-mono-num">
                        {formatFcfa(Math.round(a.deposit_amount_xof / Math.max(1, a.quantity)))}
                      </span>
                    </div>
                  </div>
                  {remaining > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={remaining}
                        aria-label={`Quantité à retourner pour ${a.packaging_name}`}
                        value={clampedQty}
                        onChange={(e) =>
                          setReturnQtyByAsset((prev) => ({
                            ...prev,
                            [a.packaging_asset_id]: Math.min(
                              remaining,
                              Math.max(1, Number(e.target.value) || 1)
                            ),
                          }))
                        }
                        className="w-20 rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono-num"
                      />
                      <input
                        type="text"
                        value={noteVal}
                        onChange={(e) =>
                          setReturnNoteByAsset((prev) => ({
                            ...prev,
                            [a.packaging_asset_id]: e.target.value,
                          }))
                        }
                        placeholder="Note (optionnel)"
                        className="w-36 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                      />
                      <button
                        type="button"
                        disabled={isBusy || clampedQty <= 0}
                        onClick={() => {
                          onReturnCrate(
                            a.packaging_asset_id,
                            clampedQty,
                            noteVal.trim() || undefined
                          );
                          setReturnQtyByAsset((prev) => {
                            const next = { ...prev };
                            delete next[a.packaging_asset_id];
                            return next;
                          });
                          setReturnNoteByAsset((prev) => {
                            const next = { ...prev };
                            delete next[a.packaging_asset_id];
                            return next;
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restituer ({clampedQty})
                      </button>
                      {remaining > 1 && clampedQty < remaining && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            onReturnCrate(
                              a.packaging_asset_id,
                              remaining,
                              noteVal.trim() || undefined
                            )
                          }
                          className="rounded-lg border border-amber-400 dark:border-amber-700 px-2.5 py-1.5 font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100/70 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
                        >
                          Tout solder ({remaining})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {customPayOpen && remainingToPay > 0 && order.status !== 'cancelled' && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3 text-xs">
          <div className="font-semibold text-[#182230] dark:text-slate-100">
            Enregistrer un versement (acompte partiel ou Mobile Money)
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block font-medium">Montant encaissé (FCFA)</label>
              <input
                type="number"
                min={1}
                max={remainingToPay}
                value={payAmount}
                onChange={(e) => setPayAmount(Math.max(1, Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-medium">Moyen de paiement</label>
              <select aria-label="Moyen de paiement"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
              >
                <option value="cash">Espèces</option>
                <option value="wave">Wave</option>
                <option value="orange_money">Orange Money</option>
                <option value="mtn_money">MTN Money</option>
                <option value="moov_money">Moov Money</option>
                <option value="transfer">Virement bancaire</option>
                <option value="cheque">Chèque</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Réf. transaction Mobile Money (optionnel)</label>
              <input
                type="text"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder="Ex : WV-9028172"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono-num"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCustomPay(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-medium"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={isBusy || payAmount <= 0 || !hasOpenCashSession}
              onClick={() => {
                const effectiveAmount = Math.min(remainingToPay, payAmount);
                const cleanMethod = normalizeOrderSettlementMethod(payMethod, 'cash');
                const cleanRef = externalRef.trim() || undefined;
                const sig = `custom:${order.id}:${effectiveAmount}:${cleanMethod}:${cleanRef ?? ''}`;
                const effectiveKey =
                  effectivePayKeyState.fingerprint !== null &&
                  effectivePayKeyState.fingerprint !== sig
                    ? newRequestKey('ordpay')
                    : effectivePayKeyState.key;
                setPayKeyState({ sig: settlementSig, key: effectiveKey, fingerprint: sig });
                onPayCustom({
                  amount_xof: effectiveAmount,
                  method: cleanMethod,
                  external_reference: cleanRef,
                  request_key: effectiveKey,
                });
                setShowCustomPay(false);
                setExternalRef('');
              }}
              className="rounded-lg bg-[#0D7A4C] px-3 py-1.5 font-semibold text-white disabled:bg-[#B7DACB] disabled:text-[#0A3F28] disabled:opacity-100"
            >
              Enregistrer ce versement
            </button>
          </div>
        </div>
      )}

      {orderDetail.payments && orderDetail.payments.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-2">
          <div className="font-semibold">Règlements enregistrés sur cette commande ({orderDetail.payments.length})</div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {orderDetail.payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-mono-num font-semibold">{p.reference}</span> · {p.method_label}
                  {p.external_reference ? ` · Réf. Txn ${p.external_reference}` : ''}
                  {p.recorded_by_name ? ` · Par ${p.recorded_by_name}` : ''}
                  <span className="ml-2 text-[11px] text-[#667085] dark:text-[#94A3B8]">{formatDateTime(p.created_at)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono-num font-semibold text-[#16A36A]">{formatFcfa(p.amount_xof)}</span>
                  <button
                    type="button"
                    onClick={() => onPrintPaymentReceipt(p.id)}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Printer className="h-3 w-3" />
                    Reçu paiement
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={pendingAction !== null}
        onOpenChange={(next) => {
          if (!next && !isBusy) setPendingAction(null);
        }}
        title={
          pendingAction === 'confirm'
            ? `Confirmer la commande #${order.order_number} ?`
            : pendingAction === 'deliver'
              ? `Confirmer la remise / livraison de #${order.order_number} ?`
              : `Annuler la commande #${order.order_number} ?`
        }
        description={
          pendingAction === 'confirm'
            ? 'Cette validation réserve et déduit immédiatement le stock liquide requis pour préparer la commande.'
            : pendingAction === 'deliver'
              ? 'Cette opération acte la remise effective des marchandises et inscrit les emballages consignés au compte du client.'
              : order.status === 'confirmed'
                ? 'Cette commande repassera son stock réservé en rayon et sera verrouillée en statut Annulée.'
                : 'Le brouillon de commande sera définitivement classé sans suite.'
        }
        consequences={
          pendingAction === 'confirm'
            ? [
                `Lignes préparées : ${lines.map((l) => `${l.product_name} (${l.base_quantity} ${l.base_unit})`).join(', ')}`,
                `Net à percevoir : ${formatFcfa(order.total_to_collect_xof)}`,
              ]
            : pendingAction === 'deliver'
              ? [
                  `Client : ${order.customer_name || `#${order.customer_id}`}`,
                  ...(consignedAllocations.length > 0
                    ? [
                        `Consignes imputées au client : ${consignedAllocations.map((a) => `${a.quantity} × ${a.packaging_name}`).join(', ')} (${formatFcfa(order.deposit_due_xof)})`,
                      ]
                    : ['Aucun emballage consigné à imputer.']),
                  `Solde restant à encaisser : ${formatFcfa(remainingToPay)}`,
                ]
              : [
                  `Commande : #${order.order_number}`,
                  `Montant annulé : ${formatFcfa(order.total_to_collect_xof)}`,
                ]
        }
        confirmLabel={
          pendingAction === 'confirm'
            ? 'Confirmer et déduire le stock'
            : pendingAction === 'deliver'
              ? 'Valider la livraison'
              : 'Annuler définitivement'
        }
        destructive={pendingAction === 'cancel'}
        loading={isBusy}
        onConfirm={() => {
          const act = pendingAction;
          setPendingAction(null);
          if (act === 'confirm') onConfirm();
          else if (act === 'deliver') onDeliver();
          else if (act === 'cancel') onCancel();
        }}
      />
    </div>
  );
}
