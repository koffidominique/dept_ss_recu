import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ClientPackagingBalance,
  CustomerOrderDetail,
  Receivable,
  ReportsOverview,
  SaleDetail,
} from '../../../types/erp.ts';
import { buildOrderReceiptDocument } from '../../orders/utils/orderPrintDocument.ts';
import { formatCashMovementKind } from '../../../utils/csvCommerceExports.ts';
import {
  buildPackagingDebtPaymentReceiptDoc,
  buildPackagingLateReturnReceiptDoc,
  buildReturnPrintDocument,
} from '../../consignments/components/consignmentPrintHelpers.ts';
import {
  buildCommercialPdfDoc,
  buildConsignmentsPdfDoc,
  buildReceivablesPdfDoc,
} from '../../reports/utils/reportPdfBuilders.ts';
import {
  buildMissingPackagingNote,
  buildSalePrintableDoc,
} from '../components/ValidatedSaleBanner.tsx';
import {
  calculateSaleCart,
  computeAvailableReturnableRows,
  computeReturnedPackagingSummary,
  type SaleCalculationItem,
} from './saleCalculations.ts';
import { buildSaleDraftFingerprint } from './posCartBuilders.ts';

test('computeAvailableReturnableRows merges client due balances with outgoing cart returnables', () => {
  const balances: ClientPackagingBalance[] = [
    {
      id: 1,
      client_id: 10,
      client_name: 'Maquis Chez Tantine',
      client_code: 'CLI-010',
      returnable_id: 100,
      packaging_name: 'Casier SOLIBRA 24',
      packaging_code: 'CAS-24',
      deposit_value: 3600,
      balance_pieces: 5,
      deposit_held_amount: 18000,
    },
  ];

  const cart: SaleCalculationItem[] = [
    {
      key: 'line-1',
      productName: 'Bock 66cl',
      packagingName: 'casier',
      coefficientMilli: 12000,
      allowFraction: false,
      quantity: '2',
      unitPrice: 9000,
      discountAmount: 0,
      depositPerPack: 3600,
      depositMode: 'deposit',
      depositComponents: [
        {
          returnable_id: 100,
          pieces_per_pack: 1,
          code: 'CAS-24',
          name: 'Casier SOLIBRA 24',
          deposit_value: 3600,
          kind: 'crate',
        },
        {
          returnable_id: 101,
          pieces_per_pack: 12,
          code: 'BTL-66',
          name: 'Bouteille verre 66cl',
          deposit_value: 200,
          kind: 'bottle',
        },
      ],
    },
  ];

  const rows = computeAvailableReturnableRows(balances, cart);
  assert.equal(rows.length, 2);

  const bottleRow = rows.find((r) => r.returnable_id === 101);
  assert.ok(bottleRow);
  assert.equal(bottleRow.prior_due_pieces, 0);
  assert.equal(bottleRow.cart_outgoing_pieces, 24);
  assert.equal(bottleRow.max_returnable_pieces, 24);

  const crateRow = rows.find((r) => r.returnable_id === 100);
  assert.ok(crateRow);
  assert.equal(crateRow.prior_due_pieces, 5);
  assert.equal(crateRow.cart_outgoing_pieces, 2);
  assert.equal(crateRow.max_returnable_pieces, 7);
});

test('computeReturnedPackagingSummary clamps quantities and keeps order grandTotal untouched', () => {
  const rows = [
    {
      returnable_id: 100,
      packaging_name: 'Casier 24',
      packaging_code: 'CAS-24',
      deposit_value: 3600,
      prior_due_pieces: 4,
      cart_outgoing_pieces: 1,
      max_returnable_pieces: 5,
    },
  ];

  const summary = computeReturnedPackagingSummary(rows, [
    { returnable_id: 100, pieces: 9 },
    { returnable_id: 999, pieces: 3 },
  ]);

  assert.deepEqual(summary.normalized, [{ returnable_id: 100, pieces: 5 }]);
  assert.equal(summary.totalPieces, 5);
  assert.equal(summary.totalAmountFcfa, 18000);

  const cartCalc = calculateSaleCart(
    [
      {
        key: 'l1',
        productName: 'Beaufort 50cl',
        packagingName: 'casier',
        coefficientMilli: 24000,
        allowFraction: false,
        quantity: '1',
        unitPrice: 12000,
        discountAmount: 0,
        depositPerPack: 3600,
        depositMode: 'deposit',
      },
    ],
    0,
    [{ method_code: 'cash', amount: 15600 }]
  );
  assert.equal(cartCalc.isValid, true);
  assert.equal(cartCalc.grandTotal, 15600);
});

test('buildSalePrintableDoc includes 15-day notice and returned packaging amount outside order total', () => {
  const sale: SaleDetail = {
    id: 42,
    reference: 'VTE-2026-0042',
    client_id: 10,
    client_name: 'Cave Prestige',
    client_code: 'CLI-010',
    client_phone: '+22507000000',
    sale_type: 'cash',
    price_tier: 'wholesale',
    subtotal_merchandise: 12000,
    discount_amount: 0,
    total_merchandise: 12000,
    total_deposit: 3600,
    total_amount: 15600,
    paid_amount: 15600,
    remaining_amount: 0,
    payment_labels: 'Espèces',
    status: 'validated',
    created_at: '2026-11-23T10:00:00Z',
    receivable_id: null,
    due_date: null,
    notes: null,
    lines: [
      {
        id: 1,
        product_id: 5,
        packaging_id: 8,
        product_name: 'Flag Spéciale 65cl',
        packaging_name: 'casier',
        base_unit: 'bouteille',
        coefficient_milli: 12000,
        quantity_milli: 1000,
        base_quantity_milli: 12000,
        unit_price: 12000,
        discount_amount: 0,
        line_total: 12000,
        returned_base_milli: 0,
      },
    ],
    payments: [
      {
        id: 1,
        reference: 'PAY-0042',
        method_code: 'cash',
        method_label: 'Espèces',
        part_amount: 15600,
        created_at: '2026-11-23T10:00:00Z',
      },
    ],
    deposits: [
      {
        id: 11,
        sale_line_id: 1,
        returnable_id: 100,
        kind: 'crate',
        packaging_name: 'Casier 12',
        packaging_code: 'CAS-12',
        pieces: 1,
        returned_pieces: 0,
        unit_value: 3600,
        amount: 3600,
      },
    ],
    received_returnables: [
      {
        id: 12,
        returnable_id: 100,
        kind: 'crate',
        packaging_name: 'Casier 12',
        packaging_code: 'CAS-12',
        pieces: 3,
        unit_value: 3600,
        amount: 10800,
      },
    ],
    total_returned_packaging_amount: 10800,
    cancellation: null,
    returns: [],
  };

  const doc = buildSalePrintableDoc(sale);
  const totalTtcRow = doc.summaryRows.find((r) => r.label === 'Total TTC');
  const returnOutsideRow = doc.summaryRows.find(
    (r) => r.label === 'Retour emballages (hors total commande)'
  );

  assert.ok(totalTtcRow);
  assert.ok(returnOutsideRow);
  assert.match(totalTtcRow.value, /15.*600/);
  assert.match(returnOutsideRow.value, /10.*800/);
  assert.match(doc.commercialConditions ?? '', /15 jours/);
  assert.match(doc.commercialConditions ?? '', /hors total commande/i);

  const missingNote = buildMissingPackagingNote(sale.deposits);
  assert.ok(missingNote);
  assert.match(missingNote, /15 jours/);
});

test('buildOrderReceiptDocument displays 15-day return notice and returned packaging row outside NET A PAYER', () => {
  const orderDetail: CustomerOrderDetail = {
    order: {
      id: 7,
      order_number: 'CMD-2026-0007',
      customer_id: 10,
      customer_name: 'Maquis Le Palmier',
      order_type: 'vente',
      status: 'delivered',
      approval_status: 'approved',
      payment_status: 'paid',
      payment_method: 'cash',
      subtotal_xof: 24000,
      deposit_total_xof: 7200,
      discount_xof: 0,
      tax_xof: 0,
      total_xof: 24000,
      deposit_due_xof: 7200,
      delivery_fee_xof: 0,
      total_to_collect_xof: 31200,
      paid_xof: 31200,
      delivery_mode: 'pickup',
      delivery_address: null,
      delivery_date: null,
      notes: null,
      created_at: '2026-11-23T09:00:00Z',
      updated_at: '2026-11-23T09:05:00Z',
    },
    lines: [],
    allocations: [
      {
        id: 1,
        order_id: 7,
        packaging_asset_id: 100,
        packaging_name: 'Casier 24',
        compatibility_class: 'bottle_65cl',
        capacity: 24,
        quantity: 2,
        returned_quantity: 1,
        is_consigned: 1,
        deposit_amount_xof: 3600,
        provided_by: 'SOUS-DÉPÔT',
        notes: null,
      },
    ],
    links: [],
    payments: [],
    customer_deposits: [],
  };

  const doc = buildOrderReceiptDocument(orderDetail, null, 'Agent Test');
  assert.equal(doc.packagingLines?.[0]?.statusLabel, 'Consigné — retour sous 15 jours');
  const netRow = doc.summaryRows.find((r) => r.label === 'NET À PAYER (FCFA)');
  const retRow = doc.summaryRows.find((r) => r.label === 'Retour emballages (hors total)');
  assert.ok(netRow);
  assert.ok(retRow);
  assert.match(netRow.value, /31.*200/);
  assert.match(retRow.value, /3.*600/);
  assert.match(doc.notes ?? '', /15 jours maximum/);
  assert.match(doc.notes ?? '', /hors total commande/);
});

test('walk-in client without prior balances still gets immediate return options for outgoing cart items', () => {
  const rows = computeAvailableReturnableRows([], [
    {
      key: 'line-walkin-1',
      productName: 'Beaufort 65cl',
      packagingName: 'Casier 12',
      quantity: '3',
      coefficientMilli: 12000,
      allowFraction: false,
      unitPrice: 7000,
      discountAmount: 0,
      depositMode: 'deposit',
      depositPerPack: 2400,
      depositComponents: [
        {
          returnable_id: 12,
          code: 'CAS-12',
          name: 'Casier 12 bouteilles',
          kind: 'crate',
          pieces_per_pack: 1,
          deposit_value: 2400,
        },
      ],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].prior_due_pieces, 0);
  assert.equal(rows[0].cart_outgoing_pieces, 3);
  assert.equal(rows[0].max_returnable_pieces, 3);
});

test('buildSalePrintableDoc omits returned packaging summary row when no packaging was returned', () => {
  const sale: SaleDetail = {
    id: 99,
    reference: 'VTE-2026-0099',
    client_id: null,
    client_name: 'Client Comptoir',
    client_code: null,
    client_phone: null,
    sale_type: 'cash',
    price_tier: 'retail',
    subtotal_merchandise: 5000,
    discount_amount: 0,
    total_merchandise: 5000,
    total_deposit: 0,
    total_amount: 5000,
    total_returned_packaging_amount: 0,
    paid_amount: 5000,
    remaining_amount: 0,
    receivable_id: null,
    due_date: null,
    payment_labels: 'Espèces',
    status: 'validated',
    notes: null,
    created_at: '2026-11-23T12:00:00Z',
    lines: [],
    deposits: [],
    received_returnables: [],
    payments: [
      {
        id: 1,
        reference: 'PAY-2026-0099',
        method_code: 'cash',
        method_label: 'Espèces',
        part_amount: 5000,
        created_at: '2026-11-23T12:00:00Z',
      },
    ],
    returns: [],
    cancellation: null,
  };
  const doc = buildSalePrintableDoc(sale);
  const retRow = doc.summaryRows.find((r) => r.label === 'Retour emballages (hors total commande)');
  assert.equal(retRow, undefined);
});

test('buildReturnPrintDocument formats cash refund and credit deduction properly', () => {
  const doc = buildReturnPrintDocument({
    id: 42,
    reference: 'RVE-2026-0042',
    packaging_name: 'Casier 24 × 33cl SOLIBRA',
    client_name: 'Maquis Le Prestige',
    pieces: 4,
    condition_state: 'good',
    refund_amount: 10000,
    credit_reduction: 4400,
    method_label: 'Espèces',
    reason: 'Restitution casiers vides',
    created_at: '2026-11-23T14:30:00Z',
  });
  assert.equal(doc.docType, 'REÇU RETOUR EMBALLAGES');
  assert.equal(doc.partyName, 'Maquis Le Prestige');
  assert.equal(doc.lines[0].total, 14400);
  assert.match(doc.lines[0].sublabel ?? '', /Bon état/);
  assert.equal(doc.payments?.length, 1);
  assert.equal(doc.payments?.[0].amount, 10000);
});

test('buildReturnPrintDocument omits payment block when damaged packaging has zero refund', () => {
  const doc = buildReturnPrintDocument({
    id: 43,
    reference: 'RVE-2026-0043',
    packaging_name: 'Bouteille verre 65cl',
    client_name: null,
    pieces: 2,
    condition_state: 'damaged',
    refund_amount: 0,
    credit_reduction: 0,
    method_label: 'Espèces',
    reason: 'Casse constatée au retour',
    created_at: '2026-11-23T15:00:00Z',
  });
  assert.equal(doc.partyName, 'Client Comptoir');
  assert.match(doc.lines[0].sublabel ?? '', /Endommagé/);
  assert.equal(doc.payments, undefined);
});

test('buildConsignmentsPdfDoc uses 15-day due packaging terminology instead of collected deposit', () => {
  const doc = buildConsignmentsPdfDoc(
    {
      types: [
        {
          id: 1,
          code: 'CAS-24',
          name: 'Casier 24 × 33cl',
          producer: 'SOLIBRA',
          deposit_value: 3600,
          stock_quantity: 40,
        },
      ],
      clientBalances: [
        {
          id: 10,
          client_name: 'Maquis Chez Tantie',
          packaging_name: 'Casier 24 × 33cl',
          balance_pieces: 5,
          deposit_held_amount: 18000,
        },
      ],
    },
    '2026-11-23',
  );
  assert.equal(doc.docType, 'ÉTAT DES CONSIGNATIONS');
  assert.match(doc.lines[1].quantity, /5 pcs dues \(échéance 15j\)/);
  const duePiecesRow = doc.summaryRows.find((r) => r.label === 'Emballages dus par les clients');
  const refValueRow = doc.summaryRows.find(
    (r) => r.label === 'Valeur réf. totale des emballages dus',
  );
  assert.ok(duePiecesRow);
  assert.ok(refValueRow);
  assert.equal(duePiecesRow.value, '5 pièce(s)');
  assert.match(refValueRow.value, /18.*000/);
});

test('buildCommercialPdfDoc and buildReceivablesPdfDoc separate merchandise receivables from packaging deposits', () => {
  const recs: Receivable[] = [
    {
      id: 1,
      sale_id: 12,
      sale_reference: 'VTE-2026-0012',
      sale_date: '2026-11-20T10:00:00Z',
      sale_total: 50000,
      client_id: 4,
      client_name: 'Cave Abobo',
      client_code: 'CLI-0004',
      client_phone: '+2250700000000',
      initial_amount: 50000,
      remaining_amount: 20000,
      due_date: '2026-12-05',
      status: 'partial',
      created_at: '2026-11-20T10:00:00Z',
    },
  ];
  const recDoc = buildReceivablesPdfDoc(recs, '2026-11-23');
  assert.equal(recDoc.docType, 'ÉTAT DES CRÉANCES CLIENTS');
  assert.match(recDoc.statusLabel ?? '', /marchandises/);
  assert.ok(recDoc.summaryRows.some((r) => r.label === 'Total marchandises à recouvrer'));

  const rep: ReportsOverview = {
    commercial: {
      count: 3,
      merchandise_revenue: 120000,
      deposit_billed: 0,
      paid_amount: 100000,
    },
    profitability: {
      knownCostTotal: 85000,
      knownCostRevenue: 120000,
      knownGrossMargin: 35000,
      unknownCostLines: 0,
      expensesTotal: 5000,
      netKnownResult: 30000,
    },
    paymentBreakdown: [],
    stock: {
      product_count: 18,
      unknown_cost_products: 0,
      knownValuationFcfa: 450000,
    },
    dailySales: [],
  };
  const comDoc = buildCommercialPdfDoc(rep, 'Novembre 2026', '2026-11-23');
  assert.ok(comDoc.summaryRows.some((r) => r.label === 'CA Marchandises (hors consignes)'));
  assert.ok(
    comDoc.summaryRows.some((r) => r.label === 'Consignes emballages facturées (hors CA)'),
  );
});

test('buildPackagingDebtPaymentReceiptDoc formats partial and full packaging debt settlements', () => {
  const partialDoc = buildPackagingDebtPaymentReceiptDoc({
    reference: 'REG-EMB-ABCD1234',
    paidAt: '2026-11-23T16:00:00Z',
    clientName: 'Maquis La Terrasse',
    methodLabel: 'Wave CI',
    amountPaid: 10000,
    previousBalance: 18000,
    remainingBalance: 8000,
    note: 'Acompte sur 5 casiers échus',
  });
  assert.equal(partialDoc.docType, 'REÇU DE PAIEMENT');
  assert.equal(partialDoc.statusLabel, 'RÈGLEMENT PARTIEL');
  assert.equal(partialDoc.partyName, 'Maquis La Terrasse');
  assert.equal(partialDoc.payments?.[0].amount, 10000);
  assert.match(partialDoc.notes ?? '', /distinct du compte commercial marchandises/);
  assert.match(partialDoc.notes ?? '', /Acompte sur 5 casiers échus/);
});

test('buildPackagingLateReturnReceiptDoc formats late return credit note against packaging debt', () => {
  const lateDoc = buildPackagingLateReturnReceiptDoc({
    reference: 'RTD-EMB-15-90123',
    returnedAt: '2026-11-23T17:15:00Z',
    clientName: 'Cave Koumassi',
    saleReference: 'VTE-2026-0044',
    pieces: 2,
    unitValue: 3600,
    creditedAmount: 7200,
  });
  assert.equal(lateDoc.docType, 'REÇU RETOUR EMBALLAGES');
  assert.equal(lateDoc.statusLabel, 'RETOUR TARDIF CRÉDITÉ');
  assert.equal(lateDoc.linkedDocumentRef, 'VTE-2026-0044');
  assert.equal(lateDoc.lines[0].total, 7200);
  assert.match(lateDoc.notes ?? '', /contre-écriture automatique/);
});

test('formatCashMovementKind distinguishes packaging debt payments from trade receivables', () => {
  assert.equal(
    formatCashMovementKind('receivable', 'pkg-debt-pay:client-7:1763900000'),
    'Règlement créance emballages'
  );
  assert.equal(
    formatCashMovementKind('receivable', 'REC-2026-0012'),
    'Règlement créance client'
  );
  assert.equal(formatCashMovementKind('deposit_refund', null), 'Dédommagement emballages');
  assert.equal(formatCashMovementKind('sale_refund', 'RET-2026-0005'), 'Remboursement avoir');
  assert.equal(formatCashMovementKind('sale', 'VTE-2026-0100'), 'Vente');
});





test('computeReturnedPackagingSummary keeps per-line returns distinct and feeds the aggregate', () => {
  const rows = [
    {
      returnable_id: 100,
      packaging_name: 'Casier 24',
      packaging_code: 'CAS-24',
      deposit_value: 1000,
      prior_due_pieces: 0,
      cart_outgoing_pieces: 3,
      max_returnable_pieces: 3,
    },
  ];

  // Deux lignes du panier rendent des casiers : ce sont deux dettes distinctes,
  // rattachées chacune à SA ligne de vente. Les fusionner ferait mentir la
  // fiche de suivi client.
  const summary = computeReturnedPackagingSummary(
    rows,
    [],
    [
      { cartIndex: 0, returnable_id: 100, pieces: 2 },
      { cartIndex: 1, returnable_id: 100, pieces: 1 },
    ]
  );

  assert.deepEqual(summary.normalizedLineReturns, [
    { cartIndex: 0, returnable_id: 100, pieces: 2 },
    { cartIndex: 1, returnable_id: 100, pieces: 1 },
  ]);
  // L'agrégat par type reste la somme, pour la valorisation affichée.
  assert.deepEqual(summary.normalized, [{ returnable_id: 100, pieces: 3 }]);
  assert.equal(summary.totalPieces, 3);
  assert.equal(summary.totalAmountFcfa, 3000);
});

test('computeReturnedPackagingSummary ignores line returns above the line ceiling', () => {
  const rows = [
    {
      returnable_id: 100,
      packaging_name: 'Casier 24',
      packaging_code: 'CAS-24',
      deposit_value: 1000,
      prior_due_pieces: 0,
      cart_outgoing_pieces: 3,
      max_returnable_pieces: 3,
    },
  ];

  const summary = computeReturnedPackagingSummary(rows, [], [
    { cartIndex: 0, returnable_id: 100, pieces: 9 },
    { cartIndex: 1, returnable_id: 999, pieces: 1 },
    { cartIndex: -1, returnable_id: 100, pieces: 1 },
  ]);

  assert.deepEqual(summary.normalizedLineReturns, []);
  assert.deepEqual(summary.normalized, []);
  assert.equal(summary.totalPieces, 0);
});

test('buildSaleDraftFingerprint distinguishes which line received the crates', () => {
  const rows = [
    {
      returnable_id: 100,
      packaging_name: 'Casier 24',
      packaging_code: 'CAS-24',
      deposit_value: 1000,
      prior_due_pieces: 0,
      cart_outgoing_pieces: 3,
      max_returnable_pieces: 3,
    },
  ];
  const base = computeReturnedPackagingSummary(rows, [], [
    { cartIndex: 0, returnable_id: 100, pieces: 1 },
  ]);
  const other = computeReturnedPackagingSummary(rows, [], [
    { cartIndex: 1, returnable_id: 100, pieces: 1 },
  ]);

  const common = {
    posClientId: 1,
    posPriceTier: 'retail' as const,
    posSaleType: 'cash' as const,
    globalDiscount: 0,
    dueDate: '',
    posCart: [],
    paymentRows: [],
  };

  const fpBase = buildSaleDraftFingerprint({
    ...common,
    receivedReturnables: base.normalized,
    lineReturnables: base.normalizedLineReturns,
  });
  const fpOther = buildSaleDraftFingerprint({
    ...common,
    receivedReturnables: other.normalized,
    lineReturnables: other.normalizedLineReturns,
  });

  // Même total rendu, mais pas la même ligne : deux ventes différentes, donc
  // deux clés de requête différentes (sinon l'idempotence les confondrait).
  assert.notEqual(fpBase, fpOther);
});
