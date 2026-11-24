import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocationBlocker,
  buildCreateRunInput,
  isDriverAccount,
  isReconcilableForReading,
  isTerminal,
  reconciliationBlocker,
  reconciliationGaps,
  runActions,
  runBrief,
  todayIso,
} from './deliveryRuns.ts';
import type { DeliveryReconciliation, DeliveryRun, DeliveryRunStop } from '../../../types/erp.ts';

/**
 * Logique des tournées, testée hors navigateur.
 *
 * Ce qui est verrouillé ici n'est pas cosmétique : ce sont les règles qui
 * décident si un bouton apparaît, si un écart oblige à un motif, et si des
 * vides peuvent entrer en stock sans contrepartie.
 */

function run(over: Partial<DeliveryRun> = {}): DeliveryRun {
  return {
    id: 1,
    reference: 'TRN-2026-0001',
    run_date: '2026-11-24',
    driver_user_id: 3,
    driver_name: 'Chauffeur',
    vehicle_label: null,
    status: 'draft',
    planned_stops: 0,
    opened_at: '2026-11-24T08:00:00Z',
    closed_at: null,
    notes: null,
    ...over,
  };
}

function stop(over: Partial<DeliveryRunStop> = {}): DeliveryRunStop {
  return {
    id: 10,
    run_id: 1,
    client_id: 5,
    client_name: 'Client A',
    order_id: null,
    sequence: 1,
    expected_amount: 0,
    expected_empty_pieces: 0,
    status: 'planned',
    failure_reason: null,
    ...over,
  };
}

function rec(over: Partial<DeliveryReconciliation> = {}): DeliveryReconciliation {
  return {
    run_id: 1,
    reference: 'TRN-2026-0001',
    status: 'reconciled',
    expected_amount: 4600,
    declared_amount: 4600,
    counted_amount: 4600,
    declared_gap: 0,
    cash_gap: 0,
    discrepancy_reason: null,
    by_method: [],
    expected_empty_pieces: 2,
    returned_good_pieces: 2,
    returned_damaged_pieces: 0,
    collections_written: 1,
    ...over,
  };
}

/* --- Actions proposées ---------------------------------------------------- */

test('une tournée vide ne propose pas le chargement', () => {
  // Le cœur refuse de charger zéro arrêt. Proposer le bouton ferait découvrir
  // la règle par un message d'erreur.
  const a = runActions('draft', 0);
  assert.equal(a.canAddStop, true, 'on peut ajouter un arrêt à un brouillon');
  assert.equal(a.canLoad, false, 'charger une tournée vide sera refusé : ne pas le proposer');
  assert.equal(runActions('draft', 1).canLoad, true);
});

test('le départ exige une tournée chargée, pas un brouillon', () => {
  assert.equal(runActions('draft', 3).canStart, false);
  assert.equal(runActions('loaded', 3).canStart, true);
  assert.equal(runActions('in_progress', 3).canStart, false, 'pas de double départ');
});

test('la réconciliation n’est proposée qu’au retour', () => {
  assert.equal(runActions('returned', 2).canReconcile, true);
  assert.equal(runActions('in_progress', 2).canReconcile, false, 'on ne réconcilie pas une tournée sur la route');
  assert.equal(runActions('reconciled', 2).canReconcile, false);
});

test('les gestes de terrain ne sont proposés que pendant la tournée', () => {
  assert.equal(runActions('in_progress', 2).canDeclareCollection, true);
  assert.equal(runActions('in_progress', 2).canRecordReturn, true);
  assert.equal(runActions('draft', 2).canDeclareCollection, false);
  assert.equal(runActions('reconciled', 2).canRecordReturn, false, 'réconciliée = terminal');
});

test('un constat d’arrêt reste possible après le retour, pour les arrêts oubliés', () => {
  assert.equal(runActions('returned', 2).canRecordOutcome, true);
  assert.equal(runActions('in_progress', 2).canRecordOutcome, true);
  assert.equal(runActions('loaded', 2).canRecordOutcome, false);
});

test('reconciled et cancelled sont terminaux', () => {
  assert.equal(isTerminal('reconciled'), true);
  assert.equal(isTerminal('cancelled'), true);
  assert.equal(isTerminal('returned'), false);
});

/* --- Résumé de tournée ---------------------------------------------------- */

test('le résumé somme l’attendu figé des arrêts, pas un prévisionnel', () => {
  const brief = runBrief(run({ status: 'loaded' }), [
    stop({ expected_amount: 4600 }),
    stop({ id: 11, expected_amount: 2400 }),
  ]);
  assert.match(brief, /2 arrêts/);
  assert.match(brief, /7\s000 FCFA/, `attendu 7 000 introuvable dans : ${brief}`);
});

test('le résumé signale les arrêts non constatés pendant la tournée', () => {
  const brief = runBrief(run({ status: 'in_progress' }), [
    stop({ status: 'delivered', expected_amount: 1000 }),
    stop({ id: 11, status: 'planned', expected_amount: 1000 }),
    stop({ id: 12, status: 'planned', expected_amount: 1000 }),
  ]);
  assert.match(brief, /1 livré/);
  assert.match(brief, /2 non constatés/);
});

/* --- Écarts de réconciliation --------------------------------------------- */

test('deux écarts distincts : déclaration et caisse', () => {
  const [decl, cash] = reconciliationGaps(rec({ declared_gap: -100, cash_gap: -50 }));
  assert.equal(decl.value, -100);
  assert.equal(cash.value, -50);
  assert.equal(decl.tone, 'danger');
  assert.equal(cash.tone, 'danger');
  assert.match(decl.explanation, /déclaré moins/);
  assert.match(cash.explanation, /manque de l'argent/);
});

test('un écart nul n’est pas signalé, même si l’autre ne l’est pas', () => {
  // Le piège classique : un seul écart à zéro ne veut pas dire « tout va bien ».
  const [decl, cash] = reconciliationGaps(rec({ declared_gap: 0, cash_gap: -100 }));
  assert.equal(decl.tone, null, 'rien à signaler sur la déclaration');
  assert.equal(cash.tone, 'danger', 'mais la caisse manque');
});

test('un écart positif est un avertissement, pas une faute', () => {
  const [decl] = reconciliationGaps(rec({ declared_gap: 500 }));
  assert.equal(decl.tone, 'warning');
  assert.match(decl.explanation, /plus que l'attendu/);
});

/* --- Blocage de la réconciliation ----------------------------------------- */

test('sans écart, aucun motif n’est exigé', () => {
  assert.equal(reconciliationBlocker(4600, 4600, 4600, ''), null);
});

test('avec un écart, le motif devient obligatoire', () => {
  assert.match(String(reconciliationBlocker(4600, 4600, 4500, '   ')), /motif est obligatoire/);
  assert.equal(reconciliationBlocker(4600, 4600, 4500, 'Billet manquant'), null);
});

test('un montant non entier ou négatif est refusé', () => {
  assert.match(String(reconciliationBlocker(4600, 4600, -1, 'x')), /entier positif/);
  assert.match(String(reconciliationBlocker(4600, 4600, 12.5, 'x')), /entier positif/);
});

/* --- Répartition des vides ------------------------------------------------ */

test('la répartition doit égaler exactement ce qui est rapporté', () => {
  assert.equal(
    allocationBlocker([{ returnable_id: 1, good_pieces: 2, damaged_pieces: 0 }], [{ returnable_id: 1, good_pieces: 2, damaged_pieces: 0 }]),
    null
  );
  assert.match(
    String(allocationBlocker([{ returnable_id: 1, good_pieces: 2, damaged_pieces: 0 }], [{ returnable_id: 1, good_pieces: 1, damaged_pieces: 0 }])),
    /2 rapportés, 1 répartis/
  );
});

test('des vides abîmés manquants sont refusés distinctement des bons', () => {
  const msg = allocationBlocker([{ returnable_id: 1, good_pieces: 0, damaged_pieces: 2 }], []);
  assert.match(String(msg), /abîmés/);
});

test('une répartition chez un client sans rien de rapporté est refusée', () => {
  const msg = allocationBlocker([], [{ returnable_id: 1, good_pieces: 1, damaged_pieces: 0 }]);
  assert.match(String(msg), /pas déclaré comme rapporté/);
});

test('des quantités négatives sont refusées', () => {
  assert.match(
    String(allocationBlocker([{ returnable_id: 1, good_pieces: -1, damaged_pieces: 0 }], [])),
    /négatives/
  );
});

/* --- Divers --------------------------------------------------------------- */

test('la date du jour ne glisse pas d’un jour selon le fuseau', () => {
  // `toISOString()` décale en UTC : à 23 h à Abidjan on obtient le lendemain.
  const d = new Date(2026, 10, 24, 23, 30);
  assert.equal(todayIso(d), '2026-11-24');
});

test('le payload de création met un véhicule vide à null, pas à chaîne vide', () => {
  const payload = buildCreateRunInput(3, '   ', '  ', 'req-1', new Date(2026, 10, 24));
  assert.equal(payload.vehicle_label, null);
  assert.equal(payload.notes, null);
  assert.equal(payload.run_date, '2026-11-24');
  assert.equal(payload.request_key, 'req-1');
});

/* --- Comptes attribuables ------------------------------------------------ */

test('seuls les rôles qui portent delivery_runs:execute sont proposés comme livreur', () => {
  // Vérifié contre rbac.rs : Owner et Driver portent Execute. Admin et Manager
  // préparent et réconcilient, mais ne partent pas en tournée.
  assert.equal(isDriverAccount({ active: true, role: 'driver' }), true);
  assert.equal(isDriverAccount({ active: true, role: 'owner' }), true);
  assert.equal(isDriverAccount({ active: true, role: 'manager' }), false);
  assert.equal(isDriverAccount({ active: true, role: 'admin' }), false);
  assert.equal(isDriverAccount({ active: true, role: 'cashier' }), false);
});

test('un compte désactivé n’est jamais proposé, quel que soit son rôle', () => {
  assert.equal(isDriverAccount({ active: false, role: 'driver' }), false);
});

/* --- Lisibilité de la réconciliation ------------------------------------- */

test('la réconciliation est lisible dès le retour, pas seulement après', () => {
  // Défaut réel : la requête était conditionnée à `reconciled`. La modale
  // s'ouvrait donc sur un résumé `null` — vide — au moment exact où le gérant
  // devait saisir le montant compté.
  assert.equal(isReconcilableForReading('returned'), true);
  assert.equal(isReconcilableForReading('reconciled'), true, 'consultation après coup');
});

test('rien à lire avant le retour : le livreur est encore sur la route', () => {
  assert.equal(isReconcilableForReading('draft'), false);
  assert.equal(isReconcilableForReading('loaded'), false);
  assert.equal(isReconcilableForReading('in_progress'), false);
  assert.equal(isReconcilableForReading('cancelled'), false);
  assert.equal(isReconcilableForReading(undefined), false, 'aucune tournée sélectionnée');
});

test('chaque statut où l’on peut réconcilier est aussi un statut lisible', () => {
  // Le invariant qui manquait : proposer le bouton sans pouvoir charger le
  // résumé. Il doit rester vrai si la matrice des actions change.
  const statuses = ['draft', 'loaded', 'in_progress', 'returned', 'reconciled', 'cancelled'] as const;
  for (const st of statuses) {
    if (runActions(st, 3).canReconcile) {
      assert.equal(isReconcilableForReading(st), true, `réconciliable mais illisible : ${st}`);
    }
  }
});
