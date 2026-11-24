import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import type { AddDeliveryStopInput, Client, DeliveryRunStop } from '../../../types/erp.ts';
import type { CustomerOrderSummary } from '../../../types/erp/orders.ts';

/**
 * Ajout d'un arrêt à une tournée encore modifiable.
 *
 * La recherche est locale : sur un dépôt, la liste des clients tient en
 * mémoire. Un filtre serveur par frappe produirait un appel par caractère pour
 * un gain nul, et ferait clignoter la liste.
 *
 * Le rattachement d'une commande n'est pas décoratif : l'attendu d'un arrêt
 * est `orders.total_to_collect_xof - orders.paid_xof`. Sans commande, il vaut
 * zéro, le livreur n'a rien à encaisser, et la déclaration est refusée
 * (« le montant doit être supérieur à zéro »). Le cœur acceptait déjà
 * `order_id` ; l'écran, lui, ne l'exposait pas — on pouvait donc créer une
 * tournée complète qui ne servait à rien.
 */
export function DeliveryRunStopModal({
  open,
  onOpenChange,
  clients,
  existingStops,
  orders,
  ordersPending,
  error,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  existingStops: DeliveryRunStop[];
  orders: CustomerOrderSummary[];
  ordersPending: boolean;
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
          orders={orders}
          ordersPending={ordersPending}
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
  orders,
  ordersPending,
  isPending,
  onSubmit,
}: {
  clients: Client[];
  existingStops: DeliveryRunStop[];
  orders: CustomerOrderSummary[];
  ordersPending: boolean;
  isPending: boolean;
  onSubmit: (payload: AddDeliveryStopInput) => void;
}) {
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState<number>(0);
  const [orderId, setOrderId] = useState<number>(0);

  // Un arrêt sans commande n'a pas d'attendu : on ne propose que les commandes
  // qui restent à encaisser, et seulement celles du client choisi. Proposer une
  // commande déjà soldée reproduirait le problème résolu.
  const clientOrders = useMemo(() => {
    if (clientId <= 0) return [];
    return orders.filter(
      (o) => o.customer_id === clientId && o.total_to_collect_xof - o.paid_xof > 0
    );
  }, [orders, clientId]);

  const remaining = (o: CustomerOrderSummary) => o.total_to_collect_xof - o.paid_xof;

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
            onChange={(e) => {
              setClientId(Number(e.target.value));
              // Changer de client invalide la commande retenue : elle
              // appartiendrait à quelqu'un d'autre.
              setOrderId(0);
            }}
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
        <div>
          <label className="block font-medium" htmlFor="trn-stop-order">
            Commande à livrer
          </label>
          <select
            id="trn-stop-order"
            value={orderId}
            onChange={(e) => setOrderId(Number(e.target.value))}
            disabled={clientId <= 0 || ordersPending}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 disabled:opacity-50"
          >
            <option value={0}>— aucune (arrêt de visite seule) —</option>
            {clientOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_number} · {new Intl.NumberFormat('fr-FR').format(remaining(o))} FCFA
                à encaisser
              </option>
            ))}
          </select>
          {clientId > 0 && !ordersPending && clientOrders.length === 0 && (
            <p className="mt-1 text-[11px] text-[#B45309] dark:text-amber-400">
              Aucune commande à encaisser pour ce client : l’arrêt n’aura pas d’attendu.
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
          onClick={() =>
            onSubmit({ client_id: clientId, order_id: orderId > 0 ? orderId : null })
          }
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isPending ? 'Ajout…' : 'Ajouter l’arrêt'}
        </button>
      </div>
    </>
  );
}
