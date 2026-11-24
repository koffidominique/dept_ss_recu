/* ============================================================================
 * Vides rapportés au comptoir — logique pure
 * ========================================================================== */
// Séparé du composant pour deux raisons : c'est testable sans DOM, et ce sont
// les deux décisions qui comptent (agréger par consignable, avertir sur
// l'excédent) qui méritent d'être vérifiées, pas le rendu.

import type { CustomerDepositBalance, PackagingObligationRef } from '../../../types/erp.ts';

/**
 * Ligne de consigne due, agrégée par consignable.
 * Les consignes naissent par vente ; le client, lui, raisonne en casiers.
 */
export interface DueEmptyLine {
  returnable_id: number;
  packaging_asset_id: number | null;
  packaging_name: string;
  due_pieces: number;
  unit_value: number;
  overdue: boolean;
  due_date: string | null;
}

export interface ReturnedEmptyLine {
  returnable_id: number;
  packaging_asset_id: number;
  packaging_name: string;
  pieces: number;
}

/**
 * Agrège les consignes ouvertes par consignable.
 *
 * Une même consigne peut naître sur plusieurs ventes d'un même emballage. On
 * additionne donc les pièces dues par consignable, en gardant l'échéance la
 * plus ancienne comme repère visuel et en marquant la ligne échue dès qu'une
 * des consignes l'est.
 */
export function aggregateDueEmpties(
  deposits: CustomerDepositBalance[],
  obligations: PackagingObligationRef[],
): DueEmptyLine[] {
  const parConsignable = new Map<number, DueEmptyLine>();

  for (const o of obligations) {
    const pending = o.pending_pieces;
    if (!Number.isFinite(pending) || pending <= 0) continue;

    const existant = parConsignable.get(o.returnable_id);
    if (existant) {
      existant.due_pieces += pending;
      existant.overdue = existant.overdue || o.overdue;
      if (o.due_date && (!existant.due_date || o.due_date < existant.due_date)) {
        existant.due_date = o.due_date;
      }
      continue;
    }

    const asset = deposits.find((d) => d.returnable_id === o.returnable_id);
    parConsignable.set(o.returnable_id, {
      returnable_id: o.returnable_id,
      packaging_asset_id: asset?.packaging_asset_id ?? null,
      packaging_name: asset?.packaging_name ?? `Consignable #${o.returnable_id}`,
      due_pieces: pending,
      unit_value: o.unit_value,
      overdue: o.overdue,
      due_date: o.due_date,
    });
  }

  return [...parConsignable.values()].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31');
  });
}

/**
 * Ce que le client rapporte et qui ne correspond à aucune dette.
 *
 * Cas réel : le client rend 10 casiers alors qu'il n'en doit que 8. Sans
 * avertissement, le gérant croirait avoir soldé quelque chose et les 2 casiers
 * en trop disparaîtraient silencieusement.
 */
export function surplusWarning(returned: ReturnedEmptyLine[], due: DueEmptyLine[]): string[] {
  const avertissements: string[] = [];
  for (const ligne of returned) {
    if (ligne.pieces <= 0) continue;
    const du = due.find((d) => d.returnable_id === ligne.returnable_id);
    const duPieces = du?.due_pieces ?? 0;
    if (ligne.pieces > duPieces) {
      avertissements.push(
        `${ligne.pieces} ${ligne.packaging_name} rapportés, ${duPieces} dus : ` +
          `${ligne.pieces - duPieces} en trop. La consigne sera soldée, l'excédent n'est pas déduit.`,
      );
    }
  }
  return avertissements;
}
