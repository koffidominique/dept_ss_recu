import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { ConfirmationDialog } from '../../../components/common/ConfirmationDialog.tsx';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { QuantityInput } from '../../../components/common/QuantityInput.tsx';
import type { PurchaseOrder } from '../../../types/erp.ts';
import { formatQty, newRequestKey } from '../../../utils/format.ts';
import {
  evaluatePurchaseReceiveLine,
  formatMilliExactString,
} from '../../inventory/utils/phase2OperationsGuards.ts';

export interface PurchaseReceiveSubmitValues {
  target: PurchaseOrder;
  receiveQty: Record<number, string>;
  missingQty: Record<number, string>;
  damagedQty: Record<number, string>;
  refusedQty: Record<number, string>;
  receiveReason: Record<number, string>;
  notes: string;
  request_key?: string;
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
      initQty[l.id] = formatMilliExactString(remMilli);
    }
  });
  return initQty;
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
  const [keyState, setKeyState] = useState<{ key: string; sig: string | null }>(() => ({
    key: newRequestKey('rec'),
    sig: null,
  }));
  const [pendingConfirm, setPendingConfirm] = useState<PurchaseReceiveSubmitValues | null>(null);

  const lineEvaluations = useMemo(
    () =>
      target.lines
        .filter((l) => l.ordered_quantity_milli - l.received_quantity_milli > 0)
        .map((line) => ({
          line,
          evalRes: evaluatePurchaseReceiveLine({
            orderedMilli: line.ordered_quantity_milli,
            alreadyReceivedMilli: line.received_quantity_milli,
            receiveRaw: receiveQty[line.id],
            missingRaw: missingQty[line.id],
            damagedRaw: damagedQty[line.id],
            refusedRaw: refusedQty[line.id],
            reasonRaw: receiveReason[line.id],
          }),
        })),
    [target.lines, receiveQty, missingQty, damagedQty, refusedQty, receiveReason]
  );

  const hasNonZeroActivity = lineEvaluations.some(
    ({ evalRes }) =>
      (evalRes.receivedMilli ?? 0) > 0 ||
      evalRes.missingMilli > 0 ||
      evalRes.damagedMilli > 0 ||
      evalRes.refusedMilli > 0
  );
  const firstError = lineEvaluations.find(({ evalRes }) => Boolean(evalRes.errorMessage));
  const blockingMessage = firstError
    ? `${firstError.line.product_name} : ${firstError.evalRes.errorMessage}`
    : !hasNonZeroActivity
      ? 'Saisissez au moins une quantité reçue ou un écart contrôlé avant de valider.'
      : null;

  const totalDiscrepancyLines = lineEvaluations.filter(
    ({ evalRes }) => evalRes.hasDiscrepancy
  ).length;
  const totalReceivedLines = lineEvaluations.filter(
    ({ evalRes }) => (evalRes.receivedMilli ?? 0) > 0
  ).length;

  return (
    <>
      {blockingMessage && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{blockingMessage}</span>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {lineEvaluations.map(({ line: l, evalRes }) => {
          return (
            <div
              key={l.id}
              className={`rounded-lg border p-3 space-y-2.5 text-xs ${
                evalRes.errorMessage
                  ? 'border-rose-300 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/10'
                  : evalRes.hasDiscrepancy
                    ? 'border-amber-300 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10'
                    : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex justify-between">
                <span className="font-semibold">{l.product_name}</span>
                <span className="font-mono-num text-[#667085] dark:text-[#94A3B8]">
                  Restant : {formatQty(evalRes.remMilli, l.packaging_name)} (×
                  {formatQty(l.coefficient_milli, l.base_unit)})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <QuantityInput
                  label="Reçue conforme"
                  value={receiveQty[l.id] || ''}
                  error={evalRes.exceedsRemaining ? 'Dépasse le reliquat' : undefined}
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
                  {evalRes.hasDiscrepancy
                    ? 'Motif d’écart / litige * (obligatoire · min. 3 car.)'
                    : 'Motif d’écart (optionnel)'}
                </label>
                <input
                  type="text"
                  aria-invalid={evalRes.missingReason}
                  placeholder={
                    evalRes.hasDiscrepancy
                      ? 'Ex : 2 casiers cassés au transport, manquant à quai...'
                      : ''
                  }
                  value={receiveReason[l.id] || ''}
                  onChange={(e) =>
                    setReceiveReason((p) => ({ ...p, [l.id]: e.target.value }))
                  }
                  className={`mt-1 w-full rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 text-xs ${
                    evalRes.missingReason
                      ? 'border-amber-400 dark:border-amber-600'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                />
              </div>
            </div>
          );
        })}

        <div>
          <label className="block text-xs font-medium">
            Observations réception / chauffeur fournisseur
          </label>
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
            disabled={isPending}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
          >
            Annuler
          </button>
        </Dialog.Close>
        <button
          type="button"
          disabled={isPending || Boolean(blockingMessage)}
          onClick={() => {
            const sig = JSON.stringify({
              id: target.id,
              receiveQty,
              missingQty,
              damagedQty,
              refusedQty,
              receiveReason,
              notes: notes.trim(),
            });
            const effectiveKey =
              keyState.sig !== null && keyState.sig !== sig
                ? newRequestKey('rec')
                : keyState.key;
            setKeyState({ key: effectiveKey, sig });
            setPendingConfirm({
              target,
              receiveQty,
              missingQty,
              damagedQty,
              refusedQty,
              receiveReason,
              notes,
              request_key: effectiveKey,
            });
          }}
          className="rounded-lg bg-[#0D7A4C] px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-[#B7DACB] disabled:text-[#0A3F28] disabled:opacity-100"
        >
          {isPending ? 'Validation en cours…' : 'Vérifier & valider la réception'}
        </button>
      </div>

      <ConfirmationDialog
        open={Boolean(pendingConfirm)}
        onOpenChange={(next) => {
          if (!next && !isPending) setPendingConfirm(null);
        }}
        title={`Confirmer la réception sur ${target.reference} ?`}
        description="Cette opération incrémente immédiatement le stock physique, émet le bon de réception (REC) et enregistre la dette fournisseur correspondante."
        consequences={[
          `Fournisseur : ${target.supplier_name}`,
          `Lignes avec marchandise reçue : ${totalReceivedLines} / ${lineEvaluations.length}`,
          ...(totalDiscrepancyLines > 0
            ? [`Lignes avec écart documenté (manquant / casse / refus) : ${totalDiscrepancyLines}`]
            : ['Aucun écart de livraison signalé.']),
        ]}
        confirmLabel="Enregistrer l’entrée en stock"
        destructive={totalDiscrepancyLines > 0}
        loading={isPending}
        onConfirm={() => {
          if (!pendingConfirm) return;
          const payload = pendingConfirm;
          setPendingConfirm(null);
          onSubmit(payload);
        }}
      />
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
      onOpenChange={(o) => {
        if (!o && !isPending) onClose();
      }}
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
