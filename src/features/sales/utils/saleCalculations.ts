import type { ClientPackagingBalance, DepositComponent } from '../../../types/erp.ts';
import {
  MAX_SAFE_BIG,
  type SharedDepositAccumulator,
  bigIntToSafeNumber,
  computeExactBaseQtyMilli,
  computeExactLineGrossFcfa,
  computeLineDepositFcfa,
  consolidateSharedDeposits,
  parseQtyInputToMilliBigInt,
  toNonNegativeIntFcfaBigInt,
} from './saleMathHelpers.ts';

/* ============================================================================
 * Exports publics & Contrats de calcul du panier POS
 * ============================================================================ */

export {
  computeExactBaseQtyMilli,
  computeExactLineGrossFcfa,
  parseQtyInputToMilliBigInt,
  toNonNegativeIntFcfaBigInt,
};

export interface SaleCalculationItem {
  key: string;
  productName: string;
  packagingName: string;
  coefficientMilli: number;
  allowFraction: boolean;
  quantity: string;
  unitPrice: number;
  discountAmount: number;
  depositPerPack: number;
  depositMode: 'none' | 'deposit' | null;
  depositComponents?: DepositComponent[];
}

export interface SalePaymentInput {
  method_code: string;
  amount: number;
}

export interface SaleLineCalculationResult {
  valid: boolean;
  qtyMilli: number | null;
  baseQtyMilli: number | null;
  lineGross: number | null;
  lineNet: number | null;
  lineDeposit: number | null;
  error: string | null;
}

export interface SaleCalculationResult {
  isValid: boolean;
  hasItems: boolean;
  errors: string[];
  lineResults: Record<string, SaleLineCalculationResult>;
  subtotalMerch: number | null;
  netMerch: number | null;
  totalDeposit: number | null;
  grandTotal: number | null;
  paidTotal: number | null;
  remainingAmount: number | null;
  overpaidAmount: number | null;
}

function emptyInvalidResult(
  hasItems: boolean,
  errors: string[],
  lineResults: Record<string, SaleLineCalculationResult>,
  paidTotal: number | null
): SaleCalculationResult {
  return {
    isValid: false,
    hasItems,
    errors,
    lineResults,
    subtotalMerch: null,
    netMerch: null,
    totalDeposit: null,
    grandTotal: null,
    paidTotal,
    remainingAmount: null,
    overpaidAmount: null,
  };
}

/* ============================================================================
 * Calcul global exact du panier (lignes, panachage, remises & règlements)
 * ============================================================================ */

/**
 * Calcule de manière exacte (BigInt) les lignes, remises, consignes et règlements du panier POS.
 * En cas d'erreur de quantité, de fraction interdite, de fraction de FCFA ou de débordement,
 * isValid vaut false et les totaux agrégés sont mis à null afin de ne jamais afficher un montant approximatif.
 */
export function calculateSaleCart(
  items: readonly SaleCalculationItem[],
  globalDiscountInput: number,
  payments: readonly SalePaymentInput[] = []
): SaleCalculationResult {
  const lineResults: Record<string, SaleLineCalculationResult> = {};
  const errors: string[] = [];

  let subtotalMerchBig = 0n;
  let totalDepositBig = 0n;
  let allLinesValid = true;
  const sharedDeposits = new Map<number, SharedDepositAccumulator>();

  /* --- 1. Validation & calcul ligne par ligne --- */
  for (const item of items) {
    const label = `${item.productName} (${item.packagingName})`;
    const failLine = (msg: string): void => {
      allLinesValid = false;
      errors.push(msg);
      lineResults[item.key] = {
        valid: false,
        qtyMilli: null,
        baseQtyMilli: null,
        lineGross: null,
        lineNet: null,
        lineDeposit: null,
        error: msg,
      };
    };

    const parsedQty = parseQtyInputToMilliBigInt(item.quantity, `Quantité (${label})`);
    if (!parsedQty.ok) {
      failLine(parsedQty.error);
      continue;
    }
    const qtyMilli = parsedQty.milli;

    if (!item.allowFraction && qtyMilli % 1000n !== 0n) {
      failLine(`Quantité entière requise pour "${label}".`);
      continue;
    }

    const baseCheck = computeExactBaseQtyMilli(qtyMilli, item.coefficientMilli, label);
    if (!baseCheck.ok) {
      failLine(baseCheck.error);
      continue;
    }

    const parsedPrice = toNonNegativeIntFcfaBigInt(item.unitPrice, `Prix unitaire (${label})`);
    if (!parsedPrice.ok) {
      failLine(parsedPrice.error);
      continue;
    }

    const grossCheck = computeExactLineGrossFcfa(qtyMilli, parsedPrice.fcfa, label);
    if (!grossCheck.ok) {
      failLine(grossCheck.error);
      continue;
    }

    const parsedDisc = toNonNegativeIntFcfaBigInt(item.discountAmount ?? 0, `Remise (${label})`);
    if (!parsedDisc.ok) {
      failLine(parsedDisc.error);
      continue;
    }
    if (parsedDisc.fcfa > grossCheck.amount) {
      failLine(`Remise supérieure au montant de ligne pour "${label}".`);
      continue;
    }

    const depCheck = computeLineDepositFcfa({
      label,
      qtyMilli,
      baseMilli: baseCheck.baseMilli,
      depositMode: item.depositMode,
      depositPerPack: item.depositPerPack,
      depositComponents: item.depositComponents,
      sharedDeposits,
    });
    if (!depCheck.ok) {
      failLine(depCheck.error);
      continue;
    }

    const lineNetBig = grossCheck.amount - parsedDisc.fcfa;
    const qtyNum = bigIntToSafeNumber(qtyMilli, `Quantité (${label})`);
    const baseNum = bigIntToSafeNumber(baseCheck.baseMilli, `Quantité de base (${label})`);
    const grossNum = bigIntToSafeNumber(grossCheck.amount, `Montant brut (${label})`);
    const netNum = bigIntToSafeNumber(lineNetBig, `Montant net (${label})`);
    const depNum = bigIntToSafeNumber(depCheck.amount, `Consigne (${label})`);
    if (!qtyNum.ok || !baseNum.ok || !grossNum.ok || !netNum.ok || !depNum.ok) {
      failLine(`Débordement numérique sur "${label}".`);
      continue;
    }

    subtotalMerchBig += lineNetBig;
    totalDepositBig += depCheck.amount;
    lineResults[item.key] = {
      valid: true,
      qtyMilli: qtyNum.num,
      baseQtyMilli: baseNum.num,
      lineGross: grossNum.num,
      lineNet: netNum.num,
      lineDeposit: depNum.num,
      error: null,
    };
  }

  /* --- 2. Consolidation des casiers partagés (panachage demi-casiers) --- */
  const pooledDeposits = consolidateSharedDeposits(sharedDeposits, errors);
  if (!pooledDeposits.ok) {
    allLinesValid = false;
  } else {
    totalDepositBig += pooledDeposits.amount;
    if (totalDepositBig > MAX_SAFE_BIG) {
      allLinesValid = false;
      errors.push('Total des consignes hors limites.');
    }
  }

  /* --- 3. Validation des paiements & remise globale --- */
  let paidTotalBig = 0n;
  let paymentsValid = true;
  for (const p of payments) {
    const parsedPay = toNonNegativeIntFcfaBigInt(p.amount, `Paiement (${p.method_code})`);
    if (!parsedPay.ok) {
      paymentsValid = false;
      errors.push(parsedPay.error);
      break;
    }
    paidTotalBig += parsedPay.fcfa;
    if (paidTotalBig > MAX_SAFE_BIG) {
      paymentsValid = false;
      errors.push('Total encaissé hors limites.');
      break;
    }
  }
  const paidTotal = paymentsValid ? Number(paidTotalBig) : null;

  const parsedGlobalDisc = toNonNegativeIntFcfaBigInt(globalDiscountInput, 'Remise globale');
  if (!parsedGlobalDisc.ok) {
    errors.push(parsedGlobalDisc.error);
  }

  const hasItems = items.length > 0;
  if (!hasItems || !allLinesValid || !parsedGlobalDisc.ok || !paymentsValid) {
    return emptyInvalidResult(hasItems, errors, lineResults, paidTotal);
  }

  if (parsedGlobalDisc.fcfa > subtotalMerchBig) {
    errors.push('La remise globale dépasse le sous-total marchandises.');
    return emptyInvalidResult(hasItems, errors, lineResults, paidTotal);
  }

  /* --- 4. Totaux finaux & reste dû / trop-perçu --- */
  const netMerchBig = subtotalMerchBig - parsedGlobalDisc.fcfa;
  const grandTotalBig = netMerchBig + totalDepositBig;

  const subRes = bigIntToSafeNumber(subtotalMerchBig, 'Sous-total marchandises');
  const netRes = bigIntToSafeNumber(netMerchBig, 'Total marchandises');
  const depRes = bigIntToSafeNumber(totalDepositBig, 'Total consignes');
  const grandRes = bigIntToSafeNumber(grandTotalBig, 'Total général');

  if (!subRes.ok || !netRes.ok || !depRes.ok || !grandRes.ok) {
    errors.push('Le total calculé dépasse la capacité numérique autorisée.');
    return emptyInvalidResult(hasItems, errors, lineResults, paidTotal);
  }

  if (grandTotalBig <= 0n) {
    errors.push('Le total de la vente doit être strictement positif.');
    return {
      ...emptyInvalidResult(hasItems, errors, lineResults, paidTotal),
      subtotalMerch: subRes.num,
      netMerch: netRes.num,
      totalDeposit: depRes.num,
    };
  }

  const remainingBig = grandTotalBig > paidTotalBig ? grandTotalBig - paidTotalBig : 0n;
  const overpaidBig = paidTotalBig > grandTotalBig ? paidTotalBig - grandTotalBig : 0n;

  return {
    isValid: true,
    hasItems: true,
    errors: [],
    lineResults,
    subtotalMerch: subRes.num,
    netMerch: netRes.num,
    totalDeposit: depRes.num,
    grandTotal: grandRes.num,
    paidTotal,
    remainingAmount: Number(remainingBig),
    overpaidAmount: Number(overpaidBig),
  };
}

/* ============================================================================
 * Calcul des retours d'emballages client au comptoir POS (hors total commande)
 * ============================================================================ */

export interface PosReturnableRow {
  returnable_id: number;
  packaging_name: string;
  packaging_code: string;
  deposit_value: number;
  prior_due_pieces: number;
  cart_outgoing_pieces: number;
  max_returnable_pieces: number;
}

/**
 * Fusionne les soldes d'emballages antérieurs du client et les emballages consignés
 * sortant dans le panier courant afin de calculer le plafond exact restituable par type.
 */
export function computeAvailableReturnableRows(
  clientBalances: readonly ClientPackagingBalance[],
  cartItems: readonly SaleCalculationItem[]
): PosReturnableRow[] {
  const byId = new Map<number, PosReturnableRow>();

  for (const bal of clientBalances) {
    if (bal.balance_pieces <= 0 && bal.deposit_held_amount <= 0) continue;
    byId.set(bal.returnable_id, {
      returnable_id: bal.returnable_id,
      packaging_name: bal.packaging_name,
      packaging_code: bal.packaging_code,
      deposit_value: Math.max(0, Math.trunc(bal.deposit_value)),
      prior_due_pieces: Math.max(0, Math.trunc(bal.balance_pieces)),
      cart_outgoing_pieces: 0,
      max_returnable_pieces: Math.max(0, Math.trunc(bal.balance_pieces)),
    });
  }

  const milliByReturnable = new Map<
    number,
    { name: string; code: string; depositValue: number; milliPieces: bigint }
  >();

  for (const item of cartItems) {
    if (item.depositMode !== 'deposit' || !item.depositComponents?.length) continue;
    const parsedQty = parseQtyInputToMilliBigInt(item.quantity);
    if (!parsedQty.ok) continue;
    for (const comp of item.depositComponents) {
      const addMilli = parsedQty.milli * BigInt(comp.pieces_per_pack);
      const prev = milliByReturnable.get(comp.returnable_id);
      milliByReturnable.set(comp.returnable_id, {
        name: comp.name,
        code: comp.code,
        depositValue: Math.max(0, Math.trunc(comp.deposit_value)),
        milliPieces: (prev?.milliPieces ?? 0n) + addMilli,
      });
    }
  }

  for (const [returnableId, acc] of milliByReturnable.entries()) {
    if (acc.milliPieces <= 0n || acc.milliPieces % 1000n !== 0n) continue;
    const outgoing = Number(acc.milliPieces / 1000n);
    const existing = byId.get(returnableId);
    if (existing) {
      existing.cart_outgoing_pieces = outgoing;
      existing.max_returnable_pieces = existing.prior_due_pieces + outgoing;
    } else {
      byId.set(returnableId, {
        returnable_id: returnableId,
        packaging_name: acc.name,
        packaging_code: acc.code,
        deposit_value: acc.depositValue,
        prior_due_pieces: 0,
        cart_outgoing_pieces: outgoing,
        max_returnable_pieces: outgoing,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.packaging_name.localeCompare(b.packaging_name, 'fr')
  );
}

/**
 * Calcule le montant valorisé des emballages retournés par le client (hors total commande)
 * en bornant chaque ligne à son plafond autorisé.
 */
export function computeReturnedPackagingSummary(
  rows: readonly PosReturnableRow[],
  received: ReadonlyArray<{ returnable_id: number; pieces: number }>
): {
  normalized: Array<{ returnable_id: number; pieces: number }>;
  totalPieces: number;
  totalAmountFcfa: number;
} {
  const rowMap = new Map(rows.map((r) => [r.returnable_id, r]));
  const agg = new Map<number, number>();

  for (const item of received) {
    const row = rowMap.get(item.returnable_id);
    if (!row) continue;
    const raw = Number.isFinite(item.pieces) ? Math.trunc(item.pieces) : 0;
    if (raw <= 0) continue;
    const next = Math.min(row.max_returnable_pieces, (agg.get(item.returnable_id) ?? 0) + raw);
    if (next > 0) {
      agg.set(item.returnable_id, next);
    }
  }

  const normalized: Array<{ returnable_id: number; pieces: number }> = [];
  let totalPieces = 0;
  let totalAmountFcfa = 0;

  for (const [returnable_id, pieces] of agg.entries()) {
    const row = rowMap.get(returnable_id);
    if (!row || pieces <= 0) continue;
    normalized.push({ returnable_id, pieces });
    totalPieces += pieces;
    totalAmountFcfa += pieces * row.deposit_value;
  }

  return { normalized, totalPieces, totalAmountFcfa };
}
