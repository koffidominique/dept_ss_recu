import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { QuantityInput } from '../../../components/common/QuantityInput.tsx';
import type { PurchaseOrder } from '../../../types/erp.ts';
import { formatQty } from '../../../utils/format.ts';

export interface PurchaseReceiveSubmitValues {
  target: PurchaseOrder;
  receiveQty: Record<number, string>;
  missingQty: Record<number, string>;
  damagedQty: Record<number, string>;
  refusedQty: Record<number, string>;
  receiveReason: Record<number, string>;
  notes: string;
}

interface PurchaseReceiveModalProps {
  target: PurchaseOrder | null;
  onClose: () => void;
  error: string | null;
  isPending: boolean;
  onSubmit: (values: PurchaseReceiveSubmitValues) => void;
}

function buildInitialReceiveQty(target: PurchaseOrder): Record<number, string> {
  const initQty: Record<number, string> = {};
  target.lines.forEach((l) => {
    const remMilli = l.ordered_quantity_milli - l.received_quantity_milli;
    if (remMilli > 0) {
      const intPart = Math.floor(remMilli / 1000);
      const frac = remMilli % 1000;
      initQty[l.id] =
        frac === 0
          ? String(intPart)
          : `${intPart}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
    }
  });
  return initQty;
}

function parseSimpleNum(raw?: string): number {
  const n = Number((raw || '').replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function PurchaseReceiveFormBody({
  target,
  isPending,
  onSubmit,
}: {
  target: PurchaseOrder;
  isPending: boolean;
  onSubmit: PurchaseReceiveModalProps['onSubmit'];
}) {
  const [receiveQty, setReceiveQty] = useState<Record<number, string>>(() =>
    buildInitialReceiveQty(target)
  );
  const [missingQty, setMissingQty] = useState<Record<number, string>>({});
  const [damagedQty, setDamagedQty] = useState<Record<number, string>>({});
  const [refusedQty, setRefusedQty] = useState<Record<number, string>>({});
  const [receiveReason, setReceiveReason] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');

  const missingRequiredReason = target.lines.some((l) => {
    const rem = Math.max(0, l.ordered_quantity_milli - l.received_quantity_milli) / 1000;
    if (rem <= 0) return false;
    const rec = parseSimpleNum(receiveQty[l.id]);
    const hasGap =
      parseSimpleNum(missingQty[l.id]) > 0 ||
      parseSimpleNum(damagedQty[l.id]) > 0 ||
      parseSimpleNum(refusedQty[l.id]) > 0 ||
      (rec > 0 && rec < rem - 0.0001);
    return hasGap && !(receiveReason[l.id] || '').trim();
  });

  return (
    <>
      <div className="mt-4 space-y-3">
        {target.lines.map((l) => {
          const remMilli = l.ordered_quantity_milli - l.received_quantity_milli;
          if (remMilli <= 0) return null;
          const remUnits = remMilli / 1000;
          const rec = parseSimpleNum(receiveQty[l.id]);
          const hasGap =
            parseSimpleNum(missingQty[l.id]) > 0 ||
            parseSimpleNum(damagedQty[l.id]) > 0 ||
            parseSimpleNum(refusedQty[l.id]) > 0 ||
            (rec > 0 && rec < remUnits - 0.0001);

          return (
            <div
              key={l.id}
              className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2.5 text-xs"
            >
              <div className="flex justify-between">
                <span className="font-semibold">{l.product_name}</span>
                <span className="font-mono-num text-[#667085]">
                  Restant : {formatQty(remMilli, l.packaging_name)} (×
                  {formatQty(l.coefficient_milli, l.base_unit)})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <QuantityInput
                  label="Reçue conforme"
                  value={receiveQty[l.id] || ''}
                  onChange={(v) => setReceiveQty((p) => ({ ...p, [l.id]: v }))}
                  unit={l.packaging_name}
                />
                <QuantityInput
                  label="Manquante"
                  value={missingQty[l.id] || ''}
                  onChange={(v) => setMissingQty((p) => ({ ...p, [l.id]: v }))}
                  unit={l.packaging_name}
                />
                <QuantityInput
                  label="Endommagée / Casse"
                  value={damagedQty[l.id] || ''}
                  onChange={(v) => setDamagedQty((p) => ({ ...p, [l.id]: v }))}
                  unit={l.packaging_name}
                />
                <QuantityInput
                  label="Refusée"
                  value={refusedQty[l.id] || ''}
                  onChange={(v) => setRefusedQty((p) => ({ ...p, [l.id]: v }))}
                  unit={l.packaging_name}
                />
              </div>
              <div>
                <label className="block text-xs font-medium">
                  {hasGap
                    ? 'Motif d’écart / litige * (obligatoire en cas d’écart ou livraison partielle)'
                    : 'Motif d’écart (optionnel)'}
                </label>
                <input
                  type="text"
                  placeholder={hasGap ? 'Ex : 2 casiers cassés au transport, manquant à quai...' : ''}
                  value={receiveReason[l.id] || ''}
                  onChange={(e) =>
                    setReceiveReason((p) => ({ ...p, [l.id]: e.target.value }))
                  }
                  className={`mt-1 w-full rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 text-xs ${
                    hasGap && !(receiveReason[l.id] || '').trim()
                      ? 'border-amber-400 dark:border-amber-600'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                />
              </div>
            </div>
          );
        })}

        <div>
          <label className="block text-xs font-medium">Observations réception / chauffeur fournisseur</label>
          <input
            type="text"
            placeholder="N° BL fournisseur, plaque camion, remarque..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <Dialog.Close asChild>
          <button
            type="button"
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium"
          >
            Annuler
          </button>
        </Dialog.Close>
        <button
          type="button"
          disabled={isPending || missingRequiredReason}
          onClick={() =>
            onSubmit({
              target,
              receiveQty,
              missingQty,
              damagedQty,
              refusedQty,
              receiveReason,
              notes,
            })
          }
          className="rounded-lg bg-[#16A36A] px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Valider la réception en stock
        </button>
      </div>
    </>
  );
}

export function PurchaseReceiveModal({
  target,
  onClose,
  error,
  isPending,
  onSubmit,
}: PurchaseReceiveModalProps) {
  return (
    <ModalDialog
      open={Boolean(target)}
      onOpenChange={(o) => !o && onClose()}
      title={`Réceptionner · ${target?.reference ?? ''}`}
      tipsTopicId="purchases"
      tipsLabel="Aide réception"
      maxWidthClass="max-w-2xl"
      scrollable
      error={error}
    >
      {target && (
        <PurchaseReceiveFormBody
          key={target.id}
          target={target}
          isPending={isPending}
          onSubmit={onSubmit}
        />
      )}
    </ModalDialog>
  );
}
