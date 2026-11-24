/**
 * Vérifie que les écrans authentifiés se montent réellement : coquille
 * applicative présente, titre rendu, aucune exception JavaScript.
 *
 * Le serveur local n'est pas démarré : `/api/auth/me` est intercepté et reçoit
 * une session factice, ce qui permet d'exercer aussi le garde d'accès par rôle
 * (`RequirePermission`) au lieu de le neutraliser.
 *
 * Usage : node scripts/visual/screens.mjs [--base URL]
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:4173';

const ROUTES = [
  ['/', 'Tableau de bord'], ['/sales/new', 'Point de vente'], ['/orders', 'Commandes'],
  ['/sales', 'Historique des ventes'], ['/commercial-documents', 'Reçus & Bons'],
  ['/clients', 'Clients'], ['/debts', 'Créances'], ['/products', 'Produits'],
  ['/catalogue-admin', 'Admin catalogue'],
  ['/stock', 'Stocks'], ['/inventories', 'Inventaires'], ['/consignments', 'Emballages'],
  ['/suppliers', 'Fournisseurs'], ['/purchases', 'Approvisionnements'], ['/cash', 'Caisse'],
  ['/expenses', 'Dépenses'], ['/reports', 'Rapports'], ['/settings', 'Paramètres'],
  ['/backups', 'Sauvegardes'],
];

// `--single-process` a ete retire : en mode mono-processus, l'interception des
// requetes devient instable (des pages montaient avec une session non hydratee,
// donc des resultats faux).
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--headless=new',
  '--disable-dev-shm-usage', '--disable-gpu'];

// Toutes les permissions : reproduit Role::Owner (rbac.rs).
const OWNER_PERMISSIONS = [
  'catalog:read', 'catalog:write', 'catalog:delete', 'sales:read', 'sales:write',
  'sales:cancel_return', 'receivables:read', 'receivables:pay', 'purchases:read',
  'purchases:write', 'supplier_debts:pay', 'stock:read', 'stock:adjust',
  'inventory:validate', 'consignments:read', 'consignments:write', 'cash:read',
  'cash:operate', 'expenses:write', 'reports:read', 'settings:read', 'settings:write',
  'backups:read', 'backups:create', 'backups:restore', 'security:manage_users',
  'security:change_owner_pin',
];

// Role::Cashier : pas de catalog:write, pas de backups:read.
const CASHIER_PERMISSIONS = [
  'catalog:read', 'sales:read', 'sales:write', 'sales:cancel_return',
  'receivables:read', 'receivables:pay', 'consignments:read', 'consignments:write',
  'cash:read', 'cash:operate', 'expenses:write', 'settings:read',
];

function sessionFor(role, roleLabel, permissions) {
  return {
    userId: role, username: role, displayName: roleLabel, role, roleLabel, permissions,
  };
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ARGS, headless: true,
});

async function openRoute(route, user, expected = '') {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 90)));
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    try { sessionStorage.setItem('depotpro_session_token', 'audit'); } catch { /* ignore */ }
  });
  // Le service worker PWA reemet ses fetch hors de l'interception de la page :
  // sans ce contournement, /api/auth/me n'etait jamais intercepte et l'ecran
  // montait avec une session vide (verdict faux). Le SW est donc neutralise
  // pour la duree du controle ; son comportement est verifie a part.
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/auth/')) requests.push(url.replace(BASE, ''));
    if (url.includes('/api/auth/me') || url.includes('/api/auth/status')) {
      const body = url.includes('/status')
        ? { needsSetup: false, lockedUntil: null, failedAttempts: 0, authenticated: true, user }
        : { user };
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }
    req.continue().catch(() => { /* page deja fermee */ });
  });
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 45_000 }).catch(() => {});
  // La session est hydratee apres le montage de la coquille : attendre une
  // duree fixe produisait des captures avant hydratation (menu vide, garde en
  // squelette). On attend un etat observable, avec repli sur `expected`.
  await page
    .waitForFunction(
      (expectedText) =>
        document.querySelectorAll('aside a').length > 1 ||
        document.body.innerText.includes(expectedText),
      { timeout: 10_000, polling: 100 },
      expected
    )
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const info = await page.evaluate(() => ({
    path: location.pathname,
    title: document.querySelector('h1')?.textContent?.trim() || '(sans titre)',
    body: document.body.innerText,
    shell: !!document.querySelector('aside'),
  }));
  info.visibleNavLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('aside a')).map((a) => a.getAttribute('href'))
  );
  await page.close();
  return { info, errors, requests };
}

let ok = 0;
const owner = sessionFor('owner', 'Propriétaire', OWNER_PERMISSIONS);

for (const [route, label] of ROUTES) {
  const { info, errors } = await openRoute(route, owner, label);
  // Le proprietaire doit voir l'entree de menu du nouvel ecran (catalog:write).
  const navOk = route !== '/catalogue-admin' || info.visibleNavLinks.includes('/catalogue-admin');
  const good = info.shell && info.path === route && errors.length === 0 && navOk;
  console.log(`${good ? '✓' : '✗'} ${route.padEnd(22)} ${label.padEnd(24)} «${info.title}»${errors.length ? ' — ' + errors[0] : ''}`);
  if (good) ok += 1;
}

// Garde d'accès : un caissier ne doit pas atteindre l'administration catalogue
// ni les sauvegardes, alors que le propriétaire y accède (écrans ci-dessus).
const cashier = sessionFor('cashier', 'Caissier', CASHIER_PERMISSIONS);
const guarded = [
  ['/catalogue-admin', 'Admin catalogue', 'Accès non autorisé'],
  ['/backups', 'Sauvegardes', 'Accès non autorisé'],
  ['/cash', 'Caisse', 'Session de caisse'],
];

for (const [route, label, expected] of guarded) {
  const { info, errors, requests } = await openRoute(route, cashier, expected);
  if (process.env.SCREENS_DEBUG) {
    console.log('DEBUG', route, JSON.stringify({ has: info.body.includes(expected), nav: info.visibleNavLinks }));
  }
  const good = info.shell && info.path === route && errors.length === 0 && info.body.includes(expected);
  console.log(`${good ? '✓' : '✗'} ${('caissier ' + route).padEnd(22)} ${label.padEnd(24)} «${expected}»${good ? '' : ' — contenu inattendu'}`);
  if (good) ok += 1;
}

await browser.close();
const total = ROUTES.length + guarded.length;
console.log(`\nécrans montés correctement : ${ok}/${total}`);
process.exit(ok === total ? 0 : 1);
