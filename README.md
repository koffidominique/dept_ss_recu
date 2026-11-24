# DEPOTPRO PREMIUM V3 — ERP de Gestion de Dépôt de Boissons

Application de gestion commerciale, financière, stock multi-conditionnements et
consignations pour les dépôts de boissons : **FCFA entiers**, **quantités
exactes en milli-unités**, caisse séparée espèces/digital, **fonctionnement
local hors ligne**.

> Ce README décrit l'architecture **réellement présente dans le dépôt**. Il a été
> réécrit après vérification du code : les versions précédentes décrivaient un
> serveur Node/Express adossé à `node:sqlite`, qui **n'existe plus** dans ce
> dépôt. Voir « Ce qui n'existe plus » en fin de document.

## Architecture

Trois couches, avec **une seule source de vérité métier** : `crates/depotpro-core`.

```
┌─────────────────────────────────────────────────────────┐
│  React 19 + TypeScript strict + Vite + Tailwind         │
│  TanStack Query · Zustand · React Router (21 routes)    │
└─────────────────────────────────────────────────────────┘
                     │  ApiClient (abstraction)
         ┌───────────┴────────────┐
         ▼                        ▼
┌──────────────────┐   ┌──────────────────────┐
│ HttpApiClient    │   │ TauriApiClient       │
│ fetch /api/*     │   │ invoke (IPC natif)   │
│ token Bearer     │   │                      │
└──────────────────┘   └──────────────────────┘
         ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│  crates/depotpro-core  ←  logique métier unique         │
│  exposée par depotpro-server (Axum) et src-tauri        │
└─────────────────────────────────────────────────────────┘
                     ▼
             SQLite WAL (un fichier local)
```

Le choix du transport est fait au démarrage dans
`src/services/api/createApiClient.ts` : si `window.__TAURI_INTERNALS__` existe,
l'application utilise l'IPC Tauri, sinon HTTP. **Les deux runtimes partagent le
même cœur Rust** ; aucune règle métier n'est réimplémentée côté frontend.

| Couche | Chemin | Rôle |
| --- | --- | --- |
| Frontend | `src/` | Interface, aucun calcul métier |
| Contrats client | `src/services/api/` | `ApiClient`, `HttpApiClient`, `TauriApiClient` |
| Serveur | `crates/depotpro-server` | Axum, API REST `/api/*`, sert `dist/` |
| Desktop | `src-tauri` | Tauri 2, IPC, verrou d'instance, `app_data_dir` |
| Cœur métier | `crates/depotpro-core` | Toutes les règles, transactions, schéma |
| Migrations | `migrations/sqlite/` | 25 migrations SQL versionnées |

### Invariants numériques

`domain/money.rs` et `domain/quantity.rs` :

- **`Money(i64)`** — montants FCFA entiers. **Aucun `f64`** dans la chaîne de
  calcul ; les produits intermédiaires passent en `i128` avec détection de
  débordement.
- **`Quantity { milli_units: i64 }`** — exactitude à 3 décimales. Une saisie
  avec plus de 3 décimales est **refusée**, jamais arrondie en silence.

### Base de données

`infrastructure/db/mod.rs` : SQLite en mode **WAL**, `busy_timeout` borné à
60 s, et `db.begin_write()` qui **sérialise les écritures**. L'idempotence est
assurée par `request_key` : chaque opération d'écriture vérifie d'abord si la
clé existe déjà, ce qui rend un double-clic inoffensif.

| Paramètre | Variable | Défaut |
| --- | --- | --- |
| Port HTTP | `PORT` | `3000` |
| Hôte d'écoute | `DEPOTPRO_HOST` | `127.0.0.1` |

### Authentification et permissions

Deux mécanismes distincts :

- **PIN propriétaire à 6 chiffres**. Il n'existe **aucun PIN par défaut** : au
  premier lancement, le propriétaire le crée. 5 tentatives échouées, puis
  verrou de 30 secondes.
- **Utilisateurs nommés** avec rôles `Owner`, `Admin`, `Manager`, `Cashier`,
  `Accountant` et permissions fines (`SalesWrite`, `CatalogRead`,
  `BackupsRead`…).

Le contexte acteur circule via `tokio::task_local!` : les handlers enveloppent
l'appel dans `auth::with_actor(...)`, ce qui permet à
`require_current_actor_permission()` de refuser **au fond de la couche métier**,
pas seulement à l'entrée HTTP.

Sessions en mémoire : **10 minutes** d'inactivité, **12 heures** maximum.

## Les deux parcours de vente

C'est la distinction structurante de l'application.

### Vente comptoir (`application/sales/`)

Un seul appel, tout ou rien. **Exige une session de caisse ouverte** :

```
create_sale
  → require_open_session_tx          (caisse obligatoire)
  → déduction du stock + stock_movements
  → consignes éventuelles (deposit_issues)
  → cash_movements (+ créance si vente à crédit)
  → audit_logs
```

Sans caisse ouverte, la vente est refusée.

### Commande (`application/orders/`)

Cinq étapes, chacune avec un effet métier distinct :

| Statut | Fonction | Effet réel |
| --- | --- | --- |
| `draft` | `create_order` | Aucune déduction. Modifiable. |
| `confirmed` | `confirm_order` | **Déduit le stock**, écrit les mouvements, alloue les emballages |
| `delivered` | `deliver_order` | **Émet le reçu v1** (snapshot figé) et les consignes |
| `invoiced` | `invoice_order` | Crée la vente. Créance refusée si crédit `forbidden` |
| `paid` | `pay_order` | Encaissement — **caisse obligatoire** |

`cancelled` existe également.

Deux comportements à connaître :

- `invoice_order` sur une commande **déjà entièrement soldée** bascule
  directement en `paid`, sans passer par `invoiced`.
- `pay_order` n'écrit `paid` que depuis `invoiced` (condition `CASE` explicite).
  On **facture avant d'encaisser**, jamais l'inverse.

Le reçu est **immuable** : `issue_or_get_customer_order_receipt` renvoie le
snapshot existant, il n'en crée pas un nouveau à chaque appel.

## Emballages consignés

Quatre modules coopèrent :

- **`packaging_components`** — casiers, profils de bouteilles, assemblage et
  désassemblage.
- **`consignments`** — sortie d'emballages au client et retours.
- **`packaging_obligations`** — échéances (`return_delay_days`) et surtout
  `auto_convert_on_due` : à l'échéance, un emballage non rendu est **converti en
  perte et inscrit au grand livre** comme dette financière du client.
- **`partial_returns`** — retours partiels avec validation des composants.

> **Limite connue** : `process_due_obligations` s'exécute **au démarrage du
> serveur** (`crates/depotpro-server/src/main.rs`), pas périodiquement. Une
> obligation qui échoit pendant que l'application tourne n'est traitée qu'au
> prochain redémarrage. De plus, l'échec de cette tâche est seulement journalisé
> (`tracing::warn!`) — il n'interrompt pas le démarrage.

## Caisse

`open_cash_session` → opérations → `close_cash_session`. À la fermeture,
`get_theoretical_cash_tx` recalcule l'attendu à partir des `cash_movements`, en
**séparant espèces (`method_code = 'cash'`) et digital** (`pm.is_cash`).
L'écart constaté (`difference`) est **enregistré et tracé**, il ne bloque pas la
clôture.

## Documents commerciaux

`commercial_documents.rs` est un registre **transversal** couvrant les commandes
clients, bons fournisseurs, réceptions, retours et annulations. Il expose les
indicateurs et porte le workflow d'approbation :

```
submitted → pending_owner_approval → approved | rejected | changes_requested
```

Le passage en `pending_owner_approval` s'applique selon la politique
d'approbation du document ; la revue est **réservée au propriétaire**.

## Prérequis

- **Node.js `>= 22`** et `npm`
- **Rust stable** (`cargo`) pour `depotpro-core`, `depotpro-server` et Tauri
- Pour le desktop : WebView2 + Build Tools C++ (Windows) ou Xcode Command Line
  Tools (macOS)
- Python 3 — uniquement pour `scripts/migrate_v2_to_v3.py` et les scripts de seed

## Installation et démarrage

### Web local

```bash
npm install
npm run dev          # frontend seul (Vite)
```

Dans un second terminal, l'API qui sert réellement les données :

```bash
npm run dev:server   # cargo run -p depotpro-server → http://127.0.0.1:3000
```

Pour l'application complète (API + `dist/` compilé) :

```bash
npm run build
npm start            # NODE_ENV=production cargo run -p depotpro-server
```

### Desktop

```bash
npm install
npx tauri dev                      # développement
npm exec tauri -- build --ci       # installateurs .msi/.exe ou .app/.dmg
```

Le verrou d'instance unique (`depotpro.lock`) empêche deux instances d'écrire
dans la même base ; le stockage est placé dans le répertoire applicatif du
système (`app_data_dir`). Voir `docs/INSTALLATION_WINDOWS.md` et
`docs/INSTALLATION_MACOS.md`.

## Contrôles et tests

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint --max-warnings 0
npm run build         # vite build (PWA)
npm run test:web      # tests de composants et règles (node --test)
npm run test          # cargo test --workspace (Rust : 16 binaires de test + serveur)
npm run test:e2e      # Playwright (7 scénarios, serveur Rust réel)
npm run benchmark     # benchmark_perf : 10k produits / 100k lignes
```

Contrôles complémentaires (harnais navigateur, voir `scripts/visual/README.md`) :

```bash
npm run test:screens  # montage des écrans et gardes de permissions
npm run test:visual   # audit de contraste WCAG AA
```

Données de démonstration :

```bash
npm run seed:demo     # jeu de données de démonstration
npm run seed:catalog  # catalogue de référence (python3)
```

### Intégration continue

`.github/workflows/ci.yml` exécute 12 contrôles : typecheck, ESLint, tests web,
build Vite, Playwright E2E, migration SQLite et benchmark, tests Rust Core,
tests Axum, Clippy (`-D warnings`), `cargo fmt --check`, et compilation Tauri
Windows et macOS avec vérification des artefacts produits.

Un job utilitaire (`13. Appliquer rustfmt`) ne s'exécute que sur
`workflow_dispatch` ou sur un message de commit contenant `[rustfmt]` ; il
applique le vrai `cargo fmt` sur un runner et pousse le résultat.

## Sauvegarde et restauration

Les sauvegardes se font depuis l'écran **Sauvegardes** par `VACUUM INTO` — une
copie cohérente à chaud, contrairement à une simple copie de fichier. Chaque
archive est accompagnée d'une empreinte SHA-256 et peut être vérifiée et
restaurée depuis l'interface (`docs/BACKUP_RESTORE.md`).

## Migration depuis DEPOTPRO Python (V2 → V3)

Toujours migrer **sur une copie**, avec le script non destructif :

```bash
python3 scripts/migrate_v2_to_v3.py \
  --source /chemin/ancien_depot.db \
  --target ./data/depotpro_v3.db \
  --strict
```

## Dépannage

`docs/TROUBLESHOOTING.md` couvre le verrouillage PIN après 5 essais, le verrou
d'instance, `SQLITE_BUSY`, le refus de vente à crédit et la restauration de
sauvegarde.

## Documentation

| Document | Contenu |
| --- | --- |
| `docs/BUSINESS_RULES.md` | Règles métier financières, stock, consignations |
| `docs/API.md` | Contrats HTTP et commandes Tauri |
| `docs/DATABASE.md` | Schéma SQLite, contraintes, invariants |
| `docs/SECURITY.md` | Authentification, sessions, capabilities Tauri |
| `docs/FRONTEND.md` | Architecture React, client API, documents imprimables |
| `docs/TESTING.md` | Couverture des scénarios et benchmark |
| `docs/BACKUP_RESTORE.md` | `VACUUM INTO`, vérification, restauration |
| `docs/INSTALLATION_WINDOWS.md` | Build et installation Windows |
| `docs/INSTALLATION_MACOS.md` | Build et installation macOS |
| `docs/TROUBLESHOOTING.md` | Incidents courants |
| `docs/EVOLUTION_LOT_02.md` → `_08.md` | Lots d'évolution livrés et comptes rendus |

## Ce qui n'existe plus

Les versions antérieures de ce README (et de `docs/ARCHITECTURE_V3.md` et
`docs/INSTALLATION_WEB.md`) décrivaient un **serveur Node/Express**
(`server.ts`) adossé à `node:sqlite`, sur le port 3000. Ce serveur **n'est plus
présent dans le dépôt** : il n'existe aucun fichier `server.ts`, Express n'est
pas une dépendance, et `node:sqlite` n'est plus utilisé.

L'API est désormais servie **exclusivement** par `crates/depotpro-server` (Axum)
en Web et par `src-tauri` (IPC) en Desktop, tous deux adossés à
`crates/depotpro-core`. Toute documentation évoquant Express/`node:sqlite`
décrit un état antérieur.

## État vérifié

Les chiffres ci-dessous proviennent de runs de CI réels, pas d'une estimation :

- **CI verte de bout en bout**, 12 contrôles sur 12 (dernier run avant fusion :
  `45317792222`).
- **110 tests web**, **7 scénarios Playwright** couvrant le parcours commande
  complet (confirmation, livraison, facturation, encaissement, restitution des
  casiers).
- **Clippy `-D warnings` et `cargo fmt --check` passent** — le dépôt est
  entièrement formaté.
- **Builds Tauri Windows et macOS** validés en CI, avec vérification de la
  présence effective des artefacts (`.msi`/`.exe`, `.dmg`/`.app`).

**Non vérifié** : aucune signature de code macOS ni test d'installation sur
poste réel n'a été effectuée — ces étapes restent à faire sur les machines
cibles.
