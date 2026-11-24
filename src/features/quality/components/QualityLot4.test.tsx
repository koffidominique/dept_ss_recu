import '../../../test/setupDom.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { CloseCashModal } from '../../cash/components/CloseCashModal.tsx';
import { InventoryCountModal } from '../../inventory/components/InventoryCountModal.tsx';
import { LocalDbStatusCard } from '../../backups/components/LocalDbStatusCard.tsx';
import type { InventoryRecord } from '../../inventory/types.ts';
import type { LocalDbStatus } from '../../../types/erp.ts';

async function flushAnimations(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
}

test('CloseCashModal : fermer une clôture en cours de saisie exige une confirmation explicite', async () => {
  cleanup();

  let closed = 0;
  render(
    <CloseCashModal
      open
      onOpenChange={(next) => {
        if (!next) closed += 1;
      }}
      sessionReference="CAI-2026-0042"
      theoreticalCash={100_000}
      digitalNet={0}
      error={null}
      isPending={false}
      onSubmit={() => {}}
    />
  );

  // Aucune saisie : fermer est direct.
  const closeBtn = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Fermer la fenêtre"]'
  );
  assert.ok(closeBtn, 'Le bouton de fermeture du dialogue doit être accessible par son libellé');
  fireEvent.click(closeBtn);
  assert.equal(closed, 1);
  cleanup();
  await flushAnimations();
});

test('CloseCashModal : une saisie modifiée déclenche l’avertissement de perte avant fermeture', async () => {
  cleanup();

  let closed = 0;
  render(
    <CloseCashModal
      open
      onOpenChange={(next) => {
        if (!next) closed += 1;
      }}
      sessionReference="CAI-2026-0043"
      theoreticalCash={100_000}
      digitalNet={0}
      error={null}
      isPending={false}
      onSubmit={() => {}}
    />
  );

  const physInput = document.body.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
  assert.ok(physInput);
  fireEvent.change(physInput, { target: { value: '90000' } });

  const closeBtn = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Fermer la fenêtre"]'
  );
  assert.ok(closeBtn);
  fireEvent.click(closeBtn);

  // La modale ne s'est pas encore fermée : un dialogue de confirmation apparaît.
  assert.equal(closed, 0, 'La fermeture doit être interceptée');

  await waitFor(() => {
    const text = document.body.textContent ?? '';
    assert.match(text, /Fermer sans enregistrer la clôture/);
    assert.match(text, /perdra définitivement/);
    assert.match(text, /Aucune écriture de clôture ne sera transmise/);
  });

  // « Continuer la clôture » annule la fermeture
  const cancelBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Continuer la clôture')
  );
  assert.ok(cancelBtn);
  fireEvent.click(cancelBtn);
  assert.equal(closed, 0);

  cleanup();
  await flushAnimations();
});

test('InventoryCountModal : fermer un comptage avec motifs saisis n’efface rien sans confirmation', async () => {
  cleanup();

  const inv: InventoryRecord = {
    id: 12,
    reference: 'INV-2026-0012',
    status: 'draft',
    notes: null,
    created_at: '2026-11-23T08:00:00Z',
    validated_at: null,
    lines: [
      {
        id: 1,
        product_id: 900,
        product_name: 'Castel 65cl',
        product_reference: 'PRD-900',
        base_unit: 'btl',
        theoretical_milli: 10_000,
        counted_milli: 8_000,
        reason: null,
      },
    ],
  };

  let closed = 0;
  render(
    <InventoryCountModal
      inventory={inv}
      onClose={() => {
        closed += 1;
      }}
      errorMsg={null}
      isPending={false}
      onValidate={() => {}}
    />
  );

  // Saisir un motif sur l'écart => la fermeture doit être interceptée.
  const reasonInput = document.body.querySelector<HTMLInputElement>(
    'input[placeholder*="Casse"]'
  );
  assert.ok(reasonInput, 'Le champ motif doit être présent');
  fireEvent.change(reasonInput, { target: { value: '2 bouteilles cassées au rayon' } });

  const closeBtn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Fermer'
  );
  assert.ok(closeBtn);
  fireEvent.click(closeBtn);
  assert.equal(closed, 0, 'La fiche ne doit pas se fermer silencieusement');

  await waitFor(() => {
    const text = document.body.textContent ?? '';
    assert.match(text, /Fermer sans valider l’inventaire/);
    assert.match(text, /reste en brouillon/);
  });

  // Confirmer la fermeture perd bien la saisie, mais de façon explicite.
  const confirmLeave = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Fermer et perdre les saisies')
  );
  assert.ok(confirmLeave);
  fireEvent.click(confirmLeave);
  assert.equal(closed, 1);

  cleanup();
  await flushAnimations();
});

test('LocalDbStatusCard : affiche la fraîcheur réelle de la sauvegarde', async () => {
  cleanup();

  const baseStatus: LocalDbStatus = {
    dbPath: '/var/depotpro/depot.db',
    backupDir: '/var/depotpro/backups',
    dbSizeBytes: 1024 * 1024,
    walSizeBytes: 4096,
    schemaVersion: 5,
    journalMode: 'wal',
    integrity: 'ok',
    foreignKeyErrors: 0,
    backupCount: 4,
    lastBackupAt: null,
  };

  render(
    <LocalDbStatusCard status={baseStatus} isFetching={false} onRefreshIntegrity={() => {}} />
  );
  assert.match(document.body.textContent ?? '', /Aucune sauvegarde/);
  cleanup();

  const fresh = new Date(Date.now() - 3_600_000).toISOString();
  render(
    <LocalDbStatusCard
      status={{ ...baseStatus, lastBackupAt: fresh }}
      isFetching={false}
      onRefreshIntegrity={() => {}}
    />
  );
  assert.match(document.body.textContent ?? '', /Sauvegarde du jour/);
  assert.match(document.body.textContent ?? '', /créée aujourd’hui/);
  cleanup();

  const stale = new Date(Date.now() - 20 * 86_400_000).toISOString();
  render(
    <LocalDbStatusCard
      status={{ ...baseStatus, lastBackupAt: stale }}
      isFetching={false}
      onRefreshIntegrity={() => {}}
    />
  );
  const staleText = document.body.textContent ?? '';
  assert.match(staleText, /Sauvegarde critique/);
  assert.match(staleText, /perte de 20 jours d’activité/);

  cleanup();
  await flushAnimations();
});
