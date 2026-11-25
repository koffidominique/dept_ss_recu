# Cahier des charges — Emballage remis par le client (vente au comptoir)

> **Version 2 — décisions arrêtées.** Les trois questions de la v1 sont
> tranchées. Ce document est prêt à implémenter.
>
> Décisions : (1) un casier vendu = sortie de **1 casier plein + N bouteilles
> pleines**, donc un emballage rendu = entrée de **1 casier vide + N bouteilles
> vides** ; (2) le champ « Remise » est **supprimé entièrement** ; (3) le suivi
> est **par ligne de produit**.

---

## 1. La règle métier, telle qu'elle doit être codée

Un conditionnement « casier » n'est pas une unité : c'est un **conteneur de
bouteilles**. Les données le disent déjà — `deposit_packaging_components`
attache au casier Bock 24×65cl **deux** composants consignés :

| Composant | `pieces_per_pack` | Consigne émise par casier vendu |
|---|---|---|
| Casier 24 (plastique) | 1 | 1 casier |
| Bouteille 65cl (verre) | 24 | 24 bouteilles |

Vendre 3 casiers sort donc du dépôt **3 casiers vides et 72 bouteilles vides**,
et crée **deux dettes** dans `deposit_issues`, toutes deux rattachées à la même
ligne de vente.

> **Conséquence directe, et c'est le cœur de ce lot :** rendre « 1 emballage »
> ne signifie pas rendre un casier *ou* ses bouteilles — **cela signifie rendre
> le casier et les 24 bouteilles qu'il contenait**. Un seul champ, qui crédite
> les deux.

### 1.1. Formule

Pour chaque ligne dont le conditionnement émet un casier :

```
casiers_émis      = quantité                       (1 par casier vendu)
bouteilles_émises = quantité × pieces_per_pack     (du composant bouteille)

casiers_remis     = saisie de l'opérateur                        [0 … casiers_émis]
bouteilles_remises = casiers_remis × pieces_per_pack
```

L'opérateur **ne saisit qu'un nombre** : le casier. Les bouteilles en découlent
— un casier vide rendu contient forcément ses bouteilles vides. Saisir les deux
séparément permettrait « 3 casiers rendus, 12 bouteilles rendues », qui ne
correspond à aucun objet physique.

### 1.2. Dette résiduelle

```
dette casier    = (casiers_émis    − casiers_remis)     × consigne casier
dette bouteille = (bouteilles_émises − bouteilles_remises) × consigne bouteille
```

Chacune est déjà gérée par le cœur via `deposit_issues` (statut `pending`,
`due_date` à **+15 jours** par défaut via `packaging_policies.return_delay_days`).

### 1.3. Le total de la vente

La consigne **facturée** au client (émise au moment de la vente) reste dans le
total : elle a été facturée, elle est due. Seul le **retour** est hors total —
c'est déjà le comportement actuel, et le point 5 de la demande est donc
respecté sans modification (`create_persistence.rs`).

> Nuance à connaître : ce qui ne doit **jamais** entrer dans le total est le
> *montant du retour*. La consigne, elle, entre dans le total comme aujourd'hui.
> Confondre les deux ferait baisser le total de la vente à chaque emballage
> rendu.

---

## 2. Ce qui existe déjà (ne pas réécrire)

| Élément | Où |
|---|---|
| Consigne émise par composant, avec échéance 15 j | `create_persistence.rs` l. 150-185 |
| Déduction du solde client + entrée stock sous-dépôt | `create_persistence.rs` l. 212-395 |
| Apurement FIFO des dettes antérieures | même fichier, l. 297-338 |
| Retour hors total | le total est `total_merchandise` ; le retour s'affiche à part |
| Reçu : « N à restituer sous 15 jours » | `ValidatedSaleBanner.tsx` l. 77-95 |

---

## 3. Ce qui manque, et que ce lot apporte

### 3.1. Le retour par **ligne de produit**

Saisie aujourd'hui **par type d'emballage**, pas par ligne. Or
`deposit_issues.sale_line_id` existe depuis la v1, la dette la renseigne, et le
retour l'écrit à `NULL` (`create_persistence.rs` l. 342).

C'est ce qui permettra à la fiche de suivi client de dire **quelle ligne** doit
encore un casier, au lieu d'un total agrégé.

### 3.2. Le casier comme unité de saisie

Aujourd'hui les lignes du bloc « Retour d'emballages client » sont des **types
d'emballage** : « Casier 24 » et « Bouteille 65cl » apparaissent séparément,
sans lien. L'opérateur doit deviner combien de bouteilles vont avec un casier.

Demain, la ligne affiche **« Emballage remis par le client : [ 2 ] / 3 casiers »**
et le système en déduit les 48 bouteilles.

### 3.3. La suppression du champ « Remise »

Confirmée sans réserve : retiré du panier, `discountAmount` reste à `0` dans le
modèle et dans l'envoi (le supprimer du type casserait la signature
d'idempotence et le calcul de total).

---

## 4. Écran — `PosCartPanel.tsx`

```
Bock 65cl · casier · 4 800 FCFA + consigne 1 000
[−] [ 3 ] [+]                                          14 700
                                                       +3 000 cons.
Emballage remis par le client :  [ 2 ] / 3 casiers      Reste 1 casier + 24 bouteilles
```

Règles :

- champ affiché **uniquement** si la ligne émet un composant `kind = 'crate'` ;
- dénominateur = `quantité` (nombre de casiers) ;
- saisie entière, bornée `0 … quantité` ;
- sous-titre : reste dû **en casiers et en bouteilles**, avec sa valorisation ;
- à zéro saisi, afficher « aucun emballage rendu — dette totale de X FCFA » ;
- le bloc global « Retour d'emballages client » **reste** pour les emballages
  bouteille vendus à l'unité et pour les dettes antérieures d'autres produits.

---

## 5. Reçu

Pour chaque ligne de casier :

| Ligne du reçu | Source |
|---|---|
| Type de produit | `product_name` + `sales_unit_label` |
| Quantité commandée | `quantity_milli` |
| Casiers sortis | quantité |
| Bouteilles sorties | quantité × `pieces_per_pack` |
| **Emballage remis** | `X casiers + Y bouteilles` |
| **Restant dû** | casiers et bouteilles, avec valorisation |
| Statut | « Restitution complète » / « Restitution partielle » / « Aucun emballage rendu » |
| Mention | « à restituer sous 15 jours » (déjà présente) |

Aucun montant de retour dans les totaux : il reste dans la ligne
« Retour emballages (hors total commande) ».

---

## 6. Technique

### 6.1. Contrat

```rust
pub struct ReceivedReturnableInput {
    pub returnable_id: i64,
    pub pieces: i64,
    /// Ligne de vente d'origine. `None` = retour global au type (comportement
    /// actuel, conservé pour les appels existants et le desktop).
    pub sale_line_id: Option<i64>,
}
```

Champ **optionnel** : sans lui, rien ne change. C'est ce qui rend le lot
livrable sans casser les tests, le desktop ni les intégrations.

### 6.2. Persistance

Une seule modification dans `create_persistence.rs` :

```
- WHERE ... VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'returned')
+ WHERE ... VALUES (?, ?,    ?, ?, ?, ?, ?, ?, ?, NULL, 'returned')
+   .bind(returned.sale_line_id)
```

Le reste du fichier (déduction, FIFO, stock, mouvements) est correct et testé :
**ne pas y toucher**.

> **Piège FIFO à traiter.** Le retour est aujourd'hui apuré en FIFO sur les
> dettes *antérieures* (`sale_id != ?`). Avec un rattachement par ligne, il faut
> d'abord apurer **la ligne désignée**, puis retomber en FIFO pour le surplus.
> Sinon la fiche de suivi affichera une dette sur la ligne 1 alors que le client
> a rendu ses casiers de la ligne 1. **C'est le point le plus délicat du lot.**

### 6.3. Résolution de l'identifiant de ligne

Le POS ne connaît pas `sale_lines.id` avant validation. L'écran envoie
l'**index de ligne** ; le serveur le résout à l'insertion, où `line_id` est déjà
disponible dans la boucle (`create_persistence.rs` l. 77). Aucun aller-retour.

### 6.4. Modèle d'écran

- `CartItem.returnedCrates?: number` (saisie) ;
- l'agrégat `received_returnables` envoyé au serveur = saisies par ligne
  (casier **et** bouteilles dérivées) + saisie globale par type ;
- `computeAvailableReturnableRows` reste l'autorité du **plafond total** : la
  somme des saisies par ligne ne peut pas le dépasser.

### 6.5. Migration

**Aucune.** `deposit_issues.sale_line_id` existe depuis la v1 et figure au
schéma attendu (`expected_schema_v28.json`).

---

## 7. Tests

| Niveau | Ce qu'il prouve |
|---|---|
| TS | 2 casiers rendus sur 3 → 2 casiers + 48 bouteilles crédités, dette de 1 casier + 24 bouteilles |
| TS | la ligne n'apparaît pas si le conditionnement n'émet aucun casier |
| TS | la remise a disparu de l'écran, `discountAmount` reste à 0 dans l'envoi |
| Rust | `sale_line_id` **non nul** sur les deux retours (casier et bouteille) de la ligne |
| Rust | **FIFO** : le retour apure d'abord sa propre ligne, puis les dettes antérieures |
| Rust | retour **sans** `sale_line_id` → comportement identique à avant (non-régression) |
| Rust | total de la vente **identique** avec et sans retour |
| E2E | vente 3 casiers, 2 rendus → reçu « 1 casier + 24 bouteilles à restituer sous 15 jours », total inchangé |

---

## 8. Risques

| Risque | Parade |
|---|---|
| Créditer le casier sans les bouteilles | un seul champ, dérivation en un point unique, testée |
| Comptage double (ligne + type) | un seul envoi, agrégation testée |
| FIFO qui apure la mauvaise ligne | test Rust dédié à la priorité de ligne |
| Consigne du retour retirée du total | le total ne bouge pas : test Rust comparatif |
| Saisie supérieure au nombre de casiers | borne `0 … quantité` côté écran **et** côté serveur |

---

## 9. Hors périmètre

- Parcours de commande `/orders` : garde son panneau (Lot 15).
- `supportQuantity` éditable : sans objet après la réponse 1 — le champ
  « casier » de la demande désignait la ligne casier du panier.
- Demi-caisses : vendues à l'unité, elles n'émettent pas de casier ; le champ
  ne s'affiche donc pas. À traiter séparément si le besoin apparaît.

---

## 10. Ordre d'implémentation recommandé

1. **Rust** : `sale_line_id` optionnel + apurement prioritaire par ligne, avec
   les tests — c'est le socle, et le plus risqué.
2. **Modèle d'écran** : `returnedCrates`, dérivation bouteilles, plafonds, tests.
3. **Affichage** : champ par ligne, suppression de la remise.
4. **Reçu** : détail par ligne.
5. **E2E** : le parcours complet, total inchangé.

Le lot est livrable en une fois, mais l'étape 1 mérite d'être vue seule en revue :
c'est la seule qui touche à de l'argent déjà facturé.
