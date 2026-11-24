import {
  getSalesUnitTierPrice,
  getTierPrice,
} from '../hooks/usePosData.ts';
import type { CartItem } from '../../../stores/uiStore.ts';
import type {
  Client,
  PaymentMethodConfig,
  PriceTier,
  Product,
  ProductPackaging,
  ProductSalesUnit,
} from '../../../types/erp.ts';
import type { SaleCalculationResult } from './saleCalculations.ts';

export function buildCartItemFromPackaging(
  prod: Product,
  pkg: ProductPackaging,
  tier: PriceTier
): { ok: true; item: CartItem } | { ok: false; error: string } {
  if (prod.allow_unit_sale === 0 && (pkg.name === 'bouteille' || pkg.name === 'canette')) {
    return {
      ok: false,
      error: `La vente unitaire est désactivée pour "${prod.name}".`,
    };
  }
  const compDeposit =
    pkg.deposit_mode === 'deposit'
      ? pkg.components.reduce((acc, c) => acc + c.pieces_per_pack * c.deposit_value, 0)
      : 0;
  const explicitDeposit = (pkg.bottle_deposit_amount ?? 0) + (pkg.package_deposit_amount ?? 0);
  const depositPerPack = compDeposit > 0 ? compDeposit : explicitDeposit;
  const depositMode = pkg.deposit_mode === 'deposit' || depositPerPack > 0 ? 'deposit' : 'none';
  const tierPrices = {
    retail: getTierPrice(pkg, 'retail'),
    semi_wholesale: getTierPrice(pkg, 'semi_wholesale'),
    wholesale: getTierPrice(pkg, 'wholesale'),
  };
  return {
    ok: true,
    item: {
      key: `${prod.id}-${pkg.id}`,
      productId: prod.id,
      productName: prod.name,
      reference: prod.reference,
      baseUnit: prod.base_unit,
      stockMilli: prod.stock_milli,
      packagingId: pkg.id,
      packagingName: pkg.name,
      salesUnitId: null,
      salesUnitLabel: pkg.display_label || pkg.name,
      coefficientMilli: pkg.coefficient_milli,
      allowFraction: pkg.allow_fraction === 1,
      quantity: '1',
      supportQuantity: '1',
      unitPrice: tierPrices[tier],
      tierPrices,
      discountAmount: 0,
      depositPerPack,
      depositMode,
      depositComponents: pkg.components,
    },
  };
}

export function buildCartItemFromSalesUnit(
  prod: Product,
  unit: ProductSalesUnit,
  tier: PriceTier
): { ok: true; item: CartItem } | { ok: false; error: string } {
  const fallbackPkg =
    prod.packagings.find((pk) => pk.id === unit.packaging_id && pk.is_active) ??
    prod.packagings.find((pk) => pk.is_active);
  if (!fallbackPkg) {
    return {
      ok: false,
      error: `Aucun conditionnement actif trouvé pour "${prod.name}".`,
    };
  }
  const depositPerPack = unit.bottle_deposit_amount + unit.crate_deposit_amount;
  const tierPrices = {
    retail: getSalesUnitTierPrice(unit, 'retail'),
    semi_wholesale: getSalesUnitTierPrice(unit, 'semi_wholesale'),
    wholesale: getSalesUnitTierPrice(unit, 'wholesale'),
  };
  return {
    ok: true,
    item: {
      key: `${prod.id}-su-${unit.id}`,
      productId: prod.id,
      productName: prod.name,
      reference: prod.reference,
      baseUnit: prod.base_unit,
      stockMilli: prod.stock_milli,
      packagingId: fallbackPkg.id,
      packagingName: fallbackPkg.name,
      salesUnitId: unit.id,
      salesUnitLabel: unit.label,
      coefficientMilli: unit.conversion_factor * 1000,
      allowFraction: unit.allow_fraction === 1,
      quantity: '1',
      supportQuantity: '1',
      unitPrice: tierPrices[tier],
      tierPrices,
      discountAmount: 0,
      depositPerPack,
      depositMode: depositPerPack > 0 ? 'deposit' : 'none',
      depositComponents: [],
    },
  };
}

export function matchBarcodeProduct(
  products: Product[],
  code: string
):
  | { type: 'unit'; prod: Product; unit: ProductSalesUnit }
  | { type: 'pkg'; prod: Product; pkg: ProductPackaging }
  | null {
  const lower = code.trim().toLowerCase();
  if (!lower) return null;
  for (const prod of products) {
    const su = prod.sales_units?.find(
      (u) => u.is_active === 1 && u.barcode && u.barcode.trim().toLowerCase() === lower
    );
    if (su) return { type: 'unit', prod, unit: su };
    const pk = prod.packagings.find(
      (p) => p.is_active && p.barcode && p.barcode.trim().toLowerCase() === lower
    );
    if (pk) return { type: 'pkg', prod, pkg: pk };
  }
  const prod = products.find(
    (p) =>
      (p.barcode && p.barcode.trim().toLowerCase() === lower) ||
      p.reference.toLowerCase() === lower
  );
  const defaultPkg =
    prod?.packagings.find((pk) => pk.is_active && pk.is_default_sale === 1) ??
    prod?.packagings.find((pk) => pk.is_active);
  return prod && defaultPkg ? { type: 'pkg', prod, pkg: defaultPkg } : null;
}

export function buildNextPaymentRow(
  existingRows: ReadonlyArray<{ method_code: string; amount: number }>,
  activeMethods: ReadonlyArray<PaymentMethodConfig>,
  remainingAmount: number | null
): { method_code: string; amount: number } {
  const usedCodes = new Set(existingRows.map((r) => r.method_code));
  const unusedActive = activeMethods.find((m) => !usedCodes.has(m.code));
  const methodCode =
    unusedActive?.code ??
    activeMethods.find((m) => m.code !== existingRows[0]?.method_code)?.code ??
    activeMethods[0]?.code ??
    'wave';
  const safeRemaining =
    remainingAmount !== null && Number.isFinite(remainingAmount) && remainingAmount > 0
      ? Math.trunc(remainingAmount)
      : 0;
  return { method_code: methodCode, amount: safeRemaining };
}

export type PosCheckoutPhase =
  | 'empty'
  | 'submitting'
  | 'failed'
  | 'cash_closed'
  | 'invalid_cart'
  | 'cash_unbalanced'
  | 'credit_blocked'
  | 'ready';

export interface PosCheckoutReadiness {
  phase: PosCheckoutPhase;
  canSubmit: boolean;
  headline: string;
  detail: string | null;
}

export function computePosCheckoutReadiness(params: {
  cartLength: number;
  totals: SaleCalculationResult;
  posSaleType: 'cash' | 'credit';
  posClientId: number | null;
  selectedClient?: Client | null;
  hasOpenCashSession: boolean;
  isSubmitting: boolean;
  lastError: string | null;
  isOnline?: boolean;
}): PosCheckoutReadiness {
  const {
    cartLength,
    totals,
    posSaleType,
    posClientId,
    selectedClient,
    hasOpenCashSession,
    isSubmitting,
    lastError,
    isOnline = true,
  } = params;

  if (isSubmitting) {
    return {
      phase: 'submitting',
      canSubmit: false,
      headline: 'Envoi et enregistrement en cours…',
      detail: 'Ne fermez pas la page ; la clé d’idempotence protège contre tout doublon.',
    };
  }

  if (cartLength === 0) {
    return {
      phase: 'empty',
      canSubmit: false,
      headline: 'Aucun article dans le panier',
      detail: 'Scannez un code-barres (F2) ou cliquez sur un conditionnement.',
    };
  }

  if (!hasOpenCashSession) {
    return {
      phase: 'cash_closed',
      canSubmit: false,
      headline: 'Session de caisse fermée',
      detail: 'Ouvrez une session de caisse avant de valider l’encaissement.',
    };
  }

  if (!totals.isValid || totals.grandTotal === null || totals.paidTotal === null) {
    return {
      phase: 'invalid_cart',
      canSubmit: false,
      headline: 'Panier à corriger',
      detail: totals.errors[0] || 'Vérifiez les quantités et les remises saisies.',
    };
  }

  if (posSaleType === 'cash') {
    const remaining = totals.remainingAmount ?? 0;
    const overpaid = totals.overpaidAmount ?? 0;
    if (remaining > 0) {
      return {
        phase: 'cash_unbalanced',
        canSubmit: false,
        headline: 'Règlement comptant incomplet',
        detail: `Il reste ${remaining.toLocaleString('fr-FR')} FCFA à ventiler (touche F8 pour solder).`,
      };
    }
    if (overpaid > 0) {
      return {
        phase: 'cash_unbalanced',
        canSubmit: false,
        headline: 'Trop-perçu sur le règlement',
        detail: `Le total saisi dépasse le net à payer de ${overpaid.toLocaleString('fr-FR')} FCFA.`,
      };
    }
  } else {
    if (posClientId === null || !selectedClient) {
      return {
        phase: 'credit_blocked',
        canSubmit: false,
        headline: 'Client requis pour une vente à crédit',
        detail: 'Sélectionnez un client autorisé au crédit avant de valider.',
      };
    }
    if (selectedClient.credit_policy === 'forbidden') {
      return {
        phase: 'credit_blocked',
        canSubmit: false,
        headline: 'Crédit interdit pour ce client',
        detail: 'Basculez en vente Comptant ou modifiez la politique de crédit du client.',
      };
    }
    if (totals.paidTotal >= totals.grandTotal) {
      return {
        phase: 'credit_blocked',
        canSubmit: false,
        headline: 'Vente intégralement réglée',
        detail: 'Basculez le type de vente sur « Comptant » lorsque le règlement couvre tout le total.',
      };
    }
    if (
      selectedClient.credit_policy === 'limited' &&
      selectedClient.credit_limit !== null
    ) {
      const avail = Math.max(0, selectedClient.credit_limit - selectedClient.unpaid_balance);
      const creditNeeded = totals.remainingAmount ?? 0;
      if (creditNeeded > avail) {
        return {
          phase: 'credit_blocked',
          canSubmit: false,
          headline: 'Plafond de crédit dépassé',
          detail: `Crédit demandé (${creditNeeded.toLocaleString('fr-FR')} FCFA) supérieur au disponible (${avail.toLocaleString('fr-FR')} FCFA).`,
        };
      }
    }
  }

  if (lastError) {
    return {
      phase: 'failed',
      canSubmit: true,
      headline: isOnline
        ? 'Échec du dernier envoi — panier intégralement conservé'
        : 'Hors ligne / serveur injoignable — aucune vente validée',
      detail: 'Vous pouvez corriger ou relancer en sécurité sans risque de double facturation.',
    };
  }

  return {
    phase: 'ready',
    canSubmit: true,
    headline: 'Vente prête à valider',
    detail: isOnline
      ? 'Appuyez sur F9 ou cliquez sur « Valider la vente ».'
      : 'Attention : connexion signalée hors ligne — vérifiez l’accès au serveur local avant validation.',
  };
}

export function buildSaleDraftFingerprint(params: {
  posClientId: number | null;
  posPriceTier: PriceTier;
  posSaleType: 'cash' | 'credit';
  globalDiscount: number;
  dueDate: string;
  posCart: ReadonlyArray<CartItem>;
  paymentRows: ReadonlyArray<{ method_code: string; amount: number }>;
  receivedReturnables: ReadonlyArray<{ returnable_id: number; pieces: number }>;
}): string {
  const linesSig = params.posCart
    .map(
      (c) =>
        `${c.key}:${c.quantity}:${c.supportQuantity}:${c.unitPrice}:${c.discountAmount}`
    )
    .join('|');
  const paySig = params.paymentRows
    .filter((p) => p.amount > 0)
    .map((p) => `${p.method_code}:${p.amount}`)
    .join('|');
  const retSig = params.receivedReturnables
    .filter((r) => r.pieces > 0)
    .map((r) => `${r.returnable_id}:${r.pieces}`)
    .join('|');
  return [
    params.posClientId ?? 'anon',
    params.posPriceTier,
    params.posSaleType,
    params.globalDiscount,
    params.dueDate || '',
    linesSig,
    paySig,
    retSig,
  ].join('::');
}
