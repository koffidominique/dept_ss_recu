import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { InlineAlert } from '../../../components/common/InlineAlert.tsx';
import { allocationBlocker } from '../utils/deliveryRuns.ts';
import type {
  DeliveryRunStop,
  ReturnAllocationInput,
  RunReturnInput,
} from '../../../types/erp.ts';

/**
 * Retour de vides d'une tournée.
 *
 * Deux niveaux, et le second n'est pas décoratif :
 *  1. ce qui est **rapporté** au dépôt, par consignable, bons et abîmés ;
 *  2. **chez quel client** ces vides ont été repris.
 *
 * Sans le second, le stock entrerait sans que personne ne soit crédité : le
 * parc grossirait et les consignes resteraient ouvertes. La somme par
 * consignable doit donc égaler exactement ce qui est rapporté — c'est la règle
 * du cœur, et le formulaire la reflète au lieu de la laisser découvrir par un
 * message d'erreur.
 */
export interface ReturnableOption {
  id: number;
  name: string;
}

/** Payload du retour : les deux niveaux sont obligatoires, le second n'est pas
 *  une décoration — sans lui le stock bougerait sans contrepartie client. */
export interface RunReturnPayload {
  returns: RunReturnInput[];
  allocations: ReturnAllocationInput[];
}

export function DeliveryRunReturnModal({
  open,
  onOpenChange,
  stops,
  returnables,
  error,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stops: DeliveryRunStop[];
  returnables: ReturnableOption[];
  error: string | null;
  isPending: boolean;
  onSubmit: (payload: RunReturnPayload) => void;
}) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Retour de vides"
      subtitle="Les vides rapportés entrent en stock, et sont imputés aux clients chez qui ils ont été repris."
      maxWidthClass="max-w-2xl"
      scrollable
      error={error}
    >
      {open && (
        <ReturnForm
          stops={stops}
          returnables={returnables}
          isPending={isPending}
          onSubmit={onSubmit}
        />
      )}
    </ModalDialog>
  );
}

interface DraftRow {
  returnable_id: number;
  good: string;
  damaged: string;
}

function ReturnForm({
  stops,
  returnables,
  isPending,
  onSubmit,
}: {
  stops: DeliveryRunStop[];
  returnables: ReturnableOption[];
  isPending: boolean;
  onSubmit: (payload: RunReturnPayload) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [allocClient, setAllocClient] = useState<number>(stops[0]?.client_id ?? 0);
  const [allocReturnable, setAllocReturnable] = useState<number>(returnables[0]?.id ?? 0);
  const [allocGood, setAllocGood] = useState('');
  const [allocDamaged, setAllocDamaged] = useState('');
  const [allocations, setAllocations] = useState<Array<ReturnAllocationInput & { clientName: string }>>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const totalGood = rows.reduce((s, r) => s + (Number(r.good) || 0), 0);
  const totalDamaged = rows.reduce((s, r) => s + (Number(r.damaged) || 0), 0);

  const allocatedGoodByReturnable = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of allocations) m.set(a.returnable_id, (m.get(a.returnable_id) ?? 0) + a.good_pieces);
    return m;
  }, [allocations]);

  const allocatedDamagedByReturnable = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of allocations)
      m.set(a.returnable_id, (m.get(a.returnable_id) ?? 0) + a.damaged_pieces);
    return m;
  }, [allocations]);

  const addRow = () => {
    setRows((prev) => [...prev, { returnable_id: returnables[0]?.id ?? 0, good: '0', damaged: '0' }]);
  };

  const addAllocation = () => {
    if (allocClient <= 0 || allocReturnable <= 0) {
      setLocalError('Choisissez un client et un emballage.');
      return;
    }
    const good = Math.max(0, Math.trunc(Number(allocGood) || 0));
    const damaged = Math.max(0, Math.trunc(Number(allocDamaged) || 0));
    if (good === 0 && damaged === 0) {
      setLocalError('Indiquez au moins une pièce reprise chez ce client.');
      return;
    }
    const clientName = stops.find((s) => s.client_id === allocClient)?.client_name ?? '';
    setAllocations((prev) => [
      ...prev,
      { client_id: allocClient, clientName, returnable_id: allocReturnable, good_pieces: good, damaged_pieces: damaged },
    ]);
    setAllocGood('');
    setAllocDamaged('');
    setLocalError(null);
  };

  const buildPayload = (): RunReturnPayload => ({
    returns: rows
      .map((r) => ({
        returnable_id: r.returnable_id,
        good_pieces: Math.max(0, Math.trunc(Number(r.good) || 0)),
        damaged_pieces: Math.max(0, Math.trunc(Number(r.damaged) || 0)),
      }))
      .filter((r) => r.good_pieces > 0 || r.damaged_pieces > 0),
    allocations: allocations.map(({ clientName: _cn, ...rest }) => rest),
  });

  const submit = () => {
    const payload = buildPayload();
    if (payload.returns.length === 0) {
      setLocalError('Aucun vide rapporté : rien à enregistrer.');
      return;
    }
    const blocker = allocationBlocker(payload.returns, payload.allocations);
    if (blocker) {
      setLocalError(blocker);
      return;
    }
    setLocalError(null);
    onSubmit(payload);
  };

  return (
    <>
      <div className="mt-4 space-y-4 text-xs">
        {/* ① Ce qui est rapporté */}
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <h3 className="font-semibold text-[#182230] dark:text-slate-100">
            ① Vides rapportés au dépôt
          </h3>
          <p className="mt-0.5 text-[11px] text-[#667085] dark:text-[#94A3B8]">
            Tous clients confondus. {totalGood + totalDamaged} pièce(s) déclarée(s).
          </p>

          <div className="mt-2 space-y-2">
            {rows.map((row, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[160px] flex-1">
                  <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">Emballage</label>
                  <select
                    aria-label={`Emballage ligne ${idx + 1}`}
                    value={row.returnable_id}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, returnable_id: Number(e.target.value) } : r))
                      )
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                  >
                    {returnables.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">Bons</label>
                  <input
                    aria-label={`Bons ligne ${idx + 1}`}
                    type="text"
                    inputMode="numeric"
                    value={row.good}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === idx ? { ...r, good: e.target.value.replace(/[^\d]/g, '') } : r
                        )
                      )
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono-num"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">Abîmés</label>
                  <input
                    aria-label={`Abîmés ligne ${idx + 1}`}
                    type="text"
                    inputMode="numeric"
                    value={row.damaged}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === idx ? { ...r, damaged: e.target.value.replace(/[^\d]/g, '') } : r
                        )
                      )
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono-num"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px]"
                >
                  Retirer
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-medium"
          >
            + Ajouter un emballage rapporté
          </button>
        </section>

        {/* ② Chez qui */}
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <h3 className="font-semibold text-[#182230] dark:text-slate-100">
            ② Chez quel client ont-ils été repris
          </h3>
          <p className="mt-0.5 text-[11px] text-[#667085] dark:text-[#94A3B8]">
            Le livreur sait chez qui il a repris. La répartition est une observation, pas un
            calcul : c’est elle qui solde la consigne du bon client.
          </p>

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[150px] flex-1">
              <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">Client</label>
              <select
                aria-label="Client de la reprise"
                value={allocClient}
                onChange={(e) => setAllocClient(Number(e.target.value))}
                className="mt-0.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
              >
                {stops.map((s) => (
                  <option key={s.client_id} value={s.client_id}>
                    {s.client_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[140px] flex-1">
              <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">Emballage</label>
              <select
                aria-label="Emballage de la reprise"
                value={allocReturnable}
                onChange={(e) => setAllocReturnable(Number(e.target.value))}
                className="mt-0.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
              >
                {returnables.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-20">
              <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">Bons</label>
              <input
                aria-label="Pièces bonnes reprises"
                type="text"
                inputMode="numeric"
                value={allocGood}
                onChange={(e) => setAllocGood(e.target.value.replace(/[^\d]/g, ''))}
                className="mt-0.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono-num"
              />
            </div>
            <div className="w-20">
              <label className="block text-[11px] text-[#667085] dark:text-[#94A3B8]">Abîmés</label>
              <input
                aria-label="Pièces abîmées reprises"
                type="text"
                inputMode="numeric"
                value={allocDamaged}
                onChange={(e) => setAllocDamaged(e.target.value.replace(/[^\d]/g, ''))}
                className="mt-0.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono-num"
              />
            </div>
            <button
              type="button"
              onClick={addAllocation}
              className="rounded-lg bg-slate-900 dark:bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-white dark:text-slate-900"
            >
              Ajouter
            </button>
          </div>

          {allocations.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {allocations.map((a, i) => (
                <li key={i} className="flex items-center justify-between py-1.5">
                  <span>
                    {a.clientName} — {returnables.find((r) => r.id === a.returnable_id)?.name} :{' '}
                    {a.good_pieces} bon(s), {a.damaged_pieces} abîmé(s)
                  </span>
                  <button
                    type="button"
                    onClick={() => setAllocations((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[11px] text-[#BE123C]"
                  >
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Contrôle d'équilibre en direct : l'utilisateur voit le manque
              avant de valider, pas après un refus serveur. */}
          {rows.length > 0 && (
            <div className="mt-2 space-y-1 rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2 text-[11px]">
              {rows
                .filter((r) => (Number(r.good) || 0) + (Number(r.damaged) || 0) > 0)
                .map((r, i) => {
                  const name = returnables.find((x) => x.id === r.returnable_id)?.name ?? '?';
                  const good = Number(r.good) || 0;
                  const damaged = Number(r.damaged) || 0;
                  const ag = allocatedGoodByReturnable.get(r.returnable_id) ?? 0;
                  const ad = allocatedDamagedByReturnable.get(r.returnable_id) ?? 0;
                  const ok = good === ag && damaged === ad;
                  return (
                    <div key={i} className={ok ? 'text-[#16A36A]' : 'text-[#8A5A0B] dark:text-amber-300'}>
                      {name} : rapportés {good} bon(s) / {damaged} abîmé(s) · répartis {ag} / {ad}
                      {ok ? ' ✓' : ' — reste à répartir'}
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {localError && <InlineAlert variant="error" message={localError} onDismiss={() => setLocalError(null)} />}
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
          onClick={submit}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isPending ? 'Enregistrement…' : 'Enregistrer le retour'}
        </button>
      </div>
    </>
  );
}
