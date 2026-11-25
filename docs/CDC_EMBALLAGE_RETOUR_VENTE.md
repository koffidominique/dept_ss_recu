# Cahier des charges — Emballage remis par le client (vente au comptoir)

> **Statut : à valider avant implémentation.** Aucune ligne de code n'a été
> écrite. Ce document décrit ce qui existe déjà, ce qui manque réellement, et
> les deux points de facturation qui demandent votre arbitrage.

---

## 1. Demande d'origine, reformulée

Sur le formulaire de vente, pour un produit dont l'emballage est un **casier** :

- remplacer le champ « remise » par un champ **« Emballage remis par le
  client »** ;
- saisir la quantité d'emballages vides rendus ;
- soldé si la totalité est rendue, sinon **dette à régulariser sous 15 jours** ;
- ce montant **ne doit pas** entrer dans le total de la vente ;
- le reçu doit l'afficher ligne par ligne.

Décisions déjà prises : **remise supprimée**, champ **réservé aux casiers**,
**cahier des charges d'abord**.

---

## 2. L'écart entre la demande et le code réel

Cette section est le cœur du document. Une partie de la logique demandée existe
déjà ; l'implémenter telle quelle produirait soit un doublon, soit une
régression comptable.

### 2.1. Deux formulaires distincts, et ce n'est pas un détail

| Écran | Route | Rôle |
|---|---|---|
| **Point de vente** | `/sales/new` | vente comptoir, encaissement immédiat |
| **Prise de commande** | `/orders` | commande client, livraison ultérieure, « commande mixte » |

Le vocabulaire de la demande (« Nouvelle Vente », « commande mixte », « champ
casier + champ remise ») désigne **les deux à la fois**. Or ils n'ont pas le
même modèle de données :

- le POS porte une **remise monétaire par ligne** (`CartItem.discountAmount`) ;
- la prise de commande porte une **remise globale** (`discount_xof`) et un prix
  unitaire par ligne, **sans remise de ligne**.

Un « champ remise par ligne » n'existe donc que sur le POS. La suppression
demandée (§4.2) ne concerne **que le POS**. Le parcours de commande ne perd
rien : il n'avait rien.

**Décision à valider** : ce cahier des charges cible le **point de vente**
(`/sales/new`). Le parcours de commande garde son propre panneau
« emballages vides rapportés » (Lot 15), qui couvre déjà la restitution à la
création de commande.

### 2.2. Ce qui existe déjà — et qu'il ne faut pas réécrire

| Élément demandé | Où c'est déjà fait |
|---|---|
| Saisie des vides rendus | bloc « Retour d'emballages client » (`PosCartPanel.tsx` l. 228-380), avec plafond, valorisation et **reste dû** en direct |
| Calcul « reste dû » | `computeAvailableReturnableRows` (`saleCalculations.ts` l. 312) |
| Déduction de la dette | `create_persistence.rs` l. 212-265 : solde client et stock sous-dépôt dans la même transaction |
| Apurement FIFO des dettes antérieures | même fichier, l. 297-338 |
| **Hors total de la vente** | le total est `total_merchandise` ; le retour est un champ distinct, affiché « hors total commande » |
| **Délai de 15 jours** | `packaging_policies.return_delay_days`, défaut **15** (`create_persistence.rs` l. 166), et déjà imprimé sur le reçu |
| Reçu : statut par ligne | `ValidatedSaleBanner.tsx` l. 77-95 : « Restitution complète » / « N à restituer sous 15 jours » |

**Conséquence** : les points 4 et 5 de la demande (dette de 15 jours hors total)
**sont déjà satisfaits**. Les réimplémenter serait une erreur.

### 2.3. Ce qui manque vraiment : la granularité par ligne

C'est le seul vrai travail, et c'est bien ce que vous demandez.

- **Aujourd'hui, le retour se saisit par *type d'emballage***, pas par ligne de
  produit. Sur une vente de deux produits en casier, l'écran ne permet pas de
  dire « pour la ligne 1, 2 casiers rendus sur 3 ».
- **Le bouton d'annulation de la dette est déjà par ligne** : `deposit_issues`
  porte `sale_line_id`.
- **Le retour, lui, l'écrit à `NULL`** (`create_persistence.rs` l. 341-342 :
  `VALUES (?, NULL, ?, ?, …)`).

La colonne existe, la dette la renseigne, le retour l'ignore. **Le correctif
est donc d'une ligne de SQL** — plus l'écran pour la produire.

### 2.4. « Produit de caractéristique casier » : le vrai discriminant

Ne pas confondre deux notions proches :

| Notion | Où | Valeurs | Usage |
|---|---|---|---|
| `requested_unit` | ligne de vente | `crate`, `half_crate`, `bottle`, `pack`… | **vocabulaire de quantité** (combien d'unités) |
| `returnable_packaging_types.kind` | type d'emballage consigné | `bottle`, `crate` (**CHECK**) | **nature physique de l'emballage** |

Le critère correct est **`kind = 'crate'`** : une demi-caisse de bouteilles est
facturée à l'unité mais rendue dans un casier entier. Filtrer sur
`requested_unit = 'crate'` afficherait le champ sur les casiers pleins et le
cacherait sur les demi-caisses — l'inverse du besoin.

### 2.5. Le « champ casier » de la demande

Sur le POS, la seule quantité de supports est `CartItem.supportQuantity`
(nombre de casiers physiques, suivie séparément des bouteilles). Elle est
**initialisée à `'1'` et n'est éditable nulle part** (`posCartBuilders.ts`
l. 55 et 102).

Deux lectures possibles de votre demande, à trancher :

- **(a)** ce champ doit devenir visible et éditable ;
- **(b)** votre « champ casier » désignait la ligne « casier » du panier, et il
  n'y a rien à ajouter.

Les deux peuvent être vrais. Le §6 propose de laisser (b) et de traiter (a) à
part.

### 2.6. Une dépendance à couvrir explicitement

`sale_lines.id` n'existe qu'**après** l'insertion de la ligne. Le retour est
écrit plus loin dans la même transaction, donc l'identifiant est disponible.
Mais si le retour est saisi **avant** que la vente soit validée, il faut le
rattacher au `CartItem.key` en mémoire, puis le résoudre au moment de
l'insertion. **C'est le point technique le plus délicat du lot** et il doit
être testé en premier.

---

## 3. Périmètre retenu

**Dans le lot**

1. Saisie du retour **par ligne de panier**, sur les lignes dont l'emballage
   est un casier (`kind = 'crate'`).
2. Suppression du champ « Remise » sur les lignes du POS.
3. `deposit_issues.sale_line_id` renseigné pour les retours.
4. Reçu : une ligne d'emballage par ligne de vente, avec remis / dû / statut.
5. Tests : unitaires sur le calcul, Rust sur le rattachement, E2E sur le
   parcours.

**Hors périmètre (explicite)**

- Le parcours de commande `/orders` : garde son panneau actuel.
- `supportQuantity` éditable : sujet distinct (§2.5a).
- La remise **globale** du panier : conservée, elle n'entre pas dans la demande.
- Les emballages **bouteille** : le champ ne s'affiche pas (§2.4).
- Modification d'une vente après validation : impossible par construction.

---

## 4. Spécification d'écran

### 4.1. Ligne de panier — avant / après

**Aujourd'hui**, pour une ligne de casier :

```
Youki 65cl · casier · 4 800 FCFA + consigne 1 000
[−] [ 3 ] [+]                            Remise [ 0 ]   14 700
                                                         +3 000 cons.
```

**Après** :

```
Youki 65cl · casier · 4 800 FCFA + consigne 1 000
[−] [ 3 ] [+]                                         14 700
                                                      +3 000 cons.
Emballage remis par le client : [ 2 ] / 3 casiers   → reste 1 dû, 1 000 FCFA
```

Règles d'affichage :

- le champ n'apparaît **que** si la ligne émet un emballage `kind = 'crate'` ;
- le dénominateur est le nombre de casiers **émis par cette ligne** (produit
  de la quantité par `pieces_per_pack` du composant casier) ;
- la saisie est **plafonnée** au total émis par la ligne, plus les dettes
  antérieures du client si l'on veut solder l'ancien. Le plafond existant
  (`max_returnable_pieces`) est déjà calculé ; il faudra le **répartir** par
  ligne sans changer le total.
- le sous-titre indique le reste dû et sa valorisation, comme aujourd'hui.

### 4.2. Suppression du champ « Remise »

- retirer le bloc `Remise` + `MoneyInput` de `PosCartPanel.tsx` (l. 500-515) ;
- **conserver** `discountAmount` dans `CartItem` et dans l'envoi au serveur, à
  `0` : le supprimer du modèle casserait le calcul de total et la signature
  d'idempotence (`posCartBuilders.ts` l. 333) ;
- la remise **globale** du panier (`PosPaymentPanel`) reste inchangée.

> ⚠️ Ce point supprime une capacité de facturation (geste commercial sur une
> ligne). Il est implémenté **tel que demandé**, mais le reçu continuera
> d'afficher `Remise` à 0 si le modèle la conserve. Si vous préférez que la
> remise par ligne reste possible mais discrète, dites-le : c'est le seul
> point du document qui touche à l'argent.

### 4.3. Ce qui ne change pas à l'écran

Le bloc « Retour d'emballages client » (par type) reste visible **pour les
emballages bouteille** et pour solder des dettes antérieures. Le nouveau champ
par ligne le complète sur les casiers. Les deux alimentent **le même**
`received_returnables` — c'est ce qui garantit qu'aucun montant n'est compté
deux fois.

---

## 5. Spécification du reçu

Le reçu de vente est construit par `buildSalePrintableDoc`
(`ValidatedSaleBanner.tsx`), rendu par `PrintableDocumentSheet.tsx`.

Pour chaque ligne de produit dont l'emballage est un casier, le reçu affiche :

| Champ | Source |
|---|---|
| Type de produit commandé | `sale_lines.product_name` + `sales_unit_label` |
| Quantité commandée | `sale_lines.quantity_milli` |
| Casiers émis | composant casier × quantité |
| Casiers remis | `deposit_issues.returned_pieces` **de cette ligne** |
| Casiers restant dus | émis − remis |
| Statut | « Restitution complète » / « N à restituer sous 15 jours » |
| Mention 15 jours | déjà présente ; conservée |

Le montant du retour **n'apparaît pas** dans `summaryRows` : il reste dans la
ligne « Retour emballages (hors total commande) », comme aujourd'hui.

---

## 6. Spécification technique

### 6.1. Contrat d'API

`ReceivedReturnableInput` gagne un champ **optionnel** :

```rust
pub struct ReceivedReturnableInput {
    pub returnable_id: i64,
    pub pieces: i64,
    /// Ligne de vente d'origine, quand la restitution est saisie sur la ligne.
    /// `None` = retour global au type (comportement actuel, conservé).
    pub sale_line_id: Option<i64>,
}
```

Le champ est optionnel : les appels actuels continuent de fonctionner sans
modification. C'est ce qui rend le lot livrable sans casser le desktop ni les
tests existants.

### 6.2. Persistance

Dans `create_persistence.rs` (l. 341), remplacer `NULL` par `sale_line_id`
quand il est fourni. **Pas d'autre changement** dans ce fichier : la
déduction de solde, le FIFO et le stock sont corrects et testés.

### 6.3. Résolution de l'identifiant de ligne

Le POS ne connaît pas `sale_lines.id` avant validation. Deux étapes :

1. l'écran associe chaque saisie à `CartItem.key` ;
2. au moment de construire la requête, `usePosData.ts` traduit `key` → index de
   ligne, et le serveur renvoie l'identifiant par ligne dans le détail de la
   vente ; **ou** le serveur résout lui-même si l'on envoie l'index de ligne.

> **Recommandation** : envoyer l'**index de ligne** (`line_index`) plutôt que
> l'identifiant, et laisser le serveur le résoudre à l'insertion. Cela évite
> une seconde requête et un aller-retour de correspondance côté écran.

### 6.4. Modèle d'écran

- ajouter `returnedCrates?: number` à `CartItem`;
- l'agrégat `received_returnables` envoyé au serveur devient la somme des
  saisies par ligne **plus** la saisie globale par type ;
- `computeAvailableReturnableRows` reste l'autorité du plafond total.

### 6.5. Migration

**Aucune migration de schéma.** `deposit_issues.sale_line_id` existe depuis la
v1 et le schéma attendu (`expected_schema_v28.json`) la porte. Un lot sans
migration est un lot plus sûr.

---

## 7. Tests à écrire

| Niveau | Ce qu'il doit prouver |
|---|---|
| Unitaire (TS) | deux lignes de casier saisies séparément produisent deux rattachements distincts ; le plafond par ligne ne dépasse jamais le total disponible |
| Unitaire (TS) | la remise de ligne disparaît de l'écran mais `discountAmount` reste à 0 dans l'envoi |
| Rust | `sale_line_id` est **non nul** sur le retour rattaché, et la dette reste `pending` pour la différence |
| Rust | un retour **sans** `sale_line_id` (appel existant) se comporte exactement comme avant — non-régression |
| Rust | le total de la vente est **identique** avec et sans retour : le point 5 de la demande |
| E2E | vente de 3 casiers, le client en rend 2 → reçu « 1 à restituer sous 15 jours », total inchangé |

---

## 8. Risques

| Risque | Parade |
|---|---|
| **Compter deux fois** un retour saisi à la fois par ligne et par type | un seul envoi, une seule agrégation testée |
| Supprimer la remise casse un total | `discountAmount` conservé à 0 dans le modèle |
| Le champ apparaît sur un demi-casier | filtre sur `kind = 'crate'`, pas sur `requested_unit` |
| Rattachement perdu si la ligne est supprimée du panier | la saisie est purgée avec la ligne |
| Reçu dupliqué (ligne + agrégat) | le reçu détaille par ligne, l'agrégat reste un total |

---

## 9. Ce qui reste à trancher

1. **`supportQuantity`** (§2.5) : à rendre éditable, ou à laisser tel quel ?
2. **Remise par ligne** (§4.2) : suppression confirmée, ou déplacement vers un
   repli « geste commercial » ? C'est le seul point qui touche au calcul d'argent.
3. **Retour multi-lignes d'une même dette** : si deux lignes émettent le même
   type de casier, la restitution doit-elle être imputée à la ligne choisie, ou
   au plus ancien dû d'abord (FIFO, comportement actuel) ? Le choix change ce
   que le reçu affiche.

---

## 10. Estimation

| Étape | Charge |
|---|---|
| Contrat + persistance Rust (`sale_line_id`) | petite |
| Résolution ligne / index + tests Rust | moyenne |
| Champ d'écran par ligne + plafonds | moyenne |
| Suppression remise + non-régression | petite |
| Reçu par ligne | petite |
| Tests unitaires + E2E | moyenne |

Le lot est **court s'il reste dans ce périmètre**, et son intérêt principal est
moins le champ lui-même que le rattachement par ligne : c'est ce qui rendra le
reçu capable de dire *quelle* ligne doit encore un casier, au lieu d'un total
agrégé.
