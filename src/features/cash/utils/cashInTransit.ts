/* ============================================================================
 * Argent en tournée : logique pure
 * ============================================================================
 *
 * L'argent déclaré par les livreurs n'est pas en caisse. Il est en transit.
 * Ce module décide comment le présenter, et surtout comment ne PAS le faire
 * ressembler à du tiroir.
 */

import type { RunInTransit } from "../../../types/erp.ts";

/** Total déclaré par les livreurs sur toutes les tournées en cours. */
export function totalInTransit(runs: RunInTransit[] | undefined): number {
  if (!runs) return 0;
  return runs.reduce((sum, r) => sum + r.declaredAmount, 0);
}

/** Total attendu sur ces mêmes tournées (arrêts livrés seulement). */
export function totalExpectedInTransit(runs: RunInTransit[] | undefined): number {
  if (!runs) return 0;
  return runs.reduce((sum, r) => sum + r.expectedAmount, 0);
}

/**
 * Ce qu'il reste à collecter : attendu − déclaré.
 *
 * Positif : le livreur a encaissé moins que prévu (arrêts non faits, ou
 * omissions). Négatif : il déclare plus que l'attendu, ce qui mérite un
 * contrôle.
 */
export function remainingToCollect(run: RunInTransit): number {
  return run.expectedAmount - run.declaredAmount;
}

export interface TransitSummary {
  runsCount: number;
  totalDeclared: number;
  totalExpected: number;
  /** Vrai dès qu'une tournée a un écart : le panneau passe en avertissement. */
  hasGap: boolean;
}

export function summarizeTransit(runs: RunInTransit[] | undefined): TransitSummary {
  const list = runs ?? [];
  const totalDeclared = totalInTransit(list);
  const totalExpected = totalExpectedInTransit(list);
  return {
    runsCount: list.length,
    totalDeclared,
    totalExpected,
    hasGap: totalDeclared !== totalExpected,
  };
}

/**
 * Un tournée est-elle « active » au sens de la collecte ?
 *
 * Une tournée dont tous les arrêts sont constatés n'attend plus rien, même si
 * elle n'est pas encore rentrée : le livreur a fini sa route.
 */
export function isCollecting(run: RunInTransit): boolean {
  return run.declaredStops < run.plannedStops || remainingToCollect(run) !== 0;
}

/**
 * La phrase qui doit accompagner le montant.
 *
 * Elle est là pour empêcher la lecture fausse la plus probable : croire que
 * cet argent est déjà dans le tiroir. Le théorique de la caisse ne le compte
 * pas, et ne le comptera qu'à la réconciliation.
 */
export function transitCaption(total: number): string {
  if (total === 0) {
    return "Aucun encaissement de tournée en cours.";
  }
  return "En transit dans le sac des livreurs — hors caisse. Cet argent n'entrera au tiroir qu'à la réconciliation de chaque tournée.";
}
