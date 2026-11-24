import { MAX_SAFE_BIG } from '../../sales/utils/saleMathHelpers.ts';
import { newRequestKey } from '../../../utils/format.ts';
import type { InventoryLine } from '../types.ts';

/**
 * Parse une quantité positive ou nulle (ex: "0", "2", "1.5", "1,250") en milli-unités exactes via BigInt.
 * Utile pour les inventaires physiques et réceptions où 0 est une valeur légitime.
 */
export function parseNonNegativeQtyToMilliBigInt(
  raw: string,
  label = 'Quantité'
): { ok: true; milli: bigint } | { ok: false; error: string } {
  const clean = String(raw ?? '').trim().replace(',', '.');
  if (!clean) {
    return { ok: false, error: `${label} : saisie requise.` };
  }
  if (!/^\d+(\.\d{1,3})?$/.test(clean)) {
    if (/^\d+\.$/.test(clean)) {
      return { ok: false, error: `${label} : saisie décimale incomplète.` };
    }
    if (/^\d+\.\d{4,}$/.test(clean)) {
      return { ok: false, error: `${label} : 3 décimales maximum autorisées.` };
    }
    return { ok: false, error: `${label} : valeur positive ou nulle invalide.` };
  }
  const [intPart, fracPart = ''] = clean.split('.');
  const milli = BigInt(intPart) * 1000n + BigInt(fracPart.padEnd(3, '0'));
  if (milli > MAX_SAFE_BIG) {
    return { ok: false, error: `${label} dépasse la capacité numérique autorisée.` };
  }
  return { ok: true, milli };
}

export interface IdempotentRequestTracker {
  resolveKey: (fingerprint: string) => string;
  reset: () => void;
}

/**
 * Maintient la même `request_key` tant que l'empreinte métier du brouillon
 * n'a pas changé et que la mutation n'a pas abouti (`reset()`).
 * Protège contre les doubles clics, timeouts et tentatives répétées.
 */
export function createIdempotentRequestTracker(prefix: string): IdempotentRequestTracker {
  let cachedFingerprint: string | null = null;
  let cachedKey: string | null = null;
  return {
    resolveKey(fingerprint: string): string {
      if (cachedKey && cachedFingerprint === fingerprint) {
        return cachedKey;
      }
      cachedFingerprint = fingerprint;
      cachedKey = newRequestKey(prefix);
      return cachedKey;
    },
    reset(): void {
      cachedFingerprint = null;
      cachedKey = null;
    },
  };
}

/* ============================================================================
 * Garde-fous purs Lot 2 : Caisse, Inventaire/Stock, Commandes & Réceptions
 * ============================================================================ */

export const SIGNIFICANT_CASH_DISCREPANCY_XOF = 1000;
export const SIGNIFICANT_DISCREPANCY_MIN_REASON_LEN = 10;

export type CashDiscrepancySeverity = 'exact' | 'minor_surplus' | 'minor_shortage' | 'significant_surplus' | 'significant_shortage';

export interface CashDiscrepancyEvaluation {
  diffXof: number;
  severity: CashDiscrepancySeverity;
  requiresReason: boolean;
  minReasonLength: number;
  isReasonValid: boolean;
  validationMessage: string | null;
}

export function evaluateCashDiscrepancy(
  theoreticalCash: number,
  physicalCash: number,
  closingNotes: string
): CashDiscrepancyEvaluation {
  const safeTheo = Number.isSafeInteger(theoreticalCash) ? theoreticalCash : 0;
  const safePhys = Number.isSafeInteger(physicalCash) && physicalCash >= 0 ? physicalCash : 0;
  const diffXof = safePhys - safeTheo;
  const absDiff = Math.abs(diffXof);

  if (diffXof === 0) {
    return {
      diffXof: 0,
      severity: 'exact',
      requiresReason: false,
      minReasonLength: 0,
      isReasonValid: true,
      validationMessage: null,
    };
  }

  const isSignificant = absDiff >= SIGNIFICANT_CASH_DISCREPANCY_XOF;
  const severity: CashDiscrepancySeverity =
    diffXof > 0
      ? isSignificant
        ? 'significant_surplus'
        : 'minor_surplus'
      : isSignificant
        ? 'significant_shortage'
        : 'minor_shortage';

  const minReasonLength = isSignificant ? SIGNIFICANT_DISCREPANCY_MIN_REASON_LEN : 3;
  const trimmedLen = closingNotes.trim().length;
  const isReasonValid = trimmedLen >= minReasonLength;

  let validationMessage: string | null = null;
  if (!isReasonValid) {
    validationMessage = isSignificant
      ? `Écart significatif (${diffXof > 0 ? '+' : ''}${diffXof.toLocaleString('fr-FR')} FCFA) : détaillez le motif sur au moins ${minReasonLength} caractères.`
      : 'Un motif justificatif (min. 3 caractères) est obligatoire lorsque la caisse présente un écart.';
  }

  return {
    diffXof,
    severity,
    requiresReason: true,
    minReasonLength,
    isReasonValid,
    validationMessage,
  };
}

export function formatMilliExactString(milli: number | bigint): string {
  const big = typeof milli === 'bigint' ? milli : BigInt(Math.trunc(milli));
  const neg = big < 0n;
  const abs = neg ? -big : big;
  const intPart = abs / 1000n;
  const fracPart = abs % 1000n;
  const base =
    fracPart === 0n
      ? intPart.toString()
      : `${intPart.toString()}.${fracPart.toString().padStart(3, '0').replace(/0+$/, '')}`;
  return neg ? `-${base}` : base;
}

export interface EvaluatedInventoryLine {
  line: InventoryLine;
  enteredStr: string;
  validQty: boolean;
  countedMilli: number | null;
  deltaMilli: number;
  deltaFormatted: string;
  reason: string;
  missingReason: boolean;
  qtyError: string | null;
}

export interface InventoryDraftEvaluation {
  lines: EvaluatedInventoryLine[];
  totalDiscrepancies: number;
  positiveDiscrepancies: number;
  negativeDiscrepancies: number;
  invalidQtyCount: number;
  missingReasonCount: number;
  canValidate: boolean;
  blockingMessage: string | null;
}

export function evaluateInventoryDraftLines(
  lines: readonly InventoryLine[],
  counts: Record<number, string>,
  reasons: Record<number, string>
): InventoryDraftEvaluation {
  const evaluated: EvaluatedInventoryLine[] = [];
  let totalDiscrepancies = 0;
  let positiveDiscrepancies = 0;
  let negativeDiscrepancies = 0;
  let invalidQtyCount = 0;
  let missingReasonCount = 0;

  for (const line of lines) {
    const fallbackStr = formatMilliExactString(
      line.counted_milli !== null ? line.counted_milli : line.theoretical_milli
    );
    const enteredStr = counts[line.product_id] ?? fallbackStr;
    const reason = (reasons[line.product_id] ?? line.reason ?? '').trim();

    const parsed = parseNonNegativeQtyToMilliBigInt(
      enteredStr,
      `Comptage (${line.product_name})`
    );
    if (!parsed.ok) {
      invalidQtyCount += 1;
      evaluated.push({
        line,
        enteredStr,
        validQty: false,
        countedMilli: null,
        deltaMilli: 0,
        deltaFormatted: '—',
        reason,
        missingReason: false,
        qtyError: parsed.error,
      });
      continue;
    }

    const countedMilli = Number(parsed.milli);
    const deltaMilli = countedMilli - line.theoretical_milli;
    const hasDiff = deltaMilli !== 0;
    const missingReason = hasDiff && reason.length < 3;

    if (hasDiff) {
      totalDiscrepancies += 1;
      if (deltaMilli > 0) positiveDiscrepancies += 1;
      else negativeDiscrepancies += 1;
    }
    if (missingReason) {
      missingReasonCount += 1;
    }

    const prefix = deltaMilli > 0 ? '+' : '';
    evaluated.push({
      line,
      enteredStr,
      validQty: true,
      countedMilli,
      deltaMilli,
      deltaFormatted: `${prefix}${formatMilliExactString(deltaMilli)}`,
      reason,
      missingReason,
      qtyError: null,
    });
  }

  let blockingMessage: string | null = null;
  if (invalidQtyCount > 0) {
    blockingMessage = `${invalidQtyCount} article(s) comportent une quantité comptée invalide.`;
  } else if (missingReasonCount > 0) {
    blockingMessage = `${missingReasonCount} écart(s) d’inventaire doivent être justifiés par un motif (min. 3 caractères).`;
  }

  return {
    lines: evaluated,
    totalDiscrepancies,
    positiveDiscrepancies,
    negativeDiscrepancies,
    invalidQtyCount,
    missingReasonCount,
    canValidate: lines.length > 0 && invalidQtyCount === 0 && missingReasonCount === 0,
    blockingMessage,
  };
}

const VALID_SETTLEMENT_METHODS = new Set([
  'cash',
  'wave',
  'orange_money',
  'mtn_money',
  'moov_money',
  'transfer',
  'cheque',
]);

export function normalizeOrderSettlementMethod(
  plannedChannel?: string | null,
  paymentMethod?: string | null
): string {
  const candidate1 = (plannedChannel ?? '').trim().toLowerCase();
  if (VALID_SETTLEMENT_METHODS.has(candidate1)) return candidate1;
  if (candidate1 === 'mobile_money') return 'wave';

  const candidate2 = (paymentMethod ?? '').trim().toLowerCase();
  if (VALID_SETTLEMENT_METHODS.has(candidate2)) return candidate2;
  if (candidate2 === 'mobile_money') return 'wave';

  return 'cash';
}

export interface OrderLifecycleStage {
  id: 'draft' | 'confirmed' | 'delivered' | 'invoiced' | 'paid';
  label: string;
  state: 'done' | 'current' | 'upcoming';
}

export function computeOrderLifecycleStages(
  status: string,
  approvalStatus?: string | null,
  remainingToPay = 0
): { stages: OrderLifecycleStage[]; nextActionHint: string; isCancelled: boolean } {
  if (status === 'cancelled') {
    return {
      stages: [],
      isCancelled: true,
      nextActionHint: 'Commande annulée : aucune écriture supplémentaire n’est autorisée.',
    };
  }

  const orderRank: Record<string, number> = {
    draft: 0,
    confirmed: 1,
    preparing: 1,
    delivered: 2,
    invoiced: 3,
    paid: 4,
  };
  const currentRank = orderRank[status] ?? 0;

  const rawStages: Array<{ id: OrderLifecycleStage['id']; label: string; rank: number }> = [
    {
      id: 'draft',
      label:
        status === 'draft' && approvalStatus === 'pending_owner_approval'
          ? 'Attente approbation'
          : 'Brouillon',
      rank: 0,
    },
    { id: 'confirmed', label: 'Confirmée (stock réservé)', rank: 1 },
    { id: 'delivered', label: 'Livrée (consignes 15j)', rank: 2 },
    { id: 'invoiced', label: 'Facturée', rank: 3 },
    { id: 'paid', label: 'Soldée', rank: 4 },
  ];

  const stages: OrderLifecycleStage[] = rawStages.map((s) => ({
    id: s.id,
    label: s.label,
    state:
      s.rank < currentRank || (s.id === 'paid' && remainingToPay === 0 && currentRank >= 1)
        ? 'done'
        : s.rank === currentRank
          ? 'current'
          : 'upcoming',
  }));

  let nextActionHint = 'Commande soldée et livrée.';
  if (status === 'draft') {
    nextActionHint =
      approvalStatus === 'pending_owner_approval'
        ? 'En attente de décision du propriétaire dans le registre des documents.'
        : 'Prochaine étape : confirmer la commande (prélève le stock) ou la soumettre à approbation.';
  } else if (status === 'confirmed' || status === 'preparing') {
    nextActionHint =
      'Prochaine étape : enregistrer la livraison/retrait (active le suivi des emballages consignés 15 j).';
  } else if (status === 'delivered') {
    nextActionHint =
      remainingToPay > 0
        ? 'Prochaine étape : émettre la facture ou encaisser le solde dû.'
        : 'Prochaine étape : émettre la facture définitive ou suivre les retours de casiers vides.';
  } else if (status === 'invoiced' && remainingToPay > 0) {
    nextActionHint = 'Prochaine étape : encaisser le reliquat dû par le client.';
  }

  return { stages, nextActionHint, isCancelled: false };
}

export interface PurchaseReceiveLineEvaluation {
  remMilli: number;
  receivedMilli: number | null;
  missingMilli: number;
  damagedMilli: number;
  refusedMilli: number;
  exceedsRemaining: boolean;
  hasDiscrepancy: boolean;
  missingReason: boolean;
  invalidInput: boolean;
  errorMessage: string | null;
}

export function evaluatePurchaseReceiveLine(params: {
  orderedMilli: number;
  alreadyReceivedMilli: number;
  receiveRaw?: string;
  missingRaw?: string;
  damagedRaw?: string;
  refusedRaw?: string;
  reasonRaw?: string;
}): PurchaseReceiveLineEvaluation {
  const remMilli = Math.max(0, params.orderedMilli - params.alreadyReceivedMilli);

  const parseOpt = (raw?: string): number | null => {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return 0;
    const p = parseNonNegativeQtyToMilliBigInt(trimmed, 'Quantité');
    if (!p.ok) return null;
    return Number(p.milli);
  };

  const receivedMilli = parseOpt(params.receiveRaw);
  const missingMilli = parseOpt(params.missingRaw);
  const damagedMilli = parseOpt(params.damagedRaw);
  const refusedMilli = parseOpt(params.refusedRaw);

  if (
    receivedMilli === null ||
    missingMilli === null ||
    damagedMilli === null ||
    refusedMilli === null
  ) {
    return {
      remMilli,
      receivedMilli: null,
      missingMilli: 0,
      damagedMilli: 0,
      refusedMilli: 0,
      exceedsRemaining: false,
      hasDiscrepancy: false,
      missingReason: false,
      invalidInput: true,
      errorMessage: 'Quantité saisie invalide (3 décimales max, positive ou nulle).',
    };
  }

  const exceedsRemaining = receivedMilli > remMilli;
  const anyActivity =
    receivedMilli > 0 || missingMilli > 0 || damagedMilli > 0 || refusedMilli > 0;
  const hasDiscrepancy =
    anyActivity &&
    !exceedsRemaining &&
    (missingMilli > 0 || damagedMilli > 0 || refusedMilli > 0 || receivedMilli < remMilli);
  const missingReason = hasDiscrepancy && (params.reasonRaw ?? '').trim().length < 3;

  let errorMessage: string | null = null;
  if (exceedsRemaining) {
    errorMessage = 'La quantité reçue conforme dépasse le reliquat restant à recevoir.';
  } else if (missingReason) {
    errorMessage = 'Précisez le motif d’écart ou de livraison partielle (min. 3 caractères).';
  }

  return {
    remMilli,
    receivedMilli,
    missingMilli,
    damagedMilli,
    refusedMilli,
    exceedsRemaining,
    hasDiscrepancy,
    missingReason,
    invalidInput: false,
    errorMessage,
  };
}
