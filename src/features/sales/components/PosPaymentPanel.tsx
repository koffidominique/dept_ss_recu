import { motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { MoneyInput } from '../../../components/common/MoneyInput.tsx';
import { InlineAlert } from '../../../components/common/InlineAlert.tsx';
import {
  DP_BUTTON_HOVER,
  DP_BUTTON_TAP,
  DP_SPRING_SNAPPY,
} from '../../../components/motion/MotionPrimitives.tsx';
import { formatFcfa } from '../../../utils/format.ts';
import type { PaymentMethodConfig } from '../../../types/erp.ts';
import type { SaleCalculationResult } from '../utils/saleCalculations.ts';
import {
  buildNextPaymentRow,
  type PosCheckoutReadiness,
} from '../utils/posCartBuilders.ts';

interface PosPaymentPanelProps {
  posSaleType: 'cash' | 'credit';
  globalDiscount: number;
  onGlobalDiscountChange: (value: number) => void;
  totals: SaleCalculationResult;
  returnedPackagingAmount?: number;
  returnedPackagingPieces?: number;
  paymentRows: Array<{ method_code: string; amount: number }>;
  onPaymentRowsChange: (
    updater: (
      prev: Array<{ method_code: string; amount: number }>
    ) => Array<{ method_code: string; amount: number }>
  ) => void;
  activeMethods: PaymentMethodConfig[];
  errorMsg: string | null;
  readiness: PosCheckoutReadiness;
  isOnline?: boolean;
  isSubmitting: boolean;
  onSubmitSale: () => void;
}

export function PosPaymentPanel({
  posSaleType,
  globalDiscount,
  onGlobalDiscountChange,
  totals,
  returnedPackagingAmount = 0,
  returnedPackagingPieces = 0,
  paymentRows,
  onPaymentRowsChange,
  activeMethods,
  errorMsg,
  readiness,
  isOnline = true,
  isSubmitting,
  onSubmitSale,
}: PosPaymentPanelProps) {
  const paidTotal = totals.paidTotal;
  const cashRemaining = totals.isValid ? (totals.remainingAmount ?? 0) : 0;
  const cashOverpaid = totals.isValid ? (totals.overpaidAmount ?? 0) : 0;

  return (
    <>
      <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3 text-xs">
        <div className="flex justify-between">
          <span className="text-[#667085] dark:text-slate-400">Marchandises (net lignes)</span>
          <span className="font-mono-num font-medium">
            {totals.subtotalMerch !== null ? formatFcfa(totals.subtotalMerch) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="pos-global-discount"
            className="text-[#667085] dark:text-slate-400"
          >
            Remise globale
          </label>
          <MoneyInput
            id="pos-global-discount"
            value={globalDiscount}
            onChange={onGlobalDiscountChange}
            className="w-40"
          />
        </div>
        <div className="flex justify-between">
          <span className="text-[#667085] dark:text-slate-400">Consignes emballages</span>
          <span className="font-mono-num font-medium text-[#8A5A0B] dark:text-amber-300">
            {totals.totalDeposit !== null ? formatFcfa(totals.totalDeposit) : '—'}
          </span>
        </div>
        <div className="flex justify-between border-t border-slate-200 dark:border-slate-800 pt-2 text-sm font-bold">
          <span>Total à payer</span>
          <span className="font-mono-num text-[#1D4ED8] dark:text-[#60A5FA]">
            {totals.isValid && totals.grandTotal !== null ? formatFcfa(totals.grandTotal) : '—'}
          </span>
        </div>
        {returnedPackagingPieces > 0 && (
          <div className="flex justify-between rounded-md bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 px-2.5 py-1.5 text-[11px]">
            <span className="font-medium text-emerald-800 dark:text-emerald-300">
              Retour emballages ({returnedPackagingPieces} pcs · hors total)
            </span>
            <span className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">
              {formatFcfa(returnedPackagingAmount)}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold">Encaissement (simple ou mixte)</span>
          <div className="flex items-center gap-2.5">
            {posSaleType === 'cash' &&
              totals.isValid &&
              totals.grandTotal !== null &&
              totals.grandTotal > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onPaymentRowsChange((prev) => [
                      {
                        method_code: prev[0]?.method_code || activeMethods[0]?.code || 'cash',
                        amount: totals.grandTotal as number,
                      },
                    ])
                  }
                  className="text-[11px] font-semibold text-[#1D4ED8] dark:text-[#60A5FA] hover:underline"
                >
                  Solder {formatFcfa(totals.grandTotal)} (F8)
                </button>
              )}
            <button
              type="button"
              onClick={() =>
                onPaymentRowsChange((prev) => [
                  ...prev,
                  buildNextPaymentRow(prev, activeMethods, totals.remainingAmount),
                ])
              }
              className="text-[11px] font-medium text-[#1D4ED8] dark:text-[#60A5FA] hover:underline"
            >
              + Ajouter moyen
            </button>
          </div>
        </div>

        {paymentRows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select
              aria-label={`Moyen de paiement ${idx + 1}`}
              value={row.method_code}
              onChange={(e) =>
                onPaymentRowsChange((prev) =>
                  prev.map((p, i) => (i === idx ? { ...p, method_code: e.target.value } : p))
                )
              }
              className="w-40 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs"
            >
              {activeMethods.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
            <MoneyInput
              aria-label={`Montant encaissé ligne ${idx + 1}`}
              value={row.amount}
              onChange={(amt) =>
                onPaymentRowsChange((prev) =>
                  prev.map((p, i) => (i === idx ? { ...p, amount: amt } : p))
                )
              }
              className="flex-1"
            />
            {paymentRows.length > 1 && (
              <button
                type="button"
                aria-label={`Retirer le moyen de paiement ${idx + 1}`}
                onClick={() => onPaymentRowsChange((prev) => prev.filter((_, i) => i !== idx))}
                className="rounded p-1 text-slate-400 hover:text-[#BE123C]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}

        <div className="space-y-1 pt-1 text-xs">
          <div className="flex justify-between">
            <span className="text-[#667085] dark:text-slate-400">
              {posSaleType === 'credit' ? 'Acompte immédiat saisi' : 'Total saisi'}
            </span>
            <span className="font-mono-num font-semibold">
              {paidTotal !== null ? formatFcfa(paidTotal) : '—'}
            </span>
          </div>

          {posSaleType === 'credit' ? (
            <div className="flex justify-between">
              <span className="text-[#667085] dark:text-slate-400">Reste en créance client</span>
              <span className="font-mono-num font-semibold text-[#8A5A0B] dark:text-amber-300">
                {totals.isValid && totals.remainingAmount !== null
                  ? formatFcfa(totals.remainingAmount)
                  : '—'}
              </span>
            </div>
          ) : (
            totals.isValid &&
            totals.grandTotal !== null && (
              <div
                className={`flex items-center justify-between font-medium ${
                  cashRemaining > 0
                    ? 'text-[#8A5A0B] dark:text-amber-300'
                    : cashOverpaid > 0
                      ? 'text-[#BE123C] dark:text-rose-400'
                      : 'text-[#16A36A] dark:text-emerald-400'
                }`}
              >
                <span>
                  {cashRemaining > 0
                    ? 'Reste à encaisser'
                    : cashOverpaid > 0
                      ? 'Trop-perçu à ajuster'
                      : 'Écart de règlement'}
                </span>
                <span className="font-mono-num font-bold">
                  {cashRemaining > 0
                    ? formatFcfa(cashRemaining)
                    : cashOverpaid > 0
                      ? `+${formatFcfa(cashOverpaid)}`
                      : formatFcfa(0)}
                </span>
              </div>
            )
          )}
        </div>
      </div>

      {totals.hasItems && !totals.isValid && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-[#BE123C] space-y-1"
        >
          {totals.errors.map((err, i) => (
            <div key={i}>{err}</div>
          ))}
        </div>
      )}

      {errorMsg && <InlineAlert variant="error" message={errorMsg} />}

      {readiness.phase !== 'empty' && (
        <div
          role={readiness.phase === 'failed' ? 'alert' : 'status'}
          aria-live="polite"
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
            readiness.phase === 'ready'
              ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
              : readiness.phase === 'submitting'
                ? 'border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 text-[#1D4ED8] dark:text-blue-300'
                : readiness.phase === 'failed' || !isOnline
                  ? 'border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 text-[#BE123C] dark:text-rose-300'
                  : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300'
          }`}
        >
          {readiness.phase === 'submitting' ? (
            <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin shrink-0" />
          ) : readiness.phase === 'ready' && isOnline ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : !isOnline ? (
            <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-semibold">{readiness.headline}</div>
            {readiness.detail && (
              <div className="opacity-90 mt-0.5">{readiness.detail}</div>
            )}
          </div>
        </div>
      )}

      <motion.button
        type="button"
        whileHover={!readiness.canSubmit || isSubmitting ? undefined : DP_BUTTON_HOVER}
        whileTap={!readiness.canSubmit || isSubmitting ? undefined : DP_BUTTON_TAP}
        transition={DP_SPRING_SNAPPY}
        disabled={!readiness.canSubmit || isSubmitting}
        onClick={onSubmitSale}
        className="w-full rounded-xl bg-[#0D7A4C] py-3 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm hover:shadow-[0_10px_22px_-6px_rgba(22,163,106,0.45)] transition-all disabled:bg-[#B7DACB] disabled:text-[#0A3F28] disabled:opacity-100"
      >
        {isSubmitting
          ? 'Validation en cours…'
          : readiness.phase === 'failed'
            ? 'Réessayer la validation (F9)'
            : 'Valider la vente (F9)'}
      </motion.button>
    </>
  );
}
