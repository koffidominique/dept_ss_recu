import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCollecting,
  remainingToCollect,
  summarizeTransit,
  totalExpectedInTransit,
  totalInTransit,
  transitCaption,
} from './cashInTransit.ts';
import type { RunInTransit } from '../../../types/erp.ts';

/**
 * L'argent en transit, hors caisse.
 *
 * Le risque n'est pas arithmétique : il est de faire croire au gérant que cet
 * argent est déjà dans le tiroir. Les tests verrouillent donc autant les
 * montants que la formulation qui les accompagne.
 */

function run(over: Partial<RunInTransit> = {}): RunInTransit {
  return {
    runId: 1,
    reference: 'TRN-2026-0001',
    runDate: '2026-11-24',
    driverName: 'Chauffeur',
    status: 'in_progress',
    declaredAmount: 0,
    expectedAmount: 0,
    declaredStops: 0,
    plannedStops: 0,
    ...over,
  };
}

test('le total en transit additionne le déclaré, pas l’attendu', () => {
  // Le déclaré est ce que le livreur dit avoir pris. L'attendu est une
  // prévision : afficher l'attendu comme « en transit » inventerait de
  // l'argent qui n'a peut-être jamais été encaissé.
  const runs = [
    run({ declaredAmount: 4_600, expectedAmount: 4_600 }),
    run({ runId: 2, declaredAmount: 1_000, expectedAmount: 2_400 }),
  ];
  assert.equal(totalInTransit(runs), 5_600);
  assert.equal(totalExpectedInTransit(runs), 7_000);
});

test('aucune tournée en cours donne zéro, pas NaN', () => {
  assert.equal(totalInTransit(undefined), 0);
  assert.equal(totalInTransit([]), 0);
  const s = summarizeTransit(undefined);
  assert.equal(s.runsCount, 0);
  assert.equal(s.totalDeclared, 0);
  assert.equal(s.hasGap, false, 'sans tournée, aucun écart à signaler');
});

test('un écart entre déclaré et attendu est signalé', () => {
  assert.equal(summarizeTransit([run({ declaredAmount: 4_600, expectedAmount: 4_600 })]).hasGap, false);
  assert.equal(summarizeTransit([run({ declaredAmount: 4_500, expectedAmount: 4_600 })]).hasGap, true);
});

test('le reste à collecter est attendu moins déclaré', () => {
  assert.equal(remainingToCollect(run({ expectedAmount: 4_600, declaredAmount: 0 })), 4_600);
  assert.equal(remainingToCollect(run({ expectedAmount: 4_600, declaredAmount: 4_600 })), 0);
  assert.equal(
    remainingToCollect(run({ expectedAmount: 4_600, declaredAmount: 5_000 })),
    -400,
    'déclarer plus que l’attendu donne un reste négatif, à contrôler'
  );
});

test('une tournée dont tout est constaté ne collecte plus', () => {
  assert.equal(isCollecting(run({ plannedStops: 2, declaredStops: 1 })), true);
  assert.equal(
    isCollecting(run({ plannedStops: 2, declaredStops: 2, expectedAmount: 4_600, declaredAmount: 4_600 })),
    false
  );
  // Tout constaté mais un écart subsiste : il reste quelque chose à comprendre.
  assert.equal(
    isCollecting(run({ plannedStops: 1, declaredStops: 1, expectedAmount: 4_600, declaredAmount: 4_000 })),
    true
  );
});

test('la légende dit explicitement que l’argent est hors caisse', () => {
  // C'est la phrase qui empêche l'erreur de lecture la plus probable.
  const caption = transitCaption(5_600);
  assert.match(caption, /hors caisse/i);
  assert.match(caption, /réconciliation/i);
});

test('sans argent en transit, la légende ne parle pas de caisse', () => {
  const caption = transitCaption(0);
  assert.match(caption, /Aucun encaissement/i);
  assert.doesNotMatch(caption, /hors caisse/i);
});
