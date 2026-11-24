/* ============================================================================
 * Types métier : Tournées de livraison (Lots 13, 14, 16)
 * ============================================================================
 *
 * Miroir exact des DTO de `crates/depotpro-core/src/application/
 * delivery_runs.rs` et `delivery_reconciliation.rs`. Le nom des champs suit le
 * serveur à la lettre (snake_case) : une conversion ici ferait diverger les
 * deux côtés sans que rien ne le signale.
 */

/** Statuts d'une tournée, dans l'ordre du cycle de vie. */
export type DeliveryRunStatus =
  | "draft"
  | "loaded"
  | "in_progress"
  | "returned"
  | "reconciled"
  | "cancelled";

/** Statut d'un arrêt. */
export type DeliveryRunStopStatus = "planned" | "delivered" | "failed" | "skipped";

export interface DeliveryRun {
  id: number;
  reference: string;
  run_date: string;
  driver_user_id: number;
  driver_name: string;
  vehicle_label: string | null;
  status: DeliveryRunStatus;
  planned_stops: number;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

export interface DeliveryRunStop {
  id: number;
  run_id: number;
  client_id: number;
  client_name: string;
  order_id: number | null;
  sequence: number;
  expected_amount: number;
  expected_empty_pieces: number;
  status: DeliveryRunStopStatus;
  failure_reason: string | null;
}

export interface DeliveryRunDetail {
  run: DeliveryRun;
  stops: DeliveryRunStop[];
}

export interface CollectionLine {
  method_code: string;
  expected: number;
  declared: number;
  declared_gap: number;
}

export interface DeliveryReconciliation {
  run_id: number;
  reference: string;
  status: DeliveryRunStatus;
  expected_amount: number;
  declared_amount: number;
  counted_amount: number;
  /** déclaré − attendu : erreur ou omission du livreur. */
  declared_gap: number;
  /** compté − déclaré : manquant ou trop-perçu constaté au comptage. */
  cash_gap: number;
  discrepancy_reason: string | null;
  by_method: CollectionLine[];
  expected_empty_pieces: number;
  returned_good_pieces: number;
  returned_damaged_pieces: number;
  collections_written: number;
}

/* --- Entrées ------------------------------------------------------------- */

export interface CreateDeliveryRunInput {
  run_date: string;
  driver_user_id: number;
  vehicle_label?: string | null;
  request_key?: string | null;
  notes?: string | null;
}

export interface AddDeliveryStopInput {
  client_id: number;
  order_id?: number | null;
  sequence?: number | null;
}

export interface DeclareCollectionInput {
  stop_id: number;
  method_code: string;
  amount: number;
}

export interface RecordStopOutcomeInput {
  stop_id: number;
  status: DeliveryRunStopStatus;
  failure_reason?: string | null;
}

export interface RunReturnInput {
  returnable_id: number;
  good_pieces: number;
  damaged_pieces: number;
}

export interface ReturnAllocationInput {
  client_id: number;
  returnable_id: number;
  good_pieces: number;
  damaged_pieces: number;
}

export interface RecordRunReturnInput {
  returns: RunReturnInput[];
  allocations: ReturnAllocationInput[];
}

export interface ReconcileRunInput {
  counted_amount: number;
  discrepancy_reason?: string | null;
  request_key?: string | null;
}
