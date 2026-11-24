/* ============================================================================
 * Types métier : Commandes clientèle mixtes, actifs d'emballage & consignes
 * ============================================================================ */

export interface PackagingAsset {
  id: number;
  code: string | null;
  name: string;
  packaging_type_id: number | null;
  returnable_id: number | null;
  capacity: number;
  deposit_value: number;
  currency: string;
  returnable: number;
  compatibility_class: string;
  stock_empty: number;
  stock_full: number;
  is_active: number;
}

export type OrderRequestedUnit =
  | "unit"
  | "bottle"
  | "can"
  | "half_crate"
  | "crate"
  | "pack"
  | "carton"
  | "pallet"
  | "custom";

export interface OrderLineInput {
  variant_id: number;
  requested_unit: OrderRequestedUnit;
  requested_quantity: number;
  unit_price_xof?: number | null;
  discount_xof?: number | null;
  notes?: string | null;
}

export interface OrderAllocationOverrideInput {
  packaging_asset_id: number;
  quantity: number;
  is_consigned: boolean;
  deposit_amount_xof?: number | null;
  provided_by?: "brewery" | "supplier" | "depot";
  notes?: string | null;
}

export interface CreateCustomerOrderInput {
  customer_id: number;
  order_type?: "vente" | "retour" | "mixte";
  payment_method?: "cash" | "mobile_money" | "credit" | "mixed" | null;
  planned_payment_channel?: string | null;
  discount_xof?: number;
  tax_xof?: number;
  delivery_fee_xof?: number;
  delivery_mode?: "pickup" | "delivery" | string;
  delivery_date?: string | null;
  planned_delivery_time?: string | null;
  delivery_address?: string | null;
  delivery_landmark?: string | null;
  courier_name?: string | null;
  notes?: string | null;
  allow_price_override?: boolean;
  lines: OrderLineInput[];
  allocations?: OrderAllocationOverrideInput[] | null;
  /**
   * Vides rapportés au comptoir pendant la commande. Appliqués dans la même
   * transaction : la commande échoue si un retour est invalide.
   */
  returned_empties?: Array<{ packaging_asset_id: number; quantity: number }> | null;
}

export interface OrderTotals {
  subtotal_xof: number;
  deposit_total_xof: number;
  discount_xof: number;
  tax_xof: number;
  delivery_fee_xof?: number;
  total_xof: number;
  deposit_due_xof: number;
  total_to_collect_xof: number;
}

export interface PreviewLine {
  variant_id: number;
  product_id: number;
  product_name: string;
  variant_name: string;
  compatibility_class: string;
  base_unit: string;
  requested_unit: string;
  requested_quantity: number;
  units_per_requested_unit: number;
  base_quantity: number;
  unit_price_xof: number;
  discount_xof: number;
  line_total_xof: number;
}

export interface PreviewAllocation {
  packaging_asset_id: number;
  packaging_name: string;
  compatibility_class: string;
  capacity: number;
  quantity: number;
  is_consigned: boolean;
  deposit_amount_xof: number;
  total_deposit_xof: number;
}

export interface ComposePreviewResult {
  lines: PreviewLine[];
  allocations: PreviewAllocation[];
  warnings: string[];
  totals: OrderTotals;
}

export interface CustomerOrderSummary {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  order_type: string;
  status: string;
  approval_status?: string | null;
  subtotal_xof: number;
  deposit_total_xof: number;
  discount_xof: number;
  tax_xof: number;
  delivery_fee_xof?: number;
  total_xof: number;
  deposit_due_xof: number;
  total_to_collect_xof: number;
  paid_xof: number;
  payment_status: string;
  payment_method: string | null;
  planned_payment_channel?: string | null;
  delivery_mode?: string;
  courier_name?: string | null;
  planned_delivery_time?: string | null;
  delivery_date: string | null;
  delivery_address: string | null;
  delivery_landmark?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerOrderLine {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  base_unit: string;
  variant_id: number;
  variant_name: string;
  compatibility_class: string | null;
  requested_unit: string;
  requested_quantity: number;
  base_quantity: number;
  unit_price_xof: number;
  line_total_xof: number;
  discount_xof: number;
  notes: string | null;
}

export interface OrderPackagingAllocation {
  id: number;
  order_id: number;
  packaging_asset_id: number;
  packaging_name: string;
  compatibility_class: string;
  capacity: number;
  quantity: number;
  is_consigned: number;
  deposit_amount_xof: number;
  provided_by: string | null;
  returned_quantity: number;
  notes: string | null;
}

export interface OrderLinePackagingLink {
  id: number;
  order_line_id: number;
  order_packaging_allocation_id: number;
  units_in_packaging: number;
}

export interface CustomerDepositBalance {
  id: number;
  customer_id: number;
  packaging_asset_id: number;
  /** Consignable lié (nullable) : clé du rapprochement avec les consignes dues. */
  returnable_id: number | null;
  packaging_name: string;
  compatibility_class: string;
  deposit_value: number;
  quantity_held: number;
  amount_held_xof: number;
  last_movement_at: string | null;
}

/**
 * Consigne ouverte, telle que `list_obligations` la renvoie.
 *
 * Une consigne est rattachée à une VENTE et à un CONSIGNABLE. Pour décider ce
 * qu'un retour physique solde, c'est l'agrégat par consignable qui compte : le
 * client raisonne en casiers, pas en ventes.
 */
export interface PackagingObligationRef {
  id: number;
  sale_id: number;
  sale_reference: string | null;
  client_id: number | null;
  returnable_id: number;
  pieces: number;
  returned_pieces: number;
  lost_pieces: number;
  destroyed_pieces: number;
  converted_pieces: number;
  pending_pieces: number;
  unit_value: number;
  total_reference_value: number;
  due_date: string | null;
  overdue: boolean;
  status: string;
}

export interface PackagingMovementRecord {
  id: number;
  packaging_asset_id: number;
  packaging_name: string;
  customer_id: number | null;
  order_id: number | null;
  order_packaging_allocation_id: number | null;
  movement_type: string;
  quantity: number;
  unit_deposit_xof: number;
  total_deposit_xof: number;
  notes: string | null;
  created_at: string;
}

export type UpdateCustomerOrderInput = Partial<CreateCustomerOrderInput>;

export interface CustomerOrderReceiptSnapshot {
  id: number;
  order_id: number;
  version: number;
  receipt_number: string;
  snapshot_json: string;
  issued_at: string;
  issued_by_user_id: string | null;
  issued_by_name: string;
  issued_by_role: string;
  revision_reason?: string | null;
}

export interface CustomerOrderDetail {
  order: CustomerOrderSummary;
  lines: CustomerOrderLine[];
  allocations: OrderPackagingAllocation[];
  links: OrderLinePackagingLink[];
  customer_deposits: CustomerDepositBalance[];
  payments?: Array<{
    id: number;
    reference: string;
    amount_xof: number;
    method_code: string;
    method_label: string;
    external_reference?: string | null;
    recorded_by_name?: string | null;
    created_at: string;
  }>;
}
