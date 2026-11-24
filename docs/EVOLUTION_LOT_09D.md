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

## 4. RECTIFICATION : le défaut que j'avais annoncé n'existe pas

J'ai écrit que `return_order_packaging` ne mettait pas à jour `deposit_issues`,
et j'ai présenté cela comme une double facturation potentielle. **C'est faux.**

Le bloc existe, dans `apply_customer_empty_return_tx`
(`orders/packaging_and_returns.rs:270-318`), et il est **plus complet** que ce que
j'aurais écrit :

```rust
"SELECT id, pieces, returned_pieces, lost_pieces + destroyed_pieces + converted_pieces
 FROM deposit_issues
 WHERE client_id = ? AND returnable_id = ?
   AND status IN ('pending', 'partially_returned')
 ORDER BY CASE WHEN ? IS NOT NULL AND sale_id = ? THEN 0 ELSE 1 END ASC,
          COALESCE(due_date, '9999-12-31') ASC,
          id ASC"
```

Il fait exactement ce qu'il faut :

| Point | Traitement correct |
| --- | --- |
| Priorité à la vente de la commande | `CASE WHEN sale_id = ? THEN 0 ELSE 1` |
| Exclut les pièces déjà sorties | `lost_pieces + destroyed_pieces + converted_pieces` |
| Restant borné | `(pieces - returned - other_out).max(0)` |
| Statut cohérent | `next_returned + other_out >= pieces` → `settled` |

**Pourquoi j'ai manqué ce bloc.** J'ai cherché `deposit_issues` dans
`packaging_and_returns.rs` et j'ai restreint ma recherche à la plage de lignes de
`return_order_packaging` (358+). Or le bloc vit dans la fonction utilitaire
`apply_customer_empty_return_tx` (ligne 177), que `return_order_packaging` appelle.
Chercher par numéro de ligne au lieu de chercher par nom de fonction : c'est
exactement l'erreur que j'avais déjà consignée sur ce dépôt.

Le commit `git log -S "FROM deposit_issues"` confirme que le bloc date de
`0cff48b`, donc du socle, pas de mes travaux.

---

## 5. Conclusion pour le Lot 13

Le Lot 13 (tournées) **n'est pas bloqué** par la dépendance livrer/facturer :

- livrer puis facturer fonctionne ;
- facturer puis livrer fonctionne.

Comme établi en §4, `return_order_packaging` solde bien `deposit_issues`. Le
retour de tournée du Lot 14 peut donc réutiliser `apply_customer_empty_return_tx`
plutôt que réimplémenter la répartition FIFO : la logique est déjà écrite, testée
et plus complète qu'une réécriture.

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

Quatre sites d'écriture, donc quatre chemins à examiner avant de conclure — et
surtout : **chercher par nom de fonction, jamais par plage de lignes**. C'est la
deuxième fois que cette erreur me coûte une conclusion fausse sur ce dépôt.
