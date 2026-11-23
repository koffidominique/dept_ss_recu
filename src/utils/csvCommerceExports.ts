import type { CashSession, ExpenseItem, PurchaseOrder, Receivable, SaleSummary } from '../types/erp.ts';
import { downloadCsv, todayTag } from './csvCore.ts';

/* ============================================================================
 * Exports CSV : Ventes, Créances, Approvisionnements, Dépenses & Caisse
 * ============================================================================ */

const PRICE_TIER_LABELS: Record<string, string> = {
  retail: 'Détail',
  semi_wholesale: 'Demi-gros',
  wholesale: 'Gros',
};

const SALE_STATUS_LABELS: Record<string, string> = {
  validated: 'Validée',
  partially_returned: 'Partiellement retournée',
  returned: 'Retournée',
  cancelled: 'Annulée',
};

const RECEIVABLE_STATUS_LABELS: Record<string, string> = {
  open: 'Ouverte',
  partial: 'Partielle',
  paid: 'Soldée',
  cancelled: 'Annulée',
};

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  submitted: 'Soumise',
  approved: 'Approuvée',
  ordered: 'Commandée',
  partial: 'Partiellement reçue',
  partially_received: 'Partiellement reçue',
  received: 'Reçue',
  cancelled: 'Annulée',
  rejected: 'Rejetée',
};

export function exportSalesCsv(items: SaleSummary[]) {
  return downloadCsv(
    `depotpro_ventes_${todayTag()}.csv`,
    [
      'Référence',
      'Date',
      'Client',
      'Type',
      'Tarif',
      'Sous-total marchandises (FCFA)',
      'Remise (FCFA)',
      'Net marchandises (FCFA)',
      'Consignes emballages (FCFA)',
      'Total TTC (FCFA)',
      'Payé (FCFA)',
      'Reste dû (FCFA)',
      'Moyens de paiement',
      'Statut',
    ],
    items.map((s) => [
      s.reference,
      s.created_at,
      s.client_name,
      s.sale_type === 'credit' ? 'Crédit' : 'Comptant',
      PRICE_TIER_LABELS[s.price_tier] || s.price_tier,
      s.subtotal_merchandise,
      s.discount_amount,
      s.total_merchandise,
      s.total_deposit,
      s.total_amount,
      s.paid_amount,
      s.remaining_amount,
      s.payment_labels || '',
      SALE_STATUS_LABELS[s.status] || s.status,
    ])
  );
}

export function exportReceivablesCsv(items: Receivable[]) {
  return downloadCsv(
    `depotpro_creances_marchandises_${todayTag()}.csv`,
    [
      'Client',
      'Code client',
      'Téléphone',
      'Facture',
      'Date vente',
      'Échéance',
      'Montant initial (FCFA)',
      'Payé (FCFA)',
      'Reste à encaisser (FCFA)',
      'Statut',
    ],
    items.map((r) => [
      r.client_name,
      r.client_code,
      r.client_phone || '',
      r.sale_reference,
      r.sale_date,
      r.due_date || '',
      r.initial_amount,
      Math.max(0, r.initial_amount - r.remaining_amount),
      r.remaining_amount,
      RECEIVABLE_STATUS_LABELS[r.status] || r.status,
    ])
  );
}

export function exportExpensesCsv(items: ExpenseItem[]) {
  return downloadCsv(
    `depotpro_depenses_${todayTag()}.csv`,
    [
      'Référence',
      'Date',
      'Catégorie',
      'Bénéficiaire',
      'Moyen de paiement',
      'Montant (FCFA)',
      'Notes',
      'Justificatif joint',
    ],
    items.map((e) => [
      e.reference,
      e.expense_date,
      e.category,
      e.beneficiary || '',
      e.method_label,
      e.amount,
      e.notes || '',
      e.receipt_path ? 'Oui' : 'Non',
    ])
  );
}

export const CASH_MOVEMENT_KIND_LABELS: Record<string, string> = {
  sale: 'Vente',
  receivable: 'Règlement créance client',
  expense: 'Dépense',
  supplier_payment: 'Règlement fournisseur',
  deposit_refund: 'Dédommagement emballages',
  sale_refund: 'Remboursement avoir',
  income: 'Entrée diverse',
  outflow: 'Sortie diverse',
};

export function formatCashMovementKind(
  kind?: string | null,
  referenceDocument?: string | null
): string {
  if (referenceDocument?.startsWith('pkg-debt-pay:')) {
    return 'Règlement créance emballages';
  }
  if (!kind) return 'Opération';
  return CASH_MOVEMENT_KIND_LABELS[kind] ?? kind;
}

export interface CashMovementCsvRow {
  created_at: string;
  kind?: string;
  description: string;
  method_label: string;
  is_cash: number;
  direction: 'in' | 'out';
  amount: number;
  reference_document: string | null;
}

export function exportCashMovementsCsv(sessionRef: string, movements: CashMovementCsvRow[]) {
  return downloadCsv(
    `depotpro_caisse_mouvements_${sessionRef}_${todayTag()}.csv`,
    ['Date & heure', 'Nature', 'Opération', 'Moyen', 'Canal', 'Sens', 'Montant (FCFA)', 'Document'],
    movements.map((m) => [
      m.created_at,
      formatCashMovementKind(m.kind, m.reference_document),
      m.description,
      m.method_label,
      m.is_cash === 1 ? 'Espèces' : 'Digital',
      m.direction === 'in' ? 'Entrée' : 'Sortie',
      m.direction === 'in' ? m.amount : -m.amount,
      m.reference_document || '',
    ])
  );
}

export function exportCashSessionsCsv(history: CashSession[]) {
  return downloadCsv(
    `depotpro_caisse_sessions_${todayTag()}.csv`,
    [
      'Référence',
      'Ouverte le',
      'Clôturée le',
      'Fond initial (FCFA)',
      'Théorique (FCFA)',
      'Compté (FCFA)',
      'Écart (FCFA)',
      'Notes clôture',
    ],
    history.map((s) => [
      s.reference,
      s.opened_at,
      s.closed_at || '',
      s.opening_cash,
      s.theoretical_cash ?? '',
      s.physical_cash ?? '',
      s.difference ?? '',
      s.closing_notes || '',
    ])
  );
}

export function exportPurchasesCsv(orders: PurchaseOrder[]) {
  return downloadCsv(
    `depotpro_approvisionnements_${todayTag()}.csv`,
    [
      'Référence',
      'Date',
      'Fournisseur',
      'Code fournisseur',
      'Montant commandé (FCFA)',
      'Montant réceptionné (FCFA)',
      'Nb lignes',
      'Nb réceptions',
      'Statut',
    ],
    orders.map((o) => [
      o.reference,
      o.created_at,
      o.supplier_name,
      o.supplier_code,
      o.total_amount,
      o.received_amount,
      o.lines.length,
      o.receipts.length,
      PURCHASE_STATUS_LABELS[o.status] || o.status,
    ])
  );
}
