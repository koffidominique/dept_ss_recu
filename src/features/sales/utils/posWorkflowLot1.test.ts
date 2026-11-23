import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../../services/api/ApiClient.ts';
import { normalizeFetchError } from '../../../services/api/http/httpTransport.ts';
import { useUiStore } from '../../../stores/uiStore.ts';
import type {
  Client,
  PaymentMethodConfig,
  Product,
  ProductPackaging,
} from '../../../types/erp.ts';
import {
  buildCartItemFromPackaging,
  buildNextPaymentRow,
  buildSaleDraftFingerprint,
  computePosCheckoutReadiness,
} from './posCartBuilders.ts';
import { calculateSaleCart } from './saleCalculations.ts';

function makeSampleProduct(): { prod: Product; pkg: ProductPackaging } {
  const pkg: ProductPackaging = {
    id: 101,
    product_id: 10,
    name: 'casier',
    base_unit: 'bouteille',
    display_label: 'Casier 24 × 33cl',
    coefficient_milli: 24000,
    purchase_price: 7000,
    wholesale_price: 8400,
    semi_wholesale_price: 9000,
    retail_price: 9600,
    min_selling_price: 8000,
    barcode: '3300101',
    allow_fraction: 0,
    is_default_sale: 1,
    is_active: 1,
    deposit_mode: 'deposit',
    package_deposit_amount: 3600,
    bottle_deposit_amount: 0,
    components: [
      {
        returnable_id: 5,
        name: 'Casier 24 trous + 24 bouteilles',
        code: 'CS24',
        kind: 'crate',
        pieces_per_pack: 1,
        deposit_value: 3600,
      },
    ],
  };

  const prod: Product = {
    id: 10,
    reference: 'SOL-BEAU-33',
    barcode: '3300100',
    name: 'Beaufort Lager 33cl',
    brand: 'Beaufort',
    category_id: 1,
    category_name: 'Bières',
    supplier_id: null,
    supplier_name: null,
    description: null,
    base_unit: 'bouteille',
    stock_milli: 240000,
    min_stock_milli: 24000,
    max_stock_milli: 480000,
    average_cost_fcfa: null,
    purchase_price: 7000,
    wholesale_price: 8400,
    semi_wholesale_price: 9000,
    retail_price: 9600,
    image_path: null,
    is_active: 1,
    allow_unit_sale: 1,
    allow_credit_sale: 1,
    packagings: [pkg],
  };

  return { prod, pkg };
}

test('setPosPriceTier updates store tier and recalculates cart item unit prices across tiers', () => {
  useUiStore.setState({
    posCart: [],
    posClientId: null,
    posPriceTier: 'retail',
    posSaleType: 'cash',
    heldCarts: [],
  });

  const { prod, pkg } = makeSampleProduct();
  const built = buildCartItemFromPackaging(prod, pkg, 'retail');
  assert.equal(built.ok, true);
  if (!built.ok) return;

  useUiStore.getState().addToCart(built.item);
  assert.equal(useUiStore.getState().posPriceTier, 'retail');
  assert.equal(useUiStore.getState().posCart[0].unitPrice, 9600);

  useUiStore.getState().setPosPriceTier('wholesale');
  assert.equal(useUiStore.getState().posPriceTier, 'wholesale');
  assert.equal(useUiStore.getState().posCart[0].unitPrice, 8400);

  useUiStore.getState().setPosPriceTier('semi_wholesale');
  assert.equal(useUiStore.getState().posPriceTier, 'semi_wholesale');
  assert.equal(useUiStore.getState().posCart[0].unitPrice, 9000);
});

test('holdCurrentCart and resumeHeldCart preserve full context and auto-hold active cart without data loss', () => {
  useUiStore.setState({
    posCart: [],
    posClientId: 7,
    posPriceTier: 'wholesale',
    posSaleType: 'credit',
    heldCarts: [],
  });

  const { prod, pkg } = makeSampleProduct();
  const built1 = buildCartItemFromPackaging(prod, pkg, 'wholesale');
  assert.equal(built1.ok, true);
  if (!built1.ok) return;

  useUiStore.getState().addToCart({ ...built1.item, quantity: '3' });
  useUiStore.getState().holdCurrentCart({
    label: 'Maquis La Paix',
    discountAmount: 500,
    dueDate: '2026-12-05',
    paymentRows: [{ method_code: 'wave', amount: 5000 }],
    receivedReturnables: [{ returnable_id: 5, pieces: 2 }],
  });

  assert.equal(useUiStore.getState().posCart.length, 0);
  assert.equal(useUiStore.getState().heldCarts.length, 1);
  const heldTicketId = useUiStore.getState().heldCarts[0].id;

  // Un second client arrive au comptoir : un nouveau panier est entamé
  useUiStore.getState().setPosPriceTier('retail');
  const built2 = buildCartItemFromPackaging(prod, pkg, 'retail');
  assert.equal(built2.ok, true);
  if (!built2.ok) return;
  useUiStore.getState().addToCart({ ...built2.item, quantity: '1' });

  // On reprend le ticket "Maquis La Paix" sans vider manuellement le panier en cours
  const resumed = useUiStore.getState().resumeHeldCart(heldTicketId, {
    label: 'Client Comptoir #2',
    discountAmount: 0,
  });

  assert.ok(resumed);
  assert.equal(resumed.label, 'Maquis La Paix');
  assert.equal(resumed.priceTier, 'wholesale');
  assert.equal(resumed.saleType, 'credit');
  assert.equal(resumed.discountAmount, 500);
  assert.equal(resumed.dueDate, '2026-12-05');
  assert.deepEqual(resumed.paymentRows, [{ method_code: 'wave', amount: 5000 }]);
  assert.deepEqual(resumed.receivedReturnables, [{ returnable_id: 5, pieces: 2 }]);
  assert.equal(resumed.autoHeldLabel, 'Client Comptoir #2');

  // État du store après reprise : ticket 1 actif au tarif Gros, ticket 2 sauvegardé en attente
  const stateAfter = useUiStore.getState();
  assert.equal(stateAfter.posPriceTier, 'wholesale');
  assert.equal(stateAfter.posSaleType, 'credit');
  assert.equal(stateAfter.posClientId, 7);
  assert.equal(stateAfter.posCart[0].quantity, '3');
  assert.equal(stateAfter.heldCarts.length, 1);
  assert.equal(stateAfter.heldCarts[0].label, 'Client Comptoir #2');
  assert.equal(stateAfter.heldCarts[0].items[0].quantity, '1');
});

test('buildNextPaymentRow picks first unused active payment method and prefills exact remaining amount', () => {
  const methods: PaymentMethodConfig[] = [
    { code: 'cash', label: 'Espèces', is_cash: 1, active: 1 },
    { code: 'wave', label: 'Wave', is_cash: 0, active: 1 },
    { code: 'orange_money', label: 'Orange Money', is_cash: 0, active: 1 },
  ];

  const row2 = buildNextPaymentRow([{ method_code: 'cash', amount: 5000 }], methods, 8200);
  assert.deepEqual(row2, { method_code: 'wave', amount: 8200 });

  const row3 = buildNextPaymentRow(
    [
      { method_code: 'cash', amount: 5000 },
      { method_code: 'wave', amount: 3000 },
    ],
    methods,
    5200
  );
  assert.deepEqual(row3, { method_code: 'orange_money', amount: 5200 });
});

test('computePosCheckoutReadiness enforces cash balance, credit policy, double-submit lock and offline/error feedback', () => {
  const { prod, pkg } = makeSampleProduct();
  const built = buildCartItemFromPackaging(prod, pkg, 'retail');
  assert.equal(built.ok, true);
  if (!built.ok) return;

  // 1 casier = 9600 marchandises + 3600 consigne = 13200 FCFA
  const unpaidTotals = calculateSaleCart([built.item], 0, [{ method_code: 'cash', amount: 0 }]);
  assert.equal(unpaidTotals.grandTotal, 13200);

  // Comptant non soldé -> bloqué avec indication claire
  const cashUnpaid = computePosCheckoutReadiness({
    cartLength: 1,
    totals: unpaidTotals,
    posSaleType: 'cash',
    posClientId: null,
    hasOpenCashSession: true,
    isSubmitting: false,
    lastError: null,
  });
  assert.equal(cashUnpaid.phase, 'cash_unbalanced');
  assert.equal(cashUnpaid.canSubmit, false);

  // Comptant soldé mais caisse fermée -> bloqué
  const exactTotals = calculateSaleCart([built.item], 0, [{ method_code: 'cash', amount: 13200 }]);
  const cashClosed = computePosCheckoutReadiness({
    cartLength: 1,
    totals: exactTotals,
    posSaleType: 'cash',
    posClientId: null,
    hasOpenCashSession: false,
    isSubmitting: false,
    lastError: null,
  });
  assert.equal(cashClosed.phase, 'cash_closed');
  assert.equal(cashClosed.canSubmit, false);

  // Comptant soldé + caisse ouverte -> prêt
  const ready = computePosCheckoutReadiness({
    cartLength: 1,
    totals: exactTotals,
    posSaleType: 'cash',
    posClientId: null,
    hasOpenCashSession: true,
    isSubmitting: false,
    lastError: null,
  });
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.canSubmit, true);

  // Envoi en cours -> bloque toute double validation
  const submitting = computePosCheckoutReadiness({
    cartLength: 1,
    totals: exactTotals,
    posSaleType: 'cash',
    posClientId: null,
    hasOpenCashSession: true,
    isSubmitting: true,
    lastError: null,
  });
  assert.equal(submitting.phase, 'submitting');
  assert.equal(submitting.canSubmit, false);

  // Échec hors ligne -> n'annonce jamais la vente comme validée, permet de relancer
  const failedOffline = computePosCheckoutReadiness({
    cartLength: 1,
    totals: exactTotals,
    posSaleType: 'cash',
    posClientId: null,
    hasOpenCashSession: true,
    isSubmitting: false,
    lastError: 'Connexion au serveur local indisponible',
    isOnline: false,
  });
  assert.equal(failedOffline.phase, 'failed');
  assert.equal(failedOffline.canSubmit, true);
  assert.match(failedOffline.headline, /aucune vente validée/i);

  // Crédit avec dépassement de plafond -> bloqué avant appel serveur
  const limitedClient: Client = {
    id: 12,
    code: 'CLI-0012',
    name: 'Cave Abobo',
    client_type: 'professionnel',
    phone: '0700000000',
    address: null,
    city: 'Abidjan',
    email: null,
    contact_person: null,
    credit_policy: 'limited',
    credit_limit: 20000,
    payment_terms_days: 15,
    unpaid_balance: 10000, // disponible = 10000 < 13200
    returnable_pieces_due: 0,
    is_active: 1,
  };
  const creditExceeded = computePosCheckoutReadiness({
    cartLength: 1,
    totals: unpaidTotals,
    posSaleType: 'credit',
    posClientId: 12,
    selectedClient: limitedClient,
    hasOpenCashSession: true,
    isSubmitting: false,
    lastError: null,
  });
  assert.equal(creditExceeded.phase, 'credit_blocked');
  assert.equal(creditExceeded.canSubmit, false);
  assert.match(creditExceeded.headline, /Plafond de crédit dépassé/);
});

test('buildSaleDraftFingerprint stays stable on identical retry and changes when cart or payment mutates', () => {
  const { prod, pkg } = makeSampleProduct();
  const built = buildCartItemFromPackaging(prod, pkg, 'retail');
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const baseParams = {
    posClientId: 5,
    posPriceTier: 'retail' as const,
    posSaleType: 'cash' as const,
    globalDiscount: 0,
    dueDate: '',
    posCart: [built.item],
    paymentRows: [{ method_code: 'cash', amount: 13200 }],
    receivedReturnables: [{ returnable_id: 5, pieces: 1 }],
  };

  const fp1 = buildSaleDraftFingerprint(baseParams);
  const fpRetry = buildSaleDraftFingerprint({ ...baseParams });
  assert.equal(fp1, fpRetry);

  const fpChangedQty = buildSaleDraftFingerprint({
    ...baseParams,
    posCart: [{ ...built.item, quantity: '2' }],
  });
  assert.notEqual(fp1, fpChangedQty);

  const fpChangedTier = buildSaleDraftFingerprint({
    ...baseParams,
    posPriceTier: 'wholesale',
  });
  assert.notEqual(fp1, fpChangedTier);
});

test('normalizeFetchError converts raw network TypeError and AbortError into explicit French ApiError', () => {
  const netErr = normalizeFetchError(new TypeError('Failed to fetch'));
  assert.ok(netErr instanceof ApiError);
  assert.equal(netErr.code, 'NETWORK_ERROR');
  assert.equal(netErr.status, 0);
  assert.match(netErr.message, /aucune écriture n’a été validée/);

  const abortErr = new Error('The operation was aborted');
  abortErr.name = 'AbortError';
  const timeoutApiErr = normalizeFetchError(abortErr);
  assert.equal(timeoutApiErr.code, 'TIMEOUT_ERROR');
  assert.equal(timeoutApiErr.status, 0);
});
