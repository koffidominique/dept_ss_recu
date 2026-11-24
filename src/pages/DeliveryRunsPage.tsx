import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  MapPinned,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  Truck,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../services/api/createApiClient.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { formatFcfa } from '../utils/format.ts';
import { cn } from '../utils/format.ts';
import { ErrorState, LoadingState } from '../components/common/States.tsx';
import { InlineAlert } from '../components/common/InlineAlert.tsx';
import { useDeliveryRunsMutations, useDeliveryRunsQueries } from '../features/delivery/hooks/useDeliveryRuns.ts';
import { DeliveryRunCreateModal } from '../features/delivery/components/DeliveryRunCreateModal.tsx';
import { DeliveryRunStopModal } from '../features/delivery/components/DeliveryRunStopModal.tsx';
import {
  DeliveryCollectionModal,
  DeliveryStopOutcomeModal,
} from '../features/delivery/components/DeliveryStopModals.tsx';
import { DeliveryRunReturnModal } from '../features/delivery/components/DeliveryRunReturnModal.tsx';
import { DeliveryReconcileModal } from '../features/delivery/components/DeliveryReconcileModal.tsx';
import {
  RUN_STATUS_LABELS,
  STOP_STATUS_LABELS,
  isTerminal,
  runActions,
  runBrief,
} from '../features/delivery/utils/deliveryRuns.ts';
import { hasPermission, PERMISSIONS } from '../features/quality/utils/permissions.ts';
import type { ReturnableType } from '../features/consignments/types.ts';
import type {
  Client,
  DeliveryRun,
  DeliveryRunStatus,
  DeliveryRunStop,
} from '../types/erp.ts';

/* ============================================================================
 * Écran Tournées de livraison
 * ============================================================================
 *
 * Deux vues dans une seule page : la liste (ce qui part et ce qui rentre) et
 * le détail (les arrêts, les constats, le retour de vides, la réconciliation).
 *
 * Règle d'affichage : un bouton n'apparaît que si l'action est à la fois
 * permise par le rôle ET valide pour le statut. Proposer un geste que le cœur
 * refuse oblige l'utilisateur à découvrir la règle par un message d'erreur.
 */

export function DeliveryRunsPage() {
  const currentUser = useUiStore((s) => s.currentUser);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { runsQuery, detailQuery, reconciliationQuery, activeMethods } =
    useDeliveryRunsQueries(selectedId);

  const mutations = useDeliveryRunsMutations({
    onError: setErrorMsg,
    onDone: () => setErrorMsg(null),
  });

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.listUsers(),
  });
  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiClient.listClients(),
  });
  const returnablesQuery = useQuery({
    queryKey: ['consignments'],
    queryFn: () => apiClient.getConsignmentsOverview(),
  });

  const canManage = hasPermission(currentUser, PERMISSIONS.deliveryRunsManage);
  const canExecute = hasPermission(currentUser, PERMISSIONS.deliveryRunsExecute);
  const canReconcile = hasPermission(currentUser, PERMISSIONS.deliveryRunsReconcile);

  if (runsQuery.isLoading) return <LoadingState rows={5} />;
  if (runsQuery.error || !runsQuery.data) {
    return (
      <ErrorState
        message={
          runsQuery.error instanceof Error
            ? runsQuery.error.message
            : 'Erreur de chargement des tournées.'
        }
        onRetry={() => runsQuery.refetch()}
      />
    );
  }

  const runs = runsQuery.data;

  return (
    <div className="space-y-5">
      {errorMsg && (
        <InlineAlert variant="error" message={errorMsg} onDismiss={() => setErrorMsg(null)} />
      )}

      {selectedId === null ? (
        <RunsList
          runs={runs}
          canManage={canManage}
          onOpen={(id) => {
            setErrorMsg(null);
            setSelectedId(id);
          }}
          onNew={() => {
            setErrorMsg(null);
            setNewRunOpen(true);
          }}
        />
      ) : (
        <RunDetail
          runId={selectedId}
          onBack={() => {
            setErrorMsg(null);
            setSelectedId(null);
          }}
          detailQuery={detailQuery}
          reconciliationQuery={reconciliationQuery}
          mutations={mutations}
          canManage={canManage}
          canExecute={canExecute}
          canReconcile={canReconcile}
          clients={clientsQuery.data ?? []}
          returnables={
            ((returnablesQuery.data?.types ?? []) as unknown as ReturnableType[]).map((t) => ({
              id: t.id,
              name: t.name,
            }))
          }
          activeMethods={activeMethods}
          setError={setErrorMsg}
        />
      )}

      <DeliveryRunCreateModal
        open={newRunOpen}
        onOpenChange={setNewRunOpen}
        users={usersQuery.data ?? []}
        error={errorMsg}
        isPending={mutations.createMut.isPending}
        onSubmit={(payload) =>
          mutations.createMut.mutate(payload, {
            onSuccess: (created) => {
              setNewRunOpen(false);
              setSelectedId(created.id);
            },
          })
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Liste                                                                      */
/* -------------------------------------------------------------------------- */

function RunsList({
  runs,
  canManage,
  onOpen,
  onNew,
}: {
  runs: DeliveryRun[];
  canManage: boolean;
  onOpen: (id: number) => void;
  onNew: () => void;
}) {
  const grouped = useMemo(() => {
    const open = runs.filter((r) => !isTerminal(r.status));
    const closed = runs.filter((r) => isTerminal(r.status));
    return { open, closed };
  }, [runs]);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-semibold text-[#182230] dark:text-slate-100">
            Tournées de livraison
          </h1>
          <p className="mt-0.5 text-xs text-[#667085] dark:text-[#94A3B8]">
            Le livreur déclare ce qu’il encaisse ; la caisse n’est mouvementée qu’à la
            réconciliation.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Nouvelle tournée
          </button>
        )}
      </header>

      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-6 py-12 text-center">
          <MapPinned className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <h3 className="mt-3 font-display text-sm font-semibold">Aucune tournée</h3>
          <p className="mt-1 text-xs text-[#667085] dark:text-[#94A3B8]">
            Créez une tournée pour affecter des arrêts à un livreur et suivre ce qui rentre
            le soir.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.open.length > 0 && (
            <RunGroup title={`En cours (${grouped.open.length})`} runs={grouped.open} onOpen={onOpen} />
          )}
          {grouped.closed.length > 0 && (
            <RunGroup
              title={`Terminées (${grouped.closed.length})`}
              runs={grouped.closed}
              onOpen={onOpen}
            />
          )}
        </div>
      )}
    </>
  );
}

function RunGroup({
  title,
  runs,
  onOpen,
}: {
  title: string;
  runs: DeliveryRun[];
  onOpen: (id: number) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667085] dark:text-[#94A3B8]">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E]">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wide text-[#667085] dark:text-[#94A3B8]">
            <tr>
              <th className="px-3 py-2 font-medium">Référence</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Livreur</th>
              <th className="px-3 py-2 font-medium">Véhicule</th>
              <th className="px-3 py-2 font-medium text-right">Arrêts</th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {runs.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                onClick={() => onOpen(r.id)}
              >
                <td className="px-3 py-2 font-mono-num font-medium">{r.reference}</td>
                <td className="px-3 py-2">{r.run_date}</td>
                <td className="px-3 py-2">{r.driver_name}</td>
                <td className="px-3 py-2 text-[#667085] dark:text-[#94A3B8]">
                  {r.vehicle_label ?? '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono-num">{r.planned_stops}</td>
                <td className="px-3 py-2">
                  <RunStatusPill status={r.status} />
                </td>
                <td className="px-3 py-2 text-right text-[#2563EB]">Ouvrir</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RunStatusPill({ status }: { status: DeliveryRunStatus }) {
  const styles: Record<DeliveryRunStatus, string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    loaded: 'bg-blue-50 text-[#1D4ED8] dark:bg-blue-950/40 dark:text-[#60A5FA]',
    in_progress: 'bg-amber-50 text-[#8A5A0B] dark:bg-amber-950/40 dark:text-amber-300',
    returned: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
    reconciled: 'bg-emerald-50 text-[#16A36A] dark:bg-emerald-950/40 dark:text-emerald-400',
    cancelled: 'bg-rose-50 text-[#BE123C] dark:bg-rose-950/40 dark:text-rose-400',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        styles[status]
      )}
    >
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Détail                                                                     */
/* -------------------------------------------------------------------------- */

function RunDetail({
  runId,
  onBack,
  detailQuery,
  reconciliationQuery,
  mutations,
  canManage,
  canExecute,
  canReconcile,
  clients,
  returnables,
  activeMethods,
  setError,
}: {
  runId: number;
  onBack: () => void;
  detailQuery: ReturnType<typeof useDeliveryRunsQueries>['detailQuery'];
  reconciliationQuery: ReturnType<typeof useDeliveryRunsQueries>['reconciliationQuery'];
  mutations: ReturnType<typeof useDeliveryRunsMutations>;
  canManage: boolean;
  canExecute: boolean;
  canReconcile: boolean;
  clients: Client[];
  returnables: Array<{ id: number; name: string }>;
  activeMethods: Array<{ code: string; label: string }>;
  setError: (msg: string | null) => void;
}) {
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [outcomeStop, setOutcomeStop] = useState<DeliveryRunStop | null>(null);
  const [collectionStop, setCollectionStop] = useState<DeliveryRunStop | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [tab, setTab] = useState('stops');

  if (detailQuery.isLoading) return <LoadingState rows={4} />;
  if (detailQuery.error || !detailQuery.data) {
    return (
      <ErrorState
        message={
          detailQuery.error instanceof Error
            ? detailQuery.error.message
            : 'Tournée introuvable.'
        }
        onRetry={() => detailQuery.refetch()}
      />
    );
  }

  const { run, stops } = detailQuery.data;
  const actions = runActions(run.status, stops.length);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-1 inline-flex items-center gap-1 text-[11px] text-[#667085] dark:text-[#94A3B8] hover:text-[#182230] dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Toutes les tournées
          </button>
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold text-[#182230] dark:text-slate-100">
            <span className="font-mono-num">{run.reference}</span>
            <RunStatusPill status={run.status} />
          </h1>
          <p className="mt-0.5 text-xs text-[#667085] dark:text-[#94A3B8]">
            {run.driver_name} · {run.run_date}
            {run.vehicle_label ? ` · ${run.vehicle_label}` : ''}
          </p>
          <p className="mt-1 text-xs font-medium text-[#182230] dark:text-slate-100">
            {runBrief(run, stops)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.canAddStop && canManage && (
            <ActionButton icon={Plus} onClick={() => setStopModalOpen(true)}>
              Arrêt
            </ActionButton>
          )}
          {actions.canLoad && canManage && (
            <ActionButton
              icon={PackageCheck}
              onClick={() => mutations.loadMut.mutate(runId)}
              pending={mutations.loadMut.isPending}
            >
              Charger
            </ActionButton>
          )}
          {actions.canStart && canExecute && (
            <ActionButton
              icon={Play}
              variant="primary"
              onClick={() => mutations.startMut.mutate(runId)}
              pending={mutations.startMut.isPending}
            >
              Départ
            </ActionButton>
          )}
          {actions.canRecordReturn && canManage && (
            <ActionButton icon={RefreshCw} onClick={() => setReturnOpen(true)}>
              Retour de vides
            </ActionButton>
          )}
          {actions.canReturnRun && canManage && (
            <ActionButton
              icon={Truck}
              onClick={() => mutations.returnRunMut.mutate(runId)}
              pending={mutations.returnRunMut.isPending}
            >
              Tournée rentrée
            </ActionButton>
          )}
          {actions.canReconcile && canReconcile && (
            <ActionButton
              icon={CheckCircle2}
              variant="primary"
              onClick={() => setReconcileOpen(true)}
            >
              Réconcilier
            </ActionButton>
          )}
          {actions.canCancel && canManage && (
            <ActionButton
              icon={XCircle}
              variant="danger"
              onClick={() => mutations.cancelMut.mutate(runId)}
              pending={mutations.cancelMut.isPending}
            >
              Annuler
            </ActionButton>
          )}
        </div>
      </header>

      {run.status === 'draft' && stops.length === 0 && (
        <InlineAlert
          variant="warning"
          message="Cette tournée n’a aucun arrêt. Le chargement (qui fige l’attendu) sera refusé tant qu’elle reste vide."
        />
      )}

      <Tabs.Root value={tab} onValueChange={setTab} className="space-y-3">
        <Tabs.List className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-1">
          <TabTrigger value="stops">Arrêts ({stops.length})</TabTrigger>
          <TabTrigger value="reconciliation">Réconciliation</TabTrigger>
        </Tabs.List>

        <Tabs.Content value="stops">
          {stops.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center text-xs text-[#667085] dark:text-[#94A3B8]">
              Aucun arrêt. Ajoutez au moins un client pour pouvoir charger la tournée.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wide text-[#667085] dark:text-[#94A3B8]">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 font-medium text-right">Attendu</th>
                    <th className="px-3 py-2 font-medium text-right">Vides</th>
                    <th className="px-3 py-2 font-medium">Constat</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {stops.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-mono-num">{s.sequence}</td>
                      <td className="px-3 py-2 font-medium">{s.client_name}</td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {formatFcfa(s.expected_amount)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {s.expected_empty_pieces}
                      </td>
                      <td className="px-3 py-2">
                        <StopStatusLabel stop={s} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          {actions.canRecordOutcome && canManage && s.status === 'planned' && (
                            <button
                              type="button"
                              onClick={() => {
                                setError(null);
                                setOutcomeStop(s);
                              }}
                              className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px]"
                            >
                              Constater
                            </button>
                          )}
                          {actions.canDeclareCollection && canExecute && s.status === 'delivered' && (
                            <button
                              type="button"
                              onClick={() => {
                                setError(null);
                                setCollectionStop(s);
                              }}
                              className="rounded-md bg-[#2563EB] px-2 py-1 text-[11px] font-medium text-white"
                            >
                              Encaissement
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="reconciliation">
          <ReconciliationPanel
            run={run}
            reconciliationQuery={reconciliationQuery}
            onOpenReconcile={() => setReconcileOpen(true)}
            canReconcile={canReconcile}
          />
        </Tabs.Content>
      </Tabs.Root>

      {/* Modales */}
      <DeliveryRunStopModal
        open={stopModalOpen}
        onOpenChange={setStopModalOpen}
        clients={clients}
        existingStops={stops}
        error={null}
        isPending={mutations.addStopMut.isPending}
        onSubmit={(payload) => {
          mutations.addStopMut.mutate(
            { runId, payload },
            { onSuccess: () => setStopModalOpen(false) }
          );
        }}
      />

      <DeliveryStopOutcomeModal
        stop={outcomeStop}
        onClose={() => setOutcomeStop(null)}
        error={null}
        isPending={mutations.outcomeMut.isPending}
        onSubmit={(payload) =>
          mutations.outcomeMut.mutate(
            { runId, payload },
            { onSuccess: () => setOutcomeStop(null) }
          )
        }
      />

      <DeliveryCollectionModal
        stop={collectionStop}
        activeMethods={activeMethods}
        onClose={() => setCollectionStop(null)}
        error={null}
        isPending={mutations.collectionMut.isPending}
        onSubmit={(payload) =>
          mutations.collectionMut.mutate(
            { runId, payload },
            { onSuccess: () => setCollectionStop(null) }
          )
        }
      />

      <DeliveryRunReturnModal
        open={returnOpen}
        onOpenChange={setReturnOpen}
        stops={stops}
        returnables={returnables}
        error={null}
        isPending={mutations.returnMut.isPending}
        onSubmit={(payload) =>
          mutations.returnMut.mutate(
            { runId, payload },
            { onSuccess: () => setReturnOpen(false) }
          )
        }
      />

      <DeliveryReconcileModal
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        summary={reconciliationQuery.data ?? null}
        error={null}
        isPending={mutations.reconcileMut.isPending}
        onSubmit={(payload) =>
          mutations.reconcileMut.mutate(
            { runId, payload },
            { onSuccess: () => setReconcileOpen(false) }
          )
        }
      />
    </>
  );
}

function StopStatusLabel({ stop }: { stop: DeliveryRunStop }) {
  const tone: Record<DeliveryRunStop['status'], string> = {
    planned: 'text-slate-500 dark:text-slate-400',
    delivered: 'text-[#16A36A] dark:text-emerald-400',
    failed: 'text-[#BE123C]',
    skipped: 'text-[#8A5A0B] dark:text-amber-300',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', tone[stop.status])}>
      {stop.status === 'delivered' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
      {stop.status === 'failed' && <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
      {stop.status === 'skipped' && <CircleSlash className="h-3.5 w-3.5" aria-hidden="true" />}
      {STOP_STATUS_LABELS[stop.status]}
      {stop.failure_reason ? ` — ${stop.failure_reason}` : ''}
    </span>
  );
}

function ReconciliationPanel({
  run,
  reconciliationQuery,
  onOpenReconcile,
  canReconcile,
}: {
  run: DeliveryRun;
  reconciliationQuery: ReturnType<typeof useDeliveryRunsQueries>['reconciliationQuery'];
  onOpenReconcile: () => void;
  canReconcile: boolean;
}) {
  if (run.status !== 'returned' && run.status !== 'reconciled') {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center text-xs text-[#667085] dark:text-[#94A3B8]">
        La réconciliation devient possible une fois la tournée rentrée. Tant qu’elle roule,
        rien n’est écrit en caisse.
      </p>
    );
  }

  if (reconciliationQuery.isLoading) return <LoadingState rows={3} />;

  const rec = reconciliationQuery.data;
  if (!rec) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-4 text-xs">
        <p className="text-[#667085] dark:text-[#94A3B8]">
          Tournée rentrée, pas encore réconciliée. Le montant compté déterminera ce qui entre
          en caisse.
        </p>
        {canReconcile && (
          <button
            type="button"
            onClick={onOpenReconcile}
            className="mt-3 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white"
          >
            Réconcilier
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Attendu" value={formatFcfa(rec.expected_amount)} />
        <Metric label="Déclaré" value={formatFcfa(rec.declared_amount)} />
        <Metric label="Compté" value={formatFcfa(rec.counted_amount)} tone="ok" />
        <Metric
          label="Écart de caisse"
          value={formatFcfa(rec.cash_gap)}
          tone={rec.cash_gap === 0 ? undefined : 'danger'}
        />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-4 text-xs">
        <div className="flex justify-between py-1">
          <span className="text-[#667085] dark:text-[#94A3B8]">Écart de déclaration</span>
          <span
            className={cn(
              'font-mono-num',
              rec.declared_gap === 0 ? '' : 'font-semibold text-[#BE123C]'
            )}
          >
            {formatFcfa(rec.declared_gap)}
          </span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-[#667085] dark:text-[#94A3B8]">Vides attendus / récupérés</span>
          <span className="font-mono-num">
            {rec.expected_empty_pieces} → {rec.returned_good_pieces} bons /{' '}
            {rec.returned_damaged_pieces} abîmés
          </span>
        </div>
        {rec.discrepancy_reason && (
          <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-[#8A5A0B] dark:text-amber-300">
            Motif : {rec.discrepancy_reason}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] px-3 py-2">
      <p className="text-[11px] text-[#667085] dark:text-[#94A3B8]">{label}</p>
      <p
        className={cn(
          'mt-0.5 font-mono-num text-sm font-semibold',
          tone === 'ok' ? 'text-[#16A36A]' : tone === 'danger' ? 'text-[#BE123C]' : ''
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  children,
  onClick,
  variant = 'default',
  pending = false,
}: {
  icon: typeof Plus;
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
  pending?: boolean;
}) {
  const styles =
    variant === 'primary'
      ? 'bg-[#2563EB] text-white hover:bg-blue-700'
      : variant === 'danger'
        ? 'border border-rose-200 dark:border-rose-900/50 text-[#BE123C] hover:bg-rose-50 dark:hover:bg-rose-950/30'
        : 'border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50',
        styles
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="rounded-md px-3 py-1.5 text-xs font-medium text-[#667085] dark:text-[#94A3B8] transition-all hover:text-[#182230] dark:hover:text-slate-100 data-[state=active]:bg-[#2563EB] data-[state=active]:text-white"
    >
      {children}
    </Tabs.Trigger>
  );
}
