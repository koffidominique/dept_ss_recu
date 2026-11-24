# Rapport d'Évolution — LOT 3 : Tableau de bord et listes de travail

**Statut :** Implémenté, testé et vérifié localement  
**Branche :** `arena/4785ea08-dept-ss-recu` (base `main` @ `675c908`)  
**Date :** 2026-11-23  
**Périmètre du Prompt Master :** PHASE 3 — Tableau de bord et listes de travail, avec application des exigences de livraison de la PHASE 5.

---

## 1. Constat vérifié et parcours choisis

L'audit du tableau de bord et des listes a montré six écarts entre l'intention de la Phase 3 et la réalité de l'écran :

| Constat vérifié dans le code | Conséquence réelle |
| --- | --- |
| Le tableau de bord n'affichait que deux liens d'alerte (créances, dettes fournisseurs), sans hiérarchie ni action directe | L'exploitant voyait un chiffre, mais ne savait pas par où commencer sa journée |
| **Aucune alerte de caisse** alors que `cashSessionOpen === false` bloque toute vente au comptant | Découverte du blocage au moment de l'encaissement, pas avant |
| **Aucune alerte sur les commandes en attente d'approbation**, les commandes à livrer ou les soldes non encaissés | Commandes silencieusement stagnantes |
| **Aucune alerte sur les inventaires en brouillon** ni sur les consignes échues | Stock physique non aligné, emballages jamais relancés |
| **Aucune alerte de sauvegarde** malgré `localDbStatus.lastBackupAt` disponible | Risque de perte définitive invisible |
| Les KPI sont des **cumuls depuis l'origine** (`SUM` sans filtre de date côté Rust) alors que le graphique est mensuel, sans aucune mention à l'écran | Confusion directe entre « vendu », « encaissé » et « dette » — exactement ce que la Phase 3 interdit |
| **Aucune liste ne conservait ses filtres** : `DebtsPage`, `OrdersPage`, `InventoryPage` n'avaient ni recherche ni filtre, et rien n'était persisté dans l'URL | Retour depuis une fiche = perte totale du contexte de travail |
| Aucun écran de travail n'annonçait l'état hors ligne | L'opérateur pouvait croire une écriture validée alors que le serveur local était injoignable |

Parcours retenu : **une file de travail priorisée** construite uniquement sur des faits déjà calculés par l'autorité métier, **chaque ligne menant directement à l'action**, des **filtres persistés dans l'URL**, et un **état hors ligne explicite** sur les écrans d'écriture.

---

## 2. Améliorations effectuées et justification produit

### 2.1 File de travail actionnable (`WorkQueuePanel`)

Huit catégories d'alertes, chacune avec un bouton d'action et une route vers les enregistrements qui expliquent la valeur :

| Catégorie | Source de vérité | Sévérité | Lien |
| --- | --- | --- | --- |
| Caisse fermée | `kpis.cashSessionOpen` | Bloquant | `/cash` |
| Session ouverte trop longtemps | `activeSession.opened_at` vs seuil 12 h | Bloquant ≥ 24 h | `/cash` |
| Créances échues | `kpis.overdueReceivables*` (SQL Rust) | Bloquant | `/debts?statut=en_retard` |
| Dettes fournisseurs échues | `kpis.overdueSupplierDebts*` (SQL Rust) | Bloquant | `/suppliers?dettes=en_retard` |
| Ruptures de stock | `kpis.outOfStockCount` (SQL Rust) | Bloquant | `/stock?alerte=rupture` |
| Stocks sous seuil | `kpis.lowStockCount` (SQL Rust) | À traiter | `/stock?alerte=seuil` |
| Commandes à approuver / à livrer / soldes dus | `listCustomerOrders()` (statuts bruts) | À traiter | `/orders?statut=…` |
| Inventaires en brouillon | `listInventories()` (statut `draft`) | À traiter | `/inventories?statut=brouillon` |
| Consignes échues | `openIssues` + `due_date` + `overdue` | À traiter | `/consignments?tab=issues` |
| Sauvegarde absente ou ancienne | `localDbStatus.lastBackupAt` | À traiter / Bloquant ≥ 14 j | `/backups` |

Chaque carte porte un **badge textuel** (« Bloquant » / « À traiter » / « Suivi ») en plus de la couleur : l'information reste lisible sans percevoir la nuance de teinte.

### 2.2 Aucune formule métier inventée

Le module `workQueue.ts` ne calcule **aucun** montant métier. Il ne fait que :

- **lire tel quel** les agrégats produits par `crates/depotpro-core/src/application/reports/dashboard.rs` (`overdueReceivablesTotal`, `overdueSupplierDebtsTotal`, `outOfStockCount`, `lowStockCount`) ;
- **additionner des restants déjà exposés** par l'API pour les commandes (`total_to_collect_xof - paid_xof`, champ fourni par le serveur) et les pièces de consignes (`pieces - returned_pieces`) ;
- **calculer des anciennetés** (heures / jours), qui sont des durées, pas des indicateurs économiques.

Aucune marge, aucun taux, aucun ratio, aucun « panier moyen » n'a été ajouté — conformément à l'interdiction explicite de la Phase 3.

### 2.3 Clarification de la portée des KPI

Ajout de `KpiScopeNote` sous la grille de KPI : les cartes sont des **cumuls depuis l'origine** ou des **encours à date**, alors que le graphique ne couvre que le **mois en cours**. Les formules ont été vérifiées dans `dashboard.rs` avant rédaction du libellé — aucune n'a été modifiée.

### 2.4 Filtres de listes conservés dans l'URL

| Écran | Filtres ajoutés | Persistance |
| --- | --- | --- |
| `OrdersPage` | Recherche (n° / client) + statut (à approuver, à livrer, solde dû, cycle en cours) | `?statut=…&q=…` |
| `DebtsPage` | Recherche (client / code / facture) + statut (ouvertes, échéance dépassée) | `?statut=…&q=…` |
| `InventoryPage` | Recherche (référence / note) + statut (brouillons, validés) | `?statut=…` |
| `StockPage` | Segments **Tout / Seuil / Ruptures** avec compteurs réels | `?alerte=…` |
| `SuppliersPage` | Bascule **Échéance dépassée** avec compteur et total échu | `?dettes=en_retard` |

Chaque liste affiche systématiquement `vue filtrée / total` et un bouton **Réinitialiser**, et distingue **« aucun enregistrement »** de **« aucun résultat pour ces filtres »**.

### 2.5 États de chargement, erreur, vide et hors ligne

- **Chargement** : squelettes animés dans la file de travail (pas de saut de mise en page).
- **Erreur partielle** : la file annonce explicitement « File partielle : X indisponible(s)… ne considérez pas cette liste comme complète ». Une requête en échec ne doit jamais faire disparaître silencieusement une alerte.
- **Vide** : message vert positif « Rien à traiter pour le moment » avec la liste des domaines vérifiés.
- **Hors ligne** : `OfflineWorkBanner` sur `/` (tableau de bord), `/cash`, `/debts`, `/orders`, `/stock`, `/inventories`. Il affiche l'heure de la bascule et précise qu'**aucune écriture n'est validée** tant que le serveur local n'a pas répondu.

---

## 3. Fichiers et couches métier concernés

### Nouveaux fichiers

- `src/features/dashboard/utils/workQueue.ts` — règles pures : construction, priorisation, résumé, filtres de listes, calculs d'ancienneté.
- `src/features/dashboard/utils/workQueue.test.ts` — 12 tests de règles.
- `src/features/dashboard/hooks/useWorkQueue.ts` — assemblage des six sources avec dégradation explicite.
- `src/features/dashboard/hooks/useConnectionState.ts` — état de connexion au serveur local.
- `src/features/dashboard/components/WorkQueuePanel.tsx` — file de travail, bandeau hors ligne, note de portée des KPI.
- `src/features/dashboard/components/WorkQueuePanel.test.tsx` — 4 tests de composants.

### Fichiers modifiés

- `src/pages/DashboardPage.tsx` — file de travail, bandeau hors ligne, note de portée.
- `src/pages/OrdersPage.tsx` — filtres URL + recherche + bandeau hors ligne.
- `src/features/orders/components/OrdersListTable.tsx` — message d'absence paramétrable, badge « à approuver », en-têtes `scope="col"`.
- `src/pages/DebtsPage.tsx` — filtres URL + recherche + état vide dédié + bandeau hors ligne.
- `src/pages/InventoryPage.tsx` — filtres URL + recherche + `useMemo` stabilisé + bandeau hors ligne.
- `src/pages/StockPage.tsx` — segments d'alerte pilotés par l'URL + bandeau hors ligne.
- `src/pages/SuppliersPage.tsx` — bascule « échéance dépassée » + bandeau n/a (pas d'écriture directe).
- `src/features/purchases/components/SuppliersTables.tsx` — message d'absence paramétrable.

### Contrats

**Aucun contrat Web, Tauri ou Rust modifié.** Toutes les données proviennent de méthodes `ApiClient` déjà existantes (`getDashboard`, `getCashStatus`, `listCustomerOrders`, `listInventories`, `getConsignmentsOverview`, `getLocalDbStatus`). Aucun nouveau KPI serveur n'a été ajouté.

---

## 4. Tests réellement exécutés et résultats

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Règles Lot 3 | `npx tsx --test src/features/dashboard/utils/workQueue.test.ts` | **12/12 PASS** |
| Composants Lot 3 | `npx tsx --test src/features/dashboard/components/WorkQueuePanel.test.tsx` | **4/4 PASS** |
| Suite complète Lot 1 + 2 + 3 | `npx tsx --test` sur les 7 fichiers | **47/47 PASS** |
| TypeScript | `npm run typecheck` | **0 erreur** |
| ESLint | `npm run lint` (`--max-warnings 0`) | **0 erreur, 0 warning** |
| Build production | `npm run build` | **OK** (PWA 62 entrées précachées) |
| Serveur de dev | `npm run dev` → `0.0.0.0:5173` | **HTTP 200**, aucune erreur HMR |

### Couverture des nouveaux tests

**Règles (12)** : `hoursSince`/`daysSince`/`isPastDueDate` (dates absentes ou invalides) ; absence totale d'alerte quand tout est à jour ; caisse fermée et session de 13 h puis 26 h (bascule en bloquant) ; reprise **telle quelle** des montants échus Rust (125 000 et 60 000 non recalculés) ; distinction rupture/seuil ; cycle des commandes avec restant dû exact (20 000 à livrer, 10 000 à encaisser, commande soldée exclue) ; consignes avec pièces déjà restituées ignorées (5 + 5 pièces) ; sauvegarde absente / ancienne / fraîche ; ordre de priorisation sans mutation de l'entrée ; en-têtes de résumé ; filtres commandes (approbation, statut, recherche) ; filtres créances (retard, soldées et annulées exclues).

**Composants (4)** : rendu des cartes avec badge textuel, `aria-labelledby` et liens profonds corrects ; annonce explicite d'une file partielle sur source en échec + état vide positif ; bandeau hors ligne contenant « aucune écriture n'est validée » et n'affirmant jamais une réussite, disparition en ligne ; note de portée des KPI mentionnant cumul, encours et mois.

### Contrôles non exécutés (et pourquoi)

- **Tests Rust** (`cargo test --workspace`) : non exécutés — `cargo` n'est pas installé dans cet environnement. **Aucun fichier Rust n'a été modifié** dans ce lot ; les formules KPI ont été lues, pas changées.
- **Tests E2E Playwright** : non exécutés — navigateurs non installables (CDN `cdn.playwright.dev` hors du réseau autorisé). Le parcours visuel a été limité à la vérification `HTTP 200` du serveur de dev et aux tests DOM.
- **Vérification manuelle multi-résolutions dans le navigateur** (point 5 de la Phase 5) : **partielle**. Le rendu responsive repose sur les classes Tailwind existantes (`grid-cols-1 lg:grid-cols-*`, `flex-wrap`), mais aucun contrôle visuel réel n'a pu être effectué. **Point à confirmer avant livraison finale.**

---

## 5. Risques résiduels et décisions métier à clarifier

1. **Seuils opérationnels paramétrés en dur** : `CASH_SESSION_STALE_HOURS = 12` et `BACKUP_STALE_DAYS = 7`. Ce sont des politiques d'exploitation, pas des règles métier ; elles demandent validation par l'utilisateur (une session de nuit longue et légitime pourrait déclencher une fausse alerte).
2. **La file agrège six requêtes** (dashboard, caisse, commandes, inventaires, consignations, statut base). Sur une base volumineuse, `listCustomerOrders()` et `getConsignmentsOverview()` peuvent être coûteux. Aucun profil de performance n'a été exécuté. Une pagination serveur des commandes serait à prévoir en Phase 3+.
3. **`overdueReceivablesCount` inclut les créances d'emballages** (agrégation Rust `rec_merch_count + pkg_debt_count`). Le libellé de l'alerte parle donc de « créances client » au sens large, pas uniquement de ventes à crédit. C'est conforme à la source, mais l'utilisateur peut s'attendre au seul poste commercial — **à confirmer**.
4. **La recherche est strictement locale** (côté client, sur les données déjà chargées). Elle ne remplace pas une recherche serveur et ne couvre pas les enregistrements hors de la fenêtre chargée.
5. **Le bandeau hors ligne repose sur `navigator.onLine`**, qui ne détecte pas un serveur local arrêté derrière une interface réseau active. Les erreurs d'écriture remontent bien via `httpTransport` (message explicite déjà présent depuis le Lot 1), mais le bandeau ne les anticipe pas.
6. **Aucun des nouveaux écrans n'a été validé visuellement** (thème sombre, largeurs intermédiaires). À faire dès que Playwright ou un accès navigateur sera disponible.

---

## 6. Prochaine étape recommandée

**LOT 4 — PHASE 4 : Qualité transversale et sécurité opérationnelle.**

Cibles prioritaires identifiées pendant ce lot :
- **Accessibilité** : généraliser les `scope="col"` sur tous les tableaux, auditer le piège de focus des dialogues Radix, vérifier le contraste des badges de sévérité en thème sombre.
- **Formulaires** : validation au plus près du champ, protection contre la perte de saisie (le brouillon de commande est déjà persisté, pas les modales de caisse/inventaire).
- **Hors ligne** : étendre l'état de connexion aux autres écrans d'écriture et distinguer « serveur local arrêté » de « navigateur hors ligne ».
- **Sauvegardes** : rendre l'état et la date de dernière sauvegarde compréhensibles depuis la page Sauvegardes, avec vérification de restauration guidée.

Prérequis techniques toujours recommandés : toolchain Rust et navigateurs Playwright, pour pouvoir exécuter `cargo test --workspace` et `npm run test:e2e`.
