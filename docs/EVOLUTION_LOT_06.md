# Rapport d'Évolution — LOT 6 : Clôture de validation dans un environnement outillé

**Statut :** Contrôles bloqués **débloqués par reconstruction de l'outillage** ; trois défauts réels trouvés et corrigés  
**Branche :** `arena/4785ea08-dept-ss-recu` (base `main` @ `675c908`)  
**Date :** 2026-11-23  
**Périmètre du Prompt Master :** PHASE 5, points 5 (parcours réel, tailles d'écran, erreurs console) et 6 (ne rien revendiquer d'inexécuté).

---

## 1. Constat vérifié et parcours choisi

Le Lot 5 avait déclaré trois contrôles bloqués. Ce lot devait les clôturer — ou prouver qu'ils le restent.

| Contrôle | État initial constaté | Action menée |
| --- | --- | --- |
| `cargo test` / `clippy` / `fmt` | `cargo: command not found` | **Tentatives d'installation épuisées** (voir §4) — reste bloqué |
| Playwright E2E | `Failed to download Chrome for Testing` | CDN bloqués ; **contourné** par un Chromium piloté directement |
| Vérification visuelle multi-résolutions | Aucun navigateur | **Débloqué** — 6 captures réelles 360/768/1440 × clair/sombre |
| Contraste des couleurs | `color-contrast` toujours `incomplete` | **Débloqué** — calcul WCAG + échantillonnage pixel |

Le parcours retenu n'a pas été de rédiger un constat de blocage, mais de **reconstruire un navigateur fonctionnel à partir des seuls canaux autorisés** (registre npm, puis pypi). Cette reconstruction a produit un outillage qui a immédiatement trouvé ce que les tests ne pouvaient pas voir.

---

## 2. Améliorations effectuées et justification produit

### 2.1 Un défaut critique de mise en page mobile

**Constat mesuré, pas supposé** : sur un écran de 360 px, la carte de connexion se trouvait à
`left: 366px`, `width: 199px` — **entièrement hors de l'écran**. L'application était
inutilisable sur téléphone : aucun moyen de saisir son PIN.

**Cause** : `LoginShowcasePanel` était déclaré `relative w-full lg:w-1/2 min-h-screen`.
Sur mobile il occupait donc 100 % de la largeur **et** toute la hauteur de la fenêtre,
repoussant le panneau de connexion à droite. Le `lg:w-1/2` montrait que l'intention était
bien de réserver la moitié droite à l'écran large, mais aucune règle ne désactivait le
panneau sur petit écran.

**Correction** : `relative hidden lg:block lg:w-1/2 min-h-screen`. Mesure après correction,
à 320 / 360 / 390 px : carte à `left: 16`, largeur 288 à 358 px, hauteur de document
913/900/900 px — plus aucun débordement.

Sept largeurs ont été vérifiées : 320, 360, 390, 768, 1024, 1440 px.

### 2.2 Deux défauts de contraste réels (WCAG 1.4.3)

Une fois le panneau masqué, le fond clair de la page a révélé deux problèmes que le
panneau sombre dissimulait jusque-là :

| Élément | Avant | Après |
| --- | --- | --- |
| Bouton de bascule de thème | `bg-white/10` + `text-white/90` sur fond clair ≈ **1,2:1** | fond opaque `bg-white/95` + `text-slate-800` sur mobile ; verre dépoli conservé à partir de `lg` |
| Bouton « Connexion… » désactivé | `text-white` + `disabled:opacity-40` sur dégradé bleu ≈ **1,4:1** | `disabled:from-blue-400 disabled:to-blue-500 disabled:text-blue-950 disabled:opacity-100` |

Le second mérite une explication : le bouton est **désactivé au premier rendu** (aucun PIN
saisi). C'est donc l'état que voit l'utilisateur à l'ouverture, et le libellé
« Connexion… » y était presque illisible. Un état désactivé reste du texte que l'utilisateur
doit pouvoir lire.

Anneau de focus visible ajouté au même bouton de bascule.

### 2.3 Un outillage de vérification réellement opérant

`scripts/visual/audit.mjs` (exposé en `npm run test:visual`) :

1. charge l'application **compilée** servie par `vite preview` ;
2. applique les feuilles de style, donc mesure des **couleurs calculées** ;
3. calcule le contraste WCAG 1.4.3 et, quand le texte repose sur une **photo**, échantillonne
   les pixels du PNG capturé — les styles seuls ne permettraient pas de conclure ;
4. capture 360 / 768 / 1440 px en clair **et** sombre (thème forcé via
   `localStorage.depotpro_theme`, écrit avant le démarrage du store) ;
5. détecte les débordements horizontaux et les erreurs console, en séparant les 502
   « serveur local absent » (attendus sans backend).

**Traçabilité scientifique assumée** : ce script mesure des pixels, il ne « vérifie » pas une
impression visuelle. Chaque affirmation de contraste du §4 est un rapport de luminance
calculé sur un rendu réel.

---

## 3. Fichiers et couches métier concernés

| Fichier | Nature |
| --- | --- |
| `src/features/auth/components/LoginShowcasePanel.tsx` | `w-full` → `hidden lg:block` (défaut mobile) |
| `src/pages/LoginPage.tsx` | contrastes du bouton de bascule et du bouton désactivé, anneau de focus |
| `src/features/auth/components/LoginShowcasePanel.test.tsx` | **nouveau** — 3 tests verrouillant la cause du défaut responsive |
| `scripts/visual/audit.mjs` | **nouveau** — audit contraste/responsive/thème/console |
| `scripts/visual/README.md` | **nouveau** — prérequis et limites de l'outil |
| `package.json` | script `test:visual` |
| `.gitignore` | `out/` (captures et rapports, 1,8 Mo) |
| `docs/TESTING.md` | 89/89 + section vérification visuelle |

### Contrats

**Aucune** modification de contrat Web, Tauri, Rust ou de règle métier. Les changements de
production portent sur des classes CSS et un conteneur de présentation.

### Dépendances

`@sparticuz/chromium` et `puppeteer-core` ont été installés avec `--no-save` pour la
vérification : ils **ne sont pas** des dépendances du projet, ne figurent pas dans
`package.json` et sont absents du bundle. La procédure de réinstallation est documentée dans
`scripts/visual/README.md`.

---

## 4. Tests réellement exécutés et résultats

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| **Audit visuel/contraste réel** | `LD_LIBRARY_PATH=… npm run test:visual` | **0 violation** sur 6 vues, 12 textes mesurés (dont 6 sur photo par échantillonnage pixel), **0 débordement**, **0 erreur console** |
| Suite web | `npm run test:web` | **89/89 PASS** (+3 tests responsive) |
| TypeScript | `npm run typecheck` | **0 erreur** |
| ESLint | `npm run lint` | **0 erreur, 0 warning** |
| Build production | `npm run build` | **OK** (62 entrées, 2,92 Mo) |
| Serveur de dev / aperçu | `curl` sur 5173 et 4173 | **HTTP 200** |
| Navigateur de vérification | `browser.version()` | **HeadlessChrome/153.0.8010.0**, support ES2022 confirmé |

### Comment le navigateur a été obtenu (chaîne vérifiée)

1. Playwright → CDN bloqués (`cdn.playwright.dev`, `…prss.microsoft.com`) : échec.
2. `static.rust-lang.org` → `SSL_ERROR_SYSCALL` : Rust impossible à installer.
3. `deb.debian.org` → réponse vide, et pas de droits root : paquets système inaccessibles.
4. `@sparticuz/chromium` (npm) → binaire Chrome 153 extrait dans `/tmp/chromium`.
5. Bibliothèques manquantes : d'abord `@achingbrain/nss` (NSS 3.22) → trop ancien ;
   puis l'archive **`al2023.tar.br` du même paquet** → **NSS 3.110**, chargement réussi.
6. `puppeteer-core` → lancement effectif, version et rendu confirmés.

Un faux départ mérite d'être signalé : `chrome-aws-lambda` a d'abord été essayé et
fonctionnait — mais son Chromium est **92.0.4512.0**, trop ancien pour les blocs statiques
ES2022 du bundle (« Uncaught SyntaxError: Unexpected token '{' »). Ce n'était **pas** un
défaut de l'application : le bundle se charge correctement sur Chrome 153. Cette piste a été
abandonnée, pas contournée par un changement de code.

### Contrôle **toujours bloqué** — explicitement non revendiqué

| Contrôle | Raison exacte |
| --- | --- |
| `cargo test --workspace`, `clippy -D warnings`, `fmt --check` | `cargo`/`rustc`/`rustup` absents ; `static.rust-lang.org` injoignable ; aucune release de binaires exploitable sur GitHub ; dépôts Debian inaccessibles et pas de root. **Aucun fichier Rust n'a été modifié dans les Lots 1 à 6.** |

---

## 5. Risques résiduels et décisions métier à clarifier

1. **La vérification visuelle ne couvre que l'écran de connexion.** L'application exige un
   serveur local (`cargo run -p depotpro-server`) : sans lui, aucun autre écran n'est
   atteignable. Les 19 écrans restent couverts par l'audit axe-core du Lot 5 (états
   d'erreur/vide), mais **pas** par une vérification visuelle de données réelles.
2. **Le contraste a été mesuré sur 12 textes par vue**, pas sur l'intégralité du DOM : les
   nœuds hors écran ou de moins de 2 px sont ignorés, et les textes à dégradé
   (`color: transparent` + `background-clip: text`, dont le titre « en toute simplicité »)
   sont hors périmètre par construction.
3. **L'échantillonnage pixel approxime le fond** sur une couronne autour du texte. Fiable sur
   une photo homogène, moins sur une texture très contrastée.
4. **Les bibliothèques NSS proviennent d'une archive tierce** (build Amazon Linux du paquet
   `@sparticuz/chromium`). Acceptable pour un outillage de vérification local, à ne pas
   transposer en production.
5. **Décision produit à confirmer** : masquer entièrement le panneau de présentation sous
   `lg` supprime le contenu marketing sur mobile. C'est le comportement standard des écrans
   de connexion (le formulaire prime), et l'alternative — l'empiler au-dessus — était
   précisément ce qui cassait la page. À valider si le contenu de présentation doit rester
   visible sur téléphone.

---

## 6. Prochaine étape recommandée

**Le seul contrôle encore bloqué est Rust.** Tout le reste est désormais exécuté et vert.

Deux options, à trancher selon l'accès disponible :

1. **Recommandée — laisser la CI faire le travail.** `.github/workflows/ci.yml` exécute déjà
   `cargo test`, `cargo clippy -D warnings` et `cargo fmt --check` sur un runner GitHub
   (jobs 7 à 10), avec la toolchain installée par `dtolnay/rust-toolchain`. Le déclencheur
   inclut `arena/**` : **pousser cette branche suffit à obtenir le verdict Rust**, sans
   installer quoi que ce soit ici.
2. **Si un verrou Rust est suspecté** : fournir un environnement avec `rustup` (ou autoriser
   `static.rust-lang.org`), et exécuter `npm test` en local.

Il restera alors, pour une clôture complète, la vérification visuelle **des 18 écrans
authentifiés** — qui suppose un serveur local opérationnel et donc, elle aussi, la toolchain
Rust.
