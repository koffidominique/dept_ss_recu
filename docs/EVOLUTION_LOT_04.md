# Rapport d'Évolution — LOT 4 : Qualité transversale et sécurité opérationnelle

**Statut :** Implémenté, testé et vérifié localement  
**Branche :** `arena/4785ea08-dept-ss-recu` (base `main` @ `675c908`)  
**Date :** 2026-11-23  
**Périmètre du Prompt Master :** PHASE 4 — Qualité transversale et sécurité opérationnelle, avec application des exigences de livraison de la PHASE 5.

---

## 1. Constat vérifié et parcours choisis

| Constat vérifié dans le code | Pourquoi c'est un risque opérationnel |
| --- | --- |
| `httpTransport` relayait **tel quel** le `message` renvoyé par le serveur | Un jeton, une phrase secrète ou une empreinte pouvait atterrir à l'écran et dans la console — interdit explicite de la Phase 4 |
| **93 `<th>` dont 8 seulement** portaient un `scope` | Les lecteurs d'écran ne pouvaient pas associer une cellule à son en-tête de colonne sur 9 tableaux de données |
| Le bandeau hors ligne confondait **« poste sans réseau »** et **« serveur local arrêté »** | Sur un dépôt, le wifi fonctionne mais le processus serveur est souvent arrêté : l'opérateur recevait un message faux et cherchait au mauvais endroit |
| Fermer la modale de clôture de caisse ou de comptage d'inventaire **effaçait la saisie sans un mot** | Perte silencieuse de plusieurs minutes de comptage ; la Phase 4 exige une protection contre les pertes accidentelles |
| `LocalDbStatusCard` affichait le **nombre** d'archives mais **jamais la date** de la dernière sauvegarde | L'opérateur ne pouvait pas savoir si sa dernière sauvegarde datait d'aujourd'hui ou de trois semaines |
| Deux boutons de fermeture de dialogue sans anneau de focus visible | Navigation clavier non perceptible sur les modales les plus utilisées |

Parcours retenu : **assainir au point d'entrée** (le transport HTTP), **rendre l'accessibilité structurelle** (en-têtes, focus), **nommer précisément la panne** (réseau vs serveur), **intercepter toute fermeture destructrice**, et **afficher la fraîcheur réelle** des sauvegardes.

---

## 2. Améliorations effectuées et justification produit

### 2.1 Aucun secret ne peut plus atteindre l'écran

- `redactSecrets()` masque six familles de motifs : champs nommés (`Authorization`, `Bearer`, `token`, `passphrase`, `password`, `secret`, `api_key`, `pin`), JWT, chaînes hexadécimales ≥ 32 caractères, clés `sk_live_…` / `pk_test_…`.
- **Le libellé du champ est conservé** : `Authorization: [masqué]` reste diagnosticable, contrairement à un message entièrement effacé.
- Branchement direct dans `httpTransport` : le message serveur est assaini **avant** de devenir une exception. Deux occurrences traitées (`httpRequest` et `httpRequestBytes`).
- `toDisplayableError()` va plus loin : normalise toute erreur inconnue (y compris `null` ou `undefined`) en un message non vide, extrait le code machine, et signale `isUnconfirmed` quand l'écriture **n'a pas pu être confirmée** (`NETWORK_ERROR`, `TIMEOUT_ERROR`).

### 2.2 Accessibilité structurelle

- **93 en-têtes de tableau sur 93** portent désormais `scope="col"` (85 ajoutés sur 9 fichiers). Le composant `DataTable` générique a été vérifié en premier : il était déjà couvert.
- Anneau de focus visible ajouté aux boutons de fermeture de `ConfirmationDialog` et `ModalDialog` (`focus-visible:ring-2` + offset adapté au thème sombre).
- Les messages d'état critiques portent déjà un **badge textuel** (« Bloquant » / « À traiter ») depuis le Lot 3 : l'information ne dépend pas de la couleur.
- `FOCUS_RING_CLASS` et `headerScope()` exposés comme utilitaires testés pour éviter que les prochains écrans régressent.

### 2.3 La panne est nommée correctement

`useConnectionState` distingue désormais trois états au lieu de deux :

| État | Détection | Message |
| --- | --- | --- |
| `offline` | `navigator.onLine === false` | « Poste hors ligne » — la connexion réseau du poste est indisponible |
| `server-unreachable` | réseau OK **mais** dernier appel en `NETWORK_ERROR` / `TIMEOUT_ERROR` | « Serveur local injoignable » — processus arrêté ou port fermé, **relancez le serveur puis vérifiez l'enregistrement** |
| `online` | dernier appel API réussi | Aucun bandeau |

Le hook s'abonne au cache React Query : **aucune requête supplémentaire** n'est émise, un succès prouve que le serveur vit, un échec réseau prouve l'inverse. Une erreur métier (`VALIDATION_ERROR`) ne fait **jamais** basculer l'état — le serveur est bien vivant, il a simplement refusé l'opération.

### 2.4 Protections contre la perte de saisie

| Écran | Comportement |
| --- | --- |
| `CloseCashModal` (clôture de caisse) | Formulaire modifié + fermeture → dialogue **« Fermer sans enregistrer la clôture ? »** avec rappel que le tiroir reste sous la responsabilité de l'opérateur |
| `InventoryCountModal` (comptage physique) | Motifs saisis + fermeture → dialogue **« Fermer sans valider l'inventaire ? »** avec le nombre d'articles saisis et les écarts restant à justifier |

Le bouton « Fermer » direct a été remplacé par une interception ; aucun n'efface plus les saisies en silence. En revanche, une fermeture **sans saisie** reste immédiate : on n'ajoute pas de friction inutile.

### 2.5 Sauvegardes compréhensibles

`evaluateBackupHealth()` qualifie la dernière sauvegarde en quatre états lisibles, affichés dans `LocalDbStatusCard` :

- **Aucune sauvegarde** → « Une panne disque entraînerait une perte définitive des données »
- **Sauvegarde du jour / récente (< 7 j)** → ton vert
- **À renouveler (≥ 7 j)** → ton ambre
- **Critique (≥ 14 j)** → ton rouge + « perte de X jours d'activité »

Le calcul est une **durée**, pas un indicateur comptable : aucune donnée métier n'est dérivée.

---

## 3. Fichiers et couches métier concernés

### Nouveaux fichiers

- `src/features/quality/utils/operationalSafety.ts` — 8 règles pures : masquage de secrets, erreur affichable, état serveur local, fraîcheur des sauvegardes, détection de saisie non enregistrée, utilitaires ARIA/focus.
- `src/features/quality/utils/operationalSafety.test.ts` — 8 tests de règles.
- `src/features/quality/components/QualityLot4.test.tsx` — 4 tests de composants.

### Fichiers modifiés

- `src/services/api/http/httpTransport.ts` — assainissement des messages d'erreur serveur (2 occurrences).
- `src/features/dashboard/hooks/useConnectionState.ts` — trois états, abonnement au cache React Query, horloge mémorisée hors rendu.
- `src/features/dashboard/components/WorkQueuePanel.tsx` — bandeau hors ligne à deux messages distincts.
- `src/features/backups/components/LocalDbStatusCard.tsx` — bloc de fraîcheur des sauvegardes.
- `src/features/cash/components/CloseCashModal.tsx` — interception de fermeture avec saisie.
- `src/features/inventory/components/InventoryCountModal.tsx` — interception de fermeture + prop `onClose` transmise au corps.
- `src/components/common/ConfirmationDialog.tsx`, `src/components/dialogs/ModalDialog.tsx` — anneau de focus.
- 9 fichiers de tableaux : `PrintableDocumentSheet`, `CatalogueAdminModals`, `PackagingFinancialPanel`, `OrderStepPackaging`, `OrderStepReview`, `CommercialReportTab`, `ReportDomainTabs`, `SaleDetailModal`, `CommercialDocumentsPage` — 85 `scope="col"`.
- 6 pages : `DashboardPage`, `CashPage`, `DebtsPage`, `InventoryPage`, `OrdersPage`, `StockPage` — propagation de `serverState`.

### Contrats

**Aucun contrat Web, Tauri ou Rust modifié.** Les ajouts sont strictement front : assainissement, accessibilité, messages, confirmations.

---

## 4. Tests réellement exécutés et résultats

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Règles Lot 4 | `npx tsx --test src/features/quality/utils/operationalSafety.test.ts` | **8/8 PASS** |
| Composants Lot 4 | `npx tsx --test src/features/quality/components/QualityLot4.test.tsx` | **4/4 PASS** |
| Suite complète Lots 1 → 4 | `npx tsx --test` sur les 9 fichiers | **59/59 PASS** |
| TypeScript | `npm run typecheck` | **0 erreur** |
| ESLint | `npm run lint` (`--max-warnings 0`) | **0 erreur, 0 warning** |
| Build production | `npm run build` | **OK** (PWA 62 entrées précachées, 2,91 Mo) |
| Serveur de dev | `npm run dev` → `0.0.0.0:5173` | **HTTP 200**, aucune erreur HMR |

### Couverture des nouveaux tests

**Règles (8)** : masquage des six familles de secrets (jeton Bearer, `passphrase=`, `token:`, JWT, `sk_live_`, empreinte SHA-256) avec conservation du libellé ; `containsSecret` sans révélation ; `toDisplayableError` sur erreur porteuse de secret, réseau, timeout, validation, `null`, `undefined`, chaîne brute et message vide ; les trois états serveur (dont le cas « erreur métier ≠ serveur mort » et « aucun succès connu ») ; messages hors ligne / serveur arrêté contenant **« aucune écriture n'est validée »** et **jamais** « validée avec succès » ; fraîcheur des sauvegardes sur les quatre états ; protection de saisie sans blocage pendant soumission ; `headerScope`.

**Composants (4)** : fermeture directe d'une clôture vierge ; interception avec saisie modifiée + « Continuer la clôture » qui n'efface rien ; interception du comptage d'inventaire avec confirmation destructive explicite ; affichage des trois états de sauvegarde (aucune, du jour, critique à 20 jours).

### Contrôles non exécutés (et pourquoi)

- **Tests Rust** (`cargo test --workspace`) : non exécutés — `cargo` absent de l'environnement. **Aucun fichier Rust modifié** dans ce lot.
- **Tests E2E Playwright** : non exécutés — navigateurs non installables (CDN hors réseau autorisé).
- **Audit d'accessibilité automatisé** (axe-core / Lighthouse) : **non exécuté**. Les corrections sont structurelles et vérifiables dans le code (`scope` sur 100 % des en-têtes, `aria-labelledby`, `aria-pressed`, `role="alert"`), mais **aucune mesure de contraste ni navigation clavier réelle** n'a été effectuée. C'est le principal point à confirmer avant livraison.

---

## 5. Risques résiduels et décisions métier à clarifier

1. **Le masquage est probabiliste**, pas absolu : un secret sans libellé, sans préfixe connu et de moins de 32 caractères hexadécimaux passerait. Le filet reste utile mais ne remplace pas une discipline serveur (ne jamais renvoyer de secret dans un message).
2. **Les seuils de sauvegarde** (7 j / 14 j) sont des politiques d'exploitation en dur ; à valider selon la fréquence de sauvegarde voulue par l'utilisateur.
3. **L'interception de fermeture ne couvre que deux modales** (clôture de caisse, comptage d'inventaire) — les deux où une saisie longue est réellement en jeu. Les autres modales (paiement, dépense, création rapide) restent fermables directement ; à étendre si l'usage le justifie.
4. **`useConnectionState` s'appuie sur le cache React Query** : si aucune requête n'a été émise depuis plus d'une minute et que le serveur tombe, le bandeau n'apparaîtra qu'au prochain appel. Le message d'erreur explicite du transport reste le filet de sécurité.
5. **`navigator.onLine` reste peu fiable** sur certains systèmes (VPN, réseau local sans passerelle). C'est précisément pourquoi l'état serveur est désormais déduit des appels API réels, mais la détection « offline » hérite de cette limite.

---

## 6. Prochaine étape recommandée

**LOT 5 — PHASE 5 : Validation et livraison finale.**

Ce que la Phase 5 exige encore et qui n'est **pas** couvert à ce stade :
- **Tests Rust** (`cargo test --workspace`, `clippy`, `cargo fmt --check`) : la Phase 5 demande d'exécuter « les contrôles pertinents du dépôt » ; les crates n'ont jamais été vérifiés dans cette session faute de toolchain.
- **E2E Playwright** et **contrôle visuel multi-résolutions / thème sombre** (point 5 de la Phase 5, toujours partiel depuis le Lot 3).
- **Audit d'accessibilité automatisé** (axe-core) sur les 17 écrans.
- **Vérification de la restauration de sauvegarde** de bout en bout, exigée par la Phase 4 et non encore exercée manuellement.

Prérequis bloquants pour ce lot final : installer la toolchain Rust (`rustup`) et les navigateurs Playwright, ou disposer d'un environnement CI capable de les exécuter.
