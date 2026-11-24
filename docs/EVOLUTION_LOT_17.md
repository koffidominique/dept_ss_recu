# Lot 17 — L'écran des tournées

> Suite du `Lot 16`. Les routes existaient, aucune page ne les appelait.
> CI verte 13/13, 24 tests ajoutés (22 de logique, 2 de matrice).

---

## 1. Ce qui manquait réellement

Le Lot 16 avait rendu les tournées **joignables** : 12 routes HTTP, des
permissions, 4 tests. Techniquement, tout répondait. Et personne ne pouvait
s'en servir : aucune page n'appelait ces routes.

Il y avait trois trous, et aucun n'était visible en relisant les tests HTTP.

### ① Le client Tauri n'existait pas

L'application se compile en deux modes : navigateur (HTTP) et bureau (Tauri,
IPC natif). Le client Tauri implémente un contrat TypeScript commun, donc les
13 commandes IPC devaient exister des deux côtés.

Elles n'existaient pas. L'écran aurait fonctionné dans le navigateur et
échoué dans l'application de bureau — sur une erreur de runtime Tauri
(`command not found`), pas sur un refus lisible. Le genre de panne qu'on
n'attrape pas en testant l'un des deux modes.

### ② Quatre routes répondent 204, et le transport lisait du JSON

`httpRequest` termine par `res.json()`. Sur un corps vide, cela lève
« Unexpected end of JSON input », que le transport traduit en
`NETWORK_ERROR` — « Connexion au serveur local indisponible : aucune écriture
n'a été validée ».

Le serveur avait pourtant enregistré l'opération. **Une fausse panne sur un
succès est pire qu'une vraie panne** : l'utilisateur la rejoue, et on se
retrouve avec deux déclarations d'encaissement pour un seul arrêt.

`httpRequestVoid` a été ajouté au transport — pas à côté. Ma première version
reconstruisait les en-têtes à la main et **n'ajoutait pas le jeton** : elle
aurait rendu 401 sur chaque appel. Le jeton et la révocation sur 401 doivent
rester dans `buildHeaders`, à un seul endroit.

### ③ Il n'y avait pas de règle d'affichage

Un bouton ne s'affiche que si le rôle **et** le statut l'autorisent. Sans
cette règle, l'écran propose de charger une tournée vide, de réconcilier une
tournée qui roule, ou de démarrer un brouillon : l'utilisateur découvre les
règles du cœur par des messages d'erreur successifs.

`runActions(status, stopCount)` est la source unique de cette vérité.

---

## 2. Un défaut trouvé en vérifiant contre `rbac.rs`

Mon premier filtre des comptes attribuables à une tournée était :

```ts
const DRIVER_CAPABLE_ROLES = new Set(["driver", "owner", "manager"]);
```

Faux. En relisant `rbac.rs` : **seuls `Owner` et `Driver` portent
`DeliveryRunsExecute`**. `Admin` et `Manager` préparent et réconcilient, mais
ne partent pas en tournée.

Proposer un gérant comme livreur, c'est créer une tournée que personne ne
pourra démarrer — et le découvrir au moment du départ, pas à la création.

Corrigé à `["driver", "owner"]`, et **verrouillé par un test**, parce que
c'est exactement le genre d'erreur qui revient.

---

## 3. Les deux écarts, et pourquoi les confondre est l'erreur

La réconciliation affiche deux écarts distincts :

```text
écart_déclaration = déclaré − attendu    le livreur s'est trompé ou a oublié
écart_caisse      = compté  − déclaré    il manque des billets dans le sac
```

Un seul des deux à zéro **ne veut pas dire que tout va bien**. Le test
« un écart nul n'est pas signalé, même si l'autre ne l'est pas » verrouille
précisément ce piège.

Le montant qui entre en caisse est le **compté**, jamais le déclaré. Et un
motif devient obligatoire dès qu'un écart existe — vérifié côté formulaire
*pour ne pas faire deviner*, et côté cœur *pour que ce ne soit pas
contournable*.

---

## 4. Le retour de vides a deux niveaux, le second n'est pas décoratif

1. **ce qui est rapporté** au dépôt, par consignable, bons et abîmés ;
2. **chez quel client** ces vides ont été repris.

Sans le second, le stock entrerait sans que personne ne soit crédité : le parc
grossirait et les consignes resteraient ouvertes. La somme par consignable
doit donc égaler exactement ce qui est rapporté.

Le formulaire affiche l'équilibre **en direct** :

```text
Casier 12 : rapportés 3 bon(s) / 0 abîmé(s) · répartis 2 / 0 — reste à répartir
Casier 12 : rapportés 3 bon(s) / 0 abîmé(s) · répartis 3 / 0 ✓
```

L'utilisateur voit le manque avant de valider, pas après un refus serveur.

---

## 5. Ce qui est livré

| Élément | Nature |
| --- | --- |
| `types/erp/delivery.ts` | 12 types, miroir des DTO |
| `services/api/contracts/deliveryContracts.ts` | contrat `DeliveryApiClient` |
| `services/api/http/httpDeliveryRoutes.ts` | 13 routes HTTP |
| `services/api/tauri/tauriDeliveryCommands.ts` | 13 commandes IPC |
| `src-tauri/src/commands/delivery.rs` | 13 commandes Rust |
| `httpTransport.ts` | `+ httpRequestVoid` (204 sans corps) |
| `features/delivery/utils/deliveryRuns.ts` | logique pure |
| `features/delivery/hooks/useDeliveryRuns.ts` | requêtes & mutations |
| `features/delivery/components/*` | 6 modales |
| `pages/DeliveryRunsPage.tsx` | liste + détail + réconciliation |
| `permissions.ts` | 4 permissions + route `/delivery-runs` |
| `Sidebar.tsx` | entrée « Tournées de livraison » |

---

## 6. Tests

**22 tests de logique pure** (`deliveryRuns.test.ts`), exécutables sans
navigateur :

| Groupe | Ce qui est verrouillé |
| --- | --- |
| Actions | tournée vide non chargeable, pas de double départ, réconciliation au retour seulement, terminal |
| Résumé | somme de l'attendu **figé**, arrêts non constatés signalés |
| Écarts | deux écarts distincts, un zéro ne masque pas l'autre, positif = avertissement |
| Motif | obligatoire dès un écart, montants entiers positifs |
| Répartition | équilibre exact, abîmés séparés des bons, client hors tournée refusé |
| Comptes | seuls `owner`/`driver` proposés ; un compte inactif jamais |
| Divers | fuseau horaire (`toISOString` décale à 23 h), chaîne vide → `null` |

**2 tests de matrice** dans `permissions.test.ts` : owner sur toutes les
routes (dont la nouvelle), livreur et caissier admis, rôle sans
`delivery_runs:read` refusé.

Totaux locaux : `tsc` propre, `eslint --max-warnings 0` propre,
`vite build` OK, **143/143** tests web.

---

## 7. Où en est le chantier tournées

| Lot | Contenu | État |
| --- | --- | --- |
| 13 | socle : tournées, arrêts, chargement | livré |
| 14 | réconciliation, retours de vides | livré |
| 15 | vides rapportés à la commande | livré |
| 16 | exposition HTTP + rôle livreur | livré |
| **17** | **écran de pilotage** | **livré** |

Le cycle est complet et utilisable de bout en bout : créer une tournée,
ajouter des arrêts, charger (l'attendu se fige), faire partir le livreur,
déclarer les encaissements, constater les arrêts, enregistrer les vides
rapportés avec leur client, rentrer la tournée, puis réconcilier — où la
caisse bouge pour la première fois.

---

## 8. La limite qui reste

`DeliveryRunsRead` n'est toujours pas filtrée par ligne : un livreur voit
toutes les tournées du dépôt, pas seulement les siennes. C'est acceptable pour
quelques livreurs et documenté dans `rbac.rs`. Le jour où ça ne l'est plus, le
filtre porte sur `driver_user_id` — et l'écran devra alors distinguer « mes
tournées » du reste, ce qui n'est pas qu'un changement de requête.

Deuxième limite, plus discrète : le front déduit la capacité d'un compte à
partir de son **rôle**, parce que `UserAccount` ne renvoie pas les
permissions. Si la matrice de `rbac.rs` change, ce filtre ne suivra pas tout
seul. Le test qui verrouille `owner`/`driver` échouera, ce qui est le signal
voulu — mais c'est une duplication à surveiller.
