import { useState } from 'react';
import { ConfirmationDialog } from '../../../components/common/ConfirmationDialog.tsx';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { InlineAlert } from '../../../components/common/InlineAlert.tsx';
import { formatQty, newRequestKey } from '../../../utils/format.ts';
import { parseQtyInputToMilliBigInt } from '../../sales/utils/saleCalculations.ts';
import type { StockProductRow } from '../types.ts';

const REASON_PRESETS = [
  'Casse / bouteille brisée',
  'Perte / coulage',
  'Échantillon / don',
  'Surplus constaté',
];

function parsePreviewMilli(raw: string): number | null {
  const res = parseQtyInputToMilliBigInt(raw, 'Quantité ajustée');
  if (!res.ok || res.milli > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(res.milli);
}

interface StockAdjustPayload {
  product_id: number;
  direction: 'in' | 'out';
  quantity: string;
  reason: string;
  request_key: string;
}

interface StockAdjustModalProps {
  open: boolean;
  initialProductId: number;
  products: StockProductRow[];
  isPending: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (payload: StockAdjustPayload) => void;
}

function StockAdjustFormBody({
  initialProductId,
  products,
  isPending,
  serverError,
  onClose,
  onSubmit,
}: Omit<StockAdjustModalProps, 'open'>) {
  const [adjProductId, setAdjProductId] = useState<number>(
    initialProductId || products[0]?.id || 0
  );
  const [adjDirection, setAdjDirection] = useState<'in' | 'out'>('out');
  const [adjQuantity, setAdjQuantity] = useState('1');
  const [adjReason, setAdjReason] = useState('');
  const [keyState, setKeyState] = useState<{ key: string; sig: string | null }>(() => ({
    key: newRequestKey('adj'),
    sig: null,
  }));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<StockAdjustPayload | null>(null);

  const selectedProduct = products.find((p) => p.id === adjProductId) || products[0] || null;
  const parsedQtyMilli = parsePreviewMilli(adjQuantity);
  const projectedMilli =
    selectedProduct && parsedQtyMilli !== null
      ? selectedProduct.stock_milli + (adjDirection === 'out' ? -parsedQtyMilli : parsedQtyMilli)
      : null;

  const isCriticalDrop =
    selectedProduct !== null &&
    adjDirection === 'out' &&
    projectedMilli !== null &&
    (projectedMilli <= 0 || projectedMilli <= selectedProduct.min_stock_milli);

  const displayedError = validationError || serverError;

  return (
    <div className="mt-4">
      {displayedError && <InlineAlert message={displayedError} className="mb-3" />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setValidationError(null);
          if (!selectedProduct) {
            setValidationError('Sélectionnez un produit actif.');
            return;
          }
          if (parsedQtyMilli === null) {
            setValidationError('Saisissez une quantité positive valide (max 3 décimales).');
            return;
          }
          if (adjReason.trim().length < 3) {
            setValidationError('Veuillez indiquer un motif explicite (au moins 3 caractères).');
            return;
          }
          const cleanQty = adjQuantity.trim();
          const cleanReason = adjReason.trim();
          const sig = `${selectedProduct.id}:${adjDirection}:${cleanQty}:${cleanReason}`;
          const effectiveKey =
            keyState.sig !== null && keyState.sig !== sig
              ? newRequestKey('adj')
              : keyState.key;
          setKeyState({ key: effectiveKey, sig });

          const payload: StockAdjustPayload = {
            product_id: selectedProduct.id,
            direction: adjDirection,
            quantity: cleanQty,
            reason: cleanReason,
            request_key: effectiveKey,
          };

          if (isCriticalDrop) {
            setPendingPayload(payload);
          } else {
            onSubmit(payload);
          }
        }}
        className="space-y-3.5 text-sm"
      >
        <div>
          <label className="block text-xs font-medium text-[#667085] dark:text-[#94A3B8] mb-1">
            Produit concerné *
          </label>
          <select
            aria-label="Produit concerné"
            value={selectedProduct?.id ?? ''}
            onChange={(e) => setAdjProductId(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.reference}) — Stock : {formatQty(p.stock_milli, p.base_unit)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#667085] dark:text-[#94A3B8] mb-1">
              Type d&apos;ajustement *
            </label>
            <div className="grid grid-cols-2 rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setAdjDirection('out')}
                className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  adjDirection === 'out'
                    ? 'bg-[#BE123C] text-white'
                    : 'text-[#667085] dark:text-[#94A3B8] hover:text-[#182230] dark:hover:text-slate-200'
                }`}
              >
                Sortie (-)
              </button>
              <button
                type="button"
                onClick={() => setAdjDirection('in')}
                className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  adjDirection === 'in'
                    ? 'bg-[#0D7A4C] text-white'
                    : 'text-[#667085] dark:text-[#94A3B8] hover:text-[#182230] dark:hover:text-slate-200'
                }`}
              >
                Entrée (+)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#667085] dark:text-[#94A3B8] mb-1">
              Quantité ({selectedProduct?.base_unit || 'unité'}) *
            </label>
            <input
              aria-label="Quantité ajustée"
              type="text"
              inputMode="decimal"
              required
              value={adjQuantity}
              onChange={(e) => setAdjQuantity(e.target.value)}
              placeholder="Ex: 2 ou 0.5"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono-num"
            />
          </div>
        </div>

        {selectedProduct && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs space-y-1 ${
              projectedMilli !== null && projectedMilli < 0
                ? 'border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30'
                : isCriticalDrop
                  ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20'
                  : 'bg-slate-50 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[#667085] dark:text-slate-400">Impact sur le stock :</span>
              <span className="font-mono-num font-semibold text-[#182230] dark:text-slate-100">
                {formatQty(selectedProduct.stock_milli, selectedProduct.base_unit)} →{' '}
                {projectedMilli !== null ? (
                  <span
                    className={
                      projectedMilli < 0
                        ? 'text-[#BE123C]'
                        : adjDirection === 'in'
                          ? 'text-[#16A36A]'
                          : 'text-[#8A5A0B] dark:text-[#FBBF24]'
                    }
                  >
                    {formatQty(projectedMilli, selectedProduct.base_unit)}
                  </span>
                ) : (
                  '—'
                )}
              </span>
            </div>
            {projectedMilli !== null && projectedMilli < 0 && (
              <p className="text-[11px] font-medium text-[#BE123C]">
                Attention : cet ajustement rendrait le stock négatif (refusé si le stock négatif est désactivé dans les paramètres).
              </p>
            )}
            {projectedMilli !== null &&
              projectedMilli >= 0 &&
              isCriticalDrop && (
                <p className="text-[11px] font-medium text-[#8A5A0B] dark:text-amber-300">
                  Attention : cet ajustement place l’article sous son seuil d’alerte ({formatQty(selectedProduct.min_stock_milli, selectedProduct.base_unit)}).
                </p>
              )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[#667085] dark:text-[#94A3B8] mb-1">
            Motif obligatoire (tracé dans l&apos;audit) *
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {REASON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAdjReason(preset)}
                className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] text-[#667085] dark:text-[#94A3B8] hover:border-[#2563EB] hover:text-[#1D4ED8] dark:text-[#60A5FA] dark:hover:text-[#60A5FA]"
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            aria-label="Motif d'ajustement"
            type="text"
            required
            minLength={3}
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
            placeholder="Ex: 2 bouteilles brisées lors de la manutention"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
          >
            {isPending ? 'Validation…' : "Valider l'ajustement"}
          </button>
        </div>
      </form>

      <ConfirmationDialog
        open={Boolean(pendingPayload)}
        onOpenChange={(next) => {
          if (!next && !isPending) setPendingPayload(null);
        }}
        title="Confirmer cet ajustement critique de stock ?"
        description="Cette sortie manuelle est irréversible et abaisse le stock en rupture ou sous le seuil critique."
        consequences={
          pendingPayload && selectedProduct && projectedMilli !== null
            ? [
                `Article : ${selectedProduct.name} (${selectedProduct.reference})`,
                `Variation : -${pendingPayload.quantity} ${selectedProduct.base_unit}`,
                `Nouveau stock théorique : ${formatQty(projectedMilli, selectedProduct.base_unit)}`,
                `Motif audité : ${pendingPayload.reason}`,
              ]
            : []
        }
        confirmLabel="Confirmer la sortie de stock"
        destructive
        loading={isPending}
        onConfirm={() => {
          if (!pendingPayload) return;
          const payload = pendingPayload;
          setPendingPayload(null);
          onSubmit(payload);
        }}
      />
    </div>
  );
}

export function StockAdjustModal({
  open,
  initialProductId,
  products,
  isPending,
  serverError,
  onClose,
  onSubmit,
}: StockAdjustModalProps) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose();
      }}
      title="Ajustement manuel du stock"
      description="Casse, perte, don, échantillon ou correction ponctuelle avec motif audité"
      maxWidthClass="max-w-lg"
    >
      {open && (
        <StockAdjustFormBody
          key={initialProductId}
          initialProductId={initialProductId}
          products={products}
          isPending={isPending}
          serverError={serverError}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )}
    </ModalDialog>
  );
}
