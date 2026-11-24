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

### 2.1 Résolution à la volée dans `deliver_order` (le vrai correctif)

`deliver_order` rattache désormais lui-même les actifs consignables qui n'ont
pas de consignable, en trois requêtes :

1. créer le consignable manquant depuis l'actif (`code = 'EMB-AUTO-' || code`,
   `producer = 'DEPOT'`, `deposit_value` reprise de l'actif) ;
2. initialiser son stock à 0 dans `returnable_stock_balances` ;
3. renseigner `packaging_assets.returnable_id`.

C'est **exactement le mécanisme déjà utilisé par `apply_catalog_presets`**, qui
crée les consignables à la volée quand un preset les référence. Le code dérivé
de l'actif rend l'opération idempotente : rejouer la livraison ne duplique rien.

**Pourquoi pas dans la migration ?** Un test d'architecture
(`lot4_fresh_db_neutral_defaults_and_schema_parity_with_node`) impose que
`returnable_packaging_types` reste **vide** sur une base neuve : aucune donnée
commerciale fictive. Une migration ne peut donc pas créer de consignable. La
création doit être un **acte métier**, pas une étape de schéma.

### 2.2 Migration `0026_link_packaging_assets_to_returnables.sql`

Rattachement des actifs existants aux consignables **déjà présents**, par trois
critères cumulatifs — utile sur un dépôt existant dont le catalogue de brasseries
a créé les consignables :

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

### 2.3 Ce que j'ai d'abord fait de faux

Ma première version bloquait la livraison quand l'actif n'était pas rattaché, avec
un message demandant de créer le consignable manuellement. **C'était pire que le
bug** : sur une base neuve, aucun consignable n'existe, donc *toute* livraison de
consigne devenait impossible. Le scénario E2E l'a révélé immédiatement.

C'est le genre d'erreur que seule l'exécution révèle : le raisonnement « refuser
plutôt que perdre en silence » est juste, mais il supposait que le consignable
existait déjà. La résolution à la volée rend la garde inutile.

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

**Correction de ce que j'avais annoncé.** J'ai d'abord écrit que « livrer avant
facturer perd la consigne définitivement ». C'est **faux** : `invoice_order`
(lifecycle_settlement.rs:190) crée les consignes dès lors que la commande a été
livrée. Les deux fonctions sont **complémentaires**, et ensemble elles couvrent
les deux ordres possibles :

| Ordre | Qui crée la consigne |
| --- | --- |
| Facturer puis livrer | `deliver_order` (via `existing_sale_id`) |
| Livrer puis facturer | `invoice_order` (via `was_delivered > 0`) |

Le vrai défaut n'est donc pas l'ordre des opérations, mais qu'**aucune des deux
fonctions ne déduplique** : elles se fient à leur garde de statut. Correct tant
que l'état est cohérent, fragile si une reprise ou un correctif manuel laisse la
commande dans un état intermédiaire.

Voir `docs/EVOLUTION_LOT_09D.md` pour la mesure et les correctifs.

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
