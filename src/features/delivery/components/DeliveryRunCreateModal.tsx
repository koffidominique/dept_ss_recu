import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import type { CreateDeliveryRunInput, UserAccount } from '../../../types/erp.ts';
import { buildCreateRunInput, todayIso, isDriverAccount } from '../utils/deliveryRuns.ts';

/**
 * Création d'une tournée.
 *
 * Le livreur est choisi parmi les comptes actifs. Le rôle doit porter
 * `delivery_runs:execute`, sinon la tournée est créée pour quelqu'un qui ne
 * pourra jamais la démarrer : l'écran filtre donc sur cette permission.
 * `UserAccount.id` est l'identifiant numérique attendu par le serveur ; il ne
 * faut pas confondre avec `SessionUser.userId`, qui est une chaîne.
 */
export function DeliveryRunCreateModal({
  open,
  onOpenChange,
  users,
  error,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserAccount[];
  error: string | null;
  isPending: boolean;
  onSubmit: (payload: CreateDeliveryRunInput) => void;
}) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle tournée"
      subtitle="Les montants attendus seront figés au chargement, pas à la création."
      maxWidthClass="max-w-md"
      error={error}
    >
      {open && (
        <CreateRunForm users={users} isPending={isPending} onSubmit={onSubmit} />
      )}
    </ModalDialog>
  );
}

function CreateRunForm({
  users,
  isPending,
  onSubmit,
}: {
  users: UserAccount[];
  isPending: boolean;
  onSubmit: (payload: CreateDeliveryRunInput) => void;
}) {
  const drivers = users.filter(isDriverAccount);
  const [driverId, setDriverId] = useState<number>(drivers[0]?.id ?? 0);
  const [runDate, setRunDate] = useState(todayIso());
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes] = useState('');
  // Une clé par saisie : rejouer la même création (double clic, réseau qui
  // hoquette) ne doit pas produire deux tournées.
  const [requestKey] = useState(() => `trn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const canSubmit = driverId > 0 && !isPending;

  return (
    <>
      <div className="mt-4 space-y-3 text-xs">
        <div>
          <label className="block font-medium" htmlFor="trn-driver">
            Livreur *
          </label>
          <select
            id="trn-driver"
            value={driverId}
            onChange={(e) => setDriverId(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          >
            {drivers.length === 0 && <option value={0}>Aucun compte actif</option>}
            {drivers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.username} — {u.roleLabel}
              </option>
            ))}
          </select>
          {drivers.length === 0 && (
            <p className="mt-1 text-[11px] text-[#8A5A0B] dark:text-amber-300">
              Créez au moins un compte staff avant d’ouvrir une tournée.
            </p>
          )}
        </div>

        <div>
          <label className="block font-medium" htmlFor="trn-date">
            Date de tournée
          </label>
          <input
            id="trn-date"
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono-num"
          />
        </div>

        <div>
          <label className="block font-medium" htmlFor="trn-vehicle">
            Véhicule
          </label>
          <input
            id="trn-vehicle"
            type="text"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            placeholder="Ex : Triporteur 2"
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          />
        </div>

        <div>
          <label className="block font-medium" htmlFor="trn-notes">
            Notes
          </label>
          <textarea
            id="trn-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
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
          disabled={!canSubmit}
          onClick={() => {
            const payload = buildCreateRunInput(driverId, vehicle, notes, requestKey);
            // La date choisie dans le formulaire prime sur « aujourd'hui ».
            onSubmit({ ...payload, run_date: runDate });
          }}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isPending ? 'Création…' : 'Créer la tournée'}
        </button>
      </div>
    </>
  );
}
