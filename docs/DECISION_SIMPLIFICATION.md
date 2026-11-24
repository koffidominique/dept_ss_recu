# Décision d'architecture — Simplification à administrer

> Décision demandée : « la meilleure option pour avoir une application
> professionnelle et pas trop complexe à administrer ».
> Toutes les affirmations ci-dessous sont vérifiées dans le code au 2026-11-23.

---

## 0. Le principe de décision

Pour un sous-dépôt de boissons, **administrable** veut dire trois choses, dans
cet ordre :

1. **Un seul chiffre par question.** S'il y a deux soldes de consignes, personne
   ne sait lequel est vrai — donc personne ne s'en sert.
2. **Rien de codé en dur qu'un gérant voudrait changer.** Un délai de retour
   gravé dans l'interface est une donnée métier qu'on ne peut pas administrer.
3. **Un seul endroit à configurer.** Un écran de réglages, pas cinq formulaires.

J'ai donc écarté les options élégantes mais coûteuses, et retenu les choix qui
**réduisent le nombre de concepts** que le gérant doit comprendre.

---

## 1. Le problème réel, mesuré

Avant de choisir, voici ce que j'ai trouvé en vérifiant — et c'est pire que ce
que j'avais annoncé au message précédent.

### 1.1 Le délai de retour est faux partout dans l'interface

La politique globale créée par la migration `0015` dit **30 jours** :

```sql
INSERT INTO packaging_policies (name, return_delay_days, auto_convert_on_due, allow_late_return)
SELECT 'Politique par défaut', 30, 1, 1
```

Mais **22 fichiers de l'interface** affichent « 15 jours » :

| Fichier | Occurrences |
| --- | --- |
| `PackagingFinancialPanel.tsx` | 10 |
| `ValidatedSaleBanner.tsx` | 5 |
| `csvInventoryExports.ts` | 4 |
| `PrintableDocumentSheet.tsx` | 3 |
| `consignmentPrintHelpers.ts` | 3 |
| `ClientDetailModal.tsx`, `phase2OperationsGuards.ts`, `orderPrintDocument.ts`, `CommercialDocumentsPage.tsx` | 2 chacun |
| 11 autres fichiers | 1 chacun |

Le code Rust est aussi incohérent, avec **quatre** retombées en dur :

| Fichier | Ligne | Valeur par défaut |
| --- | --- | --- |
| `orders/lifecycle.rs` | 289 | 15 jours |
| `orders/lifecycle_settlement.rs` | 222 | 15 jours |
| `sales/create_persistence.rs` | 167 | 15 jours |
| `packaging_obligations/conversions.rs` | 136 | 15 jours + conversion auto |

**Conséquence concrète** : un client reçoit un bon imprimé qui promet 15 jours,
l'interface lui affiche « (> 15j) » quand il est en retard, mais le système ne
convertit la créance qu'à 30 jours. Et si quelqu'un supprime la politique
globale, le calcul retombe réellement sur 15.

### 1.2 Les politiques d'emballage ne sont administrables nulle part

```
grep "packaging_policies" crates/depotpro-server/src/  → 0 résultat
grep "packaging_policies" src/                          → 0 résultat
```

**Aucune route, aucun écran.** Les trois champs qui décident du comportement —
`return_delay_days`, `auto_convert_on_due`, `allow_late_return` — ne sont
modifiables que par requête SQL directe sur la base.

C'est la contradiction la plus grave de tout le module : **le logiciel a une
politique configurable, et personne ne peut la configurer.**

### 1.3 Les deux référentiels d'emballages ne sont pas reliés

`packaging_assets.returnable_id` existe, mais le seed de la migration `0019` ne
le remplit pas :

```sql
INSERT OR IGNORE INTO packaging_assets (code, name, packaging_type_id, capacity,
    deposit_value, currency, returnable, compatibility_class)
VALUES ('PA-CASIER-24X33', ..., 1, 'bottle_33cl_glass'), ...
```

Aucune ligne ne renseigne `returnable_id`. Il vaut donc **NULL pour tous les
actifs**.

Et `deliver_order` en dépend directement :

```rust
if let Some(rid) = returnable_id_opt {
    // écrit customer_packaging_accounts ET deposit_issues
}
```

**Conséquence** : `customer_packaging_accounts` et `deposit_issues` ne
reçoivent **rien** d'une livraison de commande. Toute la machinerie
d'échéances et de conversion reste vide du côté commandes. Seule la vente
directe (`sales/create_persistence.rs`) alimente correctement les deux.

### 1.4 Trois soldes coexistent, aucun ne dit la même chose

| Table | Granularité | Alimentée par | Affichée |
| --- | --- | --- | --- |
| `customer_packaging_accounts` | par consignable | ventes directes + `deliver_order` (qui n'écrit rien) | Oui, onglet « Soldes par client » |
| `customer_deposit_balances` | par actif | `deliver_order`, retours de commande | Écran de commande (`OrderStepClient`, via `customer_deposits`) |
| `deposit_issues` | par ligne de vente | les deux chemins | Oui, onglet « Consignes ouvertes » |

`customer_deposit_balances` **n'est pas mort** : `OrderStepClient.tsx:67` le lit
pour afficher les emballages détenus avant de prendre une commande. Il est
seulement absent du module consignes. Mesure : 4 écritures dans 3 fichiers, et
7 assertions dans `orders_mixed.rs`.

---

## 2. La décision : `deposit_issues` est la seule vérité

### Pourquoi cette table et pas une autre

| Candidat | Verdict |
| --- | --- |
| `deposit_issues` | ✅ **Retenue.** C'est la seule déjà écrite par **tous** les chemins (vente directe, commande, retour, conversion, perte, annulation), avec `pieces`, `returned_pieces`, `converted_pieces`, `lost_pieces`, `unit_value` figé, `due_date`, `policy_id` et un statut contraint par le schéma. |
| `customer_packaging_accounts` | ❌ Agrégat dénormalisé, maintenu par **11 fichiers**. Chaque oubli crée un solde faux, silencieusement. |
| `customer_deposit_balances` | ❌ Granularité **par actif**, affichée par l'écran de commande. 4 écritures, 3 fichiers. Ne peut pas être supprimée sans réécrire cet écran. |

**Règle unique à inscrire dans le code :**

> Toute dette d'emballages d'un client se lit en interrogeant `deposit_issues`
> avec un statut ouvert. Aucune autre table ne fait foi.

Et la formule, qui remplace les trois :

```sql
SELECT client_id, returnable_id,
       SUM(pieces - returned_pieces - converted_pieces - lost_pieces) AS pieces_dues
FROM deposit_issues
WHERE status IN ('pending', 'partially_returned')
GROUP BY client_id, returnable_id
```

`customer_packaging_accounts` et `customer_deposit_balances` deviennent des
**vues en lecture** (ou sont supprimées). Elles ne sont plus jamais écrites par
du code métier — au maximum recalculées à la demande.

### Pourquoi c'est la moins complexe à administrer

Le gérant ne voit plus qu'**un** solde par client. Quand il se demande « combien
de casiers me doit Maquis Le Palmier », la réponse vient d'un seul endroit,
celui-là même qui produit les échéances, les conversions et les pertes. Il n'y a
plus de dérive possible entre trois compteurs.

### Le coût, assumé

Il faut retoucher les 11 fichiers qui écrivent `customer_packaging_accounts` et
les 3 fichiers qui écrivent `customer_deposit_balances` (4 écritures). C'est un chantier de refactor,
pas une fonctionnalité — donc **invisible pour l'utilisateur** et difficile à
justifier auprès d'un commanditaire pressé. C'est précisément le genre de dette
qu'il faut payer tôt, avant que les tournées n'ajoutent un quatrième écrivain.

---

## 3. Le délai : une valeur, un seul endroit

### La décision

**Un réglage unique dans `app_settings`, et le DTO le porte.**

```sql
ALTER TABLE app_settings ADD COLUMN packaging_return_delay_days INTEGER NOT NULL DEFAULT 15;
ALTER TABLE app_settings ADD COLUMN packaging_limit_action TEXT NOT NULL DEFAULT 'warn'
    CHECK (packaging_limit_action IN ('warn', 'block'));
ALTER TABLE app_settings ADD COLUMN packaging_pending_limit_pieces INTEGER NOT NULL DEFAULT 0;
```

**La valeur par défaut : 15 jours.** Raison opérationnelle : c'est ce que le
logiciel affiche déjà partout, ce que les bons imprimés promettent déjà aux
clients, et c'est le rythme réel d'un sous-dépôt de boissons — un casier tourne
en 7 à 21 jours. Passer à 30 sans changer 22 textes produirait exactement le
désordre actuel.

La migration `0015` cesse de poser 30 : la politique seedée prend la valeur du
réglage.

### Pourquoi supprimer `packaging_policies` (la partie la plus difficile)

La table permet une politique **par client** et **par emballage**, avec cascade
à quatre niveaux. Sur le papier, c'est mieux. En pratique :

- **aucune interface** ne permet de la remplir (constat 1.2) ;
- une cascade à quatre niveaux est **impossible à expliquer** à un gérant qui
  demande « pourquoi ce client a 15 jours et celui-là 30 ? » ;
- chaque niveau est une source de divergence supplémentaire avec les textes de
  l'interface.

**Décision : la cascade est supprimée.** Un délai global, plus une exception
possible par client — la seule que le commerce justifie réellement (un gros
maquis négocie 30 jours, un client de passage reste à 15). La colonne
`clients.packaging_delay_days` (nullable) porte cette exception.

Le code continue de lire `deposit_issues.due_date` : les échéances déjà
calculées restent valides. On ne réécrit pas le passé ; on arrête seulement de
produire de nouvelles divergences.

**Si vous jugez la suppression trop risquée**, l'alternative acceptable est de
garder la table mais de l'exposer dans un écran unique. Ce serait plus de code
que la supprimer — et un concept de plus à administrer. C'est exactement ce que
vous avez demandé d'éviter.

---

## 4. Les deux automatismes qu'il faut retirer, pas ajouter

C'est la partie contre-intuitive de cette décision : **administrable veut dire
moins d'automatique**, pas plus.

| Automatisme actuel | Décision | Raison |
| --- | --- | --- |
| Conversion **automatique** à l'échéance (`auto_convert_on_due = 1` par défaut) | **Désactivée par défaut.** La conversion devient une **action proposée** sur l'écran de pression | Une créance financière invisible qui apparaît toute seule est indéfendable face à un client. Le gérant doit voir la conversion avant qu'elle ne se produise. |
| `allow_late_return = 1` | Conservé, mais **explicite** dans l'écran | Le retour tardif est la norme dans ce métier. L'interdire est irréaliste ; le rendre silencieux est dangereux. |
| Traitement des échéances au démarrage du serveur | **Supprimé** | Il ne tourne pas si l'application est fermée le soir — donc il donne une fausse impression de sécurité. Remplacé par un écran qui calcule à la demande. |
| Blocage à la vente (nouveau) | **Mode `warn` par défaut** | Un blocage trop strict fait perdre des clients ; le mode avertissement laisse le gérant juger. Bascule en `block` quand l'équipe est à l'aise. |

**Aucun ordonnanceur, aucun processus d'arrière-plan.** C'est une décision
d'administrabilité : un sous-dépôt n'a pas d'informaticien. Un écran qui
s'actualise à l'ouverture vaut mieux qu'une tâche planifiée que personne ne
surveille.

---

## 5. L'écran unique : la page Consignes devient le poste de pilotage

Elle existe déjà (`src/pages/ConsignmentsPage.tsx`, 284 lignes, 6 onglets). Je
ne propose **pas** de nouvel écran — j'ajoute un bandeau au-dessus des onglets
existants.

```
┌─────────────────────────────────────────────────────────────┐
│  PRESSION DE RETOUR          (aujourd'hui)                  │
│  ┌──────────┬──────────┬──────────┬───────────────────────┐ │
│  │ Échues   │ ≤ 7 j    │ Pièces   │ Clients au plafond    │ │
│  │   3      │   8      │  240 pcs │        1              │ │
│  │ 12 000 F │          │          │  (Maquis Le Palmier)  │ │
│  └──────────┴──────────┴──────────┴───────────────────────┘ │
│  ▸ Convertir les 3 échéances  (action explicite, tracée)    │
└─────────────────────────────────────────────────────────────┘
   [Consignes ouvertes] [Soldes] [Catalogue] [Mouvements]
   [Créances d'emballages] [Historique]
```

Pourquoi ce choix et pas un septième onglet : un onglet se consulte, un bandeau
se voit. La pression de retour est une information qui doit être **vue sans
cliquer**.

---

## 6. Ordre d'exécution révisé

La découverte des sections 1.1 à 1.4 déplace les priorités. Le Lot 9 devient
plus lourd et plus urgent.

| Lot | Contenu | Effort | Pourquoi ce rang |
| --- | --- | --- | --- |
| **9a** | **Une seule référence pour les décisions** : `deposit_issues` fait foi pour le plafond. Les deux tables de soldes restent des caches d'affichage (elles alimentent des écrans à granularités différentes). | 1 j | Réalisable tout de suite, sans réécrire 15 écritures. `EVOLUTION_LOT_09A_PLAN.md` |
| **9b** | **Un seul délai** : réglage `app_settings`, suppression de la cascade, 22 textes UI et 4 retombées Rust alimentés par le DTO | 2 j | Le délai faux est visible par les clients, sur du papier signé. |
| **9c** | **Remplir `packaging_assets.returnable_id`** par migration + contrainte `NOT NULL` sur les actifs `returnable = 1` | 1 j | Sans ça, la consigne par commande ne naît jamais. |
| **9d** | **Plafond de consignes** : `warn` / `block` / dérogation tracée | 2 j | C'est la question 1 que vous avez tranchée. |
| **9e** | **Écran d'administration des consignes** : délai, plafond, mode | 1 j | Rien n'est administrable aujourd'hui. |
| **10** | Bandeau « Pression de retour » + conversion explicite | 2 j | Réutilise l'existant, aucun nouvel écran. |
| **11** | Règlement d'emballages aligné sur la caisse | 1 j | Cohérence des encaissements. |
| **12** | Permissions dans le cœur | 2 j | Défense en profondeur. |
| **13–15** | Tournées (socle → réconciliation → interface) | 5 sem. | Après que les fondations soient exactes. |

Total phase d'assainissement : **environ 2 semaines** au lieu des 8 jours
annoncés précédemment — la découverte des sections 1.1 à 1.4 ajoute du travail
réel qui n'était pas visible.

**Le Lot 9c est le plus important et le plus discret.** Aujourd'hui, une
commande livrée ne crée aucune consigne. Le module de consignes, tel qu'il est
câblé pour les commandes, est inerte. Corriger cela avant de construire des
tournées qui en dépendront est non négociable.

---

## 7. Ce que cette décision coûte, en clair

Je ne vais pas vendre cette option comme gratuite.

| Coût | Détail |
| --- | --- |
| **Refactor à fort impact** | 14 fichiers touchent les deux tables à déclasser. Le risque de régression est réel : les tests existants couvrent les ventes directes, moins les commandes. |
| **Une fonctionnalité retirée** | Les politiques par client et par emballage disparaissent. Si un jour un client négocie des conditions différentes sur les casiers 33cl et 50cl, la solution sera insuffisante. Sauvegarde : `deposit_issues.unit_value` et `due_date` sont figés à la création, donc l'historique ne bouge pas. |
| **Migration de données** | Remplir `returnable_id` demande de deviner la correspondance casier → consignable. Faisable par `compatibility_class`, mais à **vérifier sur les données réelles** avant d'appliquer. |

C'est le prix d'une application à un seul chiffre. L'alternative — garder trois
soldes et quatre niveaux de politique — est moins de travail immédiat et
beaucoup plus d'administration ensuite.

---

## 8. Résumé en une page

**La décision, en cinq lignes :**

1. `deposit_issues` est la seule source de vérité des consignes ; les deux
   tables de soldes deviennent des vues en lecture.
2. Un délai global dans `app_settings`, **15 jours par défaut**, plus une
   exception par client. La cascade à quatre niveaux disparaît.
3. Les politiques deviennent administrables (écran unique) — c'est ce qui
   manque le plus aujourd'hui.
4. Aucun automatisme invisible : conversion **proposée**, jamais déclenchée
   seule ; pas d'ordonnanceur.
5. Un bandeau « Pression de retour » sur l'écran Consignes existant, pas un
   nouvel écran.

**Ce qu'un gérant devra comprendre pour administrer :** un délai, un plafond,
deux méthodes d'achat. Plus trois tables et quatre niveaux de politique.
