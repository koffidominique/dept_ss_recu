# Rapport d'Évolution — LOT 2 : Caisse, Stock, Commandes & Idempotence transversale

**Statut :** Implémenté, testé et vérifié localement  
**Branche :** `arena/4785ea08-dept-ss-recu` (base `main` @ `675c908`)  
**Date :** 2026-11-23  
**Périmètre du Prompt Master :** PHASE 2 — Caisse, stock et commandes, avec application des exigences de livraison de la PHASE 5.

---

## 1. Constat vérifié et parcours choisis

L'audit du dépôt a montré cinq familles d'échecs silencieux, toutes situées sur des opérations **irréversibles ou financières** :

| Constat vérifié | Conséquence réelle sur le terrain |
| --- | --- |
| Les clôtures de caisse acceptaient un écart quelconque sans motif circonstancié | Écarts de tiroir non traçables, impossibles à justifier en audit |
| Les comptages d'inventaire partaient au serveur même avec des écarts non motivés | `VALIDATION_ERROR` renvoyée après coup, saisie perdue, ressaisie complète |
| Les réceptions fournisseurs acceptaient `reçu > reliquat` | Sur-stock fantôme et dette fournisseur surévaluée |
| `payCustomerOrder` pouvait recevoir `method: 'credit'` | Rejet `INVALID_PAYMENT` côté cœur, ou encaissement non enregistré en caisse |
| Encaissement possible sans session de caisse ouverte | Échec `require_open_session_tx` renvoyé après validation de l'écran |
| Aucune clé d'idempotence sur les mutations financières secondaires | Double clic / timeout réseau = double écriture comptable |

Parcours retenus : **empêcher la faute avant l'appel** (garde-fous purs), **exiger une confirmation explicite** sur toute action irréversible, et **rendre chaque mutation financière rejouable sans risque** via `request_key`.

---

## 2. Améliorations effectuées et justification produit

### 2.1 Caisse

- `evaluateCashDiscrepancy` distingue **équilibre / manquant / excédent** et deux niveaux de gravité : écart mineur (motif ≥ 3 car.) et écart significatif **≥ 1 000 FCFA** (motif ≥ 10 car.).
- `CloseCashModal` affiche un bandeau de diagnostic en temps réel (théorique attendu vs compté, écart signé), et bloque la soumission tant que le motif requis manque.
- **`ConfirmationDialog`** avant la clôture définitive, avec récapitulatif chiffré et le motif saisi.
- `request_key` **stable par empreinte** `montant::motif` : un double clic ou un retry après timeout réseau rejoue la même opération au lieu d'en créer une seconde.
- `OpenCashModal` réinitialise un formulaire neuf (et une nouvelle clé) à chaque ouverture.

### 2.2 Inventaires & stock

- Arithmétique **milli-unités stricte** via `parseNonNegativeQtyToMilliBigInt` (BigInt, 3 décimales max, `0` accepté) : aucun flottant, aucun arrondi sur les quantités physiques.
- `evaluateInventoryDraftLines` bloque la validation dès qu'un **écart n'est pas justifié** (motif ≥ 3 car.) ou qu'une quantité est invalide, avec compteur en direct des écarts positifs/négatifs.
- Bandeau bloquant + bouton **« Afficher les écarts à justifier »** : zéro ressaisie, la quantité déjà saisie est conservée pendant le filtrage.
- **`ConfirmationDialog`** avec la liste des conséquences (nombre d'écarts, nombre d'écritures de stock générées) avant validation irréversible d'inventaire et avant une sortie de stock critique.

### 2.3 Achats / réceptions fournisseurs

- `evaluatePurchaseReceiveLine` calcule le **reliquat réel** et refuse immédiatement `reçu conforme > reliquat` (au lieu d'un rejet serveur tardif).
- Toute **livraison partielle ou écart** (manquant, casse, refus) exige un motif ≥ 3 caractères.
- `request_key` stable par empreinte de réception ; **`ConfirmationDialog`** avant l'entrée en stock.
- Commandes fournisseurs : clé stable sur la création, garde-fous d'écarts conservés.

### 2.4 Commandes clients

- `computeOrderLifecycleStages` alimente une **frise d'états** (Brouillon → Confirmée → Livrée → Facturée → Soldée) avec le prochain geste attendu, et un état « annulée » explicite.
- `normalizeOrderSettlementMethod` **interdit structurellement** l'envoi de `method: 'credit'` à `payCustomerOrder` : tout canal inconnu retombe sur `cash`, `mobile_money` est mappé sur `wave`.
- Garde **`hasOpenCashSession`** : encaissement désactivé avec bandeau explicite si la caisse est fermée — l'échec est annoncé avant la validation, plus après.
- `request_key` stable sur `onPayFull` / `onPayCustom` (empreinte du montant, du canal et de la référence externe).
- **`ConfirmationDialog`** avant confirmation (déduction de stock), livraison (imputation des consignes) et annulation.

### 2.5 Idempotence transversale

`createIdempotentRequestTracker(prefix)` maintient la même clé tant que l'empreinte métier est inchangée et la libère (`reset()`) en `onSuccess`. Branché sur **l'intégralité** des mutations financières et logistiques restantes :

`useSalesHistoryData`, `useDebtsData`, `useConsignmentsData`, `useExpensesData`, `useSuppliersData`, `useCashData`, `usePurchasesData`, `useOrdersWizard`.

---

## 3. Fichiers et couches métier concernés

### Nouveaux fichiers

- `src/features/inventory/utils/phase2OperationsGuards.ts` — 8 garde-fous purs (aucune dépendance UI, testables isolément).
- `src/features/inventory/utils/phase2OperationsGuards.test.ts` — 7 tests de règles.
- `src/features/inventory/components/Phase2WorkflowsLot2.test.tsx` — 3 tests de composants.
- `src/test/domEnvironment.ts`, `src/test/setupDom.ts` — harnais DOM partagé pour les tests `tsx --test`.
- `docs/PROMPT_MASTER_EVOLUTION.md` — Prompt Master enregistré.

### Couche présentation / hooks modifiés

`src/features/cash/components/{OpenCashModal,CloseCashModal}.tsx`, `src/features/cash/hooks/{useCashData,useExpensesData}.ts`, `src/features/inventory/components/{InventoryCountModal,StockAdjustModal}.tsx`, `src/features/purchases/components/{PurchaseOrderModal,PurchaseReceiveModal}.tsx`, `src/features/purchases/hooks/{usePurchasesData,useSuppliersData}.ts`, `src/features/orders/components/OrderStepConfirm.tsx`, `src/features/orders/hooks/useOrdersWizard.ts`, `src/features/clients/hooks/useDebtsData.ts`, `src/features/consignments/hooks/useConsignmentsData.ts`, `src/features/sales/hooks/useSalesHistoryData.ts`, `src/pages/{CashPage,OrdersPage}.tsx`.

### Contrats

**Aucun contrat n'a été modifié** : `ordersContracts.ts`, `commerceContracts.ts`, `httpOrdersRoutes.ts`, `tauriOrdersCommands.ts` et `src/types/erp/orders.ts` restent inchangés. Les corrections sont strictement côté garde-fous et UI, conformément au point 7 de la Phase 5.

---

## 4. Tests réellement exécutés et résultats

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Règles Lot 2 | `npx tsx --test src/features/inventory/utils/phase2OperationsGuards.test.ts` | **7/7 PASS** |
| Composants Lot 2 | `npx tsx --test src/features/inventory/components/Phase2WorkflowsLot2.test.tsx` | **3/3 PASS** |
| Suite complète Lot 1 + Lot 2 | `npx tsx --test` sur les 5 fichiers | **31/31 PASS** |
| TypeScript | `npm run typecheck` | **0 erreur** |
| ESLint | `npm run lint` (`--max-warnings 0`) | **0 erreur, 0 warning** |
| Build production | `npm run build` | **OK** (PWA 60 entrées précachées) |
| Serveur de dev | `npm run dev` → `0.0.0.0:5173` | **HTTP 200** |

### Couverture des nouveaux tests

- **Purs (7)** : tracker d'idempotence (même clé sur retry, clé neuve si empreinte change, clé neuve après `reset`) ; écart de caisse (exact / mineur / significatif, seuil 1 000 FCFA) ; parseur milli-unités (accepte `0`, virgule décimale, refuse négatif et > 3 décimales) ; évaluation d'inventaire (comptage des écarts, blocage sans motif) ; normalisation du canal de règlement ; frise de cycle de vie ; réception fournisseur (dépassement de reliquat, motif obligatoire).
- **Composants (3)** : `CloseCashModal` (motif trop court bloqué → confirmation → soumission → même `request_key` au rejeu) ; `InventoryCountModal` (bouton désactivé tant que l'écart n'est pas motivé, puis confirmation explicite avant `onValidate`) ; `OrderStepConfirm` (bouton d'encaissement désactivé sans session de caisse, `method` transmis = `cash` sur une commande `credit`, même `request_key` sur double clic, `onDeliver` non appelé avant confirmation).

### Contrôles non exécutés (et pourquoi)

- **Tests Rust** (`cargo test --workspace`) : **non exécutés** — la toolchain Rust (`cargo`) n'est pas installée dans cet environnement. Aucun fichier Rust n'a été modifié dans ce lot.
- **Tests E2E Playwright** : **non exécutés** — les navigateurs Playwright ne sont pas installés et le CDN de téléchargement (`cdn.playwright.dev`) est hors du périmètre réseau autorisé. La vérification visuelle a donc été limitée au serveur de dev répondant `HTTP 200` sur les 17 routes SPA.
- **`npm test`** (suites Node `tests/*.test.mjs` / `server/`) : **non applicable ici** — ces suites historiques dépendent des fichiers `tests/*.test.mjs` qui ne sont pas présents dans ce checkout ; le harnais retenu pour ce lot est `tsx --test` sur les fichiers `src/**/*.test.ts(x)`.

---

## 5. Risques résiduels et décisions métier à clarifier

1. **Seuil d'écart significatif fixé à 1 000 FCFA** (`SIGNIFICANT_CASH_DISCREPANCY_XOF`). Valeur retenue par défaut ; à confirmer par l'exploitant (elle conditionne le niveau d'exigence du motif).
2. **Longueur minimale du motif** : 3 caractères pour un écart ordinaire, 10 pour un écart significatif. Un comptage de contrôle peut vouloir 10 caractères partout.
3. **`normalizeOrderSettlementMethod` retombe silencieusement sur `cash`** quand aucun canal valide n'est lisible. Ce comportement évite le blocage d'un encaissement réel, mais un opérateur qui visait un canal Mobile Money doit voir le canal affiché avant validation — l'interface l'affiche, la donnée persistée suit l'affichage.
4. **Le point 5 de la Phase 5 (vérification du parcours réel dans le navigateur)** reste partiellement rempli : le serveur est opérationnel et les composants sont couverts par des tests DOM, mais aucun parcours manuel multi-résolutions n'a été effectué dans ce lot.
5. Les garde-fous restent **purement côté client** : le cœur Rust demeure l'autorité de validation. Ce lot ne remplace pas les contrôles serveur, il évite d'aller les déclencher.

---

## 6. Prochaine étape recommandée

**LOT 3 — PHASE 3 : Tableau de bord et listes de travail.**

Cible : rendre l'écran d'accueil actionnable plutôt que descriptif — une file de travail priorisée (créances et dettes échues, sessions de caisse ouvertes depuis trop longtemps, inventaires en brouillon, commandes en attente d'approbation, consignes à échéance 15 jours), chaque ligne menant directement à l'action corrective, avec des états vides et d'erreur explicites.

Prérequis techniques recommandés avant ce lot :
- installer la toolchain Rust et les navigateurs Playwright dans l'environnement d'exécution afin de pouvoir exécuter `cargo test --workspace` et `npm run test:e2e` ;
- réintégrer les suites `tests/*.test.mjs` si la parité Node/Rust doit rester vérifiée en local.
