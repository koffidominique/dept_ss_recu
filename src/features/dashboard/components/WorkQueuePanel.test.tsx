import '../../../test/setupDom.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render } from '@testing-library/react';
import {
  KpiScopeNote,
  OfflineWorkBanner,
  WorkQueuePanel,
} from './WorkQueuePanel.tsx';
import { summarizeWorkQueue, type WorkQueueItem } from '../utils/workQueue.ts';

async function flushAnimations(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 60));
}

const ITEMS: WorkQueueItem[] = [
  {
    id: 'cash-closed',
    category: 'cash',
    severity: 'critical',
    title: 'Ouvrez une session de caisse',
    detail: 'Caisse fermée : aucune vente au comptant ne peut être enregistrée.',
    actionLabel: 'Ouvrir la caisse',
    to: '/cash',
    priority: 5,
  },
  {
    id: 'stock-low',
    category: 'stock',
    severity: 'warning',
    title: 'Anticipez les stocks sous seuil',
    detail: '7 produit(s) ont atteint leur seuil minimum configuré.',
    actionLabel: 'Voir les seuils',
    to: '/stock?alerte=seuil',
    count: 7,
    priority: 40,
  },
];

test('WorkQueuePanel affiche chaque action avec son lien direct et son niveau de gravité', async () => {
  cleanup();
  render(
    <MemoryRouter>
      <WorkQueuePanel
        items={ITEMS}
        summary={summarizeWorkQueue(ITEMS)}
        degradedSources={[]}
        isLoading={false}
        isFetching={false}
        onRefresh={() => {}}
      />
    </MemoryRouter>
  );

  const text = document.body.textContent ?? '';
  assert.match(text, /File de travail du jour/);
  assert.match(text, /Ouvrez une session de caisse/);
  assert.match(text, /Bloquant/, 'Le niveau bloquant doit être lisible sans dépendre de la couleur');
  assert.match(text, /À traiter/);
  assert.match(text, /7 éléments/);

  const links = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  assert.ok(links.includes('/cash'));
  assert.ok(links.includes('/stock?alerte=seuil'));

  // Le titre est bien relié à la section (accessibilité)
  assert.equal(document.querySelector('section')?.getAttribute('aria-labelledby'), 'work-queue-heading');

  cleanup();
  await flushAnimations();
});

test('WorkQueuePanel annonce explicitement une file partielle quand une source échoue', async () => {
  cleanup();
  render(
    <MemoryRouter>
      <WorkQueuePanel
        items={[]}
        summary={summarizeWorkQueue([])}
        degradedSources={['sauvegardes', 'consignations']}
        isLoading={false}
        isFetching={false}
        onRefresh={() => {}}
      />
    </MemoryRouter>
  );

  const alert = document.body.querySelector('[role="status"]');
  assert.ok(alert, 'Un statut explicite doit être exposé');
  const alertText = alert.textContent ?? '';
  assert.match(alertText, /File partielle/);
  assert.match(alertText, /sauvegardes/);
  assert.match(alertText, /ne considérez pas cette liste comme complète/);

  // État vide : message positif, pas d'ambiguïté
  assert.match(document.body.textContent ?? '', /Rien à traiter pour le moment/);

  cleanup();
  await flushAnimations();
});

test('OfflineWorkBanner n’annonce jamais une réussite et disparaît en ligne', async () => {
  cleanup();
  const offlineSince = new Date('2026-11-23T08:15:00Z');
  render(<OfflineWorkBanner isOnline={false} offlineSince={offlineSince} />);

  const alert = document.body.querySelector('[role="alert"]');
  assert.ok(alert, 'Le bandeau hors ligne doit être une alerte accessible');
  const text = alert.textContent ?? '';
  assert.match(text, /Serveur local injoignable/);
  assert.match(text, /[Aa]ucune écriture n’est validée/);
  assert.doesNotMatch(text, /validée avec succès|enregistrée avec succès/);
  cleanup();

  // Lot 4 : le poste hors réseau et le serveur local arrêté ne disent pas la même chose.
  render(<OfflineWorkBanner isOnline={false} offlineSince={offlineSince} serverState="offline" />);
  const offlineText = document.body.querySelector('[role="alert"]')?.textContent ?? '';
  assert.match(offlineText, /Poste hors ligne/);
  assert.match(offlineText, /connexion réseau de ce poste/);
  cleanup();

  render(
    <OfflineWorkBanner
      isOnline={false}
      offlineSince={offlineSince}
      serverState="server-unreachable"
    />
  );
  const unreachableText = document.body.querySelector('[role="alert"]')?.textContent ?? '';
  assert.match(unreachableText, /Serveur local injoignable/);
  assert.match(unreachableText, /processus arrêté ou port fermé/);
  cleanup();

  render(<OfflineWorkBanner isOnline offlineSince={null} />);
  assert.equal(document.body.querySelector('[role="alert"]'), null);

  cleanup();
  await flushAnimations();
});

test('KpiScopeNote clarifie la portée des montants (cumul vs encours vs mois)', async () => {
  cleanup();
  render(<KpiScopeNote />);
  const text = document.body.textContent ?? '';
  assert.match(text, /cumuls depuis l’origine/);
  assert.match(text, /encours à date/);
  assert.match(text, /mois en cours/);
  cleanup();
  await flushAnimations();
});
