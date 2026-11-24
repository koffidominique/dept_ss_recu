# Lot 14 — Réconciliation des tournées

> Cœur métier, sans interface. Suite du `Lot 13` (socle) et de
> `DECISIONS_TOURNEES_ET_CONSIGNES.md`.
> CI verte 13/13, 12 tests dédiés.

---

## 1. Ce qui est livré

| Élément | Nature |
| --- | --- |
| `migrations/sqlite/0028_delivery_run_reconciliation.sql` | 1 table + 2 colonnes |
| `application/delivery_reconciliation.rs` | 5 fonctions |
| `application/packaging_returns.rs` | boucle de solde **extraite**, partagée |
| `tests/lot14_delivery_reconciliation.rs` | 12 tests |

Schéma passé en **v28** (104 tables, 171 index).

---

## 2. Le flux, et pourquoi il a trois temps

```text
① DÉCLARATION   le livreur saisit ce qu'il a encaissé, par moyen.
                Aucun mouvement de caisse.

② RETOUR        le gérant constate : quels arrêts livrés, combien de vides,
                et chez qui ils ont été repris. Toujours rien en caisse.

③ RÉCONCILIATION  le gérant compte. C'est ici, et seulement ici, que les
                  cash_movements sont écrits.
```

La propriété recherchée : **`cash_sessions.theoretical_cash` reste exact en
permanence**. Rien n'entre avant le retour, donc l'écart se mesure au bon
endroit.

```
attendu         = Σ arrêts livrés (figé au chargement)
déclaré         = Σ collections du livreur
compté          = ce que le gérant trouve dans le sac
écart_déclaré   = déclaré − attendu
écart_caisse    = compté − déclaré
```

---

## 3. Trois décisions qui ne sont pas des détails

### ① L'attendu ne compte que les arrêts livrés

Un arrêt `failed` ou `skipped` n'a rien produit. L'inclure fabriquerait un
manquant imaginaire le soir, et le gérant chercherait un billet qui n'a jamais
existé.

Testé : tournée à deux arrêts, l'un livré à 4 600, l'autre en échec → attendu
= **4 600**, pas 7 600.

### ② La caisse encaisse le compté, pas le déclaré

Si le livreur déclare 10 000 et rend 9 500, faire entrer 10 000 rendrait la
caisse théorique fausse de 500 **à chaque tournée**.

Le mouvement porte donc le compté. L'écart compté − déclaré est **constaté et
motivé**, jamais absorbé.

Testé : attendu 4 600, déclaré 4 600, compté 4 500 → le mouvement vaut
**4 500**, et l'écart affiché est **−100**.

### ③ Les vides se répartissent par client, pas en FIFO global

C'est l'écart assumé avec la doc d'origine. `DECISIONS_TOURNEES_ET_CONSIGNES.md`
§6 prévoyait un FIFO sur les `deposit_issues` — mais ces consignes sont **par
client**. Un FIFO global solderait la dette du client B avec des casiers
ramassés chez le client A.

Le livreur **sait** chez qui il reprend. Le gérant le déclare à la
réconciliation : c'est une **observation**, pas une reconstruction fragile.

Testé : le client B a 5 casiers de dette depuis plus longtemps, le client A
en a 2. On rapporte 2 casiers repris chez A. Résultat : la consigne de A est
soldée, celle de B **reste à 0 rendu**.

Deux gardes empêchent les dérives : on ne répartit pas plus que rapporté, et un
client absent de la tournée ne reçoit pas de répartition.

---

## 4. Un bug trouvé par un test

Le test des vides abîmés attendait 1 casier en stock. Il en trouvait 3.

`record_breakage` passait par la fonction d'entrée en stock, qui **incrémente**.
Une pièce cassée devenait donc un casier réutilisable — et le parc aurait grossi
de lui-même à chaque tournée.

La casse a maintenant son propre chemin : mouvement `breakage` journalisé avec
`stock_before == stock_after`, sans toucher au stock. C'est ce qu'on veut savoir :
*2 pièces cassées, parc inchangé*.

Le contrôle de répartition (on ne répartit pas plus que rapporté) n'aurait
**pas** attrapé ce bug : il porte sur la répartition, pas sur le stock.

---

## 5. Une transition qui manquait

`reconcile_run` exige `returned`. Or **aucune fonction ne faisait passer une
tournée de `in_progress` à `returned`**. Le cycle était incomplet : la
réconciliation était inatteignable en pratique.

`return_run` comble le trou :

- refuse si un arrêt est encore `planned` — on ne rentre pas d'une tournée dont
  on ignore ce qui s'est passé à chaque arrêt ;
- idempotent.

C'est le test qui l'a révélé, pas la relecture.

---

## 6. Un refactor au passage

La boucle de solde FIFO des consignes vivait dans `packaging_and_returns.rs`.
Elle est extraite dans `application/packaging_returns.rs` et appelée par les
**deux** flux :

- le retour d'emballage d'une commande (comportement inchangé) ;
- la réconciliation d'une tournée (nouveau).

Une règle, un seul endroit. Deux copies divergent tôt ou tard, et ce genre
d'écart se voit en comptabilité.

---

## 7. Tests

| Test | Ce qu'il protège |
| --- | --- |
| `declaring_writes_nothing_to_the_cash_session` | déclarer n'écrit aucun mouvement |
| `a_failed_stop_cannot_carry_a_collection` | un arrêt en échec efface sa déclaration |
| `a_stop_declared_failed_requires_a_reason` | un motif vide n'est pas un motif |
| `reconciliation_writes_the_counted_amount_not_the_declared_one` | compté ≠ déclaré en caisse |
| `a_gap_without_a_reason_is_refused` | l'écart sans motif est bloqué, sans rien écrire |
| `reconciliation_is_idempotent_and_terminal` | rejeu sans double mouvement, statut terminal |
| `reconciliation_requires_an_open_cash_session` | pas d'encaissement hors session |
| `expected_ignores_stops_that_were_not_delivered` | l'échec sort de l'attendu |
| `empties_settle_the_right_client_and_not_the_oldest_debt` | pas de FIFO entre clients |
| `damaged_empties_are_recorded_as_breakage_not_stock` | la casse n'est pas du stock |
| `allocating_more_than_reported_is_refused` | pas de matière créée |
| `a_driver_cannot_reconcile` | le livreur déclare, il ne clôture pas |

---

## 8. Ce que ce lot ne fait pas

| Manquant | Lot |
| --- | --- |
| Interface gérant (écran de réconciliation) | 15 |
| Bon de tournée imprimable | 15 |
| Terminal mobile du livreur | 16, différé |
| Écran d'anomalie « tournée ouverte > 24 h » | 15 |

**Deux points à trancher au Lot 15 :**

1. **La répartition des vides demande du travail au gérant.** Il doit saisir,
   client par client, ce que le livreur a repris. C'est juste, mais c'est une
   saisie de plus dans un soir chargé. L'écran devra la rendre rapide —
   pré-remplir depuis les arrêts de la tournée est la piste évidente.

2. **Il n'y a pas de trace de *qui* a constaté l'écart.** `audit_logs` existe et
   `audit_log_tx` est disponible, mais je ne l'ai pas branché : le Lot 14 reste
   sans interface, donc sans acteur réel dans les tests. À câbler avec l'écran.
