# Analyse — le cycle des emballages consignés

> Analyse du code réel, pas d'une intention. Tous les chemins de fichiers et les
> valeurs cités ont été vérifiés dans le dépôt (`crates/depotpro-core`).
> Ce document décrit **ce que le code fait**, y compris là où il surprend.

## 0. Vue d'ensemble : quatre sous-systèmes, un seul pivot

```
        ┌──────────────────────────┐
        │   packaging_components   │  le référentiel : qu'est-ce qu'un casier ?
        │   casiers, bouteilles,   │  montage / démontage physique
        │   profils                │
        └────────────┬─────────────┘
                     │ alimente
        ┌────────────▼─────────────┐
        │      consignments        │  la sortie chez le client
        │  returnables, soldes     │  et le retour des vides
        └────────────┬─────────────┘
                     │ crée une ligne
        ┌────────────▼─────────────┐
        │     deposit_issues       │  ◄── LE PIVOT
        │  une ligne = une dette   │      du physique vers le financier
        │  d'emballage par client  │
        └────────────┬─────────────┘
                     │ si non rendu à l'échéance
        ┌────────────▼─────────────┐
        │  packaging_obligations   │  conversion en créance financière
        │  échéances, pertes,      │  grand livre, remboursements
        │  grand livre             │
        └──────────────────────────┘

        ┌──────────────────────────┐
        │     partial_returns      │  retours partiels, validation
        │                          │  composant par composant
        └──────────────────────────┘
```

**La table `deposit_issues` est le pivot.** Tout le cycle se lit comme l'histoire
de cette ligne : elle naît à la vente, se remplit au retour, se ferme au
règlement — ou se convertit en argent si le client ne rend rien.

## 1. Le référentiel : qu'est-ce qu'une consigne ?

### Les deux notions distinctes

| Notion | Table | Rôle |
| --- | --- | --- |
| Type de contenant consignable | `returnable_packaging_types` | le **quoi** (casier 24×33cl) |
| Valeur de consigne | `packaging_values` | le **combien** (1000 FCFA par casier) |
| Politique de retour | `packaging_policies` | le **quand** et le **que faire** |

Le seed standard (`migrations/sqlite/0019_orders_and_packaging.sql`) définit des
valeurs réelles :

| Code | Désignation | Capacité | Consigne |
| --- | --- | --- | --- |
| `PA-CASIER-24X33` | Casier 24 × 33cl verre | 24 | **1 000 FCFA** |
| `PA-CASIER-12X50` | Casier 12 × 50cl verre | 12 | 1 000 FCFA |
| `PA-CASIER-12X65` | Casier 12 × 65cl verre | 12 | 1 200 FCFA |
| `PA-CASIER-12X100` | Casier 12 × 100cl verre | 12 | 1 500 FCFA |
| `PA-CASIER-20X50` | Casier 20 × 50cl verre | 20 | 1 000 FCFA |
| `PA-CARTON-24X33` | Carton 24 × 33cl canette | 24 | **0** (non consigné) |

Les cartons ne sont **pas** consignés (`returnable = 0`, consigne 0) : ils
traversent le système sans créer de dette. C'est cohérent — un carton ne se rend
pas.

### Décomposition d'un casier

Un casier n'est pas un objet atomique. `crate_components` le décompose en :

```
component_type IN ('crate_support', 'bottle', 'cap', 'label', 'crate_assembled', 'other')
```

avec `quantity_per_crate` et `deposit_value` par composant. Cela permet de
suivre séparément les **supports plastiques** (le casier nu) et les **bouteilles
verre** qui l'occupent — deux valeurs de consigne différentes, deux durées de
vie différentes.

`assemble_crates` / `disassemble_crates` gèrent la conversion : monter un casier
consomme des supports et des bouteilles vides (`stock_empty`), produit un
`crate_assembled` (`stock_full`). Le démontage inverse l'opération.

## 2. La naissance : la consigne sort à la vente

### Le point d'écriture

`sales/create_persistence.rs:172` — dans **la même transaction** que la vente :

```sql
INSERT INTO deposit_issues (sale_id, sale_line_id, client_id, returnable_id,
                            pieces, unit_value, amount, due_date, policy_id, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
```

Puis, dans le même mouvement :

```sql
INSERT INTO customer_packaging_accounts (...) ON CONFLICT(...) DO UPDATE SET
  balance_pieces       = balance_pieces + excluded.balance_pieces,
  deposit_held_amount  = deposit_held_amount + excluded.deposit_held_amount
```

Trois invariants à la naissance :

1. **`status = 'pending'`** — la dette d'emballage est ouverte.
2. **`unit_value` est figé** dans la ligne. Si le tarif de consigne change demain,
   les dettes existantes gardent leur valeur d'origine. C'est volontaire : on ne
   réévalue pas une dette rétroactivement.
3. **`client_id` peut être `NULL`** (migration `0025` a rendu `sale_line_id`
   nullable, pour les ventes sans ligne identifiée).

### Le calcul de l'échéance : cascade de politiques

`create_persistence.rs:150` cherche la politique applicable avec une priorité
**client > emballage > défaut**, puis retombe sur **15 jours** :

```rust
.fetch_optional(&mut **tx).await?
.unwrap_or((None, 15));
let due_date = (Utc::now() + Duration::days(return_delay_days))
    .format("%Y-%m-%d").to_string();
```

La même cascade est réimplémentée en `resolve_policy`
(`packaging_obligations/conversions.rs:108`) avec un ordre explicite :

```
client + emballage   >  client seul  >  emballage seul  >  global
```

**Si aucune politique n'existe** : `(None, 15, true)` — 15 jours, et
**`auto_convert_on_due = true`**. Le défaut est donc *agressif* : à défaut de
configuration, l'emballage non rendu devient une créance financière au bout de
15 jours. C'est un choix à connaître, il n'est pas neutre.

### Les trois chemins de création

`pgrep` des `INSERT INTO deposit_issues` donne trois sites :

| Site | Contexte |
| --- | --- |
| `sales/create_persistence.rs:172` | Vente comptoir |
| `sales/create_persistence.rs:341` | Vente avec retour immédiat (status `returned`) |
| `orders/lifecycle.rs:295` | Commande à la livraison |
| `orders/lifecycle_settlement.rs:240` | Commande à la facturation |

Les consignes d'une commande sont donc créées **au moment physique** (livraison),
pas à la création du brouillon. Une commande en brouillon ne crée aucune dette
d'emballage — cohérent avec le fait qu'elle ne déduit pas non plus le stock.

## 3. Les états de `deposit_issues`

Contrainte réelle (`migrations/sqlite/0015_packaging_obligations_conversions.sql`) :

```sql
CHECK (status IN ('pending', 'partially_returned', 'settled', 'converted', 'cancelled'))
```

| Statut | Signification | Comment on y arrive |
| --- | --- | --- |
| `pending` | Rien n'est revenu | Création |
| `partially_returned` | Une partie est revenue | `return_client_empties`, `register_late_return` |
| `settled` | **Tout est soldé** (physique) | Quand `returned + lost + destroyed + converted >= pieces` **et** `converted = 0` |
| `converted` | Passée en créance financière | `process_due_obligations`, `declare_packaging_loss` |
| `cancelled` | Annulée (vente annulée) | `cancel_order` / annulation de vente |

**Piège de vocabulaire** : `settled` ne signifie *pas* « payé ». Les pièces sont
revenues, l'argent de consigne est rendu. `converted` signifie au contraire que
le **physique a été abandonné** et remplacé par une dette en FCFA.

Les compteurs de `deposit_issues` sont cumulatifs et **disjoints** :

```
pieces  =  returned_pieces + lost_pieces + destroyed_pieces + converted_pieces  + reste
```

C'est cet invariant qui rend les transitions idempotentes : chaque `UPDATE`
compare la somme des sorties à `pieces`.

## 4. Le retour des vides : le chemin nominal

`consignments/client_returns.rs` — `return_client_empties`.

### Les refus, avant tout calcul

Le code énumère explicitement ce qu'il refuse :

```
vente annulée               → refus
statut 'converted'          → refus, avec renvoi explicite :
                             « enregistrez un retour tardif dans l'onglet
                               Obligations & créances »
statut settled/returned/cancelled → refus
pieces > reliquat physique  → refus
moyen de paiement inactif   → refus
```

Le message du cas `converted` est important : il **n'y a pas de marche arrière
silencieuse**. Une obligation convertie ne se rend pas par le chemin normal ; il
faut passer par le retour tardif, qui a une comptabilité différente.

### Les deux natures de retour : `good` et `damaged`

`condition_state` n'accepte que deux valeurs. La différence est structurante :

| | `good` | `damaged` |
| --- | --- | --- |
| Stock de vides | **+ pieces** | **inchangé** |
| `packaging_assets.stock_empty` | **+ pieces** | inchangé |
| Mouvement | `entry` | **`breakage`** |
| Effet client | dette d'emballage réduite | dette d'emballage réduite |

Autrement dit : **un casier cassé solde la dette du client mais ne réintègre pas
le parc**. Le dépôt a perdu un actif physique, le client a rempli son obligation.
Les deux faits sont enregistrés séparément — c'est correct, et c'est exactement
ce que le `movement_type = 'breakage'` permet de retrouver plus tard.

### La contrepartie financière

Le retour peut se rembourser de deux façons, plafonnées ensemble :

```rust
let max_val = unit_value × pieces;
let total_counterpart = refund_amount + credit_reduction;
if total_counterpart > max_val → refus
```

| Voie | Effet |
| --- | --- |
| `refund_amount` | Sortie d'espèces de la caisse (`deposit_refund`) |
| `credit_reduction` | **Réduction de la créance commerciale** du client |

Le remboursement en espèces vérifie le solde de caisse :

```rust
if refund_amount > 0 && is_cash == 1 {
    let avail = get_theoretical_cash_tx(...)?;
    if refund_amount > avail → « Espèces en caisse insuffisantes »
}
```

**On ne peut pas rembourser plus que ce que la caisse contient.** Un client qui
rend 50 casiers et réclame 50 000 FCFA alors que la caisse n'a que 30 000 se
verra refuser — il devra être crédité en réduction de dette à la place.

### Conséquence sur le statut

```rust
let next_status = if returned + pieces + other_out >= pieces {
    if converted_pieces > 0 { "converted" } else { "settled" }
} else {
    "partially_returned"
};
```

Remarquez la branche `converted_pieces > 0` : si une partie avait déjà été
convertie, un retour ramène le statut à `converted` même si tout est revenu. Le
statut reste donc **fidèle à l'histoire**, pas seulement à l'état courant.

## 5. L'échéance : la conversion en argent

`packaging_obligations/conversions.rs` — `process_due_obligations`.

### Ce qu'elle sélectionne

```sql
WHERE di.status IN ('pending', 'partially_returned')
  AND di.due_date IS NOT NULL AND date(di.due_date) < date('now')
```

Strictement `<` : une échéance à aujourd'hui **n'est pas** encore échue. Le
lendemain, oui.

### La décision, par obligation

Pour chacune, la politique décide :

```rust
let should_auto_convert = match (pol_id, auto_opt) {
    (Some(_), Some(auto)) => auto != 0,
    (Some(_), None)      => false,      // politique liée mais effacée → PAS de conversion
    (None, _)            => resolve_policy(...).2,
};
```

Le cas `(Some(_), None)` mérite attention : la ligne référence une politique qui
n'existe plus (`LEFT JOIN` vide), et le code choisit alors **de ne pas
convertir**. C'est conservateur — on ne facture pas une dette sur la base d'une
règle qu'on n'a plus.

### Ce que la conversion écrit

1. Une ligne `packaging_conversions` avec `reason = 'due_date'`, `pieces` en
   attente, `unit_value_snapshot`, `amount`, et un `request_key` de séquence
   `CNV-EMB`.
2. Une écriture au grand livre : `entry_type = 'conversion_charge'`,
   `direction = 'debit'`, `amount`.
3. `customer_packaging_accounts` : `balance_pieces` diminue, `deposit_held_amount`
   est ramené à 0 si le solde de pièces tombe à zéro.
4. `mark_converted` : `converted_pieces += pending`, `status = 'converted'`.

**Idempotence** : la fonction est documentée idempotente et l'est par
construction — elle filtre sur `status IN ('pending','partially_returned')`, donc
une obligation déjà convertie n'est plus sélectionnée. Deux appels de suite ne
créent pas de double dette.

### Le déclenchement réel — et sa limite

```rust
// crates/depotpro-server/src/main.rs:39
if let Err(e) = packaging_obligations::process_due_obligations(&db, Some("system")).await {
    tracing::warn!("Traitement initial des échéances d'emballages ignoré : {e}");
}
```

**C'est un appel unique au démarrage du serveur.** Ce n'est pas un ordonnanceur :
il n'y a ni boucle, ni cron, ni déclencheur sur accès.

Conséquence concrète : un dépôt ouvert du lundi au vendredi ne convertira les
échéances de la semaine qu'au **redémarrage suivant**. Un emballage échu le mardi
reste `pending` jusqu'au redémarrage. La donnée n'est pas fausse — `due_date`
est en base et l'interface peut signaler le dépassement — mais **la créance
financière n'existe pas encore** tant que le traitement n'a pas tourné.

Une route existe pour le déclencher à la main
(`packaging_process_due`, permission `ConsignmentsWrite`), donc l'exploitant
peut forcer le traitement. Mais rien ne le fait automatiquement.

> **Décision métier à clarifier** : est-ce un choix (le dépôt doit valider
> explicitement ses conversions) ou une dette technique (un ordonnanceur
> manque) ? Le code ne tranche pas.

## 6. Le retour tardif : rattraper l'irrattrapable

`packaging_obligations/late_returns.rs` — `register_late_return`.

Le cas d'usage : le client avait été converti en dette de 10 000 FCFA, puis il
rapporte finalement ses casiers.

### Le calcul, en trois nombres

```rust
let pending_physical = pieces_due - returned - converted;
let capped           = pieces.min(pending_physical.max(0) + converted);
let late_regulated   = (capped - pending_physical.max(0)).max(0).min(converted);
```

Traduction : `capped` est ce qu'on accepte d'enregistrer, `late_regulated` est la
part qui **annule la conversion** plutôt que de solder du physique.

Exemple :

| Situation | Valeur |
| --- | --- |
| `pieces` = 10, `returned` = 0, `converted` = 10 | `pending_physical = 0` |
| Le client rapporte 4 casiers | `capped = 4` |
| | `late_regulated = min(4, 10) = 4` |

Les 4 pièces ne soldent pas du physique (il n'y en a plus) : elles **défont
partiellement la conversion**.

### Les deux écritures comptables

| Part | Effet |
| --- | --- |
| `physical_deduct = capped - late_regulated` | Dette d'emballage soldée, stock incrémenté |
| `late_regulated` | `entry_type = 'late_return_credit'`, `direction = 'credit'` |

Le grand livre reçoit donc un **crédit** qui vient en déduction du **débit** de la
conversion. Le solde net du client baisse sans manipulation manuelle.

La clé d'idempotence intègre le montant et le compteur — `late-ret:{id}:{n}:{montant}`
— ce qui empêche un double crédit sur le même état.

### Une asymétrie à noter

Le retour tardif **crédite la dette financière** mais ne rembourse pas d'espèces.
Si le client avait déjà payé sa créance d'emballages, le crédit devient un solde
créditeur chez le client. Le code ne réembourse pas automatiquement ce trop-perçu :
il reste au grand livre comme `late_return_credit`, à régler par un geste
commercial. C'est défendable (on ne sort pas d'espèces sans validation), mais
**ce n'est nulle part documenté côté utilisateur**.

## 7. Les pertes : déclarer, puis valider

`packaging_obligations/losses.rs`.

Un emballage perdu n'est pas une conversion à échéance, mais il emprunte **la
même voie comptable** :

```
declare_packaging_loss → packaging_loss_declarations (status 'declared')
                       → packaging_conversions (reason = 'loss')
                       → insert_ledger_entry('conversion_charge', débit)
```

Deux étapes distinctes : **déclarer** puis **valider**. La validation est ce qui
crée la créance. Entre les deux, la perte est enregistrée mais pas facturée.

Le contrôle de cohérence est le même qu'ailleurs :

```rust
if pieces > (pieces_due - already_out).max(0) → refus
```

On ne peut pas déclarer en perte plus que ce qui reste dû.

`lost_pieces` et `destroyed_pieces` sont deux colonnes distinctes, et l'une comme
l'autre entrent dans la somme qui décide du statut. `mark_converted` est réutilisé
pour les pertes — d'où le fait qu'une perte amène elle aussi au statut `converted`.

## 8. Le grand livre : deux soldes qui ne se mélangent pas

C'est le point le plus important de tout le module, et le plus facile à
comprendre de travers.

`debt_and_dashboard.rs` expose **deux** chiffres distincts :

```rust
pub struct ClientPackagingDashboardDto {
    /// Dette commerciale (créance de marchandises) — registre customer_receivables.
    pub commercial_debt: i64,
    /// Créance financière d'emballages exigible (après conversion uniquement).
    pub packaging_financial_debt: i64,
    /// Obligations physiques en attente : quantité de pièces à restituer.
    pub pending_pieces: i64,
    /// Valeur indicative — JAMAIS exigible avant conversion.
    pub pending_reference_value: i64,
    /// Total financier réellement dû (commercial + créances converties).
    pub total_financial_due: i64,
}
```

| Champ | Table source | Exigible ? |
| --- | --- | --- |
| `packaging_financial_debt` | `customer_packaging_financial_ledger` | **Oui** — c'est une créance |
| `pending_reference_value` | `customer_packaging_accounts.deposit_held_amount` | **Non** — valeur en attente |
| `commercial_debt` | `customer_receivables` | **Oui** — registre séparé |
| `total_financial_due` | somme des deux registres exigibles | **Oui** |

Le DTO sépare donc **quatre** notions : la dette de marchandises, la créance
d'emballages convertie, les pièces encore physiquement dues, et leur valeur
indicative. `total_financial_due` n'additionne que les deux premières —
`pending_reference_value` n'y entre jamais.

La règle est écrite noir sur blanc dans le code : *« la valeur indicative n'est
jamais une dette exigible »*. Un client qui détient 10 casiers ne **doit** pas
10 000 FCFA ; il doit **des casiers**. La dette ne devient financière qu'à la
conversion ou à la perte validée.

Le solde du grand livre se calcule ainsi :

```sql
SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END)
```

avec les écritures suivantes :

La contrainte de la table prévoit **quatre** `entry_type` :

```sql
CHECK (entry_type IN ('conversion_charge', 'late_return_credit', 'payment', 'adjustment'))
CHECK (direction  IN ('debit', 'credit'))
CHECK (amount > 0)
CHECK (balance_after >= 0)
```

| `entry_type` | `direction` | Origine |
| --- | --- | --- |
| `conversion_charge` | débit | Échéance dépassée **ou** perte validée |
| `payment` | crédit | `pay_packaging_financial_debt` |
| `late_return_credit` | crédit | `register_late_return` |
| `adjustment` | — | Correction autorisée (**aucun appelant dans le code**) |

`adjustment` est déclaré par le schéma mais **jamais écrit** par le cœur métier :
c'est un point d'extension réservé aux corrections manuelles. En l'état, aucune
fonction ne le produit — à vérifier avant de compter dessus.

`balance_after >= 0` signifie par ailleurs qu'une écriture ne peut jamais faire
passer le solde du client sous zéro : le grand livre interdit le crédit
excédentaire au niveau du schéma, pas seulement du code.

## 9. Le règlement de la créance

`pay_packaging_financial_debt` accepte un paiement **fractionné** sur plusieurs
moyens :

```rust
if total > balance → « Le règlement dépasse la créance d'emballages restante »
```

Garde-fou d'idempotence en tête de fonction : `request_key` + `entry_type = 'payment'`.

### Un comportement qui surprend

Le mouvement de caisse est **conditionnel** :

```rust
let open_session_id: Option<i64> =
    sqlx::query_scalar("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")...?;
if let Some(sid) = open_session_id {
    // écrit les cash_movements
}
```

**S'il n'y a pas de session ouverte, le règlement est enregistré au grand livre
mais aucune entrée de caisse n'est créée.** L'argent encaissé n'apparaît alors
nulle part dans la caisse du jour. Comparé à `pay_order` — qui **exige** une
caisse ouverte (`require_open_session_tx`) — c'est une incohérence de traitement
entre deux encaissements de nature similaire.

> **Décision métier à clarifier** : soit on exige la caisse comme partout
> ailleurs, soit on assume le règlement hors caisse et on le documente. En l'état,
> le comportement dépend de l'état de la caisse au moment du clic — ce qui n'est
> pas reproductible d'un jour à l'autre.

## 10. Les permissions, couche par couche

Constat vérifié : **aucune fonction de `packaging_obligations` n'appelle
`require_current_actor_permission`**. Le contrôle est fait exclusivement au
niveau des routes Axum :

| Route | Permission |
| --- | --- |
| `pay_packaging_financial_debt` | `ReceivablesPay` |
| `register_late_return` | `ConsignmentsWrite` |
| `declare_packaging_loss` | `ConsignmentsWrite` |
| `list_loss_declarations` | `ConsignmentsRead` |
| `process_due_obligations` | `ConsignmentsWrite` |
| `return_client_empties` | `ConsignmentsWrite` |

Sur les routes HTTP, le contrôle est donc bien présent. Mais il l'est
**seulement là** : aucune défense en profondeur dans le cœur, contrairement à
`confirm_order`, `pay_order` ou `invoice_order` qui vérifient eux-mêmes le
`Permission::SalesWrite` / la caisse.

La conséquence est concrète : **un appel direct au cœur** (test, script
d'administration, future commande Tauri oubliée) contourne le contrôle de
permission. Ce n'est pas une faille exploitable aujourd'hui — les routes sont
protégées — mais c'est une dissymétrie dans la conception des couches.

## 11. Récapitulatif du cycle complet

```
1. VENTE
   └─ la ligne porte un emballage consignable (returnable = 1, consigne > 0)
      ├─ deposit_issues      : +1 ligne 'pending', due_date = now + policy (défaut 15 j)
      └─ customer_packaging_accounts : balance_pieces += n, deposit_held += n × valeur

2. RETOUR NOMINAL (dans le délai)
   ├─ condition 'good'    → stock de vides += n, mouvement 'entry'
   ├─ condition 'damaged' → stock inchangé,     mouvement 'breakage'
   ├─ contrepartie        → espèces (si caisse suffisante) OU réduction de créance
   └─ statut              → 'partially_returned' puis 'settled'

3. ÉCHÉANCE DÉPASSÉE (si auto_convert_on_due)
   ├─ packaging_conversions (reason 'due_date')
   ├─ grand livre : débit 'conversion_charge'
   └─ statut → 'converted'   (le physique est remplacé par une dette en FCFA)

3bis. PERTE DÉCLARÉE
   ├─ packaging_loss_declarations → 'declared'
   ├─ packaging_conversions (reason 'loss') → validation
   └─ même écriture de débit, même statut 'converted'

4. RETOUR TARDIF (après conversion)
   ├─ part physique  → solde la dette d'emballage, réintègre le stock
   └─ part convertie → crédit 'late_return_credit' au grand livre

5. RÈGLEMENT DE LA CRÉANCE
   ├─ 'payment' au grand livre (plafonné au solde)
   └─ cash_movements SI une session est ouverte (sinon : rien en caisse)
```

## 12. Ce qui est solide, ce qui mérite une décision

### Solide

- **L'invariant `pieces = returned + lost + destroyed + converted + reste`** est
  respecté partout et rend les transitions vérifiables.
- **`unit_value` figé** par ligne : pas de réévaluation rétroactive des dettes.
- **Idempotence** par `request_key` de séquence et par filtrage de statut.
- **Séparation stricte** entre valeur indicative et créance exigible, écrite dans
  le code et pas seulement dans la doc.
- **Le retour `damaged` ne ment pas sur le stock** : il solde la dette du client
  sans prétendre que le parc est intact.

### À trancher

| # | Point | Question |
| --- | --- | --- |
| 1 | `process_due_obligations` au démarrage seulement | Ordonnanceur voulu ou manquant ? |
| 2 | Défaut `auto_convert_on_due = true` sans politique | Est-ce le comportement souhaité à l'installation ? |
| 3 | Règlement hors session de caisse | Exiger la caisse, comme `pay_order` ? |
| 4 | Aucune permission dans le cœur | Ajouter `require_current_actor_permission` pour la défense en profondeur ? |
| 5 | Trop-perçu après retour tardif | Rembourser, ou laisser au crédit client ? |
| 6 | `mark_converted` réutilisé pour les pertes | Un `entry_type` distinct serait-il plus lisible ? |

Aucun de ces six points n'est un bug prouvé : ce sont des **comportements réels
que le code assume implicitement**, et qui mériteraient d'être validés
explicitement ou corrigés. Les trois premiers changent le résultat comptable.
