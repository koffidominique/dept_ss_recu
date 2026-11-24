/* ============================================================================
 * Commandes Tauri IPC : Tournées de livraison
 * ============================================================================
 *
 * Chaque commande existe côté Rust (`src-tauri/src/commands/delivery.rs`) et
 * est enregistrée dans `generate_handler!`. Sans cet enregistrement, l'appel
 * échoue avec une erreur de runtime Tauri et non un refus applicatif.
 */

import type {
  AddDeliveryStopInput,
  CreateDeliveryRunInput,
  DeclareCollectionInput,
  DeliveryReconciliation,
  DeliveryRun,
  DeliveryRunDetail,
  ReconcileRunInput,
  RecordRunReturnInput,
  RecordStopOutcomeInput,
} from "../../../types/erp.ts";
import { getStoredTauriToken, tauriInvoke } from "./tauriTransport.ts";

function invokeWithToken<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return tauriInvoke<T>(cmd, { token: getStoredTauriToken(), ...args });
}

export const tauriDeliveryApi = {
  listDeliveryRuns(): Promise<DeliveryRun[]> {
    return invokeWithToken("list_delivery_runs");
  },
  getDeliveryRun(id: number): Promise<DeliveryRunDetail> {
    return invokeWithToken("get_delivery_run", { id });
  },
  createDeliveryRun(payload: CreateDeliveryRunInput): Promise<DeliveryRun> {
    return invokeWithToken("create_delivery_run", { payload });
  },
  addDeliveryStop(id: number, payload: AddDeliveryStopInput): Promise<unknown> {
    return invokeWithToken("add_delivery_stop", { id, payload });
  },
  loadDeliveryRun(id: number): Promise<DeliveryRunDetail> {
    return invokeWithToken("load_delivery_run", { id });
  },
  startDeliveryRun(id: number): Promise<DeliveryRun> {
    return invokeWithToken("start_delivery_run", { id });
  },
  cancelDeliveryRun(id: number): Promise<DeliveryRun> {
    return invokeWithToken("cancel_delivery_run", { id });
  },
  declareDeliveryCollection(id: number, payload: DeclareCollectionInput): Promise<void> {
    return invokeWithToken("declare_delivery_collection", { id, payload });
  },
  recordDeliveryStopOutcome(id: number, payload: RecordStopOutcomeInput): Promise<void> {
    return invokeWithToken("record_delivery_stop_outcome", { id, payload });
  },
  recordDeliveryRunReturn(id: number, payload: RecordRunReturnInput): Promise<void> {
    return invokeWithToken("record_delivery_run_return", { id, payload });
  },
  returnDeliveryRun(id: number): Promise<DeliveryRun> {
    return invokeWithToken("return_delivery_run", { id });
  },
  reconcileDeliveryRun(id: number, payload: ReconcileRunInput): Promise<DeliveryReconciliation> {
    return invokeWithToken("reconcile_delivery_run", { id, payload });
  },
  getDeliveryReconciliation(id: number): Promise<DeliveryReconciliation> {
    return invokeWithToken("get_delivery_reconciliation", { id });
  },
};
