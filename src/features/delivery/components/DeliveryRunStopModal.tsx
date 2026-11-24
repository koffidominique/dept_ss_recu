import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import type { AddDeliveryStopInput, Client, DeliveryRunStop } from '../../../types/erp.ts';

/**
 * Ajout d'un arrêt à une tournée encore modifiable.
 *
 * La recherche est locale : sur un dépôt, la liste des clients tient en
 * mémoire. Un filtre serveur par frappe produirait un appel par caractère pour
 * un gain nul, et ferait clignoter la liste.
 */
export function DeliveryRunStopModal({
  open,
  onOpenChange,
  clients,
  existingStops,
  error,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  existingStops: DeliveryRunStop[];
  error: string | null;
  isPending: boolean;
  onSubmit: (payload: AddDeliveryStopInput) => void;
}) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ajouter un arrêt"
      subtitle="L'attendu de l'arrêt sera figé au chargement de la tournée."
      maxWidthClass="max-w-md"
      error={error}
    >
      {open && (
        <AddStopForm
          clients={clients}
          existingStops={existingStops}
          isPending={isPending}
          onSubmit={onSubmit}
        />
      )}
    </ModalDialog>
  );
}

function AddStopForm({
  clients,
  existingStops,
  isPending,
  onSubmit,
}: {
  clients: Client[];
  existingStops: DeliveryRunStop[];
  isPending: boolean;
  onSubmit: (payload: AddDeliveryStopInput) => void;
}) {
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState<number>(0);

  const alreadyThere = useMemo(
    () => new Set(existingStops.map((s) => s.client_id)),
    [existingStops]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? clients.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q) ||
            (c.phone ?? '').includes(q)
        )
      : clients;
    // Un client déjà arrêté sur cette tournée n'a rien à y faire deux fois :
    // deux arrêts pour le même client produiraient deux attendus pour une
    // seule visite.
    return base.filter((c) => !alreadyThere.has(c.id)).slice(0, 50);
  }, [clients, search, alreadyThere]);

  return (
    <>
      <div className="mt-4 space-y-3 text-xs">
        <div>
          <label className="block font-medium" htmlFor="trn-stop-search">
            Rechercher un client
          </label>
          <input
            id="trn-stop-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, code ou téléphone"
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          />
        </div>

        <div>
          <label className="block font-medium" htmlFor="trn-stop-client">
            Client *
          </label>
          <select
            id="trn-stop-client"
            value={clientId}
            onChange={(e) => setClientId(Number(e.target.value))}
            size={8}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
          >
            <option value={0}>— choisir —</option>
            {filtered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code}){c.phone ? ` · ${c.phone}` : ''}
              </option>
            ))}
          </select>
          {filtered.length === 0 && (
            <p className="mt-1 text-[11px] text-[#667085] dark:text-[#94A3B8]">
              {search.trim()
                ? 'Aucun client ne correspond, ou il est déjà sur cette tournée.'
                : 'Tous les clients sont déjà sur cette tournée.'}
            </p>
          )}
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
          disabled={clientId <= 0 || isPending}
          onClick={() => onSubmit({ client_id: clientId })}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isPending ? 'Ajout…' : 'Ajouter l’arrêt'}
        </button>
      </div>
    </>
  );
}
