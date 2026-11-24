import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeOrderLifecycleStages,
  createIdempotentRequestTracker,
  evaluateCashDiscrepancy,
  evaluateInventoryDraftLines,
  evaluatePurchaseReceiveLine,
  formatMilliExactString,
  normalizeOrderSettlementMethod,
  parseNonNegativeQtyToMilliBigInt,
} from './phase2OperationsGuards.ts';
import type { InventoryLine } from '../types.ts';

test('createIdempotentRequestTracker conserve la même request_key sur retries identiques et la renouvelle après changement ou reset', () => {
  const tracker = createIdempotentRequestTracker('recpay');

  const firstKey = tracker.resolveKey('debt:12:cash:15000');
  const retrySameKey = tracker.resolveKey('debt:12:cash:15000');
  assert.equal(firstKey, retrySameKey, 'Un double-clic ou retry identique doit réutiliser la même clé');
  assert.ok(firstKey.startsWith('recpay-'));

  const modifiedPayloadKey = tracker.resolveKey('debt:12:cash:20000');
  assert.notEqual(modifiedPayloadKey, firstKey, 'Un changement de montant doit générer une nouvelle clé');

  tracker.reset();
  const afterSuccessKey = tracker.resolveKey('debt:12:cash:20000');
  assert.notEqual(afterSuccessKey, modifiedPayloadKey, 'Après reset(), une nouvelle opération identique obtient une clé neuve');
});

test('evaluateCashDiscrepancy distingue équilibre, écart mineur et écart significatif (>= 1 000 FCFA)', () => {
  const exact = evaluateCashDiscrepancy(125_000, 125_000, '');
  assert.equal(exact.severity, 'exact');
  assert.equal(exact.requiresReason, false);
  assert.equal(exact.isReasonValid, true);

  const minorShort = evaluateCashDiscrepancy(125_000, 124_500, '');
  assert.equal(minorShort.diffXof, -500);
  assert.equal(minorShort.severity, 'minor_shortage');
  assert.equal(minorShort.minReasonLength, 3);
  assert.equal(minorShort.isReasonValid, false);

  const minorShortWithNote = evaluateCashDiscrepancy(125_000, 124_500, 'Rendu');
  assert.equal(minorShortWithNote.isReasonValid, true);

  const sigShortTooBrief = evaluateCashDiscrepancy(125_000, 120_000, 'Erreur');
  assert.equal(sigShortTooBrief.diffXof, -5_000);
  assert.equal(sigShortTooBrief.severity, 'significant_shortage');
  assert.equal(sigShortTooBrief.minReasonLength, 10);
  assert.equal(sigShortTooBrief.isReasonValid, false);
  assert.match(sigShortTooBrief.validationMessage ?? '', /10 caractères/);

  const sigSurplusOk = evaluateCashDiscrepancy(
    125_000,
    126_500,
    'Rendu monnaie oublié par client comptoir'
  );
  assert.equal(sigSurplusOk.severity, 'significant_surplus');
  assert.equal(sigSurplusOk.isReasonValid, true);
});

test('parseNonNegativeQtyToMilliBigInt et formatMilliExactString gèrent exactement 0 et les milli-unités sans flottants', () => {
  const zero = parseNonNegativeQtyToMilliBigInt('0');
  assert.deepEqual(zero, { ok: true, milli: 0n });

  const commaDec = parseNonNegativeQtyToMilliBigInt('12,375');
  assert.deepEqual(commaDec, { ok: true, milli: 12375n });
  assert.equal(formatMilliExactString(12375), '12.375');
  assert.equal(formatMilliExactString(-2500), '-2.5');
  assert.equal(formatMilliExactString(0), '0');

  const neg = parseNonNegativeQtyToMilliBigInt('-1');
  assert.equal(neg.ok, false);

  const fourDecimals = parseNonNegativeQtyToMilliBigInt('1.2345');
  assert.equal(fourDecimals.ok, false);
});

test('evaluateInventoryDraftLines bloque les écarts sans motif ou saisies invalides et comptabilise exactement les ajustements', () => {
  const lines: InventoryLine[] = [
    {
      id: 1,
      product_id: 101,
      product_name: 'Beaufort Lager 65cl',
      product_reference: 'PRD-001',
      base_unit: 'btl',
      theoretical_milli: 24_000,
      counted_milli: null,
      reason: null,
    },
    {
      id: 2,
      product_id: 102,
      product_name: 'Youki Cocktail 1.5L',
      product_reference: 'PRD-002',
      base_unit: 'btl',
      theoretical_milli: 10_000,
      counted_milli: null,
      reason: null,
    },
  ];

  // Écart de -2 sur PRD-001 et +3 sur PRD-002 sans motif => bloqué
  const missingReasons = evaluateInventoryDraftLines(
    lines,
    { 101: '22', 102: '13' },
    {}
  );
  assert.equal(missingReasons.canValidate, false);
  assert.equal(missingReasons.totalDiscrepancies, 2);
  assert.equal(missingReasons.negativeDiscrepancies, 1);
  assert.equal(missingReasons.positiveDiscrepancies, 1);
  assert.equal(missingReasons.missingReasonCount, 2);

  // Motifs renseignés => autorisé
  const validDraft = evaluateInventoryDraftLines(
    lines,
    { 101: '0', 102: '13' },
    { 101: 'Casse complète constatée en réserve', 102: 'Surplus non pointé' }
  );
  assert.equal(validDraft.canValidate, true);
  assert.equal(validDraft.lines[0]?.countedMilli, 0);
  assert.equal(validDraft.lines[0]?.deltaFormatted, '-24');
  assert.equal(validDraft.lines[1]?.deltaFormatted, '+3');
});

test('normalizeOrderSettlementMethod empêche l’envoi de "credit" à payCustomerOrder et conserve les canaux valides', () => {
  assert.equal(normalizeOrderSettlementMethod('credit', 'credit'), 'cash');
  assert.equal(normalizeOrderSettlementMethod(null, 'credit'), 'cash');
  assert.equal(normalizeOrderSettlementMethod('mobile_money', 'mobile_money'), 'wave');
  assert.equal(normalizeOrderSettlementMethod('orange_money', 'mobile_money'), 'orange_money');
  assert.equal(normalizeOrderSettlementMethod('transfer', 'cash'), 'transfer');
});

test('computeOrderLifecycleStages reflète fidèlement les transitions de commande client', () => {
  const pendingApproval = computeOrderLifecycleStages('draft', 'pending_owner_approval', 50_000);
  assert.equal(pendingApproval.isCancelled, false);
  assert.equal(pendingApproval.stages[0]?.label, 'Attente approbation');
  assert.equal(pendingApproval.stages[0]?.state, 'current');

  const deliveredWithBalance = computeOrderLifecycleStages('delivered', 'approved', 15_000);
  assert.equal(deliveredWithBalance.stages[0]?.state, 'done');
  assert.equal(deliveredWithBalance.stages[1]?.state, 'done');
  assert.equal(deliveredWithBalance.stages[2]?.state, 'current');
  assert.equal(deliveredWithBalance.stages[4]?.state, 'upcoming');

  const cancelled = computeOrderLifecycleStages('cancelled', null, 0);
  assert.equal(cancelled.isCancelled, true);
  assert.equal(cancelled.stages.length, 0);
});

test('evaluatePurchaseReceiveLine bloque les dépassements de reliquat et exige un motif sur écart ou réception partielle', () => {
  const overReceive = evaluatePurchaseReceiveLine({
    orderedMilli: 10_000,
    alreadyReceivedMilli: 4_000,
    receiveRaw: '7',
  });
  assert.equal(overReceive.exceedsRemaining, true);
  assert.match(overReceive.errorMessage ?? '', /dépasse le reliquat/);

  const partialNoReason = evaluatePurchaseReceiveLine({
    orderedMilli: 10_000,
    alreadyReceivedMilli: 0,
    receiveRaw: '8',
    damagedRaw: '2',
    reasonRaw: '',
  });
  assert.equal(partialNoReason.hasDiscrepancy, true);
  assert.equal(partialNoReason.missingReason, true);
  assert.equal(Boolean(partialNoReason.errorMessage), true);

  const partialWithReason = evaluatePurchaseReceiveLine({
    orderedMilli: 10_000,
    alreadyReceivedMilli: 0,
    receiveRaw: '8',
    damagedRaw: '2',
    reasonRaw: '2 casiers endommagés au déchargement',
  });
  assert.equal(partialWithReason.errorMessage, null);
  assert.equal(partialWithReason.hasDiscrepancy, true);
  assert.equal(partialWithReason.missingReason, false);
});
