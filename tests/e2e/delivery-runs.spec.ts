import { test, expect, type Page } from '@playwright/test';

/**
 * Scénario 8 — Parcours complet d'une tournée de livraison.
 *
 * Ce que ce scénario couvre, et qu'aucun test existant ne couvrait :
 * créer → ajouter des arrêts → charger (l'attendu se fige) → départ →
 * constat → déclaration d'encaissement → retour de tournée → réconciliation.
 *
 * Les Lots 16 à 19 ont été validés séparément : des tests HTTP pour les
 * routes, des tests unitaires pour la logique d'écran, des tests Rust pour le
 * cœur. Aucune de ces couches ne prouve que le parcours tient debout de bout
 * en bout — c'est exactement ce qui a laissé passer les trois divergences de
 * permissions corrigées au Lot 18.
 *
 * L'amorçage passe par l'API (comptes, clients, commandes) ; tout ce qui doit
 * être prouvé passe par l'interface.
 */

function trackRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function enterPinDigits(page: Page, pin: string) {
  for (const d of pin) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
}

async function loginAs(page: Page, pin: string, username?: string) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Déverrouiller' })).toBeVisible();
  if (username) {
    await page.getByLabel(/Identifiant/i).fill(username);
  }
  await enterPinDigits(page, pin);
  await page.getByRole('button', { name: 'Déverrouiller' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe('DEPOTPRO — Tournées de livraison, parcours complet', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Ne pas dépendre de l'ordre des fichiers.
   *
   * Le PIN propriétaire est configuré par le Scénario 1 de `app.spec.ts` —
   * mais rien ne garantit qu'il s'exécute avant ce fichier : Playwright
   * ordonne les fichiers comme il l'entend, et la CI a déjà fait échouer ce
   * scénario à la connexion, sur un écran « Créer votre PIN propriétaire ».
   *
   * On l'amorce donc ici. L'appel est idempotent par nature : si le PIN existe
   * déjà, le serveur répond « déjà configuré » et on continue.
   */
  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: 'http://127.0.0.1:3100',
    });
    const res = await ctx.post('/api/auth/setup', { data: { pin: '123456' } });
    if (!res.ok()) {
      const body = (await res.json()) as { message?: string };
      if (!/déjà configuré/i.test(body.message ?? '')) {
        throw new Error(`Amorçage du PIN impossible : ${JSON.stringify(body)}`);
      }
    }
    await ctx.dispose();
  });

  test('Scénario 8 — Parcours complet d’une tournée', async ({ page }) => {
    const errors = trackRuntimeErrors(page);

    // --- Préparation : propriétaire -----------------------------------------
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, '123456');

    const loginRes = await page.request.post('/api/auth/login', { data: { pin: '123456' } });
    expect(loginRes.ok()).toBeTruthy();
    const { token } = (await loginRes.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    // Session de caisse ouverte : la réconciliation l'exige (« tout franc qui
    // entre passe par une session ouverte »). Idempotent si le Scénario 2 en a
    // déjà ouvert une.
    const openRes = await page.request.post('/api/cash/open', {
      headers: auth,
      data: { opening_cash: 1000, request_key: 'e2e-scenario8-open' },
    });
    if (!openRes.ok()) {
      expect((await openRes.json()).code).toBe('SESSION_ALREADY_OPEN');
    }

    // --- Un livreur, via l'écran Paramètres (le vrai chemin) -----------------
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Paramètres', level: 1 })).toBeVisible();
    await page.getByPlaceholder('Identifiant (ex: caisse1)').fill('chauffeur8');
    await page.getByPlaceholder('Nom affiché').fill('Chauffeur Livraison E2E');
    await page.getByLabel('Rôle du nouvel utilisateur').selectOption('driver');
    await page.getByPlaceholder('PIN 6 chiffres').fill('654321');
    await page.getByRole('button', { name: 'Ajouter un compte opérateur' }).click();
    await expect(page.getByText(/chauffeur8/i).first()).toBeVisible();

    const usersRes = await page.request.get('/api/auth/users', { headers: auth });
    expect(usersRes.ok()).toBeTruthy();
    const users = (await usersRes.json()) as Array<{ id: number; username: string }>;
    const driver = users.find((u) => u.username === 'chauffeur8');
    expect(driver, 'le livreur doit exister côté serveur').toBeTruthy();

    // --- Un client (amorçage API : la création de client est déjà couverte
    //     par le Scénario 6, on ne la refait pas ici) -------------------------
    const clientRes = await page.request.post('/api/clients', {
      headers: auth,
      data: {
        name: 'Maquis Tournée E2E',
        client_type: 'professionnel',
        // `credit_policy` n'a pas de défaut côté cœur : « Politique de crédit
        // explicite requise ». Un maquis de tournée paie comptant.
        credit_policy: 'forbidden',
      },
    });
    expect(clientRes.ok(), `création client : ${await clientRes.text()}`).toBeTruthy();
    const client = (await clientRes.json()) as { id: number; name: string };

    // --- L'écran des tournées est joignable --------------------------------
    await page.goto('/delivery-runs');
    await expect(
      page.getByRole('heading', { name: 'Tournées de livraison', level: 1 })
    ).toBeVisible();

    // --- Création ----------------------------------------------------------
    await page.getByRole('button', { name: 'Nouvelle tournée' }).click();
    const createDialog = page.getByRole('dialog');
    await expect(
      createDialog.getByRole('heading', { name: 'Nouvelle tournée', level: 2 })
    ).toBeVisible();
    await createDialog.getByLabel('Livreur *').selectOption(String(driver!.id));
    await createDialog.getByLabel('Véhicule').fill('Triporteur E2E');
    await createDialog.getByRole('button', { name: 'Créer la tournée' }).click();

    // On arrive directement sur le détail de la tournée créée.
    await expect(page.getByText(/TRN-/).first()).toBeVisible();
    await expect(page.getByText('Brouillon').first()).toBeVisible();

    // --- Un premier arrêt ---------------------------------------------------
    await page.getByRole('button', { name: 'Arrêt', exact: true }).click();
    const stopDialog = page.getByRole('dialog');
    await stopDialog.getByLabel('Client *').selectOption(String(client.id));
    // L'apostrophe de l'interface est typographique (’) : une expression
    // régulière évite de dépendre du caractère exact.
    await stopDialog.getByRole('button', { name: /Ajouter l.arrêt/ }).click();
    // La modale se ferme : c'est la preuve que l'arrêt est enregistré.
    await expect(stopDialog).toBeHidden();
    await expect(page.getByRole('cell', { name: 'Maquis Tournée E2E' })).toBeVisible();

    // --- Chargement ---------------------------------------------------------
    await page.getByRole('button', { name: 'Charger' }).click();
    await expect(page.getByText('Chargée').first()).toBeVisible();

    // --- Départ -------------------------------------------------------------
    await page.getByRole('button', { name: 'Départ' }).click();
    await expect(page.getByText('En tournée').first()).toBeVisible();

    // --- Constat : l'arrêt est livré ---------------------------------------
    await page.getByRole('button', { name: 'Constater' }).first().click();
    const outcomeDialog = page.getByRole('dialog');
    await expect(
      outcomeDialog.getByRole('heading', { name: /Constat d.arrêt/ })
    ).toBeVisible();
    await outcomeDialog.getByLabel('Résultat de la visite').selectOption('delivered');
    await outcomeDialog.getByRole('button', { name: 'Enregistrer le constat' }).click();
    await expect(page.getByText('Livré').first()).toBeVisible();

    // --- Déclaration d'encaissement ----------------------------------------
    // Le bouton n'apparaît QUE sur un arrêt non failed/skipped : c'est la
    // régression corrigée au Lot 18, où il exigeait `delivered` alors que le
    // livreur encaisse avant le constat du soir.
    await page.getByRole('button', { name: 'Encaissement' }).first().click();
    const collectDialog = page.getByRole('dialog');
    await expect(
      collectDialog.getByRole('heading', { name: /Encaissement ·/ })
    ).toBeVisible();
    await collectDialog.getByRole('button', { name: 'Déclarer' }).click();
    await expect(page.getByRole('button', { name: 'Encaissement' })).toBeHidden();

    // --- Retour de tournée --------------------------------------------------
    await page.getByRole('button', { name: 'Tournée rentrée' }).click();
    await expect(page.getByText('Rentrée').first()).toBeVisible();

    // --- Réconciliation -----------------------------------------------------
    // `reconciliationQuery` doit être lisible à ce stade (défaut corrigé au
    // Lot 19) : la modale s'ouvrait vide sur une tournée `returned`.
    await page.getByRole('button', { name: 'Réconcilier' }).click();
    const recDialog = page.getByRole('dialog');
    await expect(
      recDialog.getByRole('heading', { name: /Réconciliation ·/ })
    ).toBeVisible();
    await expect(recDialog.getByLabel('Montant compté dans le sac *')).toBeVisible();

    // Déclarer un montant compté égal au déclaré : pas d'écart, donc pas de
    // motif à saisir.
    await recDialog.getByLabel('Montant compté dans le sac *').fill('0');
    await recDialog.getByRole('button', { name: 'Réconcilier et encaisser' }).click();
    await expect(page.getByText('Réconciliée').first()).toBeVisible();

    // --- Vérification serveur : la réconciliation a bien été enregistrée ----
    const runsRes = await page.request.get('/api/delivery-runs', { headers: auth });
    expect(runsRes.ok()).toBeTruthy();
    const runs = (await runsRes.json()) as Array<{ id: number; reference: string; status: string }>;
    const ourRun = runs.find((r) => r.reference.startsWith('TRN-'));
    expect(ourRun, 'la tournée doit être listée').toBeTruthy();
    expect(ourRun!.status).toBe('reconciled');

    // --- Le livreur voit l'écran, et seulement en lecture ------------------
    await page.evaluate(() => sessionStorage.clear());
    await loginAs(page, '654321', 'chauffeur8');
    await page.goto('/delivery-runs');
    await expect(
      page.getByRole('heading', { name: 'Tournées de livraison', level: 1 })
    ).toBeVisible();
    // Aucun bouton de préparation : le livreur prépare, charge, fait partir et
    // réconcilie... rien de tout ça. Il déclare, et c'est tout.
    await expect(page.getByRole('button', { name: 'Nouvelle tournée' })).toBeHidden();

    expect(errors).toEqual([]);
  });
});
