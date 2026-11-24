# Lot 18 — L'écran disait des choses fausses

> Correction du `Lot 17`. Aucune fonctionnalité nouvelle : trois règles que
> l'écran affirmait et que le cœur refuse, plus une décision de produit que
> j'avais ignorée.
> CI verte 13/13, 7 tests ajoutés (32 au total sur la logique).

---

## 1. Ce qui s'est passé

Le Lot 17 a livré un écran complet et vert. Tous ses tests passaient. Et il
disait trois choses fausses.

Le point commun : j'ai **réécrit les règles du cœur au lieu de les lire**.
L'écran décidait d'afficher un bouton à partir d'une intuition (« le livreur
part en tournée, donc il lui faut `Execute` »), pas à partir de
`require_current_actor_permission` dans le code.

Un humain n'aurait vu qu'un `403`. Pas de plantage, pas d'écran blanc : un
bouton qui ne marche pas, et un message technique.

---

## 2. La décision que j'avais ignorée

`docs/DECISIONS_TOURNEES_ET_CONSIGNES.md` §7 est explicite :

> **Lot 16 — Terminal livreur (différé, sur décision).**
> Le flux papier — bon de tournée imprimé, retour saisi par le gérant — livre
> l'essentiel de la valeur. Le terminal mobile n'ajoute que la saisie au fil
> de l'eau.

Et §8 :

> `driver` (nouveau) | `DeliveryRunsExecute` uniquement | tout le reste

Le modèle réel n'est donc **pas** « le livreur pilote l'app sur la route » :
c'est « le gérant prépare et fait partir avec du papier ; le livreur déclare
au retour, sur le poste du dépôt ». Conséquence : `DeliveryRunsExecute` ne
sert qu'à **un seul geste** de toute l'application — déclarer un
encaissement. Vérifié : c'est le seul `DeliveryRunsExecute` du cœur.

---

## 3. Les trois divergences

### ① Le départ

| | |
| --- | --- |
| L'écran exigeait | `delivery_runs:execute` |
| Le cœur exige | `DeliveryRunsManage` (`start_run`, l. 323) |
| Effet | le livreur voyait **Départ** et recevait `403` |

### ② L'annulation

| | |
| --- | --- |
| L'écran autorisait | `draft`, `loaded` |
| Le cœur accepte | `draft`, `loaded`, **`in_progress`** |
| Effet | impossible d'annuler une tournée partie par erreur — précisément le cas où on en a besoin |

### ③ Le livreur attribuable

`create_run` exige `role == "driver"` **strictement**, sur un compte actif.
Mon filtre acceptait aussi `owner`, au motif qu'il porte `DeliveryRunsExecute`.

C'est confondre **« peut exécuter un geste »** et **« peut être désigné comme
livreur d'une tournée »**. Une tournée créée ainsi aurait été refusée par le
cœur au moment de la création.

---

## 4. Le pire : mon test verrouillait mon erreur

```ts
test('seuls les rôles qui portent delivery_runs:execute sont proposés comme livreur', () => {
  assert.equal(isDriverAccount({ active: true, role: 'owner' }), true);
```

Ce test passait. Il ne vérifiait pas la règle du cœur, il **recopiait mon
hypothèse** — et la figeait. C'est plus grave qu'une absence de test : une
absence laisse le défaut visible, un test faux le rend officiel.

Le remplacement vérifie la règle réelle et documente pourquoi :

```ts
test('seul le rôle driver est proposé comme livreur, pas owner', () => {
  assert.equal(isDriverAccount({ active: true, role: 'owner' }), false);
```

---

## 5. Ce qui empêchera la récidive

### La table action → permission

`RUN_ACTION_PERMISSION` rend le lien explicite au lieu de le laisser dans un
`&&` au milieu d'un JSX :

```ts
export const RUN_ACTION_PERMISSION: Record<keyof RunActions, RunActionPermission> = {
  canAddStop: "manage",
  canLoad: "manage",
  canStart: "manage",          // et non "execute" : voir start_run
  canCancel: "manage",
  canRecordOutcome: "manage",
  canDeclareCollection: "execute", // le seul geste que le livreur peut faire
  canRecordReturn: "manage",
  canReturnRun: "manage",
  canReconcile: "reconcile",
};
```

Le type `Record<keyof RunActions, …>` garantit qu'ajouter une action sans lui
donner de permission **ne compile pas**.

### Le test de complétude

```ts
test('chaque action déclarée possède une permission associée', () => {
  const actions = Object.keys(runActions('draft', 1)).sort();
  const mapped = Object.keys(RUN_ACTION_PERMISSION).sort();
  assert.deepEqual(actions, mapped);
});
```

### Le test qui fige la décision produit

```ts
test('déclarer un encaissement est le seul geste de niveau Execute', …)
```

Si quelqu'un accorde un jour `Execute` à un autre geste, ce test échoue et
l'oblige à relire la décision §7.

---

## 6. Tests ajoutés

| Test | Ce qui est verrouillé |
| --- | --- |
| annulation sur tournée en cours | `in_progress` annulable, `returned` non |
| départ ⇒ `Manage` | le départ n'est pas un geste de livreur |
| un seul geste `Execute` | décision §7 figée |
| complétude de la table | aucune action sans permission |
| aucun geste en `Read` | comptable et stock-manager en lecture seule |
| livreur ⇒ `driver` seul | `owner` refusé, comme le cœur |
| compte inactif | jamais proposé |

Et deux tests du Lot 18 sur la **lisibilité** de la réconciliation
(`isReconcilableForReading`), dont un qui parcourt les statuts et exige que
tout statut réconciliable soit aussi lisible.

Totaux : **32 tests** de logique pure, **153** tests web, `tsc` propre,
`eslint --max-warnings 0` propre, `vite build` OK.

---

## 7. La leçon, en une ligne

Un écran qui recopie les règles du cœur finit par se tromper, parce qu'il les
recopie **de mémoire**. La seule défense trouvée : extraire le lien
action → permission dans une table typée, l'aligner explicitement sur
`require_current_actor_permission`, et écrire un test par ligne de cette
table — en citant la fonction du cœur qui fait foi.

---

## 8. Ce qui reste ouvert

- **Le parcours complet n'a jamais tourné en vrai.** 32 tests de logique, 4
  tests HTTP : aucune exécution de bout en bout (créer → charger → départ →
  déclarer → constater → retour → réconcilier). La doc de décision le
  demandait dès le Lot 15 (« parcours Playwright bout en bout »). C'est le
  prochain chantier évident.
- `DeliveryRunsRead` toujours non filtrée par ligne : le livreur voit toutes
  les tournées. Documenté dans `rbac.rs`.
- La décision §7 elle-même (terminal différé) n'est pas remise en cause ici :
  elle est appliquée, pas discutée. Si le compte rendu de tournée s'avère
  insuffisant en pratique, c'est elle qu'il faudra rouvrir.
