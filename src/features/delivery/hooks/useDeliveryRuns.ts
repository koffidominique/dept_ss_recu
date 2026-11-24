import { useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import { createIdempotentRequestTracker } from '../../inventory/utils/phase2OperationsGuards.ts';
import { isReconcilableForReading } from '../utils/deliveryRuns.ts';
import type {
  AddDeliveryStopInput,
  CreateDeliveryRunInput,
  DeclareCollectionInput,
  ReconcileRunInput,
  RecordRunReturnInput,
  RecordStopOutcomeInput,
} from '../../../types/erp.ts';

/* ============================================================================
 * Données et mutations des tournées de livraison
 * ============================================================================
 *
 * Toutes les invalidations qui comptent sont explicites : une tournée chargée
 * fige l'attendu, un retour de vides bouge le stock, une réconciliation écrit
 * des mouvements de caisse. Oublier une clé ici laisse un écran qui affiche un
 * état périmé — c'est-à-dire un écart faux au moment où on le lit.
 */

const KEYS = {
  runs: ['delivery-runs'] as const,
  run: (id: number) => ['delivery-runs', id] as const,
  reconciliation: (id: number) => ['delivery-runs', id, 'reconciliation'] as const,
};

export function useDeliveryRunsQueries(selectedId: number | null) {
  const runsQuery = useQuery({
    queryKey: KEYS.runs,
    queryFn: () => apiClient.listDeliveryRuns(),
  });

  const detailQuery = useQuery({
    queryKey: KEYS.run(selectedId ?? -1),
    queryFn: () => apiClient.getDeliveryRun(selectedId as number),
    // `enabled` évite un appel sur `-1` au premier rendu.
    enabled: selectedId !== null,
  });

  const reconciliationQuery = useQuery({
    queryKey: KEYS.reconciliation(selectedId ?? -1),
    queryFn: () => apiClient.getDeliveryReconciliation(selectedId as number),
    // Lue dès `returned` : c'est là qu'on ouvre la modale de réconciliation, et
    // elle a besoin des montants attendu/déclaré pour calculer les écarts.
    // Restreindre à `reconciled` laissait la modale s'ouvrir sur un résumé nul,
    // donc vide, au moment précis où le gérant en a besoin. `get_reconciliation`
    // ne fait que lire et accepte n'importe quel statut.
    enabled: selectedId !== null && isReconcilableForReading(detailQuery.data?.run.status),
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.getSettings(),
  });

  const activeMethods = useMemo(
    () => (settingsQuery.data?.paymentMethods || []).filter((m) => m.active === 1),
    [settingsQuery.data]
  );

  return { runsQuery, detailQuery, reconciliationQuery, activeMethods };
}

interface MutationOptions {
  onError: (message: string) => void;
  onDone?: () => void;
}

export function useDeliveryRunsMutations({ onError, onDone }: MutationOptions) {
  const qc = useQueryClient();
  const createKeyRef = useRef(createIdempotentRequestTracker('trn-create'));
  const reconcileKeyRef = useRef(createIdempotentRequestTracker('trn-rec'));

  const fail = (err: unknown, fallback: string) =>
    onError(err instanceof Error ? err.message : fallback);

  /** Invalidation commune : une écriture sur une tournée touche aussi le stock
   *  (retours de vides) et la caisse (réconciliation). */
  const invalidateAll = (runId?: number) => {
    qc.invalidateQueries({ queryKey: KEYS.runs });
    if (runId !== undefined) {
      qc.invalidateQueries({ queryKey: KEYS.run(runId) });
      qc.invalidateQueries({ queryKey: KEYS.reconciliation(runId) });
    }
  };

  const createMut = useMutation({
    mutationFn: (payload: CreateDeliveryRunInput) =>
      apiClient.createDeliveryRun({
        ...payload,
        request_key: createKeyRef.current.resolveKey(JSON.stringify(payload)),
      }),
    onSuccess: (created) => {
      createKeyRef.current.reset();
      invalidateAll(created.id);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur création de tournée.'),
  });

  const addStopMut = useMutation({
    mutationFn: ({ runId, payload }: { runId: number; payload: AddDeliveryStopInput }) =>
      apiClient.addDeliveryStop(runId, payload),
    onSuccess: (_d, vars) => {
      invalidateAll(vars.runId);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur ajout d’arrêt.'),
  });

  const loadMut = useMutation({
    mutationFn: (runId: number) => apiClient.loadDeliveryRun(runId),
    onSuccess: (_d, runId) => {
      invalidateAll(runId);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur chargement de la tournée.'),
  });

  const startMut = useMutation({
    mutationFn: (runId: number) => apiClient.startDeliveryRun(runId),
    onSuccess: (_d, runId) => {
      invalidateAll(runId);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur au départ de la tournée.'),
  });

  const cancelMut = useMutation({
    mutationFn: (runId: number) => apiClient.cancelDeliveryRun(runId),
    onSuccess: (_d, runId) => {
      invalidateAll(runId);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur annulation de la tournée.'),
  });

  const returnRunMut = useMutation({
    mutationFn: (runId: number) => apiClient.returnDeliveryRun(runId),
    onSuccess: (_d, runId) => {
      invalidateAll(runId);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur retour de tournée.'),
  });

  const outcomeMut = useMutation({
    mutationFn: ({ runId, payload }: { runId: number; payload: RecordStopOutcomeInput }) =>
      apiClient.recordDeliveryStopOutcome(runId, payload),
    onSuccess: (_d, vars) => {
      invalidateAll(vars.runId);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur constat d’arrêt.'),
  });

  const collectionMut = useMutation({
    mutationFn: ({ runId, payload }: { runId: number; payload: DeclareCollectionInput }) =>
      apiClient.declareDeliveryCollection(runId, payload),
    onSuccess: (_d, vars) => {
      invalidateAll(vars.runId);
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur déclaration d’encaissement.'),
  });

  const returnMut = useMutation({
    mutationFn: ({ runId, payload }: { runId: number; payload: RecordRunReturnInput }) =>
      apiClient.recordDeliveryRunReturn(runId, payload),
    onSuccess: (_d, vars) => {
      invalidateAll(vars.runId);
      // Les vides rapportés touchent le stock physique et les consignes.
      qc.invalidateQueries({ queryKey: ['consignments'] });
      qc.invalidateQueries({ queryKey: ['packaging-stock'] });
      qc.invalidateQueries({ queryKey: ['packaging-obligations'] });
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur retour de vides.'),
  });

  const reconcileMut = useMutation({
    mutationFn: ({ runId, payload }: { runId: number; payload: ReconcileRunInput }) =>
      apiClient.reconcileDeliveryRun(runId, {
        ...payload,
        request_key: reconcileKeyRef.current.resolveKey(
          `${runId}:${payload.counted_amount}:${payload.discrepancy_reason ?? ''}`
        ),
      }),
    onSuccess: (_d, vars) => {
      reconcileKeyRef.current.reset();
      invalidateAll(vars.runId);
      // La réconciliation écrit en caisse : les écrans de caisse et les
      // rapports sont périmés dès cet instant.
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone?.();
    },
    onError: (err) => fail(err, 'Erreur réconciliation.'),
  });

  return {
    createMut,
    addStopMut,
    loadMut,
    startMut,
    cancelMut,
    returnRunMut,
    outcomeMut,
    collectionMut,
    returnMut,
    reconcileMut,
  };
}
