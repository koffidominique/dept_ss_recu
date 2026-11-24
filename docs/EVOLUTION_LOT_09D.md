# Lot 9d — La dépendance livrer/facturer : mesure et conclusion

> Suite du Lot 9c. Ce document corrige une affirmation que j'avais avancée
> sans la vérifier, et mesure si le défaut existe réellement.
> Vérifié dans le code au 2026-11-23.

---

## 0. Résumé

**J'avais tort.** La dépendance « livrer/facturer » que j'annonçais comme
bloquante pour le Lot 13 **n'existe pas**. Le circuit est déjà couvert dans les
deux ordres.

Ce document l'établit, identifie le **vrai** défaut résiduel (absence de
déduplication), et conclut qu'il ne justifie **aucun chantier avant le Lot 13**.

---

## 1. Ce que j'avais annoncé

> « `deliver_order` n'écrit la consigne que si une vente existe déjà. Livrer
> avant facturer perd la consigne définitivement. »

Cette affirmation reposait sur une lecture partielle : j'avais lu
`deliver_order` et conclu que la seule voie de création était
`existing_sale_id`. Je n'avais pas lu `invoice_order`.

---

## 2. Ce que le code fait réellement

Deux fonctions peuvent créer les consignes d'une commande, avec des **gardes
complémentaires** :

### `deliver_order` — `orders/lifecycle.rs:326`

```rust
if let Some(sid) = existing_sale_id {
    // crée les lignes deposit_issues
}
```

Ne crée que si une **vente existe**.

### `invoice_order` — `orders/lifecycle_settlement.rs:190`

```rust
let was_delivered: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM packaging_movements WHERE order_id = ? AND movement_type = 'LIVRAISON_CLIENT'",
)...;
if status == "delivered" || was_delivered > 0 {
    // crée les lignes deposit_issues
}
```

Ne crée que si la commande est **déjà livrée**. Et comme elle était en statut
`confirmed` ou `delivered` pour être facturable, la livraison a bien eu lieu.

### Conséquence : les deux ordres fonctionnent

| Ordre | `deliver_order` | `invoice_order` | Consigne créée ? |
| --- | --- | --- | --- |
| Facturer puis livrer | vente existe → écrit | n/a | ✅ par `deliver_order` |
| Livrer puis facturer | pas de vente → n'écrit pas | livrée → écrit | ✅ par `invoice_order` |

Le flux réel d'une tournée — livrer, puis facturer — est donc **déjà couvert**.
Le Lot 13 peut se construire dessus.

---

## 3. Le défaut qui reste : aucune déduplication

Les deux fonctions se fient à leur garde de statut, pas à l'état réel des
consignes :

```
grep "EXISTS" orders/lifecycle_settlement.rs  -> 0
```

Aucun `NOT EXISTS (SELECT 1 FROM deposit_issues WHERE sale_id = …)`.

**Pourquoi ça tient quand même aujourd'hui :** les gardes de statut sont
suffisantes parce que les transitions sont atomiques et séquentielles.

- `deliver_order` refuse si `already_delivered > 0 || status == "delivered"`
  (`lifecycle.rs:188`).
- `invoice_order` retourne immédiatement si `status IN ('invoiced','paid')`
  (`lifecycle_settlement.rs:37`).

**Quand ça peut casser :** si une commande se retrouve `delivered` **sans**
mouvement `LIVRAISON_CLIENT` enregistré — reprise manuelle, restauration
partielle, correction SQL. Dans ce cas `invoice_order` créerait une seconde
consigne. C'est un scénario de reprise d'incident, pas un flux normal.

**Verdict : correctif souhaitable, non bloquant.** Le geste est petit :

```sql
AND NOT EXISTS (
    SELECT 1 FROM deposit_issues di
    WHERE di.sale_id = ? AND di.returnable_id = pa.returnable_id
)
```

Cette condition rendrait la création **idempotente sur l'état réel** plutôt que
sur le statut déclaré. Je le laisse hors de ce lot : il ne bloque rien, et il
vaut mieux l'accompagner d'un test de reprise que de l'insérer au milieu d'un
chantier déjà livré.

---

## 4. Le vrai problème du retour d'emballages, lui, est réel

En cherchant la dépendance livrer/facturer, j'ai trouvé un défaut plus grave.

`return_order_packaging` (`orders/packaging_and_returns.rs:358`) met à jour :

- `order_packaging_allocations.returned_quantity` ;
- `customer_deposit_balances` (via `load_customer_deposits`).

Il **ne touche pas** :

- `deposit_issues` ;
- `customer_packaging_accounts`.

Vérification :

```
grep "deposit_issues" orders/packaging_and_returns.rs  -> 0 occurrence dans return_order_packaging
```

**Conséquence concrète.** Un client rend 1 casier via la commande :

| Table | Effet | Visible où |
| --- | --- | --- |
| `customer_deposit_balances` | −1 ✅ | **nulle part** (aucun écran ne la lit) |
| `deposit_issues.returned_pieces` | inchangé ❌ | onglet « Consignes ouvertes » |
| `customer_packaging_accounts` | inchangé ❌ | onglet « Soldes par client » |

Le gérant rend le casier, et **les deux écrans qu'il consulte affichent encore
la dette**. La dette ne diminue jamais. Au bout de 15 jours, l'échéance passée,
la consigne est convertie en créance financière — pour un casier **déjà rendu**.

C'est plus grave que la dépendance livrer/facturer : c'est une **double
facturation** potentielle, à chaque retour par commande.

### Pourquoi les tests ne le voient pas

`orders_mixed.rs` vérifie `after_ret.customer_deposits[0].quantity_held == 0`.
C'est la table que le retour met à jour, et celle qu'aucun écran ne lit. Le test
valide la seule partie du retour qui n'a pas d'effet visible.

### Ce que je recommande

Faire de `return_order_packaging` un **appelant de `return_client_empties`**
(ou de sa logique) au lieu d'une seconde implémentation. Aujourd'hui il y a deux
codes de retour d'emballages qui écrivent dans des tables différentes — c'est
exactement le problème « plusieurs sources de vérité » que le Lot 9a doit
supprimer.

**Ordre recommandé : 9a d'abord, puis ce correctif.** Corriger `return_order_packaging`
avant 9a reviendrait à écrire une troisième adaptation dans un système déjà
incohérent.

---

## 5. Conclusion pour le Lot 13

Le Lot 13 (tournées) **n'est pas bloqué** par la dépendance livrer/facturer :

- livrer puis facturer fonctionne ;
- facturer puis livrer fonctionne.

Il est en revanche **exposé** au défaut de `return_order_packaging` : une
tournée dont le livreur récupère des casiers produira un retour qu'il faudra
enregistrer, et le chemin actuel ne soldera pas la dette.

**Piste la plus économique** : ne pas réutiliser `return_order_packaging` dans
les tournées. Le retour de tournée du Lot 14 doit alimenter directement
`deposit_issues` (répartition FIFO par échéance, déjà prévue dans
`DECISIONS_TOURNEES_ET_CONSIGNES.md` §6). Ainsi la tournée contourne le défaut
au lieu d'en hériter.

---

## 6. Ce que j'ai appris de cette erreur

Mon affirmation précédente venait d'une lecture d'**une** fonction sur deux. Le
dépôt a régulièrement deux chemins pour la même opération
(`create_persistence` / `lifecycle`, `return_client_empties` /
`return_order_packaging`) : conclure depuis un seul chemin est structurellement
risqué ici.

Règle que j'applique désormais sur ce dépôt : **avant d'annoncer qu'un
comportement manque, chercher toutes les fonctions qui écrivent dans la table
concernée.**

```
grep -rn "INSERT INTO deposit_issues" crates/  ->  4 sites
```

Quatre sites d'écriture, donc quatre chemins à examiner avant de conclure.
