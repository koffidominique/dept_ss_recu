# Lot 8 — Trancher les composants orphelins et fermer la boucle du contrôle d'accès

## 1. Constat vérifié et parcours choisi

Le Lot 7 avait laissé deux points ouverts, désormais tranchés.

**`PaymentReceipt.tsx` (95 lignes, 0 import).** Vérifié de nouveau : aucun fichier du
dépôt ne l'importe, et `PrintableDocumentSheet.tsx` rend déjà le document
`REÇU DE PAIEMENT`. Sa seule information d'audit — « La référence interne du
paiement ne correspond pas à la référence de transaction du prestataire Mobile
Money » — avait été reportée au Lot 7 dans le pied du reçu
(`PrintableDocumentSheet.tsx`, ligne 583). La suppression ne perd donc aucune
règle métier : **fichier supprimé**, `tsc` et `eslint` restent à zéro.

**`CatalogueAdminPanel.tsx` (194 lignes).** Le panneau était complet mais
monté par aucune route : ses quatre endpoints (`getProductCatalogueOverview`,
`setCatalogueProductActive`, `setCatalogueReferencePrice`,
`getCatalogueReferencePriceHistory`) étaient donc du code mort côté interface.
La recommandation annoncée était de le **brancher** plutôt que de le supprimer,
puisque les quatre routes serveur existent et sont protégées. C'est ce qui a
été fait — et ce branchement a révélé trois défauts plus profonds, décrits au
point 2.

Le branchement a conduit à une question qui n'était pas traitée depuis les
premiers lots : **aucun filtrage d'interface par rôle n'existait**, alors que le
serveur applique `require_perm` et renvoie 403. Le lot a donc traité ce sujet
de bout en bout, en gardant le serveur comme autorité.

## 2. Améliorations et justification produit

**a) Un écran d'administration du catalogue enfin atteignable.**
`/catalogue-admin` (`src/pages/CatalogueAdminPage.tsx`) expose le panneau
existant. Un utilisateur habilité peut désactiver un produit, fixer un prix de
référence et consulter l'historique des révisions sans passer par l'API.

**b) Le menu latéral ne propose plus ce que le rôle ne peut pas faire.**
`Sidebar.tsx` filtre chaque entrée via `ROUTE_PERMISSIONS`, la **même table** que
celle utilisée par les gardes d'accès : les deux ne peuvent plus diverger. Les
libellés inaccessibles disparaissent au lieu de mener à un refus.

**c) Un garde d'accès central, pas un garde par écran.**
Premier essai : envelopper `/catalogue-admin` dans un composant dédié. Le
harnais navigateur a immédiatement montré la faiblesse — `/backups` restait
accessible à un caissier par lien direct. Le garde est donc remonté au niveau du
layout (`AppLayout.tsx`), où il couvre **toutes** les routes déclarées dans
`ROUTE_PERMISSIONS`. Le serveur continue de refuser de son côté : l'interface
n'est qu'une politesse, pas la sécurité.

**d) Trois bugs réels découverts et corrigés.**

- **Session jamais réhydratée après rechargement.** `token` est restauré depuis
  `sessionStorage`, mais `currentUser` restait `null` : le rôle était inconnu
  jusqu'à une reconnexion manuelle. `AppLayout` revalide désormais le jeton
  auprès de `/api/auth/me` (source d'autorité) et ne remplit l'état qu'avec la
  réponse du serveur ; un 401 révoque la session, une autre erreur n'invente
  rien.
- **Comparaison de permissions cassée.** Le serveur sérialise
  `catalog:write` (`Permission::code()`), pas `catalog_write`. Un premier
  normaliseur laissait le `:` intact et aurait refusé **tous** les accès. Corrigé
  et verrouillé par test : `catalog:write`, `CatalogWrite` et `catalog_write` se
  réduisent à la même clé.
- **`npm ci` impossible dans le CI.** Les douze jobs JavaScript appellent
  `npm ci` (et `cache: npm`) alors qu'aucun `package-lock.json` n'était versionné :
  vérifié, `npm ci` échoue avec `EUSAGE`. Le lockfile est désormais généré et
  versionné ; `npm ci --dry-run` installe 648 paquets.

**e) Le harnais de test ne pouvait pas voir le garde — et le disait.**
`scripts/visual/screens.mjs` validait 18 écrans avec un simple jeton factice.
Avec le nouveau garde, il capturait des squelettes et signalait 20/22. Trois
causes distinctes ont été isolées et corrigées :

1. **Le service worker PWA rejoue ses `fetch` hors de la portée de
   l'interception de la page.** `/api/auth/me` n'était jamais intercepté : la
   requête partait réellement, recevait un 502, et l'écran montait sans session.
   `page.setBypassServiceWorker(true)` neutralise le SW pendant le contrôle.
2. **Attente fixe de 1,5 s.** Insuffisante pour une hydratation asynchrone : le
   script capture maintenant un état observable (`waitForFunction`).
3. **`--single-process`.** En mode mono-processus, l'interception de requêtes
   devient instable et rendait les verdicts non reproductibles. Retiré.

Un faux positif a aussi été corrigé : `/cash` était validé pour un caissier
parce que « Caisse » est contenu dans « Session de caisse ». L'attendu est
désormais le titre complet.

`audit.mjs` (contraste) a reçu le même correctif : sans lui, l'ajout du garde
aurait fait mesurer 6 captures de squelettes au lieu des vrais écrans.

## 3. Fichiers et couches concernés

**Suppression**
- `src/components/documents/PaymentReceipt.tsx` (supprimé ; mention d'audit déjà
  reportée ligne 583 de `PrintableDocumentSheet.tsx`).

**Nouveau**
- `src/features/quality/utils/permissions.ts` — codes de permission alignés sur
  `Permission::code()`, normalisation, `hasPermission`, `hasAnyPermission`,
  `ROUTE_PERMISSIONS` (19 routes), `canAccessRoute`, `accessDecision`
  (`allow` / `deny` / `unknown`).
- `src/features/quality/utils/permissions.test.ts` — 17 tests.
- `src/pages/CatalogueAdminPage.tsx` — écran hôte du panneau existant.
- `package-lock.json` — requis par `npm ci` dans le CI.

**Modifié**
- `src/App.tsx` — route `/catalogue-admin` en `lazy`.
- `src/layouts/AppLayout.tsx` — hydratation de session via `/api/auth/me`,
  garde d'accès central, état « session indisponible » après échec explicite.
- `src/layouts/Sidebar.tsx` — entrée « Admin catalogue » + filtrage par
  `ROUTE_PERMISSIONS`.
- `scripts/visual/screens.mjs` — 19 écrans, interception `/api/auth/*`,
  contournement du SW, attente déterministe, 3 contrôles de garde (22 au total).
- `scripts/visual/audit.mjs` — même interception, session propriétaire,
  `/catalogue-admin` mesuré (18 écrans, 78 captures).
- `docs/TESTING.md`, `scripts/visual/README.md` — à jour.

**Aucune modification du noyau métier Rust** : les permissions lues sont celles
qui existaient déjà. Contrats frontend / serveur local / Tauri inchangés.

## 4. Tests réellement exécutés et résultats

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Typage | `npm run typecheck` | **0 erreur** |
| Lint | `npm run lint` | **0 erreur, 0 avertissement** (`--max-warnings 0`) |
| Tests web | `npm run test:web` | **110 / 110** (`1..98` fichiers/entrées de premier niveau) |
| Build | `npm run build` | **✓** 63 entrées précache, 2941 KiB |
| Écrans + gardes | `node scripts/visual/screens.mjs` | **22 / 22** |
| Contraste WCAG AA | `node scripts/visual/audit.mjs` | **78 captures, 1044 textes, 0 violation**, 0 débordement, 0 erreur console |
| `npm ci` | `npm ci --dry-run` | **648 paquets**, plus d'`EUSAGE` |

Détail des 22 contrôles navigateur : 19 écrans montés en session propriétaire
(dont `/catalogue-admin`, avec présence de son entrée de menu), puis 3 contrôles
en session caissier — `/catalogue-admin` → « Accès non autorisé », `/backups` →
« Accès non autorisé », `/cash` → « Session de caisse » accessible.

Test `permissions.test.ts` (17/17) : les trois sérialisations, refus d'un
utilisateur absent ou malformé, exigence « toutes » vs « au moins une »,
protection de `/catalogue-admin` par `catalog:write`, route inconnue non
bloquée, distinction `unknown` / `deny` / `allow`, et cohérence avec la matrice
RBAC réelle du serveur (propriétaire = tous les écrans ; caissier privé de
sauvegardes et d'administration catalogue ; comptable sans écriture de
dépenses).

### 4 bis. Déblocage de la CI (même lot, périmètre étendu)

Le Prompt Master impose de corriger les régressions avant d'élargir. La CI de la
branche étant rouge de bout en bout, elle a été reprise étape par étape. Chaque
ligne ci-dessous correspond à un run réellement observé.

| Job CI | État initial | État final | Preuve |
| --- | --- | --- | --- |
| 1. TypeScript | ✓ | ✓ | run `45210343916` |
| 2. ESLint | ✓ | ✓ | idem |
| 3. Tests web | ✓ | ✓ | 110 / 110 |
| 4. Build Vite | ✗ (lockfile Linux seul) | ✓ | `npm install` complet régénère 26 variantes `@rollup/rollup-*` et 26 `@esbuild/*` ; run `45206301486` compile sur Windows et macOS |
| 5. Playwright E2E | **skipped** puis 5/6 | **✓ 7 / 7** | run `45204587150` |
| 6. Migration SQLite | ✓ | ✓ | — |
| 7. Tests Rust Core | ✗ | ✓ | runs `45192149332`, `45194525075` |
| 8. Tests Axum | ✗ | ✓ | run `45194525075` |
| 9. Clippy `-D warnings` | ✗ 22 erreurs | ✗ → traité | 22 erreurs préexistantes de `depotpro-core`, toutes de style, aucune de logique |
| 10. `cargo fmt --check` | ✗ 52 fichiers | **✓** | run `45272815817` : job vert |
| 11/12. Tauri Windows / macOS | ✗ au build | ✗ au clippy desktop | le build passe désormais ; seul le clippy bloquant reste |

Deux constats vérifiés expliquent l'essentiel des échecs `fmt` :

1. **Le dépôt n'avait jamais été passé sous `rustfmt`** — pas seulement le code
   récent : à la révision de base `675c908`, `cargo fmt --check` échouait déjà
   sur des fichiers jamais touchés par ces lots. 52 fichiers `crates/` plus
   5 fichiers `src-tauri/` étaient concernés.
2. **`rustfmt` n'est pas installable dans l'environnement de travail** : le
   réseau y est fermé vers `rustup.rs`, et le paquet `rustfmt` du registre npm
   compile en WebAssembly mais **tronque** certains fichiers en sortie
   (`security.rs` vidé, en-têtes de commentaires supprimés). Il a donc été
   écarté après vérification, plutôt que d'être utilisé en aveugle.

La solution retenue est un job CI dédié (`13. Appliquer rustfmt`), qui fait
tourner le **vrai** `cargo fmt` sur un runner GitHub et pousse le résultat. Il
ne s'exécute que sur `workflow_dispatch` ou sur un message de commit contenant
`[rustfmt]` — aucun run ordinaire ne peut donc réécrire la branche. Le commit
poussé par le bot ne déclenche pas de nouveau run (protection anti-récursion de
`GITHUB_TOKEN`) : un commit vide a servi à relancer la vérification.

Sur Clippy, les 22 erreurs sont **toutes préexistantes** et **toutes de style** :
11 « very complex type » (tuples de `SELECT` SQLx), 6 `.is_multiple_of()`,
1 `str::replace` consécutif, 1 référence de référence, 1 comparaison de chars,
2 signatures à 9 et 10 arguments. Aucune règle métier n'a été touchée : les
corrections sont soit une réécriture strictement équivalente (`% 2 == 0` →
`.is_multiple_of(2)`), soit un `#[allow(...)]` ciblé, suivant les trois
précédents déjà présents dans le dépôt (`too_many_arguments` dans
`pdf/primitives.rs`, `packaging_obligations/ledger.rs` et
`purchases/packaging_exchange.rs`).

**Non exécutés localement, et non revendiqués** : `cargo test`, `cargo clippy`,
`cargo fmt --check` (binaire `cargo` absent de l'environnement) et Playwright en
local. Tous les résultats Rust ci-dessus proviennent de runs CI réels, jamais
d'une simulation.

## 5. Risques résiduels et décisions métier à clarifier

- **Le filtrage d'interface reflète le RBAC serveur, mais ne le remplace pas.**
  Un utilisateur qui contournerait le menu recevrait 403 sur chaque écriture.
  C'est voulu ; à ne pas transformer en « sécurité côté client ».
- **`ROUTE_PERMISSIONS` est déclaratif.** Une nouvelle route non répertoriée est
  laissée ouverte (`canAccessRoute` renvoie `true` pour préserver le
  comportement existant). Il faut donc l'y ajouter explicitement — un oubli
  n'ouvre pas un accès serveur, mais laisse passer l'écran.
- **Le grade de permission le plus fin n'est pas appliqué par bouton.** Un
  caissier voit « Dépenses » parce qu'il détient `expenses:write` dans le RBAC
  actuel ; c'est la matrice serveur qui décide, pas l'interface.
- **L'accès à `/catalogue-admin` est accordé à `catalog:write`**, donc à
  propriétaire, administrateur, gestionnaire et responsable de stock. Si le
  métier veut le réserver au propriétaire, il faut une permission dédiée côté
  Rust — **décision métier, non prise ici**.
- **`package-lock.json` fige les versions.** C'est ce qu'attend `npm ci`, mais
  toute mise à jour de dépendance devra désormais régénérer le lockfile.
- **Le service worker est neutralisé dans les deux harnais.** Le comportement du
  SW en production (stratégie `NetworkOnly` sur `/api/`) n'est pas exercé par ces
  scripts ; il n'a pas été modifié dans ce lot.

## 6. Prochaine étape recommandée

1. **Committer et pousser** ce lot : `git push` déclenchera le CI, qui devrait
   enfin passer l'étape `npm ci` — c'est la première fois que ce sera
   vérifiable.
2. **Valider avec un vrai backend** : démarrer `cargo run -p depotpro-server` et
   rejouer le parcours caissier (menu réduit, 403 directs) et propriétaire
   (accès catalogue, modification d'un prix de référence). C'est le seul
   contrôle encore impossible sans serveur local.
3. **Décider** si `/catalogue-admin` doit rester réservé à `catalog:write` ou
   exiger une permission dédiée.
4. Élargir éventuellement le filtrage aux **actions** (boutons) et non plus
   seulement aux écrans, avec la même table de permissions.

> Rappel : les intégrations `supabase` et `vercel` restent connectées mais
> **désactivées**. L'application est locale (SQLite + Tauri) ; aucune des deux
> n'est nécessaire ici. Dites-moi si vous voulez en activer une.
