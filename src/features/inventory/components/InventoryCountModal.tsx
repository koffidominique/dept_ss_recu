import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { ConfirmationDialog } from '../../../components/common/ConfirmationDialog.tsx';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { InlineAlert } from '../../../components/common/InlineAlert.tsx';
import { QuantityInput } from '../../../components/common/QuantityInput.tsx';
import { formatDateTime, formatQty } from '../../../utils/format.ts';
import type { InventoryRecord } from '../types.ts';
import {
  evaluateInventoryDraftLines,
  formatMilliExactString,
} from '../utils/phase2OperationsGuards.ts';
import { evaluateUnsavedChanges } from '../../quality/utils/operationalSafety.ts';

interface InventoryCountModalProps {
  inventory: InventoryRecord | null;
  onClose: () => void;
  errorMsg: string | null;
  isPending: boolean;
  onValidate: (
    id: number,
    lines: Array<{ product_id: number; counted_quantity: string; reason?: string }>
  ) => void;
}

function buildInitialCounts(inv: InventoryRecord): Record<number, string> {
  const init: Record<number, string> = {};
  inv.lines.forEach((l) => {
    const val = l.counted_milli !== null ? l.counted_milli : l.theoretical_milli;
    init[l.product_id] = formatMilliExactString(val);
  });
  return init;
}

function buildInitialReasons(inv: InventoryRecord): Record<number, string> {
  const init: Record<number, string> = {};
  inv.lines.forEach((l) => {
    init[l.product_id] = l.reason || '';
  });
  return init;
}

function InventoryCountBody({
  inventory,
  errorMsg,
  isPending,
  onValidate,
  onClose,
}: {
  inventory: InventoryRecord;
  errorMsg: string | null;
  isPending: boolean;
  onValidate: InventoryCountModalProps['onValidate'];
  onClose: () => void;
}) {
  const [counts, setCounts] = useState<Record<number, string>>(() => buildInitialCounts(inventory));
  const [reasons, setReasons] = useState<Record<number, string>>(() =>
    buildInitialReasons(inventory)
  );
  const [countSearch, setCountSearch] = useState('');
  const [onlyDiscrepancies, setOnlyDiscrepancies] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);

  const evaluation = useMemo(
    () => evaluateInventoryDraftLines(inventory.lines, counts, reasons),
    [inventory.lines, counts, reasons]
  );

  const q = countSearch.trim().toLowerCase();
  const visibleLines = evaluation.lines.filter(({ line, deltaMilli }) => {
    if (onlyDiscrepancies && deltaMilli === 0) return false;
    if (
      q &&
      !line.product_name.toLowerCase().includes(q) &&
      !line.product_reference.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
  const isReadonly = inventory.status !== 'draft';
  const unsaved = evaluateUnsavedChanges({
    dirty: !isReadonly && Object.keys(reasons).length > 0,
    submitting: isPending,
    contextLabel: `Inventaire ${inventory.reference}`,
  });

  /** Fermeture demandée : interceptée si des motifs sont saisis sans validation. */
  const requestClose = () => {
    if (unsaved.hasUnsavedChanges) {
      setLeavePromptOpen(true);
      return;
    }
    onClose();
  };

  const submitValidation = () => {
    const lines = inventory.lines.map((l) => ({
      product_id: l.product_id,
      counted_quantity:
        counts[l.product_id] ??
        formatMilliExactString(
          l.counted_milli !== null ? l.counted_milli : l.theoretical_milli
        ),
      reason: reasons[l.product_id]?.trim() || undefined,
    }));
    setConfirmOpen(false);
    onValidate(inventory.id, lines);
  };

  return (
    <>
      {errorMsg && <InlineAlert message={errorMsg} className="mt-3" />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2.5 text-xs">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#667085] dark:text-[#94A3B8]" />
          <input
            type="text"
            value={countSearch}
            onChange={(e) => setCountSearch(e.target.value)}
            placeholder="Filtrer un article (nom ou référence)..."
            aria-label="Filtrer les articles de l'inventaire"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-8 pr-2.5 py-1.5 text-xs"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyDiscrepancies}
            onChange={(e) => setOnlyDiscrepancies(e.target.checked)}
          />
          <span>Écarts uniquement</span>
        </label>
        <span className="font-mono-num text-[11px] font-semibold text-[#667085] dark:text-slate-300">
          {inventory.lines.length} article(s) ·{' '}
          <span
            className={
              evaluation.totalDiscrepancies > 0 ? 'text-[#8A5A0B] dark:text-[#FBBF24]' : 'text-[#16A36A]'
            }
          >
            {evaluation.totalDiscrepancies} écart(s)
          </span>
        </span>
      </div>

      {!isReadonly && evaluation.blockingMessage && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{evaluation.blockingMessage}</span>
          </span>
          {evaluation.missingReasonCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setCountSearch('');
                setOnlyDiscrepancies(true);
              }}
              className="rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold hover:bg-amber-50"
            >
              Afficher les écarts à justifier
            </button>
          )}
        </div>
      )}

      <div className="mt-3 max-h-[52vh] overflow-y-auto space-y-2.5 pr-1">
        {visibleLines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 py-6 text-center text-xs text-[#667085] dark:text-[#94A3B8]">
            Aucun article ne correspond au filtre actif.
          </div>
        ) : (
          visibleLines.map((item) => {
            const { line, enteredStr, deltaMilli, deltaFormatted, missingReason, qtyError } = item;
            return (
              <div
                key={line.id}
                className={`grid grid-cols-12 items-center gap-3 rounded-lg border p-3 text-xs ${
                  missingReason || qtyError
                    ? 'border-amber-300 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="col-span-12 sm:col-span-4">
                  <div className="font-medium text-[#182230] dark:text-slate-100">
                    {line.product_name}
                  </div>
                  <div className="font-mono-num text-[11px] text-[#667085] dark:text-[#94A3B8]">
                    {line.product_reference} · Théorique :{' '}
                    {formatQty(line.theoretical_milli, line.base_unit)}
                  </div>
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <QuantityInput
                    label="Compté"
                    value={enteredStr}
                    disabled={isReadonly}
                    error={qtyError || undefined}
                    onChange={(v) => setCounts((p) => ({ ...p, [line.product_id]: v }))}
                    unit={line.base_unit}
                  />
                </div>
                <div className="col-span-6 sm:col-span-2 text-right">
                  <div className="text-[11px] text-[#667085] dark:text-[#94A3B8]">Écart</div>
                  <div
                    className={`font-mono-num font-semibold ${
                      deltaMilli === 0
                        ? 'text-[#16A36A]'
                        : deltaMilli > 0
                          ? 'text-[#1D4ED8] dark:text-[#60A5FA]'
                          : 'text-[#BE123C]'
                    }`}
                  >
                    {deltaFormatted} {item.validQty ? line.base_unit : ''}
                  </div>
                </div>
                <div className="col-span-12 sm:col-span-3">
                  <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">
                    Motif {deltaMilli !== 0 ? '* (min. 3 car.)' : '(optionnel)'}
                  </label>
                  <input
                    type="text"
                    disabled={isReadonly}
                    aria-invalid={missingReason}
                    value={reasons[line.product_id] || ''}
                    onChange={(e) =>
                      setReasons((p) => ({ ...p, [line.product_id]: e.target.value }))
                    }
                    placeholder={deltaMilli !== 0 ? 'Casse, erreur comptage…' : '—'}
                    className={`mt-1 w-full rounded-lg border bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 ${
                      missingReason
                        ? 'border-amber-400 dark:border-amber-600'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={requestClose}
          className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
        >
          Fermer
        </button>
        {inventory.status === 'draft' && (
          <button
            type="button"
            disabled={isPending || !evaluation.canValidate}
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D7A4C] px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-[#B7DACB] disabled:text-[#0A3F28] disabled:opacity-100"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isPending ? 'Validation en cours…' : 'Valider et ajuster le stock'}
          </button>
        )}
      </div>

      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!isPending) setConfirmOpen(next);
        }}
        title={`Valider définitivement l’inventaire ${inventory.reference} ?`}
        description="Cette validation est irréversible : elle fige la fiche d’inventaire et aligne immédiatement les stocks physiques par écritures traçables."
        consequences={[
          `Articles contrôlés : ${inventory.lines.length}`,
          `Écarts positifs (entrées d’ajustement) : ${evaluation.positiveDiscrepancies}`,
          `Écarts négatifs (sorties d’ajustement) : ${evaluation.negativeDiscrepancies}`,
          `Chaque écart génère un mouvement immuable « Ajustement inventaire » au journal de stock.`,
        ]}
        confirmLabel="Confirmer et ajuster le stock"
        destructive={evaluation.negativeDiscrepancies > 0}
        loading={isPending}
        onConfirm={submitValidation}
      />

      <ConfirmationDialog
        open={leavePromptOpen}
        onOpenChange={setLeavePromptOpen}
        title="Fermer sans valider l’inventaire ?"
        description={
          unsaved.leaveWarning ??
          'Les motifs d’écart saisis seront perdus. La fiche restera en brouillon.'
        }
        consequences={[
          `Articles comptés saisis : ${Object.keys(counts).length} sur ${inventory.lines.length}`,
          `Écarts en attente de justification : ${evaluation.missingReasonCount}`,
          'La fiche reste en brouillon : aucun mouvement de stock n’est enregistré.',
        ]}
        confirmLabel="Fermer et perdre les saisies"
        cancelLabel="Continuer le comptage"
        destructive
        onConfirm={() => {
          setLeavePromptOpen(false);
          onClose();
        }}
      />
    </>
  );
}

export function InventoryCountModal({
  inventory,
  onClose,
  errorMsg,
  isPending,
  onValidate,
}: InventoryCountModalProps) {
  return (
    <ModalDialog
      open={Boolean(inventory)}
      onOpenChange={(o) => {
        if (!o && !isPending) onClose();
      }}
      title={inventory ? `Inventaire · ${inventory.reference}` : ''}
      description={
        inventory
          ? inventory.status === 'draft'
            ? 'Saisissez les quantités physiques comptées et justifiez tout écart avant validation irréversible.'
            : `Validé le ${formatDateTime(inventory.validated_at)}`
          : undefined
      }
      tipsTopicId="inventories"
      tipsLabel="Aide écarts"
      maxWidthClass="max-w-3xl"
    >
      {inventory && (
        <InventoryCountBody
          key={inventory.id}
          inventory={inventory}
          errorMsg={errorMsg}
          isPending={isPending}
          onValidate={onValidate}
          onClose={onClose}
        />
      )}
    </ModalDialog>
  );
}
