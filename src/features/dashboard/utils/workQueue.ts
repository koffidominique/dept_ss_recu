/* ============================================================================
 * LOT 3 — PHASE 3 : File de travail actionnable du tableau de bord
 *
 * Règle d'or de ce module : **aucune formule métier inventée**.
 * Chaque élément produit ici provient d'un fait déjà calculé par l'autorité
 * métier Rust (`depotpro-core`) ou d'une donnée brute lue telle quelle
 * (statut, date, quantité). Aucune marge, aucun taux, aucun ratio n'est dérivé.
 * ============================================================================ */

import type { CustomerOrderSummary } from '../../../types/erp.ts';

/** Seuil opérationnel (politique d'exploitation, pas un calcul métier). */
export const CASH_SESSION_STALE_HOURS = 12;
/** Seuil opérationnel de fraîcheur des sauvegardes (politique d'exploitation). */
export const BACKUP_STALE_DAYS = 7;

export type WorkQueueSeverity = 'critical' | 'warning' | 'info';

export type WorkQueueCategory =
  | 'cash'
  | 'receivables'
  | 'supplier_debts'
  | 'stock'
  | 'orders'
  | 'inventory'
  | 'consignments'
  | 'backups';

export interface WorkQueueItem {
  id: string;
  category: WorkQueueCategory;
  severity: WorkQueueSeverity;
  title: string;
  detail: string;
  /** Libellé du bouton d'action. */
  actionLabel: string;
  /** Route vers les enregistrements qui expliquent la valeur. */
  to: string;
  /** Nombre d'éléments concernés (0 = non chiffrable, ne pas afficher). */
  count?: number;
  /** Montant en FCFA entiers (0 = non chiffrable, ne pas afficher). */
  amountXof?: number;
  /** Rang de tri. Plus petit = plus urgent. */
  priority: number;
}

const SEVERITY_ORDER: Record<WorkQueueSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function compareWorkQueueItems(a: WorkQueueItem, b: WorkQueueItem): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  return a.priority - b.priority;
}

export function prioritizeWorkQueue(items: readonly WorkQueueItem[]): WorkQueueItem[] {
  return [...items].sort(compareWorkQueueItems);
}

/* ----------------------------------------------------------------------------
 * Horloge : calculs d'ancienneté explicites et testables
 * -------------------------------------------------------------------------- */

export function hoursSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 3_600_000);
}

export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

export function isPastDueDate(dueDate: string | null | undefined, now: Date): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return false;
  return due < now.getTime();
}

/* ----------------------------------------------------------------------------
 * Sources normalisées (aucune donnée inventée : uniquement lecture défensive)
 * -------------------------------------------------------------------------- */

export interface WorkQueueInput {
  now: Date;
  kpis: {
    cashSessionOpen: boolean;
    overdueReceivablesCount?: number;
    overdueReceivablesTotal?: number;
    overdueSupplierDebtsCount?: number;
    overdueSupplierDebtsTotal?: number;
    lowStockCount: number;
    outOfStockCount: number;
  };
  /** Session de caisse effectivement ouverte (statut `open`). */
  activeCashSession?: { id: number; reference: string; opened_at: string } | null;
  /** Commandes client chargées depuis l'API (statuts bruts). */
  orders?: readonly CustomerOrderSummary[];
  /** Inventaires physiques (statuts bruts `draft` / `validated` / `cancelled`). */
  inventories?: ReadonlyArray<{ id: number; reference: string; status: string }>;
  /** Obligations d'emballages ouvertes (lignes brutes de l'API). */
  packagingOpenIssues?: ReadonlyArray<{
    id: number;
    packaging_name?: string | null;
    client_name?: string | null;
    pieces?: number | null;
    returned_pieces?: number | null;
    due_date?: string | null;
    overdue?: boolean | null;
  }>;
  /** Dernière sauvegarde cohérente connue (ISO). */
  lastBackupAt?: string | null;
  /** Nombre de sauvegardes disponibles. */
  backupCount?: number | null;
}

/* ----------------------------------------------------------------------------
 * Construction de la file de travail
 * -------------------------------------------------------------------------- */

export function buildWorkQueue(input: WorkQueueInput): WorkQueueItem[] {
  const { now, kpis } = input;
  const items: WorkQueueItem[] = [];

  /* --- Caisse : session ouverte depuis trop longtemps ---------------------- */
  if (kpis.cashSessionOpen && input.activeCashSession) {
    const age = hoursSince(input.activeCashSession.opened_at, now);
    if (age !== null && age >= CASH_SESSION_STALE_HOURS) {
      items.push({
        id: `cash-stale-${input.activeCashSession.id}`,
        category: 'cash',
        severity: age >= CASH_SESSION_STALE_HOURS * 2 ? 'critical' : 'warning',
        title: 'Comptez et clôturez la caisse',
        detail: `Session ${input.activeCashSession.reference} ouverte depuis ${age} h (seuil ${CASH_SESSION_STALE_HOURS} h). Le tiroir n’est pas contrôlé.`,
        actionLabel: 'Clôturer la caisse',
        to: '/cash',
        count: 1,
        priority: 10,
      });
    }
  } else if (!kpis.cashSessionOpen) {
    items.push({
      id: 'cash-closed',
      category: 'cash',
      severity: 'critical',
      title: 'Ouvrez une session de caisse',
      detail:
        'Caisse fermée : aucune vente au comptant ni encaissement de solde ne peut être enregistré.',
      actionLabel: 'Ouvrir la caisse',
      to: '/cash',
      priority: 5,
    });
  }

  /* --- Créances clients échues (calcul vérifié côté Rust) ------------------ */
  const overdueRecCount = kpis.overdueReceivablesCount ?? 0;
  if (overdueRecCount > 0) {
    items.push({
      id: 'receivables-overdue',
      category: 'receivables',
      severity: 'critical',
      title: 'Recouvrez les créances échues',
      detail: `${overdueRecCount} créance(s) client ont dépassé leur échéance. Encours échu à recouvrer.`,
      actionLabel: 'Relancer et encaisser',
      to: '/debts?statut=en_retard',
      count: overdueRecCount,
      amountXof: kpis.overdueReceivablesTotal ?? 0,
      priority: 20,
    });
  }

  /* --- Dettes fournisseurs échues (calcul vérifié côté Rust) --------------- */
  const overdueSupCount = kpis.overdueSupplierDebtsCount ?? 0;
  if (overdueSupCount > 0) {
    items.push({
      id: 'supplier-debts-overdue',
      category: 'supplier_debts',
      severity: 'critical',
      title: 'Réglez les dettes fournisseurs échues',
      detail: `${overdueSupCount} dette(s) fournisseur ont dépassé leur échéance.`,
      actionLabel: 'Régler',
      to: '/suppliers?dettes=en_retard',
      count: overdueSupCount,
      amountXof: kpis.overdueSupplierDebtsTotal ?? 0,
      priority: 25,
    });
  }

  /* --- Ruptures et stocks critiques (comptages vérifiés côté Rust) -------- */
  if (kpis.outOfStockCount > 0) {
    items.push({
      id: 'stock-out',
      category: 'stock',
      severity: 'critical',
      title: 'Réapprovisionnez les ruptures de stock',
      detail: `${kpis.outOfStockCount} produit(s) actifs sont à quantité nulle : toute vente sera bloquée.`,
      actionLabel: 'Voir les ruptures',
      to: '/stock?alerte=rupture',
      count: kpis.outOfStockCount,
      priority: 30,
    });
  }
  if (kpis.lowStockCount > 0) {
    items.push({
      id: 'stock-low',
      category: 'stock',
      severity: 'warning',
      title: 'Anticipez les stocks sous seuil',
      detail: `${kpis.lowStockCount} produit(s) ont atteint leur seuil minimum configuré.`,
      actionLabel: 'Voir les seuils',
      to: '/stock?alerte=seuil',
      count: kpis.lowStockCount,
      priority: 40,
    });
  }

  /* --- Commandes : approbations, livraisons et soldes --------------------- */
  const orders = input.orders ?? [];
  const pendingApproval = orders.filter(
    (o) => o.approval_status === 'pending_owner_approval'
  );
  if (pendingApproval.length > 0) {
    items.push({
      id: 'orders-approval',
      category: 'orders',
      severity: 'warning',
      title: 'Décidez des commandes en attente d’approbation',
      detail: `${pendingApproval.length} commande(s) attendent une décision du propriétaire ; aucun stock n’est encore réservé.`,
      actionLabel: 'Examiner les demandes',
      to: '/orders?statut=a_approuver',
      count: pendingApproval.length,
      priority: 35,
    });
  }

  const toDeliver = orders.filter((o) => o.status === 'confirmed' || o.status === 'preparing');
  if (toDeliver.length > 0) {
    const amountToCollect = toDeliver.reduce(
      (sum, o) => sum + Math.max(0, (o.total_to_collect_xof ?? 0) - (o.paid_xof ?? 0)),
      0
    );
    items.push({
      id: 'orders-deliver',
      category: 'orders',
      severity: 'warning',
      title: 'Livrez les commandes confirmées',
      detail: `${toDeliver.length} commande(s) confirmée(s) attendent la remise des marchandises et l’imputation des consignes.`,
      actionLabel: 'Préparer et livrer',
      to: '/orders?statut=a_livrer',
      count: toDeliver.length,
      amountXof: amountToCollect,
      priority: 45,
    });
  }

  const unsettled = orders.filter(
    (o) =>
      ['delivered', 'invoiced'].includes(o.status) &&
      Math.max(0, (o.total_to_collect_xof ?? 0) - (o.paid_xof ?? 0)) > 0
  );
  if (unsettled.length > 0) {
    const outstanding = unsettled.reduce(
      (sum, o) => sum + Math.max(0, (o.total_to_collect_xof ?? 0) - (o.paid_xof ?? 0)),
      0
    );
    items.push({
      id: 'orders-settle',
      category: 'orders',
      severity: 'warning',
      title: 'Encaissez les soldes des commandes livrées',
      detail: `${unsettled.length} commande(s) livrée(s) conservent un solde à percevoir.`,
      actionLabel: 'Encaisser les soldes',
      to: '/orders?statut=solde_du',
      count: unsettled.length,
      amountXof: outstanding,
      priority: 50,
    });
  }

  /* --- Inventaires en brouillon ------------------------------------------- */
  const draftInventories = (input.inventories ?? []).filter((i) => i.status === 'draft');
  if (draftInventories.length > 0) {
    items.push({
      id: 'inventory-draft',
      category: 'inventory',
      severity: 'warning',
      title: 'Finalisez les inventaires en brouillon',
      detail: `${draftInventories.length} fiche(s) de comptage ne sont pas validées : les stocks physiques ne sont pas encore alignés.`,
      actionLabel: 'Reprendre les comptages',
      to: '/inventories?statut=brouillon',
      count: draftInventories.length,
      priority: 55,
    });
  }

  /* --- Emballages consignés échus (due_date fournie par l’API) ------------ */
  const issues = input.packagingOpenIssues ?? [];
  const overdueIssues = issues.filter((issue) => {
    const pending = Math.max(0, (issue.pieces ?? 0) - (issue.returned_pieces ?? 0));
    if (pending <= 0) return false;
    if (issue.overdue === true) return true;
    return isPastDueDate(issue.due_date, now);
  });
  if (overdueIssues.length > 0) {
    const pendingPieces = overdueIssues.reduce(
      (sum, issue) => sum + Math.max(0, (issue.pieces ?? 0) - (issue.returned_pieces ?? 0)),
      0
    );
    items.push({
      id: 'consignments-overdue',
      category: 'consignments',
      severity: 'warning',
      title: 'Relancez les emballages consignés échus',
      detail: `${overdueIssues.length} obligation(s) de consigne ont dépassé le délai de restitution (15 j).`,
      actionLabel: 'Traiter les retours',
      to: '/consignments?tab=issues',
      count: pendingPieces,
      priority: 60,
    });
  }

  /* --- Sauvegardes : fraîcheur -------------------------------------------- */
  const backupAge = daysSince(input.lastBackupAt, now);
  if (input.lastBackupAt === null || input.lastBackupAt === undefined) {
    items.push({
      id: 'backup-missing',
      category: 'backups',
      severity: 'warning',
      title: 'Créez une première sauvegarde',
      detail:
        'Aucune sauvegarde cohérente n’est enregistrée : une panne disque entraînerait une perte définitive.',
      actionLabel: 'Sauvegarder maintenant',
      to: '/backups',
      priority: 65,
    });
  } else if (backupAge !== null && backupAge >= BACKUP_STALE_DAYS) {
    items.push({
      id: 'backup-stale',
      category: 'backups',
      severity: backupAge >= BACKUP_STALE_DAYS * 2 ? 'critical' : 'warning',
      title: 'Renouvelez la sauvegarde',
      detail: `Dernière sauvegarde il y a ${backupAge} jour(s) (seuil ${BACKUP_STALE_DAYS} j).`,
      actionLabel: 'Lancer une sauvegarde',
      to: '/backups',
      priority: 70,
    });
  }

  return prioritizeWorkQueue(items);
}

/* ----------------------------------------------------------------------------
 * Résumé lisible pour l’en-tête du panneau
 * -------------------------------------------------------------------------- */

export function summarizeWorkQueue(items: readonly WorkQueueItem[]): {
  total: number;
  critical: number;
  warning: number;
  allClear: boolean;
  headline: string;
} {
  const critical = items.filter((i) => i.severity === 'critical').length;
  const warning = items.filter((i) => i.severity === 'warning').length;
  const total = items.length;

  let headline: string;
  if (total === 0) {
    headline = 'Aucune action requise : caisse, stocks, encaissements et sauvegardes sont à jour.';
  } else if (critical > 0) {
    headline = `${critical} action(s) bloquante(s) et ${warning} point(s) à traiter avant la prochaine vente.`;
  } else {
    headline = `${warning} point(s) à traiter aujourd’hui ; aucune action bloquante.`;
  }

  return { total, critical, warning, allClear: total === 0, headline };
}

/* ----------------------------------------------------------------------------
 * Filtres de listes (conservés dans l’URL)
 * -------------------------------------------------------------------------- */

export interface OrderListFilter {
  statut: 'tous' | 'a_approuver' | 'a_livrer' | 'solde_du' | 'en_cours';
  search: string;
}

const ORDER_STATUS_BY_FILTER: Record<Exclude<OrderListFilter['statut'], 'tous'>, string[]> = {
  a_approuver: ['pending_owner_approval'],
  a_livrer: ['confirmed', 'preparing'],
  solde_du: ['delivered', 'invoiced'],
  en_cours: ['draft', 'confirmed', 'preparing', 'delivered', 'invoiced'],
};

export function filterCustomerOrders(
  orders: readonly CustomerOrderSummary[],
  filter: OrderListFilter
): CustomerOrderSummary[] {
  const q = filter.search.trim().toLowerCase();
  return orders.filter((o) => {
    if (filter.statut === 'a_approuver') {
      if (o.approval_status !== 'pending_owner_approval') return false;
    } else if (filter.statut !== 'tous') {
      const allowed = ORDER_STATUS_BY_FILTER[filter.statut];
      if (!allowed.includes(o.status)) return false;
    }
    if (
      q &&
      !o.order_number.toLowerCase().includes(q) &&
      !o.customer_name.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}

export interface ReceivableListFilter {
  statut: 'tous' | 'en_retard' | 'ouvertes';
  search: string;
}

export function filterReceivables<
  T extends {
    client_name: string;
    client_code: string;
    sale_reference: string;
    remaining_amount: number;
    due_date: string | null;
    status: string;
  },
>(rows: readonly T[], filter: ReceivableListFilter, now: Date): T[] {
  const q = filter.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.statut !== 'tous') {
      if (r.status === 'cancelled' || r.remaining_amount <= 0) return false;
      if (filter.statut === 'en_retard' && !isPastDueDate(r.due_date, now)) return false;
    }
    if (
      q &&
      !r.client_name.toLowerCase().includes(q) &&
      !r.client_code.toLowerCase().includes(q) &&
      !r.sale_reference.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}
