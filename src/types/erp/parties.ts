import type { CreditPolicy } from "./auth.ts";

/* ============================================================================
 * Types métier : Tiers (Clients & Fournisseurs)
 * ============================================================================ */

export interface Client {
  id: number;
  code: string;
  name: string;
  client_type: "particulier" | "professionnel";
  establishment_name?: string | null;
  category?: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  commune?: string | null;
  quartier?: string | null;
  landmark?: string | null;
  email: string | null;
  contact_person: string | null;
  is_active: number;
  credit_policy: CreditPolicy;
  credit_limit: number | null;
  payment_terms_days: number;
  unpaid_balance: number;
  returnable_pieces_due: number;
}

export interface ClientPackagingBalance {
  id: number;
  client_id: number;
  client_name: string;
  client_code: string;
  returnable_id: number;
  packaging_name: string;
  packaging_code: string;
  deposit_value: number;
  balance_pieces: number;
  deposit_held_amount: number;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  company_name: string | null;
  phone: string;
  address: string | null;
  email: string | null;
  contact_person: string | null;
  payment_terms_days: number;
  total_purchases: number;
  balance_due: number;
  is_active: number;
}
