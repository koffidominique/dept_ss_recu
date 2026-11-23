import type { Client, ComposePreviewResult } from '../../../types/erp.ts';
import { formatFcfa } from '../../../utils/format.ts';

interface OrderStepReviewProps {
  client: Client | null;
  preview: ComposePreviewResult;
  paymentMethod: 'cash' | 'mobile_money' | 'credit' | 'mixed';
  onChangePaymentMethod: (m: 'cash' | 'mobile_money' | 'credit' | 'mixed') => void;
  plannedPaymentChannel: string;
  onChangePlannedPaymentChannel: (v: string) => void;
  discountXof: number;
  onChangeDiscountXof: (v: number) => void;
  deliveryMode: 'pickup' | 'delivery';
  onChangeDeliveryMode: (v: 'pickup' | 'delivery') => void;
  courierName: string;
  onChangeCourierName: (v: string) => void;
  plannedDeliveryTime: string;
  onChangePlannedDeliveryTime: (v: string) => void;
  deliveryFeeXof: number;
  onChangeDeliveryFeeXof: (v: number) => void;
  deliveryAddress: string;
  onChangeDeliveryAddress: (v: string) => void;
  deliveryLandmark: string;
  onChangeDeliveryLandmark: (v: string) => void;
  notes: string;
  onChangeNotes: (v: string) => void;
}

export function OrderStepReview({
  client,
  preview,
  paymentMethod,
  onChangePaymentMethod,
  plannedPaymentChannel,
  onChangePlannedPaymentChannel,
  discountXof,
  onChangeDiscountXof,
  deliveryMode,
  onChangeDeliveryMode,
  courierName,
  onChangeCourierName,
  plannedDeliveryTime,
  onChangePlannedDeliveryTime,
  deliveryFeeXof,
  onChangeDeliveryFeeXof,
  deliveryAddress,
  onChangeDeliveryAddress,
  deliveryLandmark,
  onChangeDeliveryLandmark,
  notes,
  onChangeNotes,
}: OrderStepReviewProps) {
  const creditForbidden =
    paymentMethod === 'credit' && (!client || client.credit_policy === 'forbidden');
  const creditExceeded =
    paymentMethod === 'credit' &&
    client?.credit_policy === 'limited' &&
    client.credit_limit !== null &&
    client.unpaid_balance + preview.totals.total_to_collect_xof > client.credit_limit;
  const effectiveDeliveryFee = preview.totals.delivery_fee_xof ?? deliveryFeeXof;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900 text-[#667085]">
            <tr>
              <th className="px-3 py-2 font-medium">Ligne</th>
              <th className="px-3 py-2 font-medium">Contenu</th>
              <th className="px-3 py-2 font-medium text-right">Quantité en unités</th>
              <th className="px-3 py-2 font-medium text-right">PU (FCFA)</th>
              <th className="px-3 py-2 font-medium text-right">Total (FCFA)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {preview.lines.map((l, i) => (
              <tr key={`${l.variant_id}-${i}`}>
                <td className="px-3 py-2 font-mono-num">{i + 1}</td>
                <td className="px-3 py-2 font-medium">{l.variant_name}</td>
                <td className="px-3 py-2 text-right font-mono-num font-semibold">{l.base_quantity} {l.base_unit}</td>
                <td className="px-3 py-2 text-right font-mono-num">{formatFcfa(l.unit_price_xof)}</td>
                <td className="px-3 py-2 text-right font-mono-num font-semibold">
                  {formatFcfa(l.line_total_xof)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2 text-xs">
          <div className="font-semibold">Emballages alloués</div>
          {preview.allocations.length === 0 ? (
            <p className="text-[#667085]">Aucun emballage physique alloué.</p>
          ) : (
            preview.allocations.map((a, i) => (
              <div key={i} className="flex justify-between">
                <span>
                  {a.quantity} × {a.packaging_name} ({a.is_consigned ? 'Consigné' : 'Perdu'})
                </span>
                <span className="font-mono-num">
                  {formatFcfa(a.is_consigned ? a.quantity * a.deposit_amount_xof : 0)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-[#667085]">Total liquides (CA hors consigne)</span>
            <span className="font-mono-num font-semibold">
              {formatFcfa(preview.totals.total_xof)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#667085]">Total consignes (dépôt récupérable)</span>
            <span className="font-mono-num font-semibold text-amber-700 dark:text-amber-300">
              {formatFcfa(preview.totals.deposit_due_xof)}
            </span>
          </div>
          {effectiveDeliveryFee > 0 && (
            <div className="flex justify-between">
              <span className="text-[#667085]">Frais de livraison</span>
              <span className="font-mono-num font-semibold">{formatFcfa(effectiveDeliveryFee)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 dark:border-slate-800 pt-1.5 text-sm font-bold">
            <span>Net à percevoir</span>
            <span className="font-mono-num text-[#2563EB]">
              {formatFcfa(preview.totals.total_to_collect_xof)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium">Mode de paiement</label>
          <select
            value={paymentMethod}
            onChange={(e) => {
              const next = e.target.value as 'cash' | 'mobile_money' | 'credit' | 'mixed';
              onChangePaymentMethod(next);
              if (next === 'cash') onChangePlannedPaymentChannel('cash');
              else if (next === 'mobile_money' && plannedPaymentChannel === 'cash') onChangePlannedPaymentChannel('wave');
              else if (next === 'credit') onChangePlannedPaymentChannel('credit');
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="cash">Espèces</option>
            <option value="mobile_money">Mobile Money (Wave / Orange / MTN / Moov)</option>
            <option value="credit">Crédit client</option>
            <option value="mixed">Paiement mixte</option>
          </select>
          {creditForbidden && (
            <p className="mt-1 text-[11px] text-[#DC4545]">
              Ce client n&apos;est pas autorisé à commander à crédit.
            </p>
          )}
          {creditExceeded && (
            <p className="mt-1 text-[11px] text-[#DC4545]">
              Plafond crédit dépassé ({formatFcfa(client?.credit_limit ?? 0)} max).
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium">Canal de règlement prévu (Reçu)</label>
          <select
            value={plannedPaymentChannel}
            onChange={(e) => onChangePlannedPaymentChannel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="cash">Espèces</option>
            <option value="wave">Wave</option>
            <option value="orange_money">Orange Money</option>
            <option value="mtn_money">MTN Money</option>
            <option value="moov_money">Moov Money</option>
            <option value="credit">Crédit client</option>
            <option value="other">Autre / Mixte</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium">Mode logistique</label>
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                onChangeDeliveryMode('pickup');
                onChangeDeliveryFeeXof(0);
              }}
              className={`rounded-md py-1.5 font-medium ${deliveryMode === 'pickup' ? 'bg-[#2563EB] text-white' : 'text-[#667085] dark:text-slate-300'}`}
            >
              Enlèvement au dépôt
            </button>
            <button
              type="button"
              onClick={() => onChangeDeliveryMode('delivery')}
              className={`rounded-md py-1.5 font-medium ${deliveryMode === 'delivery' ? 'bg-[#2563EB] text-white' : 'text-[#667085] dark:text-slate-300'}`}
            >
              Livraison à domicile
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium">Remise commerciale (FCFA)</label>
          <input
            type="number"
            min={0}
            value={discountXof}
            onChange={(e) => onChangeDiscountXof(Math.max(0, Number(e.target.value) || 0))}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono-num"
          />
        </div>
        <div>
          <label className="block text-xs font-medium">Adresse de livraison</label>
          <input
            type="text"
            value={deliveryAddress}
            onChange={(e) => onChangeDeliveryAddress(e.target.value)}
            placeholder="Zone / quartier / point de livraison..."
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium">Point de repère livraison</label>
          <input
            type="text"
            value={deliveryLandmark}
            onChange={(e) => onChangeDeliveryLandmark(e.target.value)}
            placeholder="Ex : Face pharmacie, carrefour..."
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>
        {deliveryMode === 'delivery' && (
          <>
            <div>
              <label className="block text-xs font-medium">Livreur / Tricycle</label>
              <input
                type="text"
                value={courierName}
                onChange={(e) => onChangeCourierName(e.target.value)}
                placeholder="Nom du livreur ou immat."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Frais de livraison (FCFA)</label>
              <input
                type="number"
                min={0}
                value={deliveryFeeXof}
                onChange={(e) => onChangeDeliveryFeeXof(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono-num"
              />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs font-medium">Date / heure prévue</label>
          <input
            type="text"
            value={plannedDeliveryTime}
            onChange={(e) => onChangePlannedDeliveryTime(e.target.value)}
            placeholder="Ex. 23/11/2026 à 16h30"
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium">Notes / instructions</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => onChangeNotes(e.target.value)}
            placeholder="Commentaire chauffeur / livraison..."
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
