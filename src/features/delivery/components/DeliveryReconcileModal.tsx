import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { MoneyInput } from '../../../components/common/MoneyInput.tsx';
import { InlineAlert } from '../../../components/common/InlineAlert.tsx';
import { reconciliationBlocker } from '../utils/deliveryRuns.ts';
import type { DeliveryReconciliation } from '../../../types/erp.ts';

/**
 * Réconciliation d'une tournée rentrée.
 *
 * C'est le seul endroit du module qui écrit en caisse. Le montant qui y entre
 * est le **compté**, jamais le déclaré : si le livreur annonce 10 000 et rend
 * 9 500, faire entrer 10 000 rendrait la caisse théorique fausse de 500 à
 * chaque tournée. L'écart est constaté et motivé, pas absorbé.
 */
export function DeliveryReconcileModal({
  open,
  onOpenChange,
  summary,
  error,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: DeliveryReconciliation | null;
  error: string | null;
  isPending: boolean;
  onSubmit: (payload: { counted_amount: number; discrepancy_reason: string | null }) => void;
}) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Réconciliation · ${summary?.reference ?? ''}`}
      subtitle="Le compté entre en caisse. L’écart est constaté, jamais absorbé."
      maxWidthClass="max-w-lg"
      error={error}
    >
      {open && summary && (
        <ReconcileForm summary={summary} isPending={isPending} onSubmit={onSubmit} />
      )}
    </ModalDialog>
  );
}

function ReconcileForm({
  summary,
  isPending,
  onSubmit,
}: {
  summary: DeliveryReconciliation;
  isPending: boolean;
  onSubmit: (payload: { counted_amount: number; discrepancy_reason: string | null }) => void;
}) {
  const [counted, setCounted] = useState<number>(summary.declared_amount);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const declaredGap = summary.declared_amount - summary.expected_amount;
  const cashGap = Number.isFinite(counted) ? counted - summary.declared_amount : 0;
  const hasGap = declaredGap !== 0 || cashGap !== 0;

  return (
    <>
      <div className="mt-4 space-y-3 text-xs">
        <div className="space-y-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2">
          <Row label="Attendu (figé au chargement)" value={summary.expected_amount} />
          <Row label="Déclaré par le livreur" value={summary.declared_amount} />
          <Row
            label="Écart de déclaration"
            value={declaredGap}
            tone={declaredGap === 0 ? undefined : declaredGap < 0 ? 'danger' : 'warning'}
          />
        </div>

        <MoneyInput label="Montant compté dans le sac *" value={counted} onChange={setCounted} />

        <div className="rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2">
          <Row
            label="Écart de caisse (compté − déclaré)"
            value={cashGap}
            tone={cashGap === 0 ? undefined : cashGap < 0 ? 'danger' : 'warning'}
          />
        </div>

        {summary.by_method.length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
            <p className="mb-1 font-medium text-[#182230] dark:text-slate-100">Par moyen de paiement</p>
            {summary.by_method.map((m) => (
              <div key={m.method_code} className="flex justify-between py-0.5">
                <span className="text-[#667085] dark:text-[#94A3B8]">{m.method_code}</span>
                <span className="font-mono-num">
                  {m.declared.toLocaleString('fr-FR')} / {m.expected.toLocaleString('fr-FR')} attendu
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
          <p className="mb-1 font-medium text-[#182230] dark:text-slate-100">Vides</p>
          <div className="flex justify-between py-0.5">
            <span className="text-[#667085] dark:text-[#94A3B8]">Attendus (arrêts livrés)</span>
            <span className="font-mono-num">{summary.expected_empty_pieces} pcs</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-[#667085] dark:text-[#94A3B8]">Récupérés</span>
            <span className="font-mono-num">
              {summary.returned_good_pieces} bons / {summary.returned_damaged_pieces} abîmés
            </span>
          </div>
        </div>

        {hasGap && (
          <div>
            <label className="block font-medium" htmlFor="trn-rec-reason">
              Motif de l’écart *
            </label>
            <textarea
              id="trn-rec-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Ex : 500 F manquants, le livreur n’a pas le billet"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
            />
          </div>
        )}

        {localError && (
          <InlineAlert variant="error" message={localError} onDismiss={() => setLocalError(null)} />
        )}

        <p className="rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-[11px] text-[#1D4ED8] dark:text-[#60A5FA]">
          {counted.toLocaleString('fr-FR')} FCFA entreront en caisse. La tournée devient
          définitive : une réconciliation ne se rejoue pas.
        </p>
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
          disabled={isPending}
          onClick={() => {
            const blocker = reconciliationBlocker(
              summary.expected_amount,
              summary.declared_amount,
              counted,
              reason
            );
            if (blocker) {
              setLocalError(blocker);
              return;
            }
            setLocalError(null);
            onSubmit({ counted_amount: counted, discrepancy_reason: reason.trim() || null });
          }}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isPending ? 'Réconciliation…' : 'Réconcilier et encaisser'}
        </button>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'danger' | 'warning';
}) {
  const color =
    tone === 'danger'
      ? 'text-[#BE123C] font-semibold'
      : tone === 'warning'
        ? 'text-[#8A5A0B] dark:text-amber-300 font-semibold'
        : 'text-[#182230] dark:text-slate-100';
  return (
    <div className="flex justify-between">
      <span className="text-[#667085] dark:text-[#94A3B8]">{label}</span>
      <span className={`font-mono-num ${color}`}>{value.toLocaleString('fr-FR')} FCFA</span>
    </div>
  );
}
