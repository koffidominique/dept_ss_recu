/* ============================================================================
 * Logique pure des tournées de livraison
 * ============================================================================
 *
 * Extraite des composants pour être testable sans navigateur : le dépôt n'a
 * aucun outillage de rendu en local (pas de node_modules), et la CI est le
 * seul juge. Ce qui décide d'un montant, d'un écart ou d'un libellé vit donc
 * ici, pas dans un `onClick`.
 */

import type {
  CreateDeliveryRunInput,
  DeliveryReconciliation,
  DeliveryRun,
  DeliveryRunStatus,
  DeliveryRunStop,
} from "../../../types/erp.ts";

/** Libellés des statuts de tournée, dans l'ordre du cycle de vie. */
export const RUN_STATUS_LABELS: Record<DeliveryRunStatus, string> = {
  draft: "Brouillon",
  loaded: "Chargée",
  in_progress: "En tournée",
  returned: "Rentrée",
  reconciled: "Réconciliée",
  cancelled: "Annulée",
};

export const STOP_STATUS_LABELS: Record<DeliveryRunStop["status"], string> = {
  planned: "Prévu",
  delivered: "Livré",
  failed: "Échec",
  skipped: "Ignoré",
};

/**
 * Ce que le gérant peut faire à une tournée, selon son statut.
 *
 * Une seule source de vérité pour les boutons : sans cela, l'écran propose une
 * action que le cœur refuse, et l'utilisateur découvre la règle par un message
 * d'erreur.
 */
export interface RunActions {
  canAddStop: boolean;
  canLoad: boolean;
  canStart: boolean;
  canCancel: boolean;
  canRecordOutcome: boolean;
  canDeclareCollection: boolean;
  canRecordReturn: boolean;
  canReturnRun: boolean;
  canReconcile: boolean;
}

export function runActions(status: DeliveryRunStatus, stopCount: number): RunActions {
  const editable = status === "draft" || status === "loaded";
  return {
    canAddStop: editable,
    // Charger une tournée vide est refusé par le cœur : on ne propose pas le
    // geste, on ne le laisse pas échouer.
    canLoad: editable && stopCount > 0,
    canStart: status === "loaded",
    canCancel: status === "draft" || status === "loaded",
    // Les constats d'arrêt se posent pendant la tournée et au retour : le
    // gérant peut encore corriger un statut resté « prévu » après coup.
    canRecordOutcome: status === "in_progress" || status === "returned",
    canDeclareCollection: status === "in_progress",
    canRecordReturn: status === "in_progress" || status === "returned",
    canReturnRun: status === "in_progress",
    canReconcile: status === "returned",
  };
}

/**
 * Quand la réconciliation est-elle **lisible** ?
 *
 * Dès le retour, pas seulement une fois réconciliée : la modale qui décide du
 * montant à encaisser a besoin de l'attendu et du déclaré pour calculer les
 * écarts. La restreindre à `reconciled` ouvrait une modale vide au moment
 * précis où le gérant en a besoin.
 */
export function isReconcilableForReading(status: DeliveryRunStatus | undefined): boolean {
  return status === 'returned' || status === 'reconciled';
}

/** Une tournée close ne se modifie plus : `reconciled` et `cancelled` sont terminaux. */
export function isTerminal(status: DeliveryRunStatus): boolean {
  return status === "reconciled" || status === "cancelled";
}

/**
 * Ce que le livreur doit savoir avant de partir, en une phrase.
 *
 * `expected_amount` est figé au chargement : c'est l'attendu de la tournée, pas
 * un prévisionnel recalculé. Afficher autre chose ferait diverger l'écran du
 * montant qui sera réconcilié le soir.
 */
export function runBrief(run: DeliveryRun, stops: DeliveryRunStop[]): string {
  const delivered = stops.filter((s) => s.status === "delivered").length;
  const pending = stops.filter((s) => s.status === "planned").length;
  const parts = [
    `${stops.length} arrêt${stops.length > 1 ? "s" : ""}`,
    `${formatXof(stops.reduce((sum, s) => sum + s.expected_amount, 0))} attendus`,
  ];
  if (run.status === "in_progress" || run.status === "returned") {
    parts.push(`${delivered} livré${delivered > 1 ? "s" : ""}`);
    if (pending > 0) parts.push(`${pending} non constaté${pending > 1 ? "s" : ""}`);
  }
  return parts.join(" · ");
}

function formatXof(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

/**
 * Écarts d'une réconciliation, prêts à afficher.
 *
 * Deux écarts différents, et les confondre est l'erreur classique :
 * `declared_gap` = déclaré − attendu (le livreur s'est trompé ou a oublié),
 * `cash_gap` = compté − déclaré (il manque des billets dans le sac).
 * Un seul des deux à zéro ne veut pas dire que tout va bien.
 */
export interface GapLine {
  label: string;
  value: number;
  /** `null` quand l'écart est nul : rien à signaler, aucune couleur à poser. */
  tone: "ok" | "warning" | "danger" | null;
  explanation: string;
}

export function reconciliationGaps(rec: DeliveryReconciliation): GapLine[] {
  return [
    {
      label: "Écart de déclaration",
      value: rec.declared_gap,
      tone: rec.declared_gap === 0 ? null : rec.declared_gap < 0 ? "danger" : "warning",
      explanation:
        rec.declared_gap === 0
          ? "Le livreur a déclaré exactement l'attendu."
          : rec.declared_gap < 0
            ? "Le livreur a déclaré moins que ce qui était attendu : arrêt oublié ou erreur de saisie."
            : "Le livreur a déclaré plus que l'attendu : encaissement hors tournée ou arrêt surévalué.",
    },
    {
      label: "Écart de caisse",
      value: rec.cash_gap,
      tone: rec.cash_gap === 0 ? null : rec.cash_gap < 0 ? "danger" : "warning",
      explanation:
        rec.cash_gap === 0
          ? "Le comptage correspond à la déclaration."
          : rec.cash_gap < 0
            ? "Il manque de l'argent dans le sac par rapport à ce qui a été déclaré."
            : "Il y a plus d'argent dans le sac que ce qui a été déclaré.",
    },
  ];
}

/**
 * Un motif est obligatoire dès qu'un écart existe.
 *
 * Le cœur le vérifie aussi ; le formulaire le vérifie avant l'appel pour que
 * l'utilisateur n'ait pas à deviner. Renvoie `null` si la saisie est recevable.
 */
export function reconciliationBlocker(
  expected: number,
  declared: number,
  counted: number,
  reason: string,
): string | null {
  for (const [label, v] of [
    ["Le montant attendu", expected],
    ["Le montant déclaré", declared],
    ["Le montant compté", counted],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) {
      return `${label} doit être un entier positif en FCFA.`;
    }
  }
  const hasGap = declared !== expected || counted !== declared;
  if (hasGap && reason.trim().length === 0) {
    return "Un motif est obligatoire dès qu'un écart existe : sans lui, la caisse serait fausse sans explication.";
  }
  return null;
}

/**
 * Contrôle de la saisie de retour de vides.
 *
 * Le stock ne bouge que si les vides rapportés ont une contrepartie chez un
 * client : la somme des répartitions par consignable doit égaler exactement ce
 * qui est rapporté. Un déséquilibre ici ferait entrer des casiers au dépôt
 * sans que personne ne les ait rendus — le parc grossirait tout seul.
 */
export interface ReturnAllocationLike {
  returnable_id: number;
  good_pieces: number;
  damaged_pieces: number;
}

export function allocationBlocker(
  returned: ReturnAllocationLike[],
  allocated: ReturnAllocationLike[],
): string | null {
  const byReturnable = new Map<number, { good: number; damaged: number }>();
  for (const r of returned) {
    if (r.good_pieces < 0 || r.damaged_pieces < 0) {
      return "Les quantités rapportées ne peuvent pas être négatives.";
    }
    const cur = byReturnable.get(r.returnable_id) ?? { good: 0, damaged: 0 };
    cur.good += r.good_pieces;
    cur.damaged += r.damaged_pieces;
    byReturnable.set(r.returnable_id, cur);
  }

  const allocatedByReturnable = new Map<number, { good: number; damaged: number }>();
  for (const a of allocated) {
    if (a.good_pieces < 0 || a.damaged_pieces < 0) {
      return "Les quantités réparties ne peuvent pas être négatives.";
    }
    const cur = allocatedByReturnable.get(a.returnable_id) ?? { good: 0, damaged: 0 };
    cur.good += a.good_pieces;
    cur.damaged += a.damaged_pieces;
    allocatedByReturnable.set(a.returnable_id, cur);
  }

  for (const [returnableId, got] of byReturnable) {
    const given = allocatedByReturnable.get(returnableId) ?? { good: 0, damaged: 0 };
    if (got.good !== given.good) {
      return `Vides en bon état : ${got.good} rapportés, ${given.good} répartis. Les deux doivent être égaux.`;
    }
    if (got.damaged !== given.damaged) {
      return `Vides abîmés : ${got.damaged} rapportés, ${given.damaged} répartis. Les deux doivent être égaux.`;
    }
  }
  for (const returnableId of allocatedByReturnable.keys()) {
    if (!byReturnable.has(returnableId)) {
      return "Une répartition porte sur un emballage qui n'est pas déclaré comme rapporté.";
    }
  }
  return null;
}

/** Date locale au format `AAAA-MM-JJ`, sans décalage de fuseau. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Payload de création, avec la date du jour par défaut. */
export function buildCreateRunInput(
  driverUserId: number,
  vehicleLabel: string,
  notes: string,
  requestKey: string,
  now: Date = new Date(),
): CreateDeliveryRunInput {
  return {
    run_date: todayIso(now),
    driver_user_id: driverUserId,
    vehicle_label: vehicleLabel.trim() || null,
    notes: notes.trim() || null,
    request_key: requestKey,
  };
}

/**
 * Ce compte peut-il se voir attribuer une tournée ?
 *
 * Il faut un compte actif **et** un rôle qui porte `delivery_runs:execute`.
 * Dans `rbac.rs`, seuls `Owner` et `Driver` portent cette permission : un
 * admin ou un gérant prépare et réconcilie, il ne part pas en tournée. Filtrer
 * sur le seul champ `active` ferait donc proposer un caissier pour un départ
 * qu'il ne pourrait jamais déclencher.
 *
 * `UserAccount` ne renvoie pas les permissions du compte (seul `/api/auth/me`
 * le fait pour la session courante) : on s'appuie sur le rôle, dont la matrice
 * est fixée côté serveur.
 */
const DRIVER_CAPABLE_ROLES = new Set(["driver", "owner"]);

export function isDriverAccount(user: { active: boolean; role: string }): boolean {
  return user.active && DRIVER_CAPABLE_ROLES.has(user.role);
}
