# Vérification visuelle et de contraste (hors navigateur standard)

## Pourquoi ce script existe

Playwright ne peut pas télécharger ses navigateurs dans certains environnements
(CDN `cdn.playwright.dev` et `playwright.download.prss.microsoft.com` bloqués).
Ce dossier fournit une voie de repli **réelle** : un Chromium moderne piloté par
`puppeteer-core`, avec ses bibliothèques système fournies par npm.

## Ce que le script mesure véritablement

| Contrôle | Méthode |
| --- | --- |
| Rendu réel de l'application compilée | `vite preview` + chargement de la SPA |
| Couleurs calculées | `getComputedStyle` après application des feuilles de style |
| Contraste WCAG 1.4.3 | calcul de luminance relatif ; **échantillonnage des pixels du PNG** quand le texte est posé sur une photo |
| Responsive | captures à 360 / 768 / 1440 px |
| Thème sombre | `localStorage.depotpro_theme` écrit avant le démarrage du store |
| Débordement horizontal | `scrollWidth` vs `clientWidth` + identification des éléments fautifs |
| Erreurs console | écoute `console.error` et `pageerror` (les 502 « serveur local absent » sont comptés à part) |

## Prérequis

```bash
npm install --no-save @sparticuz/chromium puppeteer-core
# bibliothèques NSS modernes fournies par l'archive al2023 du même paquet
mkdir -p /tmp/al2023 && cd /tmp/al2023 \
  && node -e "const f=require('fs'),z=require('zlib');f.writeFileSync('libs.tar', z.brotliDecompressSync(f.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')))" \
  && tar xf libs.tar
```

L'archive `chromium.br` est extraite au premier `executablePath()` dans `/tmp/chromium`.

## Exécution

```bash
npm run build
npx vite preview --host 0.0.0.0 --port 4173 &
LD_LIBRARY_PATH=/tmp/al2023/lib npm run test:visual
```

Sorties : `out/visual/*.png` et `out/visual/report.json` (dossier ignoré par Git).

## Gestionnaires d'état, montage des écrans et contrôle d'accès

`npm run test:screens` (`scripts/visual/screens.mjs`) vérifie que les **19 écrans
authentifiés** se montent réellement : coquille applicative présente, route
conservée, titre rendu, aucune exception JavaScript. Le menu latéral doit exposer
`/catalogue-admin` pour un propriétaire (permission `catalog:write`).

Le script exerce ensuite le **garde d'accès par rôle** avec une session caissier :
`/catalogue-admin` et `/backups` doivent afficher « Accès non autorisé », `/cash`
rester accessible. Total : **22 contrôles**.

Deux pièges matériels ont été rencontrés et sont contournés dans les deux
scripts (`screens.mjs` et `audit.mjs`) :

1. **Service worker** : le SW PWA rejoue ses `fetch` hors de la portée de
   l'interception de la page. Sans `page.setBypassServiceWorker(true)`,
   `/api/auth/me` n'est jamais intercepté et l'écran est mesuré avec une session
   vide (verdict faux). Le SW est donc neutralisé pendant le contrôle.
2. **Hydratation asynchrone** : la session arrive après le montage de la
   coquille. Une attente fixe produisait des captures avant hydratation ; le
   script attend désormais un état observable (`waitForFunction`).

`--single-process` est proscrit dans ces scripts : en mode mono-processus,
l'interception des requêtes devient instable et les résultats ne sont plus
reproductibles.

## Limites assumées

- L'application exige un serveur local (`cargo run -p depotpro-server`) : sans lui,
  seul l'écran de connexion est atteignable. Les autres écrans restent couverts par
  l'audit axe-core du Lot 5 et devront être confirmés visuellement avec backend.
- L'échantillonnage pixel approxime le fond autour du texte ; il est fiable pour un
  fond photo homogène, moins pour une texture très contrastée.
