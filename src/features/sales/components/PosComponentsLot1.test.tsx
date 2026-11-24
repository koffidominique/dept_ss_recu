import assert from 'node:assert/strict';
import { createRef } from 'react';
import test from 'node:test';
import { Window } from 'happy-dom';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { PaymentMethodConfig, Product } from '../../../types/erp.ts';
import {
  buildCartItemFromPackaging,
  computePosCheckoutReadiness,
} from '../utils/posCartBuilders.ts';
import { calculateSaleCart } from '../utils/saleCalculations.ts';
import { PosCatalogPanel } from './PosCatalogPanel.tsx';
import { PosPaymentPanel } from './PosPaymentPanel.tsx';

let domRegistered = false;
function ensureDom() {
  if (!domRegistered) {
    const win = new Window({ url: 'http://localhost:5173/sales/new' });
    Object.assign(globalThis, {
      window: win,
      document: win.document,
      HTMLElement: win.HTMLElement,
      HTMLInputElement: win.HTMLInputElement,
      HTMLButtonElement: win.HTMLButtonElement,
      HTMLSelectElement: win.HTMLSelectElement,
      Node: win.Node,
      Event: win.Event,
      KeyboardEvent: win.KeyboardEvent,
      MouseEvent: win.MouseEvent,
      MutationObserver: win.MutationObserver,
      requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id),
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: win.navigator,
      configurable: true,
    });
    domRegistered = true;
  }
}

const METHODS: PaymentMethodConfig[] = [
  { code: 'cash', label: 'Espèces', is_cash: 1, active: 1 },
  { code: 'wave', label: 'Wave', is_cash: 0, active: 1 },
  { code: 'orange_money', label: 'Orange Money', is_cash: 0, active: 1 },
];

const SAMPLE_PRODUCT: Product = {
  id: 1,
  reference: 'SOL-BOCK-65',
  barcode: '6181100',
  name: 'Bock Solibra 65cl',
  brand: 'Bock',
  category_id: 1,
  category_name: 'Bières',
  supplier_id: null,
  supplier_name: null,
  description: null,
  base_unit: 'bouteille',
  stock_milli: 120000,
  min_stock_milli: 12000,
  max_stock_milli: 240000,
  average_cost_fcfa: null,
  purchase_price: 5500,
  wholesale_price: 6600,
  semi_wholesale_price: 7000,
  retail_price: 7200,
  image_path: null,
  is_active: 1,
  allow_unit_sale: 1,
  allow_credit_sale: 1,
  packagings: [
    {
      id: 11,
      product_id: 1,
      name: 'casier',
      base_unit: 'bouteille',
      display_label: 'Casier 12 × 65cl',
      coefficient_milli: 12000,
      purchase_price: 5500,
      wholesale_price: 6600,
      semi_wholesale_price: 7000,
      retail_price: 7200,
      min_selling_price: 6000,
      barcode: '6181111',
      allow_fraction: 0,
      is_default_sale: 1,
      is_active: 1,
      deposit_mode: 'deposit',
      package_deposit_amount: 3000,
      bottle_deposit_amount: 0,
      components: [],
    },
  ],
};

test('PosPaymentPanel displays remaining cash balance, prefills split payment and prevents premature submit', () => {
  ensureDom();
  cleanup();

  const built = buildCartItemFromPackaging(SAMPLE_PRODUCT, SAMPLE_PRODUCT.packagings[0], 'retail');
  assert.equal(built.ok, true);
  if (!built.ok) return;

  // Total = 7200 + 3000 = 10200 FCFA ; 4000 FCFA saisis en espèces -> Reste 6200 FCFA
  let rows = [{ method_code: 'cash', amount: 4000 }];
  const totals = calculateSaleCart([built.item], 0, rows);
  const readiness = computePosCheckoutReadiness({
    cartLength: 1,
    totals,
    posSaleType: 'cash',
    posClientId: null,
    hasOpenCashSession: true,
    isSubmitting: false,
    lastError: null,
  });

  const view = render(
    <PosPaymentPanel
      posSaleType="cash"
      globalDiscount={0}
      onGlobalDiscountChange={() => {}}
      totals={totals}
      paymentRows={rows}
      onPaymentRowsChange={(updater) => {
        rows = updater(rows);
      }}
      activeMethods={METHODS}
      errorMsg={null}
      readiness={readiness}
      isOnline={true}
      isSubmitting={false}
      onSubmitSale={() => {}}
    />
  );

  assert.match(view.container.textContent ?? '', /Reste à encaisser/);
  assert.match(view.container.textContent ?? '', /6[\s\u202f\u00a0]?200 FCFA/);

  const submitBtn = view.getByRole('button', { name: /Valider la vente \(F9\)/i }) as HTMLButtonElement;
  assert.equal(submitBtn.disabled, true);

  // Clic sur "+ Ajouter moyen" -> pré-remplit Wave avec 6200 FCFA
  fireEvent.click(view.getByRole('button', { name: /\+ Ajouter moyen/i }));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { method_code: 'wave', amount: 6200 });

  cleanup();
});

test('PosCatalogPanel renders barcode error feedback, keyboard hints and empty search recovery', () => {
  ensureDom();
  cleanup();

  let currentSearch = '99999999';
  let selectedTier = 'retail';

  const view = render(
    <PosCatalogPanel
      searchInputRef={createRef<HTMLInputElement>()}
      search={currentSearch}
      onSearchChange={(val) => {
        currentSearch = val;
      }}
      onScanEnter={async () => {}}
      scanFeedback={{
        tone: 'error',
        message: 'Aucun article actif trouvé pour le code ou la référence « 99999999 ».',
      }}
      priceTier="retail"
      onPriceTierChange={(tier) => {
        selectedTier = tier;
      }}
      products={[]}
      onAddPackaging={() => {}}
    />
  );

  assert.match(view.getByRole('alert').textContent ?? '', /99999999/);
  assert.match(view.container.textContent ?? '', /F8/);

  fireEvent.click(view.getByRole('button', { name: 'Gros' }));
  assert.equal(selectedTier, 'wholesale');

  fireEvent.click(view.getByRole('button', { name: /Afficher tout le catalogue/i }));
  assert.equal(currentSearch, '');

  cleanup();
});
