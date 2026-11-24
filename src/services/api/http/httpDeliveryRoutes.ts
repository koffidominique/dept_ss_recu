/* ============================================================================
 * Routes HTTP : Tournées de livraison
 * ============================================================================
 *
 * Les routes qui répondent 204 sans corps passent par `httpRequestVoid` :
 * `httpRequest` lit toujours du JSON et transformerait un succès en fausse
 * panne réseau. Voir la justification dans `httpTransport.ts`.
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
import { httpRequest, httpRequestVoid } from "./httpTransport.ts";

export const httpDeliveryApi = {
  listDeliveryRuns(): Promise<DeliveryRun[]> {
    return httpRequest<DeliveryRun[]>("/api/delivery-runs");
  },
  getDeliveryRun(id: number): Promise<DeliveryRunDetail> {
    return httpRequest<DeliveryRunDetail>(`/api/delivery-runs/${id}`);
  },
  createDeliveryRun(payload: CreateDeliveryRunInput): Promise<DeliveryRun> {
    return httpRequest<DeliveryRun>("/api/delivery-runs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  addDeliveryStop(id: number, payload: AddDeliveryStopInput): Promise<unknown> {
    return httpRequest<unknown>(`/api/delivery-runs/${id}/stops`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  loadDeliveryRun(id: number): Promise<DeliveryRunDetail> {
    return httpRequest<DeliveryRunDetail>(`/api/delivery-runs/${id}/load`, { method: "POST" });
  },
  startDeliveryRun(id: number): Promise<DeliveryRun> {
    return httpRequest<DeliveryRun>(`/api/delivery-runs/${id}/start`, { method: "POST" });
  },
  cancelDeliveryRun(id: number): Promise<DeliveryRun> {
    return httpRequest<DeliveryRun>(`/api/delivery-runs/${id}/cancel`, { method: "POST" });
  },
  declareDeliveryCollection(id: number, payload: DeclareCollectionInput): Promise<void> {
    return httpRequestVoid(`/api/delivery-runs/${id}/collections`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  recordDeliveryStopOutcome(id: number, payload: RecordStopOutcomeInput): Promise<void> {
    return httpRequestVoid(`/api/delivery-runs/${id}/stops/outcome`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  recordDeliveryRunReturn(id: number, payload: RecordRunReturnInput): Promise<void> {
    return httpRequestVoid(`/api/delivery-runs/${id}/returns`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  returnDeliveryRun(id: number): Promise<DeliveryRun> {
    return httpRequest<DeliveryRun>(`/api/delivery-runs/${id}/return`, { method: "POST" });
  },
  reconcileDeliveryRun(id: number, payload: ReconcileRunInput): Promise<DeliveryReconciliation> {
    return httpRequest<DeliveryReconciliation>(`/api/delivery-runs/${id}/reconcile`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getDeliveryReconciliation(id: number): Promise<DeliveryReconciliation> {
    return httpRequest<DeliveryReconciliation>(`/api/delivery-runs/${id}/reconciliation`);
  },
};
