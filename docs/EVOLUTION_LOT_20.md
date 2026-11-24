# Lot 20 — Le parcours complet, en vrai

> Ce que le `Lot 19` laissait ouvert : aucun test ne traversait le parcours
> entier. Les Lots 16 à 19 avaient chacun leurs preuves — tests Rust du cœur,
> tests HTTP des routes, tests unitaires de la logique d'écran — et tous étaient
> verts. Le parcours, lui, n'avait jamais été exécuté par un navigateur.
>
> Il l'a été. Il n'a pas tenu debout tout de suite.
> CI verte **13/13**, un scénario E2E ajouté, **sept défauts réels corrigés**.

---

## 1. Pourquoi ce lot

Un dépôt peut avoir 160 tests unitaires, 4 tests HTTP et 6 tests Rust sur une
fonctionnalité et ne jamais savoir si elle fonctionne. Chaque couche prouve sa
propre hypothèse ; aucune ne prouve qu'elles s'emboîtent. Les trois divergences
corrigées au Lot 18 étaient exactement de ce type — invisibles pour tous les
tests existants.

Le scénario ajouté (`tests/e2e/delivery-runs.spec.ts`) traverse, dans un
navigateur réel :

créer un livreur depuis les Paramètres → créer une tournée → y poser un arrêt
avec sa commande → charger → partir → constater la livraison → déclarer
l'encaissement → retour de tournée → réconcilier → se reconnecter en livreur et
constater qu'il n'a aucun geste de préparation.

L'amorçage des données passe par l'API ; tout ce qui doit être prouvé passe par
l'interface. L'état final est relu sur le serveur, pas seulement à l'écran.

---

## 2. Ce que l'exécution a trouvé

Sept défauts, dont six jamais visibles par aucun test. Ils sont listés dans
l'ordre où ils sont apparus — c'est-à-dire dans l'ordre où un utilisateur les
rencontrerait.

### 2.1 Un arrêt sans commande n'a rien à encaisser

**Le plus grave.** La modale d'arrêt ne permettait pas de rattacher une
commande, alors que `AddStopInput` porte `order_id` depuis toujours.

Or l'attendu d'un arrêt est `orders.total_to_collect_xof - orders.paid_xof`, et
zéro sans commande. Le livreur partait donc avec un arrêt à 0 FCFA ; le bouton
« Déclarer » produisait `Le montant déclaré doit être supérieur à zéro`, sans
que rien à l'écran n'explique pourquoi.

Autrement dit : on pouvait créer, charger et faire partir une tournée complète
qui ne servait à rien.

La modale propose désormais les commandes du client choisi, limitées à celles
qui restent à encaisser, avec le montant en clair. Changer de client remet la
commande à zéro. Quand un client n'a rien à encaisser, l'écran le dit.

### 2.2 Le livreur recevait jusqu'à quatorze 403 par écran

Une fois le parcours fonctionnel, l'assertion finale « aucune erreur console »
est tombée. Le diagnostic ajouté au scénario a nommé les refus :

```
403 GET /api/dashboard       403 GET /api/reports
403 GET /api/settings        403 GET /api/cash
403 GET /api/auth/users      403 GET /api/orders
403 GET /api/inventories     403 GET /api/consignments
403 GET /api/backups/db-status
```

Le rôle `driver` ne porte que `DeliveryRunsRead` et `DeliveryRunsExecute`. Tout
le reste lui est refusé — ce qui est voulu. Le problème n'était pas les refus,
c'était de les provoquer :

| Origine | Requêtes | Pourquoi elles partaient |
|---|---|---|
| `Header` | `/api/cash`, `/api/dashboard` | pastilles affichées conditionnellement, mais requêtes inconditionnelles — **et toutes les 30 s** |
| `AppLayout` → `useSettingsQueries` | `/api/settings`, `/api/auth/users` | monté sur **toutes** les pages |
| `useWorkQueue` (tableau de bord) | 6 sources | le commentaire disait « on dégrade par source », le code partait sans condition |
| `useDashboardData` | dashboard, settings, rapports | idem |
| `useDeliveryRunsQueries` | `/api/settings` | réservé à `SettingsRead` |
| `DeliveryRunsPage` | users, clients, commandes, emballages | réservés à la préparation |

Chaque requête est maintenant liée à la permission qui la rend lisible. Le
schéma est toujours le même : **une donnée dont l'affichage est conditionnel
doit être chargée conditionnellement**. Le tableau de bord est la page
d'arrivée après connexion — c'était donc le pire endroit pour cette erreur.

Rien ne change pour le propriétaire ni le gérant : ils possèdent ces droits.

### 2.3 Le scénario 1 supposait être le premier fichier exécuté

`app.spec.ts` configurait le PIN propriétaire et attendait l'écran de création.
Vrai tant qu'il était seul à le faire ; faux dès qu'un autre fichier amorçait le
PIN avant lui. Playwright ordonne les fichiers comme il l'entend, et il a
effectivement exécuté `delivery-runs.spec.ts` en premier.

Trois corrections d'ordre, de même nature :

- le nouveau fichier amorce le PIN de façon idempotente (`déjà configuré` est
  accepté, tout autre message échoue) ;
- le Scénario 1 accepte les deux états de départ, et vérifie toujours le
  montage complet quand la création a lieu ;
- les Scénarios 1 et 2 attendent que l'écran ait décidé avant de choisir une
  branche — `isVisible()` ne patiente pas, `expect(...).toBeVisible()` si.

### 2.4 Le Scénario 2 supposait la caisse fermée

Même cause, autre conséquence : il vérifiait le bouton « Ouvrir une session de
caisse », qui disparaît quand une session existe. Le Scénario 6 en ouvre une
pour de bon. Il n'ouvre désormais que si le bouton est là ; l'état final attendu
(« Session active ») ne change pas.

### 2.5 Le compté était écrasé par zéro

La modale de réconciliation pré-remplit « Montant compté dans le sac » avec le
déclaré du livreur. Le test y écrivait `0`, créant un manquant et exigeant un
motif que le scénario ne saisissait pas. Le test se trompait lui-même.

### 2.6 Le montant n'était pas celui que je croyais

En corrigeant le point précédent, le champ valait **5 800** et non 4 800 : la
commande de 12 bouteilles a alloué un casier, dont la consigne de 1 000 FCFA
entre aussi dans le reste à encaisser.

Écrire un nombre à la main dans un test, c'est y figer une hypothèse. Le
scénario vérifie désormais une **propriété** : le compté reprend le déclaré, il
est positif, et l'écart relu sur le serveur (`counted_amount`, `cash_gap`) est
exactement celui que la modale a soumis.

### 2.7 Trois formes de réponse inventées

- `POST /api/orders` renvoie un `OrderDetailDto` — `{ order, lines, … }` — pas
  la commande à la racine ;
- `GET /api/cash` renvoie `activeSession`, pas `session` ;
- `requested_unit` est un vocabulaire fermé côté schéma (`bottle`, pas
  `bouteille`), alors que `base_unit` du produit est libre et en français.

Aucune n'était devinable : les trois ont coûté une itération de CI chacune.

---

## 3. Ce qui a changé dans le code

| Fichier | Changement |
|---|---|
| `src/features/delivery/components/DeliveryRunStopModal.tsx` | choix de la commande à livrer, montant restant affiché, avertissement si rien à encaisser |
| `src/pages/DeliveryRunsPage.tsx` | requêtes de préparation liées à `canManage` / `securityManageUsers` |
| `src/features/delivery/hooks/useDeliveryRuns.ts` | réglages liés à `SettingsRead` |
| `src/layouts/Header.tsx` | pastilles de caisse et de retards liées à leur permission |
| `src/features/settings/hooks/useSettingsData.ts` | réglages et comptes liés à leur permission |
| `src/features/dashboard/hooks/useWorkQueue.ts` | 6 sources liées à leur permission |
| `src/features/reports/hooks/useDashboardData.ts` | tableau de bord, réglages, rapports liés |
| `tests/e2e/delivery-runs.spec.ts` | **nouveau** — le parcours complet |
| `tests/e2e/app.spec.ts` | Scénarios 1 et 2 indépendants de l'ordre des fichiers |

Aucun changement côté Rust : le cœur savait déjà tout faire. Les sept défauts
étaient tous dans l'écran, ou dans ce que le test croyait savoir de l'écran.

---

## 4. Ce que ce lot laisse ouvert

- **La modale d'arrêt ne permet pas encore de retirer une commande d'un arrêt
  déjà posé.** Le cœur refuse de modifier une tournée `in_progress`, mais une
  tournée `draft` accepte encore des arrêts : il n'existe pas de route pour
  éditer un arrêt. Non rencontré par le parcours, donc non traité.
- **Un arrêt sans commande est toujours accepté**, avec un simple
  avertissement. C'est défendable — une visite sans encaissement existe — mais
  cela signifie que la tournée inutile du §2.1 reste *possible*. Elle n'est
  plus silencieuse.
- **Limite déjà connue (Lots 17-18)** : un livreur voit toutes les tournées,
  pas seulement les siennes. Acceptable à l'échelle d'un dépôt, à filtrer par
  `driver_user_id` le jour où ça ne l'est plus.

---

## 5. Leçon

> Un test qui recopie une hypothèse la fige. Un test qui vérifie une propriété
> la prouve.

Les erreurs §2.5 et §2.6 sont de la même famille : j'avais écrit ce que je
*croyais* que l'écran produirait. Le cœur, lui, avait raison depuis le début.

Et sur les sept défauts, **six étaient invisibles pour toute la suite de tests
existante** — non pas parce que les tests étaient mauvais, mais parce qu'ils
testaient chacun leur couche. Le seul moyen de voir qu'elles ne s'emboîtaient
pas était de les faire tourner ensemble, dans un vrai navigateur.
