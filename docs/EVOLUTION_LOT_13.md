# Lot 13 — Socle des tournées de livraison

> Migration + cœur, sans interface. Suite de `DECISIONS_TOURNEES_ET_CONSIGNES.md`.
> Vérifié et testé au 2026-11-23.

---

## 1. Ce qui est livré

| Élément | Nature |
| --- | --- |
| `migrations/sqlite/0027_delivery_runs.sql` | rôle `driver` + 4 tables + 2 colonnes |
| `crates/depotpro-core/src/application/delivery_runs.rs` | 6 fonctions du cœur |
| `crates/depotpro-core/tests/lot13_delivery_runs.rs` | 6 tests |
| `rbac.rs` | 4 permissions + rôle `driver` |
| `auth.ts`, `SecurityAndUsersCards.tsx` | rôle exposé au frontend |

Aucune interface de tournée : le Lot 15 s'en charge. Rien n'est visible dans
l'application, tout est utilisable par l'API et testé.

---

## 2. La partie risquée : reconstruire `users`

`users.role` est protégé par un `CHECK` que SQLite **ne sait pas modifier**.

```sql
CHECK (role IN ('owner','admin','manager','cashier','stock_manager','accountant'))
```

Ajouter `driver` impose une reconstruction complète de la table, référencée par
**12 clés étrangères** dans le schéma. La procédure officielle SQLite est
appliquée intégralement : création de `users_new`, copie, `DROP`, `RENAME`,
recréation de `idx_users_role_active` (l'index disparaît avec l'ancienne table).

**Un point que j'aurais pu manquer** : le moteur de migration n'ouvre
`PRAGMA foreign_keys = OFF` que pour les versions listées en dur :

```rust
let needs_fk_off = matches!(migration.version, 14 | 25 | 27);
```

Sans cet ajout, la migration aurait échoué en production — et **pas** sur une
base neuve, où les FK ne mordent pas. Le genre de bug qui passe la CI et casse
chez le client.

**Validé sur une base peuplée** (1 utilisateur, 1 session, 1 mouvement de caisse) :

```
utilisateurs conserves : 1
mouvements caisse      : 1 -> 1
index users recree     : ['idx_users_role_active']
role driver accepte    : OUI
integrite FK           : AUCUNE VIOLATION
```

---

## 3. Modèle retenu

```
delivery_runs          une tournée (référence TRN-000001)
delivery_run_stops     un arrêt : client, commande, ordre de passage
delivery_run_collections  déclarations du livreur, par moyen de paiement
delivery_run_returns   vides rapportés, par consignable
```

Cycle : `draft → loaded → in_progress → returned → reconciled`
Annulation possible depuis `draft`, `loaded`, `in_progress` uniquement.

### Le snapshot est figé au chargement

C'est la décision structurante. `load_run` calcule et **écrit** les montants
attendus, puis ne les recalcule plus jamais :

| Attendu | Calcul au moment du chargement |
| --- | --- |
| `expected_amount` | `orders.total_to_collect_xof - paid_xof`, borné à 0 |
| `expected_empty_pieces` | somme des consignes ouvertes du client |

**Testé explicitement** : après chargement, modifier `orders.paid_xof` ne change
plus l'attendu. Recharger ne refige pas le snapshot — sinon les corrections du
soir seraient perdues.

Même principe que `deposit_issues.unit_value` : ce qui a été constaté reste
constaté.

### Le sac du livreur n'est pas la caisse

`delivery_run_collections` ne touche **aucune** table de caisse. Les colonnes
`delivery_run_id` et `collected_by_user_id` ajoutées à `cash_movements` servent
au Lot 14, où la réconciliation écrira les mouvements.

`cash_movements.kind` a un CHECK non modifiable : on ne peut pas y ajouter
`'delivery_collection'`. La distinction passe donc par ces colonnes, pas par le
type de mouvement.

---

## 4. Permissions

31 permissions (27 + 4), et le rôle `driver` avec **une seule** :

| Rôle | Permissions de tournée |
| --- | --- |
| `owner` | toutes (via `Permission::ALL`) |
| `admin` | Read, Manage, Reconcile |
| `manager` | Read, Manage, Reconcile |
| `cashier` | Read, Reconcile (il tient la caisse) |
| `stock_manager` | Read |
| `accountant` | Read |
| **`driver`** | **Execute uniquement** |

Le livreur n'a **ni `CashOperate`, ni `SalesWrite`**. C'est la garantie
structurelle que son sac reste séparé de la caisse, et pas seulement une
convention.

---

## 5. Un bug attrapé avant de pousser

Ma première requête de calcul du montant attendu était :

```sql
SELECT order_id,
       CASE WHEN order_id IS NULL THEN 0
            ELSE MAX(0, COALESCE((SELECT total_to_collect_xof - paid_xof
                                  FROM orders WHERE id = order_id), 0))
       END
FROM delivery_run_stops WHERE id = ?
```

`WHERE id = order_id` **s'auto-référence** : `id` résout vers la sous-requête
elle-même, qui retourne toujours la première ligne de `orders`. Test sur deux
commandes différentes :

```
avant  : commande 1 -> 4600 | commande 2 (surpayée) -> 4600   ❌
apres  : commande 1 -> 4600 | commande 2 -> 0                 ✅
```

Corrigé par des alias explicites (`s`, `o`). Le second cas est le plus parlant :
une commande entièrement payée aurait été comptée comme due.

---

## 6. Tests

| Test | Ce qu'il protège |
| --- | --- |
| `run_can_only_be_assigned_to_a_driver` | un caissier ne peut pas être livreur |
| `create_run_is_idempotent_on_request_key` | rejouer la requête ne duplique pas |
| `stop_cannot_target_another_clients_order` | pas de livraison croisée entre clients |
| `load_freezes_expected_amounts_and_status_flow_is_guarded` | snapshot figé + transitions gardées |
| `cancel_is_refused_once_the_run_has_returned` | un retour constaté ne s'annule pas + `cashier` sans `Manage` |
| `expected_empty_pieces_follow_open_deposit_issues` | 3 + 2 consignes = 5 vides attendus |

---

## 7. Ce que ce lot ne fait pas

| Manquant | Lot |
| --- | --- |
| Réconciliation (comptage, écarts, écriture des mouvements de caisse) | 14 |
| Saisie des collections par le livreur | 14 |
| Retour des vides tournée (stock + `deposit_issues`) | 14 |
| Interface gérant | 15 |
| Terminal mobile | 16, différé |

**Point d'attention pour le Lot 14** : la réconciliation devra exiger une
session de caisse ouverte, comme `return_client_empties` le fait déjà. C'est la
règle unique retenue : *tout franc qui entre dans le dépôt passe par une session
de caisse ouverte*.

Et le retour des vides devra alimenter `deposit_issues` — la logique existe déjà
dans `apply_customer_empty_return_tx`, qui gère la priorité à la vente de la
commande et l'exclusion des pièces converties ou perdues. Il faut la réutiliser,
pas la réécrire.
