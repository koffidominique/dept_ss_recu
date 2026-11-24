# Lot 9a — Un seul solde : plan d'exécution et révision de la décision

> Ce document révise la décision du Lot 9a après mesure du code.
> Il contredit **deux** de mes affirmations antérieures, et explique pourquoi.
> Vérifié au 2026-11-23.

---

## 1. Ce que la mesure a changé

J'avais proposé : « `deposit_issues` est la seule vérité, les deux tables de
soldes deviennent des vues en lecture ». La mesure montre que **cette approche
directe n'est pas sûre**, et qu'une partie de mon diagnostic était faux.

### 1.1 Le diagnostic de départ était en partie faux

J'avais écrit que `customer_deposit_balances` était un « troisième solde mort,
alimenté sans jamais être consulté ». C'est faux sur un point : **il est lu par
l'écran de commande.**

```ts
// OrderStepClient.tsx:67 — filtre les emballages réellement détenus
const heldDeposits = deposits.filter((d) => d.quantity_held > 0);
```

Cet écran affiche au gérant ce que le client détient **avant** de prendre la
commande. C'est une information de décision commerciale, pas un compteur
décoratif.

**La table n'est donc pas morte.** Elle est simplement absente du **module
consignes**, qui ne la lit pas. Deux modules, deux tables, chacun son écran.

### 1.2 Les deux tables ne mesurent pas la même chose

| | `customer_packaging_accounts` | `customer_deposit_balances` |
| --- | --- | --- |
| Granularité | par **consignable** (`returnable_id`) | par **actif** (`packaging_asset_id`) |
| Contenu | `balance_pieces`, `deposit_held_amount` | `quantity_held`, `amount_held_xof` |
| Alimentée par | 11 écritures, 9 fichiers source | 4 écritures, 3 fichiers source |
| Affichée par | onglets Consignes (soldes, créances) | écran de commande |
| Couvre | ventes directes, commandes, conversions, pertes, retours, annulations | commandes et restitutions |

Ce ne sont pas deux exemplaires du même compteur : ce sont **deux granularités
différentes**. Les fusionner demanderait de choisir une granularité et de
réécrire l'écran qui utilise l'autre.

### 1.3 Une incohérence structurelle que je n'avais pas vue

`orders/packaging_and_returns.rs` écrit dans **les deux** : il met à jour
`customer_packaging_accounts` **et** `customer_deposit_balances`. C'est le seul
fichier qui fait le pont.

Ailleurs, chaque module vit sa vie. `packaging_obligations` ne touche que
`customer_packaging_accounts`. `orders` touche les deux. D'où l'écart qui grandit
entre les deux écrans.

---

## 2. Pourquoi l'approche « vue en lecture » n'est pas prête

### Le volume réel du refactor

| Table | Sites d'écriture | Fichiers | Tests adossés |
| --- | --- | --- | --- |
| `customer_packaging_accounts` | 11 | 9 | `lot12_sale_returnables.rs` (10 assertions) |
| `customer_deposit_balances` | 4 | 3 | `orders_mixed.rs` (7 assertions) |

Il ne s'agit pas de remettre à zéro deux compteurs : il s'agit de réimplémenter
**15 écritures** en agrégation. Chaque chemin doit continuer de produire le bon
chiffre au même moment de la transaction.

### Le piège des soldes de valeur

`customer_packaging_accounts.deposit_held_amount` (et son équivalent
`amount_held_xof`) est une **somme de valeurs unitaires**.

Or `deposit_issues.unit_value` est **figé à la création de chaque consigne**, et
peut avoir changé entre deux consignes du même consignable pour le même client.
Un retour de 3 casiers ne dit pas **lesquels** il solde.

Deux règles possibles, aucune n'est neutre :

| Règle | Effet comptable |
| --- | --- |
| FIFO (le plus ancien d'abord) | conforme à l'usage commercial |
| Plus petite valeur d'abord | avantage le dépôt, désavantage le client |

Le code actuel contourne le problème en décrémentant un compteur global. Passer
à une agrégation impose de **choisir une règle** — et ce choix a un effet direct
sur le montant remboursé au client.

### Ce que je refuse de faire

Écrire 15 agrégations et livrer cela avec une CI verte **ne prouverait rien**.
La CI vérifie des compteurs, pas la cohérence entre deux écrans. Livrer un
refactor de cette taille sans données réelles pour le valider serait une faute
professionnelle — le genre de changement qui « marche » en test et casse le
soir venu.

---

## 3. Ce que je propose à la place : 9a-1, désamorcer sans réécrire

Trois corrections ciblées, chacune vérifiable, qui suppriment les défauts
**observables** sans toucher à l'architecture des compteurs.

### 9a-1-a — ~~Le retour par commande solde la consigne~~ DÉJÀ FAIT

**Abandonné : ce correctif existe depuis le socle.** J'avais annoncé au Lot 9d que
`return_order_packaging` ne soldait pas `deposit_issues`. Faux :
`apply_customer_empty_return_tx` (ligne 270-318) le fait déjà, et mieux que ma
proposition — il priorise la vente de la commande, exclut
`lost + destroyed + converted`, et calcule le statut correctement.

**Ce que j'ai réellement écrit avant de m'en apercevoir** : un second bloc FIFO,
inséré 60 lignes au-dessus, qui aurait fait doublon. Il a été retiré ;
`git diff` sur le fichier est vide, le code source est intact.

Voir `EVOLUTION_LOT_09D.md` §4 pour la rectification complète.

### 9a-1-b — Le suivi d'écart entre les deux compteurs

**Livré** : `scripts/diagnostic_soldes_emballages.sql` — cinq requêtes de lecture
seule. Testé sur une base migrée avec un écart provoqué : il détecte bien
l'écart de −7 pièces entre la référence et le cache, et signale les consignes
sans échéance.

Le contrôle de référence :

```sql
-- Consignes ouvertes par client et consignable
SELECT client_id, returnable_id,
       SUM(pieces - returned_pieces - converted_pieces - lost_pieces) AS pieces_dues
FROM deposit_issues
WHERE status IN ('pending','partially_returned')
GROUP BY client_id, returnable_id;
```

Comparé à `customer_packaging_accounts.balance_pieces`. Un écart durable sur un
dépôt en production indique un chemin d'écriture défaillant — information
inestimable avant toute migration.

### 9a-1-c — Un seul chemin pour le plafond

Le plafond de consignes (question tranchée plus tôt) doit se baser sur **une**
formule. Je retiens l'agrégation de `deposit_issues`, parce qu'elle est calculée
et non maintenue : elle ne peut pas dériver. `customer_packaging_accounts` reste
l'affichage, mais ne fait plus foi pour décider de bloquer une vente.

C'est la partie de la décision du Lot 9a qui est **immédiatement réalisable** et
sans risque.

---

## 4. Ce que devient la fusion complète

Elle reste l'objectif. Elle exige, dans cet ordre :

1. **Des données réelles** — sans elles, on ne peut pas valider 18 écritures
   réécrites.
2. **Une règle de valorisation écrite** (FIFO ou valeur minimale), validée par
   vous, car elle change le montant remboursé au client.
3. **Une période d'observation** du contrôle 9a-1-b, pour connaître l'écart de
   départ.
4. **Un groupe de tests de non-régression** qui compare, pour un jeu de scénarios
   donné, l'ancien et le nouveau calcul — avant bascule.

**Recommandation : ne pas fusionner avant le Lot 13.** Les tournées produiront
un flux de retours massif et concentré ; c'est le meilleur jeu de données de
validation qu'on puisse espérer. Fusionner avant, c'est réécrire à l'aveugle.

---

## 5. Si vous voulez malgré tout la fusion maintenant

Je le ferai, mais je dois énoncer les conditions :

- je commence par les **tests** qui figent le comportement actuel des 18 sites
  d'écriture (tests de caractérisation), avant de toucher au code ;
- je ne touche qu'une table à la fois, `customer_packaging_accounts` d'abord
  (11 écritures), avec un commit par sous-système : `sales`, `orders`,
  `consignments`, `packaging_obligations` ;
- je m'arrête et vous demande un arbitrage à la première divergence entre
  l'ancien et le nouveau calcul ;
- durée réaliste : **2 à 3 semaines**, pas 3 jours.

Ce n'est pas de la prudence excessive : c'est le volume mesuré.

---

## 6. Décision demandée

| Option | Contenu | Risque | Délai |
| --- | --- | --- | --- |
| **A (recommandée)** | 9a-1-b (**livré**), 9a-1-c | Faible | ~2 jours |
| **B** | A, puis fusion complète de `customer_packaging_accounts` | Élevé | +2 à 3 semaines |
| **C** | A, puis fusion des deux tables | Très élevé | +4 semaines |

L'option A supprime les défauts visibles et prépare la fusion sans la précipiter.
Elle permet d'enchaîner sur le Lot 13 sans dette bloquante.
