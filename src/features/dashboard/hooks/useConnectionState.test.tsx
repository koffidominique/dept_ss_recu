import '../../../test/setupDom.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../services/api/ApiClient.ts';
import { useConnectionState, type ConnectionState } from './useConnectionState.ts';

/**
 * LOT 6 · Vérification des gestionnaires d'état.
 *
 * `useConnectionState` est le seul hook qui décide si l'interface affirme
 * « en ligne ». Une erreur ici produit soit une fausse confirmation, soit un
 * bandeau fantôme. Ces tests couvrent les transitions réelles :
 * succès → panne → reprise, et l'invalidation des requêtes en échec.
 */

const settle = (ms = 90) => new Promise<void>((r) => setTimeout(r, ms));

function Probe({ onRender }: { onRender: (s: ConnectionState) => void }) {
  const state = useConnectionState();
  onRender(state);
  return null;
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  let latest: ConnectionState | null = null;
  const { unmount } = render(
    <QueryClientProvider client={qc}>
      <Probe onRender={(s) => (latest = s)} />
    </QueryClientProvider>
  );
  return { qc, get: () => latest as ConnectionState, unmount };
}

test('sans aucun appel API, l’état est « serveur injoignable » (jamais « en ligne » par défaut)', async () => {
  cleanup();
  const { get, unmount } = setup();
  await settle();

  const s = get();
  assert.equal(s.isOnline, false, 'Aucune preuve de vie → never « en ligne »');
  assert.equal(s.serverState, 'server-unreachable');
  assert.ok(s.message, 'Un message explicatif doit être fourni');
  assert.match(s.message.title, /Serveur local injoignable/);
  assert.match(s.message.detail, /aucune écriture n’est validée/i);

  unmount();
  await settle();
});

test('un succès API fait passer en ligne, puis une panne réseau rebascule', async () => {
  cleanup();
  const { qc, get, unmount } = setup();

  // 1) succès → en ligne
  await qc.fetchQuery({
    queryKey: ['probe-success'],
    queryFn: () => Promise.resolve({ ok: true }),
  });
  await settle();
  assert.equal(get().serverState, 'online');
  assert.equal(get().isOnline, true);
  assert.equal(get().message, null, 'Aucun message quand tout va bien');

  // 2) panne réseau → serveur injoignable
  await qc
    .fetchQuery({
      queryKey: ['probe-failure'],
      queryFn: () => Promise.reject(new ApiError('NETWORK_ERROR', 'serveur muet', 0)),
    })
    .catch(() => {});
  await settle();
  assert.equal(get().serverState, 'server-unreachable');
  assert.equal(get().isOnline, false);
  assert.ok(get().offlineSince, 'L’instant de la panne est mémorisé');
  assert.match(get().message!.title, /Serveur local injoignable/);

  unmount();
  await settle();
});

test('une erreur métier ne fait pas croire à une panne serveur', async () => {
  cleanup();
  const { qc, get, unmount } = setup();

  await qc.fetchQuery({
    queryKey: ['probe-ok'],
    queryFn: () => Promise.resolve({ ok: true }),
  });
  await settle();
  assert.equal(get().serverState, 'online');

  // Le serveur est vivant : il a répondu « 422 validation refusée ».
  await qc
    .fetchQuery({
      queryKey: ['probe-metric'],
      queryFn: () => Promise.reject(new ApiError('VALIDATION_ERROR', 'montant invalide', 422)),
    })
    .catch(() => {});
  await settle();
  assert.equal(
    get().serverState,
    'online',
    'Une erreur métier prouve au contraire que le serveur répond'
  );

  unmount();
  await settle();
});

test('le retour du réseau déclenche le rejeu des requêtes en échec', async () => {
  cleanup();
  const { qc, get, unmount } = setup();

  let attempts = 0;
  // Requête **active** (montée par un composant, comme une vraie page) qui
  // échoue d'abord puis réussit : on simule un serveur local qui redémarre
  // pendant que l'écran reste ouvert.
  function ActiveQuery() {
    useQuery({
      queryKey: ['resume-probe'],
      queryFn: () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new ApiError('NETWORK_ERROR', 'muet', 0));
        return Promise.resolve('vivant');
      },
      retry: false,
    });
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <ActiveQuery />
    </QueryClientProvider>
  );
  await settle(150);
  assert.equal(qc.getQueryState(['resume-probe'])?.status, 'error');
  assert.equal(get().serverState, 'server-unreachable');

  // Le navigateur signale le retour du réseau → le hook doit rejouer la requête.
  window.dispatchEvent(new Event('online'));
  await settle(150);

  assert.ok(attempts >= 2, `La requête doit être rejouée (tentatives : ${attempts})`);
  assert.equal(qc.getQueryState(['resume-probe'])?.status, 'success');
  assert.equal(get().serverState, 'online', 'Le bandeau doit disparaître sans action utilisateur');

  unmount();
  await settle();
});
