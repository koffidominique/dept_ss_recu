import '../../../test/setupDom.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { apiClient } from '../../../services/api/createApiClient.ts';
import { ConfirmationDialog } from '../../../components/common/ConfirmationDialog.tsx';
import { LocalDbStatusCard } from '../../backups/components/LocalDbStatusCard.tsx';
import { BackupPassphraseModal } from '../../backups/components/BackupPassphraseModal.tsx';
import { OfflineWorkBanner } from '../../dashboard/components/WorkQueuePanel.tsx';
import { LoginPage } from '../../../pages/LoginPage.tsx';
import { SettingsPage } from '../../../pages/SettingsPage.tsx';
import { ProductsPage } from '../../../pages/ProductsPage.tsx';
import { ClientsPage } from '../../../pages/ClientsPage.tsx';
import { DebtsPage } from '../../../pages/DebtsPage.tsx';
import { StockPage } from '../../../pages/StockPage.tsx';
import { CashPage } from '../../../pages/CashPage.tsx';
import { SuppliersPage } from '../../../pages/SuppliersPage.tsx';
import { ExpensesPage } from '../../../pages/ExpensesPage.tsx';
import { PurchasesPage } from '../../../pages/PurchasesPage.tsx';
import { ConsignmentsPage } from '../../../pages/ConsignmentsPage.tsx';
import { CommercialDocumentsPage } from '../../../pages/CommercialDocumentsPage.tsx';
import { InventoryPage } from '../../../pages/InventoryPage.tsx';
import { OrdersPage } from '../../../pages/OrdersPage.tsx';
import { SalesHistoryPage } from '../../../pages/SalesHistoryPage.tsx';
import { ReportsPage } from '../../../pages/ReportsPage.tsx';
import { BackupsPage } from '../../../pages/BackupsPage.tsx';
import { SalesPage } from '../../../pages/SalesPage.tsx';
import { DashboardPage } from '../../../pages/DashboardPage.tsx';

/**
 * LOT 5 — PHASE 5 · Audit d'accessibilité automatisé (axe-core).
 *
 * Les tests E2E Playwright sont indisponibles ici (téléchargement de navigateur
 * bloqué par le réseau). Cet audit exécute axe-core **réellement** contre les
 * composants de production, rendus dans happy-dom, avec un client API neutralisé.
 *
 * Limite déclarée : happy-dom n'applique pas les feuilles de style, donc la règle
 * `color-contrast` est toujours « incomplete » — le contraste reste à vérifier
 * manuellement. Les règles structurelles (noms accessibles, rôles ARIA, libellés,
 * ordre des titres, association en-tête/cellule) sont, elles, pleinement évaluées.
 */

// Neutralise les appels réseau : rejet immédiat, donc état d'erreur stable
// (aucun retry infini, aucune attente de promesse non résolue).
const failFast = () => Promise.reject(new Error('API neutralisée pour l’audit a11y'));
Object.assign(
  apiClient as unknown as Record<string, unknown>,
  new Proxy({}, { get: () => failFast })
);

const axe = (await import('axe-core')).default;

const AXE_OPTIONS = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  resultTypes: ['violations' as const],
};

const settle = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms));

async function runAxe(name: string, ui: ReactElement): Promise<void> {
  cleanup();
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
  await settle();

  // Les « focus guards » de Radix sont des `<span tabindex="0" aria-hidden>` posés
  // par la bibliothèque aux extrémités du <body> pour piéger le focus. `aria-hidden`
  // les marque ensuite comme masqués, ce qui déclenche `aria-hidden-focus` dans axe
  // alors qu'ils ne sont ni du contenu applicatif ni perceptibles. On les exclut du
  // périmètre d'analyse par le mécanisme d'exclusion d'axe : rien de ce que nous
  // avons écrit n'est exclu.
  const results = await axe.run(
    { include: [document.body], exclude: [['[data-radix-focus-guard]']] },
    AXE_OPTIONS
  );
  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => ({
      target: n.target.join(' '),
      summary: (n.failureSummary ?? '').split('\n').slice(0, 2).join(' '),
    })),
  }));

  cleanup();
  await settle(60);

  if (violations.length > 0) {
    const detail = violations
      .map(
        (v) =>
          `\n  ✗ ${v.id} (${v.impact}) ×${v.nodes.length}\n` +
          v.nodes
            .slice(0, 5)
            .map((n) => `      ${n.target}\n        ${n.summary}`)
            .join('\n')
      )
      .join('');
    assert.fail(`Violations WCAG 2.1 AA sur « ${name} »${detail}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cas : composants partagés utilisés transversalement sur tous les écrans     */
/* -------------------------------------------------------------------------- */

interface Case {
  name: string;
  ui: () => ReactElement;
}

const CASES: Case[] = [
  {
    name: 'Dialogue de confirmation destructif',
    ui: () => (
      <ConfirmationDialog
        open
        onOpenChange={() => {}}
        title="Restaurer cette sauvegarde ?"
        description="La base active sera remplacée par la sauvegarde choisie."
        consequences={[
          'Une sauvegarde de sécurité est créée avant le remplacement.',
          'Un redémarrage de l’application est conseillé.',
        ]}
        confirmLabel="Restaurer"
        destructive
        onConfirm={() => {}}
      />
    ),
  },
  {
    name: 'Bandeau « poste hors ligne »',
    ui: () => (
      <OfflineWorkBanner
        isOnline={false}
        offlineSince={new Date('2026-11-23T08:15:00Z')}
        serverState="offline"
      />
    ),
  },
  {
    name: 'Bandeau « serveur local injoignable »',
    ui: () => (
      <OfflineWorkBanner
        isOnline={false}
        offlineSince={new Date('2026-11-23T08:15:00Z')}
        serverState="server-unreachable"
      />
    ),
  },
  {
    name: 'Carte d’état de la base locale (sauvegarde critique)',
    ui: () => (
      <LocalDbStatusCard
        status={{
          dbPath: '/var/depotpro/depot.db',
          backupDir: '/var/depotpro/backups',
          dbSizeBytes: 4_194_304,
          walSizeBytes: 8192,
          schemaVersion: 6,
          journalMode: 'wal',
          integrity: 'ok',
          foreignKeyErrors: 0,
          backupCount: 3,
          lastBackupAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        }}
        isFetching={false}
        onRefreshIntegrity={() => {}}
      />
    ),
  },
  {
    name: 'Modale de phrase secrète de sauvegarde',
    ui: () => (
      <BackupPassphraseModal
        action={{ mode: 'restore', name: 'depot_2026-11-20.db' }}
        passphrase=""
        onChangePassphrase={() => {}}
        onClose={() => {}}
        isBusy={false}
        onSubmit={() => {}}
      />
    ),
  },
  /* --- Écrans complets : états vides / chargement (API neutralisée) ------- */
  { name: 'Page · Connexion', ui: () => <LoginPage /> },
  { name: 'Page · Paramètres', ui: () => <SettingsPage /> },
  { name: 'Page · Produits', ui: () => <ProductsPage /> },
  { name: 'Page · Clients', ui: () => <ClientsPage /> },
  { name: 'Page · Dettes', ui: () => <DebtsPage /> },
  { name: 'Page · Stock', ui: () => <StockPage /> },
  { name: 'Page · Caisse', ui: () => <CashPage /> },
  { name: 'Page · Fournisseurs', ui: () => <SuppliersPage /> },
  { name: 'Page · Dépenses', ui: () => <ExpensesPage /> },
  { name: 'Page · Achats', ui: () => <PurchasesPage /> },
  { name: 'Page · Consignations', ui: () => <ConsignmentsPage /> },
  { name: 'Page · Documents commerciaux', ui: () => <CommercialDocumentsPage /> },
  { name: 'Page · Inventaires', ui: () => <InventoryPage /> },
  { name: 'Page · Commandes', ui: () => <OrdersPage /> },
  { name: 'Page · Historique des ventes', ui: () => <SalesHistoryPage /> },
  { name: 'Page · Rapports', ui: () => <ReportsPage /> },
  { name: 'Page · Sauvegardes', ui: () => <BackupsPage /> },
  { name: 'Page · Point de vente (caisse)', ui: () => <SalesPage /> },
  { name: 'Page · Tableau de bord', ui: () => <DashboardPage /> },
];

for (const c of CASES) {
  test(`axe · ${c.name}`, async () => {
    await runAxe(c.name, c.ui());
  });
}
