import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKUP_STALE_DAYS,
  CASH_SESSION_STALE_HOURS,
  buildWorkQueue,
  compareWorkQueueItems,
  daysSince,
  filterCustomerOrders,
  filterReceivables,
  hoursSince,
  isPastDueDate,
  prioritizeWorkQueue,
  summarizeWorkQueue,
  type WorkQueueItem,
} from './workQueue.ts';
import type { CustomerOrderSummary } from '../../../types/erp.ts';

const NOW = new Date('2026-11-23T12:00:00Z');

function iso(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
}

const CLEAR_KPIS = {
  cashSessionOpen: true,
  overdueReceivablesCount: 0,
  overdueReceivablesTotal: 0,
  overdueSupplierDebtsCount: 0,
  overdueSupplierDebtsTotal: 0,
  lowStockCount: 0,
  outOfStockCount: 0,
};

function baseOrder(over: Partial<CustomerOrderSummary> = {}): CustomerOrderSummary {
  return {
    id: 1,
    order_number: 'CMD-001',
    customer_id: 5,
    customer_name: 'Maquis Le Palais',
    order_type: 'vente',
    status: 'confirmed',
    approval_status: 'approved',
    subtotal_xof: 10_000,
    deposit_total_xof: 0,
    discount_xof: 0,
    tax_xof: 0,
    delivery_fee_xof: 0,
    total_xof: 10_000,
    deposit_due_xof: 0,
    total_to_collect_xof: 10_000,
    paid_xof: 0,
    payment_status: 'unpaid',
    payment_method: 'cash',
    planned_payment_channel: 'cash',
    delivery_mode: 'pickup',
    delivery_date: null,
    delivery_address: null,
    notes: null,
    created_at: iso(1),
    updated_at: iso(1),
    ...over,
  };
}

test('hoursSince/daysSince/isPastDueDate refusent les dates absentes ou invalides', () => {
  assert.equal(hoursSince(null, NOW), null);
  assert.equal(hoursSince('pas-une-date', NOW), null);
  assert.equal(hoursSince(iso(5), NOW), 5);

  assert.equal(daysSince(undefined, NOW), null);
  assert.equal(daysSince(iso(48), NOW), 2);

  assert.equal(isPastDueDate(null, NOW), false);
  assert.equal(isPastDueDate('n/a', NOW), false);
  assert.equal(isPastDueDate('2026-11-22', NOW), true);
  assert.equal(isPastDueDate('2026-12-01', NOW), false);
});

test('buildWorkQueue n’invente aucune alerte quand tout est à jour', () => {
  const items = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
    orders: [baseOrder({ status: 'paid', paid_xof: 10_000 })],
    inventories: [{ id: 1, reference: 'INV-1', status: 'validated' }],
    packagingOpenIssues: [],
    lastBackupAt: iso(6),
    backupCount: 3,
  });
  assert.deepEqual(items, []);
  const summary = summarizeWorkQueue(items);
  assert.equal(summary.allClear, true);
  assert.match(summary.headline, /Aucune action requise/);
});

test('buildWorkQueue signale la caisse fermée en bloquant et remonte la session trop ancienne', () => {
  const closed = buildWorkQueue({ now: NOW, kpis: { ...CLEAR_KPIS, cashSessionOpen: false } });
  const closedItem = closed.find((i) => i.id === 'cash-closed');
  assert.ok(closedItem);
  assert.equal(closedItem.severity, 'critical');
  assert.equal(closedItem.to, '/cash');

  const stale = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: {
      id: 9,
      reference: 'CAI-9',
      opened_at: iso(CASH_SESSION_STALE_HOURS + 1),
    },
  });
  const staleItem = stale.find((i) => i.severity !== 'info' && i.category === 'cash');
  assert.ok(staleItem);
  assert.match(staleItem.detail, /ouverte depuis 13 h/);

  // Une session de 30 h doit devenir bloquante (2 x le seuil).
  const veryStale = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: { id: 9, reference: 'CAI-9', opened_at: iso(CASH_SESSION_STALE_HOURS * 2 + 2) },
  });
  assert.equal(veryStale.find((i) => i.category === 'cash')?.severity, 'critical');
});

test('buildWorkQueue reprend les montants échus fournis par le noyau sans les recalculer', () => {
  const items = buildWorkQueue({
    now: NOW,
    kpis: {
      ...CLEAR_KPIS,
      overdueReceivablesCount: 3,
      overdueReceivablesTotal: 125_000,
      overdueSupplierDebtsCount: 2,
      overdueSupplierDebtsTotal: 60_000,
    },
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
  });

  const rec = items.find((i) => i.id === 'receivables-overdue');
  assert.ok(rec);
  assert.equal(rec.amountXof, 125_000, 'Le montant doit être repris tel quel, jamais recalculé');
  assert.equal(rec.count, 3);
  assert.equal(rec.to, '/debts?statut=en_retard');

  const sup = items.find((i) => i.id === 'supplier-debts-overdue');
  assert.ok(sup);
  assert.equal(sup.amountXof, 60_000);
  assert.equal(sup.to, '/suppliers?dettes=en_retard');
});

test('buildWorkQueue distingue ruptures bloquantes et seuils à anticiper', () => {
  const items = buildWorkQueue({
    now: NOW,
    kpis: { ...CLEAR_KPIS, outOfStockCount: 4, lowStockCount: 7 },
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
  });
  const out = items.find((i) => i.id === 'stock-out');
  const low = items.find((i) => i.id === 'stock-low');
  assert.equal(out?.severity, 'critical');
  assert.equal(out?.to, '/stock?alerte=rupture');
  assert.equal(low?.severity, 'warning');
  assert.equal(low?.to, '/stock?alerte=seuil');
});

test('buildWorkQueue suit le cycle de vie des commandes et calcule le restant dû exact', () => {
  const items = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
    orders: [
      baseOrder({ id: 1, approval_status: 'pending_owner_approval', status: 'draft' }),
      baseOrder({ id: 2, status: 'confirmed', total_to_collect_xof: 20_000, paid_xof: 0 }),
      baseOrder({ id: 3, status: 'preparing', total_to_collect_xof: 5_000, paid_xof: 5_000 }),
      // Livrée avec solde : 12 000 - 2 000 = 10 000 restants
      baseOrder({ id: 4, status: 'delivered', total_to_collect_xof: 12_000, paid_xof: 2_000 }),
      // Livrée soldée : ne doit pas apparaître
      baseOrder({ id: 5, status: 'delivered', total_to_collect_xof: 8_000, paid_xof: 8_000 }),
    ],
  });

  const approval = items.find((i) => i.id === 'orders-approval');
  assert.equal(approval?.count, 1);
  assert.equal(approval?.to, '/orders?statut=a_approuver');

  const deliver = items.find((i) => i.id === 'orders-deliver');
  assert.equal(deliver?.count, 2);
  // 20 000 (cmd 2) + 0 (cmd 3 soldée) = 20 000
  assert.equal(deliver?.amountXof, 20_000);

  const settle = items.find((i) => i.id === 'orders-settle');
  assert.equal(settle?.count, 1, 'Seule la commande livrée non soldée compte');
  assert.equal(settle?.amountXof, 10_000);
});

test('buildWorkQueue ignore les emballages déjà restitués et retient les échéances dépassées', () => {
  const items = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
    packagingOpenIssues: [
      // Restitué intégralement : rien à relancer
      { id: 1, pieces: 12, returned_pieces: 12, due_date: '2026-11-01' },
      // Échéance passée, 5 pièces encore dues
      { id: 2, pieces: 12, returned_pieces: 7, due_date: '2026-11-10' },
      // Signalé échu par l'API sans date exploitable
      { id: 3, pieces: 6, returned_pieces: 1, due_date: null, overdue: true },
      // Échéance future
      { id: 4, pieces: 10, returned_pieces: 0, due_date: '2026-12-20' },
    ],
  });
  const item = items.find((i) => i.id === 'consignments-overdue');
  assert.ok(item);
  assert.equal(item.count, 5 + 5, 'Pièces restantes : 5 (issue 2) + 5 (issue 3)');
  assert.equal(item.to, '/consignments?tab=issues');
});

test('buildWorkQueue alerte sur l’absence de sauvegarde puis sur son ancienneté', () => {
  const none = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
    lastBackupAt: null,
  });
  assert.equal(none.find((i) => i.id === 'backup-missing')?.severity, 'warning');

  const stale = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
    lastBackupAt: iso(24 * (BACKUP_STALE_DAYS * 2 + 1)),
  });
  const item = stale.find((i) => i.id === 'backup-stale');
  assert.equal(item?.severity, 'critical');

  const fresh = buildWorkQueue({
    now: NOW,
    kpis: CLEAR_KPIS,
    activeCashSession: { id: 1, reference: 'CAI-1', opened_at: iso(1) },
    lastBackupAt: iso(24),
  });
  assert.equal(fresh.find((i) => i.category === 'backups'), undefined);
});

test('prioritizeWorkQueue place les blocages avant les avertissements et respecte le rang interne', () => {
  const items: WorkQueueItem[] = [
    { id: 'b', category: 'stock', severity: 'warning', title: 'B', detail: '', actionLabel: 'x', to: '/', priority: 10 },
    { id: 'a', category: 'cash', severity: 'critical', title: 'A', detail: '', actionLabel: 'x', to: '/', priority: 50 },
    { id: 'c', category: 'cash', severity: 'critical', title: 'C', detail: '', actionLabel: 'x', to: '/', priority: 5 },
    { id: 'd', category: 'cash', severity: 'info', title: 'D', detail: '', actionLabel: 'x', to: '/', priority: 1 },
  ];
  assert.deepEqual(
    prioritizeWorkQueue(items).map((i) => i.id),
    ['c', 'a', 'b', 'd']
  );
  assert.ok(compareWorkQueueItems(items[1]!, items[0]!) < 0);
  // La fonction ne mute pas l'entrée
  assert.deepEqual(items.map((i) => i.id), ['b', 'a', 'c', 'd']);
});

test('summarizeWorkQueue produit un en-tête exact et non trompeur', () => {
  assert.match(summarizeWorkQueue([]).headline, /Aucune action requise/);

  const criticalOnly = summarizeWorkQueue([
    { id: 'a', category: 'cash', severity: 'critical', title: '', detail: '', actionLabel: '', to: '/', priority: 1 },
  ]);
  assert.equal(criticalOnly.critical, 1);
  assert.match(criticalOnly.headline, /1 action\(s\) bloquante\(s\)/);

  const warningOnly = summarizeWorkQueue([
    { id: 'a', category: 'stock', severity: 'warning', title: '', detail: '', actionLabel: '', to: '/', priority: 1 },
    { id: 'b', category: 'stock', severity: 'warning', title: '', detail: '', actionLabel: '', to: '/', priority: 2 },
  ]);
  assert.equal(warningOnly.warning, 2);
  assert.match(warningOnly.headline, /aucune action bloquante/);
});

test('filterCustomerOrders applique statut, approbation et recherche sans perdre les lignes valides', () => {
  const orders = [
    baseOrder({ id: 1, order_number: 'CMD-100', customer_name: 'Maquis A', approval_status: 'pending_owner_approval', status: 'draft' }),
    baseOrder({ id: 2, order_number: 'CMD-200', customer_name: 'Boutique B', status: 'confirmed' }),
    baseOrder({ id: 3, order_number: 'CMD-300', customer_name: 'Maquis C', status: 'delivered', total_to_collect_xof: 30_000, paid_xof: 1_000 }),
    baseOrder({ id: 4, order_number: 'CMD-400', customer_name: 'Épicerie D', status: 'paid', total_to_collect_xof: 9_000, paid_xof: 9_000 }),
  ];

  const all = filterCustomerOrders(orders, { statut: 'tous', search: '' });
  assert.equal(all.length, 4);

  const toApprove = filterCustomerOrders(orders, { statut: 'a_approuver', search: '' });
  assert.deepEqual(toApprove.map((o) => o.id), [1]);

  const toDeliver = filterCustomerOrders(orders, { statut: 'a_livrer', search: '' });
  assert.deepEqual(toDeliver.map((o) => o.id), [2]);

  const settling = filterCustomerOrders(orders, { statut: 'solde_du', search: '' });
  assert.deepEqual(settling.map((o) => o.id), [3], 'Une commande soldée ne doit pas être listée');

  const searchByClient = filterCustomerOrders(orders, { statut: 'tous', search: 'maquis' });
  assert.deepEqual(searchByClient.map((o) => o.id), [1, 3]);

  const searchByNumber = filterCustomerOrders(orders, { statut: 'tous', search: 'CMD-400' });
  assert.deepEqual(searchByNumber.map((o) => o.id), [4]);
});

test('filterReceivables isole les échéances dépassées et ignore les dossiers soldés ou annulés', () => {
  const rows = [
    { client_name: 'Maquis A', client_code: 'CLI-1', sale_reference: 'VTE-1', remaining_amount: 50_000, due_date: '2026-11-01', status: 'open' },
    { client_name: 'Boutique B', client_code: 'CLI-2', sale_reference: 'VTE-2', remaining_amount: 20_000, due_date: '2026-12-31', status: 'partial' },
    { client_name: 'Épicerie C', client_code: 'CLI-3', sale_reference: 'VTE-3', remaining_amount: 0, due_date: '2026-11-01', status: 'paid' },
    { client_name: 'Annulée D', client_code: 'CLI-4', sale_reference: 'VTE-4', remaining_amount: 10_000, due_date: '2026-11-01', status: 'cancelled' },
  ];

  const overdue = filterReceivables(rows, { statut: 'en_retard', search: '' }, NOW);
  assert.deepEqual(overdue.map((r) => r.sale_reference), ['VTE-1']);

  const open = filterReceivables(rows, { statut: 'ouvertes', search: '' }, NOW);
  assert.deepEqual(open.map((r) => r.sale_reference), ['VTE-1', 'VTE-2']);

  const search = filterReceivables(rows, { statut: 'tous', search: 'cli-2' }, NOW);
  assert.deepEqual(search.map((r) => r.sale_reference), ['VTE-2']);
});
