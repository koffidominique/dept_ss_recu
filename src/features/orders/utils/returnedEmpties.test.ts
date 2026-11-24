/* ============================================================================
 * Vides rapportés au comptoir — logique pure du panneau
 * ========================================================================== */
// Ce qui est testé ici n'est pas l'affichage mais les deux décisions qui
// comptent : comment on agrège des consignes nées sur plusieurs ventes, et
// quand on doit avertir que le client rapporte plus qu'il ne doit.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aggregateDueEmpties,
  surplusWarning,
  type ReturnedEmptyLine,
} from './returnedEmpties.ts';
import type { CustomerDepositBalance, PackagingObligationRef } from '../../../types/erp.ts';

function obligation(
  patch: Partial<PackagingObligationRef> & Pick<PackagingObligationRef, 'returnable_id'>,
): PackagingObligationRef {
  return {
    id: patch.id ?? 1,
    sale_id: patch.sale_id ?? 1,
    sale_reference: patch.sale_reference ?? 'VTE-1',
    client_id: patch.client_id ?? 1,
    returnable_id: patch.returnable_id,
    pieces: patch.pieces ?? 3,
    returned_pieces: patch.returned_pieces ?? 0,
    lost_pieces: patch.lost_pieces ?? 0,
    destroyed_pieces: patch.destroyed_pieces ?? 0,
    converted_pieces: patch.converted_pieces ?? 0,
    pending_pieces: patch.pending_pieces ?? 3,
    unit_value: patch.unit_value ?? 1000,
    total_reference_value: patch.total_reference_value ?? 3000,
    due_date: patch.due_date ?? '2026-12-01',
    overdue: patch.overdue ?? false,
    status: patch.status ?? 'pending',
  };
}

function deposit(patch: Partial<CustomerDepositBalance> = {}): CustomerDepositBalance {
  return {
    id: patch.id ?? 1,
    customer_id: patch.customer_id ?? 1,
    packaging_asset_id: patch.packaging_asset_id ?? 10,
    returnable_id: patch.returnable_id ?? 1,
    packaging_name: patch.packaging_name ?? 'Casier 24',
    compatibility_class: patch.compatibility_class ?? 'crate_24',
    deposit_value: patch.deposit_value ?? 1000,
    quantity_held: patch.quantity_held ?? 3,
    amount_held_xof: patch.amount_held_xof ?? 3000,
    last_movement_at: patch.last_movement_at ?? null,
  };
}

test('deux ventes du même consignable forment une seule ligne due', () => {
  // Le client raisonne en casiers, pas en ventes : 3 + 2 = 5 casiers dus.
  const dues = aggregateDueEmpties(
    [deposit()],
    [
      obligation({ returnable_id: 1, pending_pieces: 3 }),
      obligation({ id: 2, sale_id: 2, returnable_id: 1, pending_pieces: 2 }),
    ],
  );

  assert.equal(dues.length, 1, 'un seul consignable = une seule ligne');
  assert.equal(dues[0].due_pieces, 5);
});

test("l'échéance la plus ancienne est retenue comme repère", () => {
  const dues = aggregateDueEmpties(
    [deposit()],
    [
      obligation({ returnable_id: 1, pending_pieces: 1, due_date: '2026-12-20' }),
      obligation({ id: 2, returnable_id: 1, pending_pieces: 1, due_date: '2026-11-05' }),
    ],
  );

  assert.equal(dues[0].due_date, '2026-11-05');
});

test('une seule consigne échue marque la ligne comme échue', () => {
  const dues = aggregateDueEmpties(
    [deposit()],
    [
      obligation({ returnable_id: 1, pending_pieces: 1, overdue: false }),
      obligation({ id: 2, returnable_id: 1, pending_pieces: 1, overdue: true }),
    ],
  );

  assert.equal(dues[0].overdue, true, "l'échéance dépassée est visible, pas diluée");
});

test('les consignes soldées ne comptent pas dans le dû', () => {
  const dues = aggregateDueEmpties(
    [deposit()],
    [
      obligation({ returnable_id: 1, pending_pieces: 0 }),
      obligation({ id: 2, returnable_id: 1, pending_pieces: 4 }),
    ],
  );

  assert.equal(dues[0].due_pieces, 4);
});

test('un consignable sans ligne de dépôt connue reste affiché', () => {
  // Cas réel : le client a une consigne ouverte mais son solde de dépôt a été
  // soldé par un ajustement. Il doit quand même voir ce qu'il doit.
  const dues = aggregateDueEmpties([], [obligation({ returnable_id: 7, pending_pieces: 2 })]);

  assert.equal(dues.length, 1);
  assert.equal(dues[0].returnable_id, 7);
  assert.equal(dues[0].packaging_asset_id, null, 'sans asset, la saisie est bloquée');
  assert.match(dues[0].packaging_name, /Consignable #7/);
});

test('les lignes échues passent devant', () => {
  const dues = aggregateDueEmpties(
    [deposit(), deposit({ id: 2, packaging_asset_id: 20, returnable_id: 2, packaging_name: 'Bouteille' })],
    [
      obligation({ returnable_id: 2, pending_pieces: 9, due_date: '2027-01-01' }),
      obligation({ id: 3, returnable_id: 1, pending_pieces: 1, due_date: '2026-10-01', overdue: true }),
    ],
  );

  assert.equal(dues[0].returnable_id, 1, "l'échue d'abord");
  assert.equal(dues[1].returnable_id, 2);
});

test("rapporter exactement le dû n'avertit pas", () => {
  const dues = aggregateDueEmpties([deposit()], [obligation({ returnable_id: 1, pending_pieces: 3 })]);
  const returned: ReturnedEmptyLine[] = [
    { returnable_id: 1, packaging_asset_id: 10, packaging_name: 'Casier 24', pieces: 3 },
  ];

  assert.deepEqual(surplusWarning(returned, dues), []);
});

test("rapporter plus que le dû avertit, avec le chiffre exact en trop", () => {
  // Le piège silencieux : 2 casiers rendus en trop disparaîtraient sans trace
  // comptable. Le gérant doit le voir avant d'enregistrer.
  const dues = aggregateDueEmpties([deposit()], [obligation({ returnable_id: 1, pending_pieces: 8 })]);
  const returned: ReturnedEmptyLine[] = [
    { returnable_id: 1, packaging_asset_id: 10, packaging_name: 'Casier 24', pieces: 10 },
  ];

  const warnings = surplusWarning(returned, dues);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2 en trop/);
  assert.match(warnings[0], /10 Casier 24 rapportés, 8 dus/);
});

test('rapporter des vides sans aucune dette avertit intégralement', () => {
  const returned: ReturnedEmptyLine[] = [
    { returnable_id: 1, packaging_asset_id: 10, packaging_name: 'Casier 24', pieces: 4 },
  ];

  const warnings = surplusWarning(returned, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /4 en trop/);
});

test('une ligne à zéro ne produit pas d\'avertissement', () => {
  const returned: ReturnedEmptyLine[] = [
    { returnable_id: 1, packaging_asset_id: 10, packaging_name: 'Casier 24', pieces: 0 },
  ];

  assert.deepEqual(surplusWarning(returned, []), []);
});
