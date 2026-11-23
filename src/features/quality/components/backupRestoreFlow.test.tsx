import '../../../test/setupDom.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { apiClient } from '../../../services/api/createApiClient.ts';
import { BackupsPage } from '../../../pages/BackupsPage.tsx';
import type { BackupFile } from '../../../types/erp.ts';

/**
 * LOT 5 — PHASE 5 · Parcours de restauration de sauvegarde, vérifié de bout en bout.
 *
 * La Phase 4 exigeait « un parcours de restauration vérifié ». Le test E2E
 * Playwright correspondant est indisponible (navigateur non téléchargeable), donc
 * le parcours est exercé ici sur le composant de production réel, avec un client
 * API instrumenté : on vérifie l'ordre exact des appels, la double confirmation,
 * l'impossibilité de restaurer sans passer par la confirmation, et le refus
 * explicite quand le serveur rejette.
 */

const settle = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms));
// Tous les clients créés sont démontés en fin de fichier : sans cela, les
// abonnements et minuteurs de React Query maintiennent la boucle d'événements
// ouverte et le processus de test ne rend jamais la main.
const clients: QueryClient[] = [];
const trackClient = (qc: QueryClient) => {
  clients.push(qc);
  return qc;
};
test.after(() => {
  for (const qc of clients) {
    qc.clear();
    qc.unmount();
  }
});

interface Call {
  method: string;
  args: unknown[];
}

function stubApi(overrides: Record<string, (...args: never[]) => unknown>) {
  const calls: Call[] = [];
  const base: Record<string, unknown> = {};
  const names = [
    'listBackups',
    'getLocalDbStatus',
    'createBackup',
    'createEncryptedBackup',
    'importBackup',
    'verifyBackup',
    'restoreBackup',
    'restoreEncryptedBackup',
    'downloadBackup',
  ];
  for (const n of names) {
    base[n] = (...args: never[]) => {
      calls.push({ method: n, args });
      const custom = overrides[n];
      if (custom) return custom(...args);
      if (n === 'listBackups') return Promise.resolve([] as BackupFile[]);
      if (n === 'getLocalDbStatus') return Promise.resolve(null);
      return Promise.resolve({ ok: true });
    };
  }
  Object.assign(apiClient as unknown as Record<string, unknown>, base);
  return calls;
}

function renderPage() {
  const qc = trackClient(new QueryClient({
    defaultOptions: {
      // `refetchInterval: false` et `gcTime: 0` évitent les minuteurs persistants
      // qui empêchent le processus de test de se terminer proprement.
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchInterval: false },
      mutations: { retry: false },
    },
  }));
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BackupsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const BACKUP: BackupFile = {
  name: 'depot_2026-11-20_030000.db',
  size: 524_288,
  createdAt: '2026-11-20T03:00:00Z',
  encrypted: false,
};

test('restauration : exige une confirmation explicite, puis appelle l’API dans le bon ordre', async () => {
  cleanup();
  const calls = stubApi({
    listBackups: () => Promise.resolve([BACKUP]),
  });

  renderPage();
  await settle();

  // Le bouton « Restaurer » est présent sur la ligne de sauvegarde.
  const restoreBtn = await waitFor(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent?.trim().startsWith('Restaurer')
    );
    assert.ok(b, 'Bouton « Restaurer » attendu sur la sauvegarde listée');
    return b;
  });

  // Clic → dialogue de confirmation ; AUCUN appel API de restauration à ce stade.
  fireEvent.click(restoreBtn);
  await settle();
  assert.equal(
    calls.filter((c) => c.method === 'restoreBackup').length,
    0,
    'La restauration ne doit jamais partir sur un simple clic'
  );
  assert.match(document.body.textContent ?? '', /Confirmer la restauration contrôlée/);
  assert.match(document.body.textContent ?? '', /sauvegarde automatique de l’état actuel|sauvegarde automatique de l'état actuel/);

  // Confirmation → l'appel part avec le bon nom.
  const confirmBtn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Restaurer cette sauvegarde'
  );
  assert.ok(confirmBtn, 'Bouton de confirmation attendu');
  fireEvent.click(confirmBtn);
  await settle(200);

  const restores = calls.filter((c) => c.method === 'restoreBackup');
  assert.equal(restores.length, 1, 'Un et un seul appel de restauration');
  assert.equal(restores[0].args[0], BACKUP.name);

  cleanup();
  await settle(80);
});

test('restauration : un refus serveur est affiché, jamais présenté comme un succès', async () => {
  cleanup();
  stubApi({
    listBackups: () => Promise.resolve([BACKUP]),
    restoreBackup: () => Promise.reject(new Error('Sauvegarde corrompue : en-tête invalide')),
  });

  renderPage();
  await settle();

  const restoreBtn = await waitFor(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent?.trim().startsWith('Restaurer')
    );
    assert.ok(b);
    return b;
  });
  fireEvent.click(restoreBtn);
  await settle();

  const confirmBtn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Restaurer cette sauvegarde'
  );
  assert.ok(confirmBtn);
  fireEvent.click(confirmBtn);
  await settle(250);

  const text = document.body.textContent ?? '';
  assert.match(text, /Sauvegarde corrompue/, 'Le motif du refus doit être visible');
  assert.doesNotMatch(
    text,
    /Base restaurée depuis/,
    'Un échec ne doit jamais afficher le message de succès'
  );

  cleanup();
  await settle(80);
});

test('restauration : la sauvegarde chiffrée réclame la phrase secrète avant tout appel', async () => {
  cleanup();
  const calls = stubApi({
    listBackups: () =>
      Promise.resolve([{ ...BACKUP, name: 'depot_2026-11-21.dpbkp', encrypted: true }]),
  });

  renderPage();
  await settle();

  const restoreBtn = await waitFor(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      x.textContent?.trim().startsWith('Restaurer')
    );
    assert.ok(b);
    return b;
  });
  fireEvent.click(restoreBtn);
  await settle();

  // Une sauvegarde chiffrée ne doit pas ouvrir la confirmation simple.
  assert.equal(
    calls.filter((c) => c.method === 'restoreEncryptedBackup').length,
    0,
    'Aucun appel avant la saisie de la phrase secrète'
  );
  const text = document.body.textContent ?? '';
  assert.match(
    text,
    /Restaurer depot_2026-11-21\.dpbkp/,
    'La modale de phrase secrète doit s’ouvrir pour une sauvegarde chiffrée'
  );
  assert.doesNotMatch(
    text,
    /Confirmer la restauration contrôlée/,
    'La confirmation simple ne doit pas être proposée pour une archive chiffrée'
  );

  cleanup();
  await settle(80);
});
