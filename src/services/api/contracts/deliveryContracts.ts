/* ============================================================================
 * Contrat API : Tournées de livraison
 * ============================================================================ */

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

export interface DeliveryApiClient {
  listDeliveryRuns(): Promise<DeliveryRun[]>;
  getDeliveryRun(id: number): Promise<DeliveryRunDetail>;
  createDeliveryRun(payload: CreateDeliveryRunInput): Promise<DeliveryRun>;
  addDeliveryStop(id: number, payload: AddDeliveryStopInput): Promise<unknown>;
  loadDeliveryRun(id: number): Promise<DeliveryRunDetail>;
  startDeliveryRun(id: number): Promise<DeliveryRun>;
  cancelDeliveryRun(id: number): Promise<DeliveryRun>;
  declareDeliveryCollection(id: number, payload: DeclareCollectionInput): Promise<void>;
  recordDeliveryStopOutcome(id: number, payload: RecordStopOutcomeInput): Promise<void>;
  recordDeliveryRunReturn(id: number, payload: RecordRunReturnInput): Promise<void>;
  returnDeliveryRun(id: number): Promise<DeliveryRun>;
  reconcileDeliveryRun(id: number, payload: ReconcileRunInput): Promise<DeliveryReconciliation>;
  getDeliveryReconciliation(id: number): Promise<DeliveryReconciliation>;
}
