import { useState } from 'react';
import { Banknote, CheckCircle2, PackageCheck, Pencil, Printer, RotateCcw, Truck, XCircle } from 'lucide-react';
import type { CustomerOrderDetail } from '../../../types/erp.ts';
import { formatDateTime, formatFcfa } from '../../../utils/format.ts';

interface OrderStepConfirmProps {
  orderDetail: CustomerOrderDetail;
  isBusy: boolean;
  isOwner: boolean;
  onSubmitForApproval: () => void;
  onConfirm: () => void;
  onDeliver: () => void;
  onInvoice: () => void;
  onPayFull: () => void;
  onPayCustom: (input: { amount_xof: number; method: string; external_reference?: string }) => void;
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
  const [showCustomPay, setShowCustomPay] = useState(false);
  const [payAmount, setPayAmount] = useState<number>(remainingToPay);
  const [payMethod, setPayMethod] = useState<string>(order.planned_payment_channel || order.payment_method || 'cash');
  const [externalRef, setExternalRef] = useState('');
  const [returnQtyByAsset, setReturnQtyByAsset] = useState<Record<number, number>>({});
  const [returnNoteByAsset, setReturnNoteByAsset] = useState<Record<number, string>>({});
  const consignedAllocations = allocations.filter((a) => a.is_consigned === 1);
  const canManageReturns = ['delivered', 'invoiced', 'paid'].includes(order.status);

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
              onClick={isOwner ? onConfirm : onSubmitForApproval}
              className="rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap shrink-0"
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
            onClick={onDeliver}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#16A36A] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap shrink-0"
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
              disabled={isBusy}
              onClick={onPayFull}
              className="rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              Encaisser solde ({formatFcfa(remainingToPay)})
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setPayAmount(remainingToPay);
                setShowCustomPay((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-300 dark:border-blue-800 px-3 py-2 text-xs font-medium text-[#2563EB] whitespace-nowrap shrink-0"
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
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-[#DC4545] whitespace-nowrap shrink-0"
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
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium disabled:opacity-40 whitespace-nowrap shrink-0"
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimer reçu de commande
        </button>
        <button
          type="button"
          disabled={order.status === 'draft'}
          onClick={onViewReceiptHistory}
          className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium disabled:opacity-40 whitespace-nowrap shrink-0"
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
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
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
                          className="rounded-lg border border-amber-400 dark:border-amber-700 px-2.5 py-1.5 font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100/70 disabled:opacity-40"
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

      {showCustomPay && remainingToPay > 0 && order.status !== 'cancelled' && (
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
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
              >
                <option value="cash">Espèces</option>
                <option value="wave">Wave</option>
                <option value="orange_money">Orange Money</option>
                <option value="mtn_money">MTN Money</option>
                <option value="moov_money">Moov Money</option>
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
              disabled={isBusy || payAmount <= 0}
              onClick={() => {
                onPayCustom({
                  amount_xof: Math.min(remainingToPay, payAmount),
                  method: payMethod,
                  external_reference: externalRef.trim() || undefined,
                });
                setShowCustomPay(false);
                setExternalRef('');
              }}
              className="rounded-lg bg-[#16A36A] px-3 py-1.5 font-semibold text-white disabled:opacity-40"
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
                  <span className="ml-2 text-[11px] text-[#667085]">{formatDateTime(p.created_at)}</span>
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
    </div>
  );
}
