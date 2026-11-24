# Lot 9c — Rendre la consigne d'une commande réellement traçable

> Suite du Lot 9c annoncé dans `docs/DECISION_SIMPLIFICATION.md`.
> Chaque affirmation est vérifiée dans le code au 2026-11-23.

---

## 1. Le défaut, prouvé

`packaging_assets.returnable_id` existe depuis la migration `0019`, mais la
colonne n'est **jamais** renseignée :

- le seed de `0019` ne la fournit pas ;
- `seed_demo.rs` ne la met pas à jour non plus.

Or `deliver_order` en dépend directement (`orders/lifecycle.rs:287`) :

```rust
if let Some(rid) = returnable_id_opt {
    // insert customer_packaging_accounts
    if let Some(sid) = existing_sale_id {  // la commande doit être DÉJÀ facturée
        // insert deposit_issues
    }
}
```

**Deux conséquences cumulées :**

1. Aucune commande livrée ne crée de `deposit_issues` — donc aucune dette
   d'emballages, aucune échéance, aucune conversion possible.
2. Même avec le rattachement, `deliver_order` n'écrit la consigne que si une
   **vente existe déjà**. Livrer puis facturer perd la consigne définitivement.

Le test existant `orders_mixed.rs` ne le détectait pas : il vérifiait
`delivered.customer_deposits` (la table `customer_deposit_balances`), jamais
`deposit_issues`. Il affirmait donc que le cycle fonctionnait alors que la moitié
comptable du cycle était vide.

---

## 2. Correction apportée

### 2.1 Migration `0026_link_packaging_assets_to_returnables.sql`

Rattachement **déterministe** des actifs existants aux consignables, par trois
critères cumulatifs :

| Critère | Source | Exemple |
| --- | --- | --- |
| Volume | `compatibility_class` encode `<volume>cl` (`compute_compatibility_class`) | `bottle_33cl_glass` → 33cl |
| Capacité | `packaging_assets.capacity` = nombre d'alvéoles du consignable | 24 |
| Type | `returnable_packaging_types.kind = 'crate'` | casier, pas bouteille |

Le rattachement ne touche que `returnable_id IS NULL` : il est **rejouable** et
n'écrase jamais un rattachement manuel. Un index sur `packaging_assets(returnable_id)`
est ajouté.

La migration **aligne aussi la politique globale à 15 jours** : `0015` la créait
à 30 alors que 22 fichiers d'interface et 4 retombées Rust valent 15. C'est le
début du Lot 9b, sans lequel la consigne nouvellement créée serait incohérente
avec le bon remis au client.

### 2.2 Garde dans `deliver_order`

Un actif consignable non rattaché produit désormais une **erreur explicite**
plutôt qu'une dette silencieusement absente :

```
L'emballage consigné de cette commande n'est rattaché à aucun consignable
(packaging_assets.returnable_id est vide). Renseignez le rattachement dans
le catalogue des emballages avant de livrer, sinon la consigne ne sera pas tracée.
```

Le test ne rejette pas la livraison pour un motif obscur : il dit quoi faire.

---

## 3. Résultat mesuré sur les données réelles

Simulation complète sur les migrations appliquées en mémoire, avec les 12
consignables du catalogue `catalog/brewery_catalog.json` :

| Actif | Capacité | Résultat |
| --- | --- | --- |
| `PA-CASIER-24X33` | 24 | ✅ `EMB-SOL-CAS24-33` (SOLIBRA) |
| `PA-CASIER-12X50` | 12 | ✅ `EMB-SOL-CAS12-50` (SOLIBRA) |
| `PA-CASIER-12X65` | 12 | ✅ `EMB-SOL-CAS12-65` (SOLIBRA) |
| `PA-CASIER-12X100` | 12 | ❌ aucun consignable 100cl au catalogue |
| `PA-CASIER-20X50` | 20 | ❌ aucun consignable 20 alvéoles |
| `PA-CARTON-24X33` | 24 | ⏭️ non consignable (`returnable = 0`), correct |
| `PA-CARTON-24X50` | 24 | ⏭️ non consignable, correct |

**Deux actifs restent non rattachés, et c'est assumé.** Le catalogue ne propose
aucun consignable pour 12×100cl ni pour 20×50cl. Inventer un rattachement
produirait une dette fausse ; la garde du §2.2 fait échouer la livraison avec un
message clair, et le gérant doit créer le consignable manquant dans le catalogue
des emballages — ce qui est précisément le geste attendu.

**Idempotence vérifiée** : rejouer la migration laisse `returnable_id` et la
politique inchangés.

---

## 4. Tests

### 4.1 Test existant corrigé

`orders_mixed_cases_1_to_7_and_lifecycle` :

- crée un consignable de test ;
- vérifie qu'une livraison **sans** rattachement est **refusée** ;
- rattache l'actif, puis livre avec succès.

Le test documente maintenant le comportement réel au lieu de le contourner.

### 4.2 Nouveau test

`order_consignment_is_traced_in_deposit_issues_when_invoiced_then_delivered` :

| Assertion | Ce qu'elle prouve |
| --- | --- |
| `allocations.len() == 1` | un casier est bien alloué |
| `deposit_issues` existe | la consigne naît réellement (elle n'existait pas avant) |
| `pieces == 1`, `returned_pieces == 0` | la dette est ouverte, intacte |
| `unit_value == 1000`, `amount == 1000` | valeur figée à la livraison |
| `status == "pending"` | statut initial correct |
| `due_date` non vide | l'échéance est exploitable |
| `return_delay_days == 15` | la politique est alignée, pas une retombée en dur |

L'ordre **facturer puis livrer** est imposé par le code actuel
(`existing_sale_id`) et documenté dans le test.

---

## 5. Risques résiduels

| Risque | Gravité | Parade |
| --- | --- | --- |
| **Livrer avant facturer perd la consigne** | **Élevée** | Non corrigé dans ce lot : c'est un choix d'architecture à trancher. Correctif possible en créant la consigne depuis `invoice_order` ou en autorisant `sale_id` NULL (déjà supporté par `0025` sur `sale_line_id`). |
| Deux actifs sans consignable (100cl, 20×50) | Moyenne | Livraison refusée avec message explicite ; le gérant crée le consignable |
| `deposit_issues.sale_id` reste NOT NULL | Moyenne | Bloque la correction du point 1 sans migration supplémentaire |
| Politique à 15 j imposée par migration | Faible | Le réglage `app_settings` du Lot 9b la rendra administrable |

**Le premier point est le plus important.** Ce lot rend la consigne *possible* ;
il ne la rend pas *certaine*. Tant que `deliver_order` exige `existing_sale_id`,
un dépôt qui livre avant de facturer — ce qui est le flux réel d'une tournée —
perdra la consigne. C'est exactement le prochain chantier, et il converge avec le
Lot 13 (tournées) où la livraison est le point de départ, pas la conclusion.

---

## 6. Fichiers touchés

| Fichier | Nature |
| --- | --- |
| `migrations/sqlite/0026_link_packaging_assets_to_returnables.sql` | nouveau |
| `crates/depotpro-core/src/infrastructure/db/sql_defs.rs` | const + entrée + `CURRENT_SCHEMA_VERSION` 25 → 26 |
| `crates/depotpro-core/src/application/orders/lifecycle.rs` | garde explicite |
| `crates/depotpro-core/tests/orders_mixed.rs` | test existant durci + 1 nouveau test |

Aucune interface modifiée. Le changement est invisible pour l'utilisateur, sauf
lorsqu'il tente de livrer une consigne non rattachée — auquel cas il reçoit
désormais une explication au lieu d'un silence.
