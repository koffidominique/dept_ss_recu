# Lot 16 — Les tournées deviennent joignables

> Exposer en HTTP le cœur écrit aux Lots 13 et 14. Aucune logique métier
> nouvelle : uniquement de l'accès, plus un rôle cassé réparé en chemin.
> CI verte 13/13, 4 tests HTTP dédiés.

---

## 1. Le problème, dit franchement

Le cœur des tournées existait. Il était testé — 12 tests au Lot 14, tous verts.
Et il était **inatteignable depuis l'application**.

Aucune route ne l'exposait. Autrement dit : une fonctionnalité complète, relue,
testée, et impossible à utiliser. C'est exactement le genre de travail qui a
l'air terminé dans une revue de code, parce que tout ce qu'on regarde est vert,
et qui ne l'est pas. Un dépôt qui ne se voit pas dans l'écran n'existe pas pour
le gérant.

---

## 2. Ce qui est livré

| Élément | Nature |
| --- | --- |
| `handlers/delivery.rs` | 13 handlers |
| `router/orders_routes.rs` | 12 routes `/api/delivery-runs…` |
| `tests/delivery_http_tests.rs` | 4 tests (`mod` déclaré) |
| `auth/rbac.rs` | `Role::Driver` corrigé |

### Les routes

| Méthode | Chemin | Permission |
| --- | --- | --- |
| `GET` | `/api/delivery-runs` | `DeliveryRunsRead` |
| `POST` | `/api/delivery-runs` | `DeliveryRunsManage` |
| `GET` | `/api/delivery-runs/:id` | `DeliveryRunsRead` |
| `POST` | `/api/delivery-runs/:id/stops` | `DeliveryRunsManage` |
| `POST` | `/api/delivery-runs/:id/load` | `DeliveryRunsManage` |
| `POST` | `/api/delivery-runs/:id/start` | `DeliveryRunsExecute` |
| `POST` | `/api/delivery-runs/:id/cancel` | `DeliveryRunsManage` |
| `POST` | `/api/delivery-runs/:id/stops/outcome` | `DeliveryRunsManage` |
| `POST` | `/api/delivery-runs/:id/collections` | `DeliveryRunsExecute` |
| `POST` | `/api/delivery-runs/:id/returns` | `DeliveryRunsManage` |
| `POST` | `/api/delivery-runs/:id/return` | `DeliveryRunsManage` |
| `POST` | `/api/delivery-runs/:id/reconcile` | `DeliveryRunsReconcile` |
| `GET` | `/api/delivery-runs/:id/reconciliation` | `DeliveryRunsRead` |

Le partage des permissions suit une règle simple : **le gérant prépare et
constate, le livreur exécute**. Déclarer un encaissement et démarrer une
tournée sont des gestes de terrain ; charger la tournée (qui fige l'attendu) et
réconcilier (qui écrit en caisse) sont des gestes de comptoir.

---

## 3. Le défaut réel : un livreur qui part sans savoir où aller

Trouvé en écrivant le test, pas en relisant la matrice.

`Role::Driver` ne portait qu'une permission : `DeliveryRunsExecute`. Le livreur
pouvait donc **démarrer** une tournée — mais pas en **lire** les arrêts. Il
appuyait sur « partir » et n'avait aucun moyen de savoir chez qui aller.

```rust
// avant
Role::Driver => &[DeliveryRunsExecute],
// après
Role::Driver => &[DeliveryRunsRead, DeliveryRunsExecute],
```

Le test l'a montré en une ligne : lecture de la tournée par le livreur → `403`.
Le correctif est dans `rbac.rs`, pas dans le handler — inutile de laisser passer
une lecture interdite pour compenser un rôle mal réglé.

### La limite assumée

`DeliveryRunsRead` **n'est pas filtrée par ligne** : un livreur voit toutes les
tournées du dépôt, pas seulement les siennes. Pour quelques livreurs, c'est
acceptable et documenté dans le code. Le jour où ça ne l'est plus, le filtre
porte sur `driver_user_id` — c'est une décision produit à prendre, pas un oubli
à rattraper.

Écrire cette limite dans le code plutôt que la taire : la prochaine personne qui
ouvre `rbac.rs` saura qu'elle est connue.

---

## 4. Trois choses que les tests ont corrigées

### ① Mon attente de statut était fausse, pas le code

J'avais écrit `422` pour « tournée vide » et « réconciliation d'un brouillon ».
La CI a rendu `400`.

`CoreError::Validation` est traduit en **400 `VALIDATION_ERROR`** par `map_err`.
`422` ne sort que de l'extracteur JSON, quand le corps est malformé. Une erreur
métier n'est pas une requête malformée : le code était juste, mon test ne
l'était pas.

Le test vérifie désormais le statut **et** le code applicatif — c'est le code
que le front lit, pas le numéro HTTP.

### ② `display_name` n'existe pas sur le fil

`CreateUserInput` dérive `#[serde(rename_all = "camelCase")]`. Trois corps de
test envoyaient `display_name`, d'où un `422` à la création du livreur, et
**deux tests en cascade** tombés pour une cause qui n'avait rien à voir avec les
tournées.

Rappel utile : une erreur d'amorçage dans un test fait échouer tout ce qui suit,
et le message pointe le mauvais endroit.

### ③ Le module de test non déclaré

`delivery_http_tests.rs` existait mais n'était pas déclaré dans `tests/mod.rs`.
Rust ne l'aurait jamais compilé : quatre tests écrits, zéro test exécuté, et une
CI verte qui n'aurait rien prouvé. C'est le piège le plus silencieux du dépôt.

---

## 5. Ce que les tests couvrent

| Test | Ce qu'il prouve |
| --- | --- |
| `delivery_routes_are_reachable_and_guarded` | les 12 routes existent ; `401` sans jeton ; `404` sur id inconnu |
| `a_run_can_be_created_and_read_through_http` | création `201`, statut `draft`, idempotence `request_key`, contrat de sortie |
| `reconciling_without_a_stop_or_session_is_refused_over_http` | refus métier en `400` + code, jamais en `500` |
| `a_driver_can_start_but_not_reconcile_over_http` | livreur : `200` en lecture, `200` au départ, `403` sur create/load/reconcile |

---

## 6. État du chantier tournées

| Lot | Contenu | État |
| --- | --- | --- |
| 13 | socle : tournées, arrêts, chargement | livré |
| 14 | réconciliation, retours de vides | livré |
| 15 | vides rapportés à la commande | livré |
| **16** | **exposition HTTP + rôle livreur** | **livré** |

Le cœur et l'accès sont désormais alignés : tout ce que le Lot 13 et le Lot 14
savent faire est joignable. Reste l'écran — les routes existent, aucune page ne
les appelle encore.
