import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { MoneyInput } from '../../../components/common/MoneyInput.tsx';
import type {
  DeliveryRunStop,
  DeliveryRunStopStatus,
  RecordStopOutcomeInput,
} from '../../../types/erp.ts';

/**
 * Constat d'un arrêt : livré, en échec ou ignoré.
 *
 * Un échec exige un motif. Sans lui, le soir on saura qu'un client n'a pas été
 * livré sans savoir pourquoi — et l'attendu de la tournée ne sera pas
 * explicable.
 */
export function DeliveryStopOutcomeModal({
  stop,
  onClose,
  error,
  isPending,
  onSubmit,
}: {
  stop: DeliveryRunStop | null;
  onClose: () => void;
  error: string | null;
  isPending: boolean;
  onSubmit: (payload: RecordStopOutcomeInput) => void;
}) {
  return (
    <ModalDialog
      open={Boolean(stop)}
      onOpenChange={(o) => !o && onClose()}
      title={`Constat d’arrêt · ${stop?.client_name ?? ''}`}
      maxWidthClass="max-w-md"
      error={error}
    >
      {stop && (
        <OutcomeForm key={stop.id} stop={stop} isPending={isPending} onSubmit={onSubmit} />
      )}
    </ModalDialog>
  );
}

function OutcomeForm({
  stop,
  isPending,
  onSubmit,
}: {
  stop: DeliveryRunStop;
  isPending: boolean;
  onSubmit: (payload: RecordStopOutcomeInput) => void;
}) {
  const [status, setStatus] = useState<DeliveryRunStopStatus>('delivered');
  const [reason, setReason] = useState('');

  const needsReason = status !== 'delivered';
  const canSubmit = !isPending && (!needsReason || reason.trim().length > 0);

  return (
    <>
      <div className="mt-4 space-y-3 text-xs">
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2">
          <div className="flex justify-between">
            <span className="text-[#667085] dark:text-[#94A3B8]">Attendu</span>
            <span className="font-mono-num font-medium">
              {new Intl.NumberFormat('fr-FR').format(stop.expected_amount)} FCFA
            </span>
          </div>
          {stop.expected_empty_pieces > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-[#667085] dark:text-[#94A3B8]">Vides attendus</span>
              <span className="font-mono-num font-medium">{stop.expected_empty_pieces} pcs</span>
            </div>
          )}
        </div>

        <div>
          <label className="block font-medium" htmlFor="trn-outcome-status">
            Résultat de la visite
          </label>
          <select
            id="trn-outcome-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as DeliveryRunStopStatus)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          >
            <option value="delivered">Livré — l’argent est encaissé</option>
            <option value="failed">Échec — client absent, refus</option>
            <option value="skipped">Ignoré — arrêt non effectué</option>
          </select>
        </div>

        {needsReason && (
          <div>
            <label className="block font-medium" htmlFor="trn-outcome-reason">
              Motif obligatoire *
            </label>
            <input
              id="trn-outcome-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex : Rideau fermé, le client devait rappeler"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
            />
          </div>
        )}

        {status === 'delivered' && (
          <p className="rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-[11px] text-[#1D4ED8] dark:text-[#60A5FA]">
            Constater n’encaisse rien en caisse. Le montant attendu entre dans le calcul de
            l’écart, il ne quitte pas le sac du livreur.
          </p>
        )}
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
          onClick={() =>
            onSubmit({
              stop_id: stop.id,
              status,
              failure_reason: needsReason ? reason.trim() : null,
            })
          }
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isPending ? 'Enregistrement…' : 'Enregistrer le constat'}
        </button>
      </div>
    </>
  );
}

/**
 * Déclaration d'encaissement du livreur.
 *
 * Aucun mouvement de caisse n'est écrit ici, et l'écran doit le dire : le
 * livreur qui croit remplir la caisse du dépôt demanderait pourquoi elle reste
 * vide.
 */
export function DeliveryCollectionModal({
  stop,
  activeMethods,
  onClose,
  error,
  isPending,
  onSubmit,
}: {
  stop: DeliveryRunStop | null;
  activeMethods: Array<{ code: string; label: string }>;
  onClose: () => void;
  error: string | null;
  isPending: boolean;
  onSubmit: (payload: { stop_id: number; method_code: string; amount: number }) => void;
}) {
  return (
    <ModalDialog
      open={Boolean(stop)}
      onOpenChange={(o) => !o && onClose()}
      title={`Encaissement · ${stop?.client_name ?? ''}`}
      subtitle="Le livreur déclare ce qu’il a pris. Rien n’entre en caisse à ce moment."
      maxWidthClass="max-w-md"
      error={error}
    >
      {stop && (
        <CollectionForm
          key={stop.id}
          stop={stop}
          activeMethods={activeMethods}
          isPending={isPending}
          onSubmit={onSubmit}
        />
      )}
    </ModalDialog>
  );
}

function CollectionForm({
  stop,
  activeMethods,
  isPending,
  onSubmit,
}: {
  stop: DeliveryRunStop;
  activeMethods: Array<{ code: string; label: string }>;
  isPending: boolean;
  onSubmit: (payload: { stop_id: number; method_code: string; amount: number }) => void;
}) {
  const [method, setMethod] = useState(activeMethods[0]?.code ?? 'cash');
  const [amount, setAmount] = useState<number>(stop.expected_amount);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="mt-4 space-y-3 text-xs">
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2 flex justify-between">
          <span className="text-[#667085] dark:text-[#94A3B8]">Attendu sur cet arrêt</span>
          <span className="font-mono-num font-medium">
            {new Intl.NumberFormat('fr-FR').format(stop.expected_amount)} FCFA
          </span>
        </div>

        <div>
          <label className="block font-medium" htmlFor="trn-col-method">
            Moyen de paiement
          </label>
          <select
            id="trn-col-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          >
            {activeMethods.length === 0 && <option value="cash">Espèces</option>}
            {activeMethods.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <MoneyInput label="Montant encaissé *" value={amount} onChange={setAmount} />

        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-[11px] text-[#BE123C]">
            {error}
          </p>
        )}
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
            // Un montant négatif ou décimal n'a pas de sens en FCFA : refus
            // local, avant l'appel, pour ne pas faire un aller-retour réseau
            // qui échouerait de toute façon.
            if (!Number.isInteger(amount) || amount < 0) {
              setError('Le montant doit être un entier positif en FCFA.');
              return;
            }
            setError(null);
            onSubmit({ stop_id: stop.id, method_code: method, amount });
          }}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isPending ? 'Déclaration…' : 'Déclarer'}
        </button>
      </div>
    </>
  );
}
