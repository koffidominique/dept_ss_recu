# Décisions d'architecture — Tournées de livraison et plafond de consignes

> Document de décision. Chaque affirmation technique a été vérifiée dans le code
> du dépôt à la date du 2026-11-23, pas déduite de la documentation existante.

---

## 0. Les deux réponses et ce qu'elles changent

| Question | Réponse | Conséquence architecturale |
| --- | --- | --- |
| Bloquer la vente à un client en dette d'emballages ? | **Oui** | Il faut une notion de **plafond**, une **mesure fiable** de la dette, et un **droit de dérogation**. |
| Le livreur encaisse-t-il sur place ? | **Oui** | Le projet doit modéliser de l'**argent en transit**, distinct de la caisse. C'est le point le plus lourd. |

La seconde réponse est de loin la plus structurante. Elle heurte de front deux
contraintes du schéma actuel, détaillées en section 2.

---

## 1. Six constats vérifiés qui contraignent le design

### 1.1 `cash_movements.session_id` est `NOT NULL`

```sql
CREATE TABLE IF NOT EXISTS cash_movements (
    session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'receivable', 'expense',
        'supplier_payment', 'deposit_refund', 'sale_refund', 'income', 'outflow')),
    method_code TEXT NOT NULL REFERENCES payment_methods(code),
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    ...
```

Un mouvement d'argent **ne peut pas exister sans session de caisse**. Il n'y a
donc aucun endroit prévu pour de l'argent encaissé hors du dépôt.

### 1.2 Il n'existe qu'**une seule** session ouverte dans tout le dépôt

`cash_sessions` ne porte **ni `user_id`, ni `terminal_id`, ni `vehicle_id`** :

```sql
CREATE TABLE IF NOT EXISTS cash_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    opening_key TEXT NOT NULL UNIQUE,
    closing_key TEXT NULL UNIQUE,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opening_cash INTEGER NOT NULL CHECK (opening_cash >= 0),
    theoretical_cash INTEGER NULL,
    physical_cash INTEGER NULL CHECK (physical_cash IS NULL OR physical_cash >= 0),
    difference INTEGER NULL,
    closing_notes TEXT NULL
);
```

L'unicité est garantie par du code, pas par le schéma :

```rust
if sqlx::query_scalar::<_, i64>("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")
    ...
    .is_some()
{
    return Err(CoreError::SessionAlreadyOpen(
        "Une session de caisse est déjà ouverte.".to_string(),
    ));
}
```

**Conséquence** : on ne peut pas « ouvrir une caisse pour le livreur ». Il
faudrait soit autoriser plusieurs sessions (refonte de la contrainte), soit
rattacher les encaissements du livreur à la session unique.

### 1.3 Le remboursement de consigne **exige** déjà une caisse ouverte

Dans `consignments/client_returns.rs` :

```rust
let (session_id, _sref, opening_cash) = require_open_session_tx(&mut tx).await?;   // l. 58
let avail = get_theoretical_cash_tx(&mut tx, session_id, opening_cash).await?;      // l. 154
```

et écrit un mouvement :

```rust
"INSERT INTO cash_movements (session_id, request_key, kind, method_code, direction, amount, description, reference_document)
 VALUES (?, ?, 'deposit_refund', ?, 'out', ?, ?, ?)"                              // l. 253
```

### 1.4 Le règlement de la créance d'emballages, lui, **ne l'exige pas**

```rust
let open_session_id: Option<i64> = ...;   // Option
if let Some(sid) = open_session_id {      // conditionnel
    // écrit les cash_movements
}
```

**Deux chemins symétriques, deux règles opposées.** C'est une incohérence
interne, pas un choix documenté. Elle doit être tranchée avant d'ajouter une
troisième voie d'encaissement.

### 1.5 Aucune notion de tournée, de véhicule ou de livreur

Aucune table `deliveries`, `routes`, `vehicles`, `tours`, `shipments`.
`deliver_order` existe (`orders/lifecycle.rs:165`) et fait correctement son
travail — stock, consignes, soldes — mais **aucun objet ne porte la livraison**.
Le cycle de vie d'une commande s'arrête à `delivered`.

### 1.6 Il y a **deux** soldes client d'emballages, en parallèle

| Table | Granularité | Écrite par | Lue par |
| --- | --- | --- | --- |
| `customer_deposit_balances` | par **actif** (`packaging_assets`) | `orders/lifecycle`, `orders/packaging_and_returns`, `orders/receipts` | `orders/*` |
| `customer_packaging_accounts` | par **consignable** (`returnable_id`) | 11 fichiers, dont tout `consignments` et tout `packaging_obligations` | `consignments`, `packaging_obligations` |

`deliver_order` **écrit dans les deux** simultanément. Les modules se parlent
peu : le monde « commandes » utilise la première, le monde « consignes » la
seconde.

**Conséquence pour la question 1** : il n'y a pas *un* chiffre de dette
d'emballages, il y en a deux, à deux granularités. Un plafond posé sur l'un
sera contourné par l'autre. **Ce point doit être réglé avant toute règle de
blocage.**

---

## 2. Décision structurante : le sac du livreur n'est pas la caisse

### Le problème

Si le livreur encaisse 250 000 FCFA dans la journée, où va cet argent dans le
système ? Les deux réponses naïves sont fausses :

| Réponse naïve | Pourquoi c'est faux |
| --- | --- |
| Écrire directement dans la caisse | La caisse du dépôt afficherait un solde théorique que le caissier **ne détient pas**. Le comptage du soir serait faux. Ce n'est plus une caisse. |
| Créer une caisse par livreur | Impossible sans refonte : une seule session ouverte est autorisée, `cash_sessions` n'a pas de dimension terminal. Et cela crée autant de caisses à compter qu'il y a de livreurs. |

### La décision

**L'argent du livreur est un actif en transit, pas de la caisse.** Trois temps
distincts :

```
① DÉPART      la tournée est chargée. Montant attendu par arrêt = snapshot figé.
              Aucun mouvement de caisse. La caisse du dépôt ne bouge pas.

② TERRAIN     le livreur encaisse. Il DÉCLARE ce qu'il a pris, par moyen
              de paiement (espèces / Wave / Orange Money / MTN).
              Toujours aucun mouvement de caisse. C'est une déclaration,
              pas une comptabilisation.

③ RETOUR      le gérant compte. Il compare DÉCLARÉ et ATTENDU.
              Écart → motif obligatoire.
              C'est SEULEMENT ici que les cash_movements sont écrits,
              rattachés à la session de caisse du dépôt.
```

Formellement :

```
attendu        = Σ montants des arrêts livrés
déclaré        = Σ collections saisies par le livreur
compté         = ce que le gérant trouve physiquement
écart_déclaré  = déclaré − attendu            (erreur ou omission)
écart_caisse   = compté − déclaré             (manquant ou trop-perçu)
manquant       = min(0, écart_caisse)         → perte à imputer
```

Ce découpage a une propriété précieuse : **`cash_sessions.theoretical_cash`
reste exact en permanence**, car rien n'entre avant le retour. Et l'écart est
mesuré **au bon endroit** — entre ce que le livreur dit et ce qu'il rend, pas
entre deux totaux qui se compensent.

### Pourquoi la caisse du dépôt convient

À l'étape ③, l'argent du livreur entre physiquement dans le dépôt. Il est donc
légitime qu'il rejoigne la session unique ouverte. On rattache chaque mouvement
à la tournée par deux colonnes nullables ajoutées à `cash_movements` :

```sql
ALTER TABLE cash_movements ADD COLUMN delivery_run_id INTEGER NULL REFERENCES delivery_runs(id);
ALTER TABLE cash_movements ADD COLUMN collected_by_user_id INTEGER NULL REFERENCES users(id);
```

`ALTER TABLE ... ADD COLUMN` est supporté par SQLite sans reconstruction. En
revanche, **la contrainte `CHECK (kind IN (...))` n'est pas modifiable** : on ne
peut pas ajouter un `kind = 'delivery_collection'`. Il faut donc **réutiliser**
les valeurs existantes :

| Encaissement | `kind` à utiliser |
| --- | --- |
| Paiement d'une commande | `sale` |
| Règlement d'une créance commerciale | `receivable` |
| Règlement d'une créance d'emballages | `receivable` |

La distinction se fait par `delivery_run_id` et `collected_by_user_id`, pas par
`kind`. C'est moins élégant, mais cela évite une reconstruction de
`cash_movements` — et surtout cela garde la compatibilité des rapports de caisse
existants qui filtrent sur `kind`.

---

## 3. Question 1 : le plafond de consignes

### Ce que « bloquer » doit vouloir dire

Bloquer au moment du **brouillon** est hostile : le gérant ne peut même pas
préparer la commande pour l'expliquer au client. Le blocage se place donc au
**passage à `confirmed`** (et sur la vente directe), pas avant.

### La mesure

Le seul chiffre honnête est **les pièces réellement en circulation**, c'est-à-dire
somme de `pieces − returned_pieces − converted_pieces − lost_pieces` sur les
`deposit_issues` dont le statut est `pending` ou `partially_returned`.

Surtout **pas** `pending_reference_value` (valeur indicative d'assurance, jamais
exigible), ni `packaging_financial_debt` (dette déjà convertie, donc déjà
monétisée : si elle est plafonnée, un client débiteur en argent ne peut plus
acheter — ce qui est le rôle d'un encours commercial, pas d'un plafond de
consignes).

### Les paramètres

À ajouter sur `app_settings` (mécanisme `ALTER TABLE ADD COLUMN` déjà utilisé
pour `allow_negative_stock`, `auto_assemble_crates`…) :

| Colonne | Défaut | Rôle |
| --- | --- | --- |
| `packaging_pending_limit_pieces` | `0` = illimité | Plafond global, en pièces |
| `packaging_limit_action` | `'warn'` | `warn` \| `block` |

Et sur `clients`, une surcharge optionnelle :

```sql
ALTER TABLE clients ADD COLUMN packaging_pending_limit_pieces INTEGER NULL;
```

### La dérogation

Sans échappatoire, la règle se retourne contre le commerce : un client bloqué
part chez le concurrent et les casiers sont perdus **de toute façon**. Il faut
donc une dérogation **tracée**, avec motif obligatoire, visible dans le
tableau de bord pendant N jours.

Nouvelle permission : `ConsignmentsOverrideLimit`. Accordée à `owner`, `admin`,
`manager` — **pas** à `cashier`.

### Ce que j'exclus

Un plafond **par client** en valeur monétaire. Cela demande de figer un prix
unitaire par consignable, de le maintenir dans le temps, et aboutit à une dette
qui ne correspond plus à aucune pièce réelle. Le comptage en pièces est
robuste ; la valorisation en FCFA diverge.

---

## 4. Décision : pas d'ordonnanceur d'échéances

Avec le plafond, la pression devient **visible au moment de la vente**, ce qui
est bien meilleur qu'un traitement nocturne que personne ne regarde.

| Option | Verdict |
| --- | --- |
| Boucle toutes les 30 min dans le serveur | **Refusée.** Processus d'arrière-plan à superviser, aucune garantie d'exécution si l'application est fermée, et sur un poste Windows arrêté le soir elle ne tourne pas. |
| Tâche planifiée Windows | Refusée : hors application, invisible, à configurer sur chaque poste. |
| **Écran de pression de retour + plafond à la vente** | **Retenue.** Déterministe, sans processus caché, auditable. |

La conversion automatique reste possible manuellement (route `packaging_process_due`
existante) et le champ `auto_convert_on_due` de la politique demeure respecté :
il sert simplement à décider, **au moment où l'on regarde**, si la conversion est
proposée ou imposée.

---

## 5. Décision : aligner le règlement d'emballages sur la caisse

`pay_packaging_financial_debt` doit exiger une session ouverte comme
`return_client_empties` le fait déjà (constat 1.3 vs 1.4).

La règle unique devient :

> **Tout franc qui entre dans le dépôt passe par une session de caisse ouverte.
> Aucune exception.**

Conséquence secondaire : cette fonction devient inutilisable hors session, ce
qui est exactement le comportement attendu. Les tournées ne la contournent pas —
elles passent par la réconciliation de l'étape ③.

Il faut également trancher `adjustment` : le `CHECK` du grand livre l'autorise,
**aucun code ne l'écrit**. Soit on l'implémente avec un motif obligatoire et un
droit dédié, soit on le retire de la contrainte. Une valeur autorisée et jamais
utilisée dans un grand livre est une invitation à la saisie manuelle non tracée.

---

## 6. Le modèle de tournée

### Tables

```sql
CREATE TABLE delivery_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,              -- TRN-000001
    run_date TEXT NOT NULL,                      -- jour de livraison
    driver_user_id INTEGER NOT NULL REFERENCES users(id),
    vehicle_label TEXT NULL,                     -- "Triporteur 1", libre
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','loaded','in_progress','returned','reconciled','cancelled')),
    planned_stops INTEGER NOT NULL DEFAULT 0,
    opened_key TEXT NOT NULL UNIQUE,             -- idempotence
    closed_key TEXT NULL UNIQUE,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT NULL,
    notes TEXT NULL
);

CREATE TABLE delivery_run_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES delivery_runs(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    order_id INTEGER NULL REFERENCES orders(id),
    sequence INTEGER NOT NULL,
    -- snapshot figé au chargement : ne dépend plus de l'état futur de la commande
    expected_amount INTEGER NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
    expected_empty_pieces INTEGER NOT NULL DEFAULT 0 CHECK (expected_empty_pieces >= 0),
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','delivered','failed','skipped')),
    failure_reason TEXT NULL,
    UNIQUE (run_id, sequence)
);

CREATE TABLE delivery_run_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stop_id INTEGER NOT NULL REFERENCES delivery_run_stops(id),
    method_code TEXT NOT NULL REFERENCES payment_methods(code),
    amount INTEGER NOT NULL CHECK (amount > 0),
    declared_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (stop_id, method_code)
);

CREATE TABLE delivery_run_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES delivery_runs(id),
    returnable_id INTEGER NOT NULL REFERENCES returnable_packaging_types(id),
    good_pieces INTEGER NOT NULL DEFAULT 0 CHECK (good_pieces >= 0),
    damaged_pieces INTEGER NOT NULL DEFAULT 0 CHECK (damaged_pieces >= 0)
);
```

### Les trois principes

**① Le snapshot est figé au chargement.** `expected_amount` et
`expected_empty_pieces` sont calculés quand la tournée passe à `loaded`, puis
**ne changent plus**. Sans cela, une commande annulée pendant la tournée
modifierait l'attendu après coup, et l'écart du soir serait faux. C'est
exactement le principe déjà appliqué à `deposit_issues.unit_value`.

**② Les collections sont des déclarations.** Elles n'écrivent aucun mouvement
de caisse. Un `UNIQUE (stop_id, method_code)` interdit la double déclaration
pour un même moyen — et rend l'opération idempotente.

**③ Les vides reviennent par tournée, pas par arrêt.** Le livreur rapporte
l'ensemble des casiers du chargement ; rattacher chaque casier à son client
d'origine serait une reconstruction fragile. Le retour de tournée alimente le
stock, la répartition par client se fait sur les `deposit_issues` existants,
par ordre d'ancienneté d'échéance (FIFO) — ce qui est aussi la règle la plus
favorable au client.

### Machine à états

```
draft ──load──▶ loaded ──depart──▶ in_progress ──return──▶ returned ──reconcile──▶ reconciled
  │                                    │                                     │
  └────────────cancelled───────────────┴──────────cancelled◀────────────────┘
```

- `reconciled` est **terminal** : on ne peut plus modifier une tournée clôturée.
  Une correction passe par une écriture d'ajustement, jamais par réécriture.
- Une tournée `in_progress` non revenue depuis plus de 24 h apparaît en
  **anomalie rouge** sur le tableau de bord : c'est le signal d'un problème réel
  (accident, vol, oubli de clôture).

---

## 7. Découpage en lots

### Phase A — Assainir avant d'étendre (≈ 8 jours)

#### Lot 9 — Une seule règle de consigne

| Action | Détail |
| --- | --- |
| Supprimer la divergence de délai | `orders/lifecycle.rs` retombe sur **15 jours** (`unwrap_or((None, 15))`) alors qu'une politique globale de **30 jours** est créée par la migration `0015`. Extraire `resolve_policy_tx` et l'utiliser aux deux endroits. |
| Choisir la table de solde de référence | Trancher entre `customer_deposit_balances` et `customer_packaging_accounts`, ou documenter explicitement pourquoi les deux coexistent et laquelle fait foi pour le plafond. |
| Ajouter les réglages | `packaging_pending_limit_pieces`, `packaging_limit_action`, surcharge client. |
| Bloquer à la confirmation | Sur `confirm_order` et la vente directe, avec dérogation tracée. |

**Tests attendus** : 8 cas — sous le plafond, au plafond, au-delà, dérogation
avec motif, dérogation sans motif (refus), surcharge client prioritaire sur le
réglage global, `warn` vs `block`, brouillon jamais bloqué.

#### Lot 10 — Pression de retour

Un écran, trois chiffres, une action. Réutilise `ClientPackagingDashboardDto`
(`pending_pieces`, `pending_reference_value`) et les `deposit_issues`.

Seuils visuels : échu (rouge), < 7 jours (orange), sinon neutre.

**Tests attendus** : 5 cas — tri par ancienneté, exclusion des `settled` et
`converted`, total en pièces exact, client sans consigne absent, filtre par
consignable.

#### Lot 11 — Le règlement passe par la caisse

`pay_packaging_financial_debt` exige `require_open_session_tx`. Décision sur
`adjustment`.

**Tests attendus** : 4 cas — paiement sans session refusé, paiement avec session
accepté et mouvement écrit, idempotence conservée, solde du grand livre inchangé
en cas de refus.

#### Lot 12 — Permissions dans le cœur

Ajouter `require_current_actor_permission` dans les fonctions de
`packaging_obligations` et `consignments`, pas seulement aux frontières Axum et
Tauri. Vérifier au passage le rôle `cashier`, qui ne possède **ni `StockRead`
ni `ReportsRead`** — un caissier peut vendre sans voir le stock disponible. À
arbitrer explicitement.

**Tests attendus** : un cas par fonction protégée + un cas « appel direct du
cœur refusé », qui n'existe pas aujourd'hui.

### Phase B — Tournées (≈ 5 semaines)

#### Lot 13 — Socle tournée (modèle + cœur, sans interface)

Migration : 4 tables, 2 colonnes sur `cash_movements`, ajout du rôle `driver`
sur `users`.

**Point technique décisif** : `users.role` est protégé par un
`CHECK (role IN ('owner','admin','manager','cashier','stock_manager','accountant'))`.
SQLite **ne sait pas modifier une contrainte CHECK** : ajouter `'driver'` plus
tard impose une reconstruction complète de `users`. Il faut donc l'ajouter
**maintenant**, même si le rôle n'a aucune permission au Lot 13. Le dépôt
connaît déjà cette manœuvre (migration `0025`).

Fonctions du cœur : `create_run`, `add_stop`, `load_run` (fige le snapshot),
`start_run`, `cancel_run`.

**Tests attendus** : ~12 cas — référence séquentielle, idempotence par
`opened_key`, snapshot non modifiable après chargement, séquence unique par
tournée, départ refusé sans arrêt, annulation impossible après retour.

#### Lot 14 — Réconciliation (le lot qui compte)

`register_collection`, `record_stop_outcome`, `return_run`, `reconcile_run`.

À la réconciliation :
1. Calcul attendu / déclaré / compté, par moyen de paiement.
2. Écart déclaré ≠ 0 → motif obligatoire.
3. Écriture des `cash_movements` rattachés à la session ouverte, avec
   `delivery_run_id` et `collected_by_user_id`.
4. Vides repris en stock (`good` / `damaged`), répartition FIFO sur les
   `deposit_issues`.
5. Manquant → écriture de perte, **jamais** de correction silencieuse du solde.

**Tests attendus** : ~15 cas, dont — tournée sans écart, manquant de 5 000 FCFA,
trop-perçu, double réconciliation refusée (idempotence), vides endommagés,
réconciliation impossible sans session de caisse ouverte, arrêt en échec exclu
de l'attendu.

#### Lot 15 — Interface gérant

Préparation, bon de tournée imprimable, suivi, écran de réconciliation avec le
comptage par moyen de paiement.

**Tests attendus** : parcours Playwright bout en bout —
créer → charger → départ → saisir → retour → réconcilier, avec un écart.

### Lot 16 — Terminal livreur (différé, sur décision)

**Je recommande de ne pas le faire dans un premier temps.** Raisons :

| Contrainte | Impact |
| --- | --- |
| Le serveur Axum tourne sur le poste du dépôt | Joignable en LAN depuis un téléphone, **pas** depuis la route sans exposition Internet |
| Tauri mobile | `bundle.targets = "all"` mais `src-tauri/gen/` absent : rien n'est initialisé |
| Hors ligne | Un moteur de synchronisation avec résolution de conflits sur une base SQLite locale est un chantier à lui seul |

Le flux papier — bon de tournée imprimé, retour saisi par le gérant au Lot 15 —
livre **l'essentiel de la valeur** (traçabilité, réconciliation, écarts) avec
zéro infrastructure supplémentaire. Le terminal mobile n'ajoute que la saisie
au fil de l'eau.

**Critère de déclenchement** : si les écarts de réconciliation restent élevés
après 2 mois d'usage, c'est que la saisie a posteriori perd de l'information —
alors, et seulement alors, le terminal se justifie.

---

## 8. Rôles et permissions

L'ajout du rôle `driver` impose de décider **maintenant** ce qu'il peut faire,
car changer une liste de permissions après coup casse les postes en production.

| Rôle | Ajout | Retrait |
| --- | --- | --- |
| `owner` / `admin` | `DeliveryRunsManage`, `DeliveryRunsReconcile`, `ConsignmentsOverrideLimit` | — |
| `manager` | idem | — |
| `cashier` | `DeliveryRunsReconcile` (il tient la caisse) | — |
| `driver` (nouveau) | `DeliveryRunsExecute` uniquement | tout le reste |
| `accountant` | `DeliveryRunsRead` | — |
| `stock_manager` | `DeliveryRunsRead` | — |

Le rôle `driver` ne doit **jamais** obtenir `CashOperate` : il déclare des
encaissements, il n'ouvre ni ne ferme de caisse. C'est la garantie structurelle
que le sac du livreur reste séparé de la caisse (section 2).

Trois nouvelles permissions sont à créer, ce qui porte l'énumération de 27 à 30.
Comme `Permission::ALL` est utilisée pour la validation, l'ajout doit être
accompagné de son extension, sous peine d'écran de sécurité vide.

---

## 9. Ce que je refuse de construire

| Tenté | Décision | Justification |
| --- | --- | --- |
| Multi-dépôt | **Non** | `app_settings` est verrouillée à `id = 1`, `stock_locations` existe mais tout l'écosystème est mono-dépôt. Une refonte de `deposit_issues`, des soldes et de la caisse pour un besoin non démontré. |
| Une caisse par livreur | **Non** | Une seule session ouverte est autorisée ; cela ferait N caisses à compter. Contraire à la section 2. |
| Ordonnanceur d'échéances | **Non** | Section 4. |
| Plafond en valeur monétaire | **Non** | Section 3. |
| Signature macOS / SQLCipher | **Différé** | Coût récurrent et incompatibilité de build Windows déjà documentée. |
| Réécriture de `cash_movements` pour ajouter un `kind` | **Non** | `CHECK` non modifiable → reconstruction. On tague par colonnes, section 2. |

---

## 10. Risques

| Risque | Gravité | Parade |
| --- | --- | --- |
| Reconstruire `users` casse les clés étrangères | **Élevée** | Procédure SQLite en 12 étapes, `PRAGMA foreign_keys=OFF`, test de restauration de sauvegarde avant migration |
| Le plafond fait fuir des clients | **Élevée** | Mode `warn` par défaut, dérogation tracée, seuil haut au départ |
| Déclaration de collection non fiable | Moyenne | Écart mesuré au retour, imputation du manquant, historique par livreur |
| Deux soldes d'emballages incohérents | **Élevée** | À trancher au Lot 9, avant toute règle |
| `expected_amount` figé mais commande modifiée | Moyenne | Le snapshot est la référence ; la modification est un événement séparé, tracé |
| Tournée non clôturée | Moyenne | Alerte rouge après 24 h |

---

## 11. Questions restantes (je ne les tranche pas seul)

1. **Le livreur peut-il encaisser un règlement de créance ancienne**, ou
   seulement les commandes de sa tournée ? Cela change le plafond de ce qu'il
   peut déclarer, et donc le calcul d'écart.
2. **Le dépôt travaille-t-il en LAN ou l'application est-elle sur un seul
   poste ?** Si un seul poste, le Lot 16 est structurellement impossible sans
   serveur dédié.
3. **Combien de livreurs simultanés ?** Un seul : le modèle actuel suffit. Trois
   ou plus : il faut décider si plusieurs tournées peuvent être `in_progress` en
   même temps — les tables le permettent, l'interface doit le prévoir.
4. **Le caissier doit-il voir le stock ?** Aujourd'hui il ne peut pas
   (`StockRead` absent). À arbitrer avant d'ajouter des permissions.
5. **`adjustment` : implémenter ou retirer ?** Une valeur autorisée et jamais
   écrite dans un grand livre est une dette.
