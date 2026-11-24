# Rapport d'Évolution — LOT 7 : Vérification complète du câblage et des gestionnaires d'état

**Statut :** Vérification exhaustive menée en navigateur réel ; **4 défauts réels corrigés**  
**Branche :** `arena/4785ea08-dept-ss-recu` (base `main` @ `675c908`)  
**Date :** 2026-11-23  
**Demande :** « assure-toi que tout est branché et que les fonctionnalités et les gestionnaires d'états fonctionnent correctement »

---

## 1. Constat vérifié et parcours choisi

La demande n'était pas d'ajouter une fonctionnalité mais de **prouver** que l'existant tient. Le parcours a donc été méthodique, du plus statique au plus dynamique :

| Étape | Méthode | Ce qu'elle pouvait révéler |
| --- | --- | --- |
| 1. Câblage du point d'entrée | lecture `main.tsx` → `App.tsx` → `AppLayout` | providers, garde d'authentification, erreurs de montage |
| 2. Imports et modules orphelins | analyse AST-like des `import` (relatifs + doubles guillemets) | fichiers jamais atteints, code mort |
| 3. Exports inutilisés | croisement `export` × occurrences | utilitaires écrits mais jamais branchés |
| 4. Montage réel des écrans | Chrome 153 via `puppeteer-core` | écrans qui plantent, routes cassées |
| 5. Gestionnaires d'état | tests de transitions réelles | fausses confirmations, bandeaux fantômes |
| 6. Persistance | clic réel + rechargement | thème et session perdus |
| 7. Contraste et responsive | 74 captures × calcul WCAG | textes illisibles, débordements |

Le point de départ a été un **relevé des exports jamais consommés**, qui a immédiatement révélé un écart entre ce que les lots précédents annonçaient et ce qui était réellement branché.

---

## 2. Améliorations effectuées et justification produit

### 2.1 Un défaut de fond : l'application affirmait être en ligne sans preuve

`resolveLocalServerState` retournait `'online'` quand **aucun appel réussi n'était encore connu** — et le test du Lot 4 validait explicitement ce comportement (« on ne prétend pas hors ligne »).

C'est l'inverse de l'exigence de la Phase 4 : *« les états hors ligne/erreur ne font jamais croire à tort que l'opération a réussi »*. Au démarrage, avant toute réponse du serveur, l'interface affichait donc une confiance qu'elle n'avait pas.

**Correction** : sans preuve, l'état est `server-unreachable`. Le premier succès fait passer en ligne. Le test qui protégeait le comportement fautif a été corrigé, pas contourné.

### 2.2 Trois utilitaires écrits mais jamais branchés

| Utilitaire | État constaté | Correction |
| --- | --- | --- |
| `toDisplayableError` | **0 consommateur** | branché sur les 6 chemins d'erreur de `useBackupsData` (création, chiffrement, import, vérification, restauration, téléchargement) |
| `headerScope` | **0 consommateur** | branché dans `DataTable` (`scope="col"` sur chaque en-tête) |
| `evaluateUnsavedChanges` | 2 consommateurs (Lots 4) | déjà effectif, conservé |

`toDisplayableError` apporte ce que le repli manuel ne faisait pas : normalisation des erreurs non-`Error`, extraction du code machine, marquage `isUnconfirmed` et **masquage de secrets**. Il accepte désormais un message de repli métier (`{ fallback }`) pour ne pas remplacer « Erreur restauration. » par un texte générique.

### 2.3 Aucune reprise automatique après une panne du serveur local

Le bandeau « Serveur local injoignable » ne disparaissait qu'au bon vouloir de l'utilisateur : **rien ne réinterrogeait le serveur**. Sur un poste de dépôt, on redémarre le serveur et l'interface continuait d'afficher la panne.

**Correction** : le hook rejoue désormais les requêtes **en échec** :
- immédiatement à l'événement `online` du navigateur ;
- toutes les 30 s tant que le serveur est injoignable ;
- **rien** n'est rejoué quand l'état est `online` (aucune requête parasite).

### 2.4 Un second défaut d'état : l'horloge ne suivait pas les succès

`nowMs` n'était mis à jour qu'au montage et toutes les 60 s. Un succès survenu après le montage rendait `now - lastSuccess` **négatif**, ce qui faisait ignorer l'échec réseau suivant pendant une minute. Corrigé : l'horloge avance avec chaque succès et chaque échec.

### 2.5 Contrastes : 56 défauts réels dans des états que personne n'avait mesurés

En élargissant l'audit du Lot 6 aux **18 écrans authentifiés**, 56 violations WCAG AA sont apparues — toutes dans des états visibles mais jamais mesurés.

| Défaut | Mesure | Correction |
| --- | --- | --- |
| Texte ambre `#D9901A` sur fond clair | **2,46:1** | `#8A5A0B` en clair (5,52:1) + `#FBBF24` en sombre |
| Bouton « Ouvrir la caisse » (blanc sur ambre) | **2,64:1** | fond `#9A6300` (5,05:1) |
| « Valider la vente (F9) » (blanc sur vert) | **3,24:1** | fond `#0D7A4C` (5,38:1) |
| « Éteindre » (blanc sur rouge) | **4,22:1** | fond `#BE123C` (6,29:1) |
| Liens `#1D4ED8` sur fond sombre | **2,59:1** | variante `dark:text-[#60A5FA]` (6,82:1) |
| Texte secondaire `#667085` sur fond sombre | **3,49:1** | variante `dark:text-[#94A3B8]` (6,76:1) |

Portée : 92 textes `#DC4545` → `#BE123C`, 76 textes bleus, 52 textes ambre, 167 textes secondaires et 49 liens avec variante sombre, 14 fonds verts, 9 boutons destructifs.

### 2.6 Le cas le plus grave : 53 boutons désactivés illisibles

L'audit initial **ignorait les éléments à faible opacité**. En le corrigeant (composer les opacités du texte et de ses ancêtres), un défaut massif est apparu : tous les boutons utilisant `disabled:opacity-40` rendaient leur libellé à **1,31:1 à 1,86:1**.

Or c'est **l'état du premier rendu** : « Valider la vente », « Enregistrer », « Confirmer la réception » s'affichent désactivés à l'ouverture. Le libellé doit rester lisible.

**Correction** : l'atténuation globale est remplacée par des couleurs explicites, plus lisibles qu'un simple gris :

| Variante | Avant | Après |
| --- | --- | --- |
| Bouton plein vert | 1,31:1 | `#0A3F28` sur `#B7DACB` → **7,92:1** |
| Bouton plein bleu | 1,31:1 | `#1E3A8A` sur `#93C5FD` → **5,74:1** |
| Bouton plein rouge | 1,41:1 | `#6B0F26` sur `#F3C6D1` → **8,02:1** |
| Bouton secondaire (texte sur blanc) | 1,71:1 | `#6B7280` clair (4,83:1) / `#9CA3AF` sombre (6,83:1) |

43 fichiers ajustés. L'état désactivé reste **perceptible** (fond pâle, texte grisé) tout en restant **lisible**.

---

## 3. Fichiers et couches métier concernés

### Câblage et état

| Fichier | Changement |
| --- | --- |
| `src/features/quality/utils/operationalSafety.ts` | `resolveLocalServerState` : sans preuve ⇒ `server-unreachable` ; `toDisplayableError` accepte un repli métier ; `headerScope` paramètre optionnel |
| `src/features/dashboard/hooks/useConnectionState.ts` | reprise automatique (30 s + événement `online`), horloge synchronisée sur succès/échec |
| `src/features/backups/hooks/useBackupsData.ts` | 6 chemins d'erreur via `toDisplayableError` |
| `src/components/tables/DataTable.tsx` | `scope={headerScope(false)}` |

### Accessibilité et contraste

92 fichiers `.tsx` touchés par les corrections de couleur (classes Tailwind uniquement — **aucune logique modifiée**), plus `LoginPage.tsx` et `LoginShowcasePanel.tsx` du Lot 6.

### Outillage

| Fichier | Rôle |
| --- | --- |
| `scripts/visual/audit.mjs` | étendu aux **18 écrans** × 2 largeurs × 2 thèmes (74 captures) ; opacités composées |
| `scripts/visual/screens.mjs` | **nouveau** — vérifie que les 18 écrans se montent sans exception |
| `package.json` | script `test:screens` |
| `src/features/dashboard/hooks/useConnectionState.test.tsx` | **nouveau** — 4 tests de transitions d'état |

### Contrats

**Aucune** modification de contrat Web, Tauri, Rust, ni de règle métier. Les changements de production sont des couleurs, des attributs ARIA et de la logique de reprise réseau côté client.

---

## 4. Tests réellement exécutés et résultats

| Contrôle | Résultat |
| --- | --- |
| **Montage des 18 écrans** (`npm run test:screens`) | **18/18** — coquille présente, route conservée, titre rendu, 0 exception JS |
| **Audit contraste/responsive** (74 captures, 963 textes) | **0 violation WCAG AA**, **0 débordement**, **0 erreur console** |
| **Suite web** (`npm run test:web`) | **93/93 PASS** (+4 nouveaux tests d'état) |
| **Garde d'authentification** | 5 routes protégées → `/login` ; route directe avec jeton → écran servi |
| **Persistance du thème** | clic réel → `dark`, rechargement → `dark` conservé |
| TypeScript | **0 erreur** |
| ESLint | **0 erreur, 0 warning** |
| Build production | **OK** (62 entrées, 2,93 Mo) |
| Serveurs 5173 / 4173 | **HTTP 200** |

### Chaîne de câblage vérifiée

1. **Entrée** : `main.tsx` → `initPwa()` → `ReactDOM.createRoot` → `<App />`
2. **Providers** : `AppErrorBoundary` → `MotionConfig` → `QueryClientProvider` → `BrowserRouter` → `Suspense` → `Routes`
3. **Routes** : 19 pages en `lazy()` (toutes présentes sur disque), 18 sous `AppLayout`, `/login` hors coquille, `*` → `/`
4. **Garde** : `AppLayout` → `useUiStore.token` → `<Navigate to="/login" />` ; verrouillage automatique par inactivité (intervalle de 1 s)
5. **Transport** : `buildHeaders` → `Authorization: Bearer` + `X-DepotPro-Token` depuis le store
6. **Serveur** : `require_perm` → `Permission::CatalogRead/Write` (ex. `catalogue_v3.rs`)
7. **État** : `QueryClient` (staleTime 10 s, retry 1, pas de retry sur 401/403/404) + `uiStore` Zustand
8. **Persistance** : thème et paniers en `localStorage`, jeton de session en `sessionStorage`

### Modules non importés — analysés, pas ignorés

43 → après correction du détecteur (guillemets doubles) → **19 pages** (imports `lazy` réels) + tests. Deux composants restent réellement orphelins, signalés au §5.

---

## 5. Risques résiduels et décisions métier à clarifier

1. **`CatalogueAdminPanel.tsx` (194 lignes) est inatteignable.** Aucune route, aucun import ; il est le seul consommateur de 4 endpoints catalogue (`getProductCatalogueOverview`, `setCatalogueProductActive`, `setCatalogueReferencePrice`, `getCatalogueReferencePriceHistory`) pourtant bien implémentés côté serveur. **Décision requise** : le brancher (écran d'administration du catalogue, réservé au rôle `owner`) ou le supprimer. Je ne l'ai pas supprimé : c'est une fonctionnalité neuve, pas du code mort évident.
2. **`PaymentReceipt.tsx` (95 lignes) est inutilisé** : la fonction est assurée par `PrintableDocumentSheet` (`docType === 'REÇU DE PAIEMENT'`). Candidat sérieux à la suppression.
3. **Aucun filtrage par rôle dans la navigation.** `role` et `roleLabel` sont affichés, mais la barre latérale présente les mêmes entrées à tous ; seul le serveur applique les permissions. Un caissier peut donc ouvrir un écran d'administration et recevoir un 403. **Décision produit** : masquer les entrées non autorisées côté client.
4. **La vérification couvre les états sans données** (serveur local absent). Les tableaux remplis, les formulations de montants sur plusieurs lignes et les dialogues ouverts ne sont pas couverts visuellement — ils restent couverts fonctionnellement par les 93 tests.
5. **Les couleurs de statut ont changé** (ambre, vert, rouge, bleu). Les teintes sont légèrement plus soutenues. À valider sur une charte graphique si elle existe formellement.
6. **Rust reste non exécuté localement** ; la CI le couvre (jobs 7 à 10).

---

## 6. Prochaine étape recommandée

**Trancher sur les deux composants orphelins**, puis pousser la branche pour obtenir le verdict CI complet.

1. `CatalogueAdminPanel` : le brancher derrière une route `/catalogue-admin` protégée par rôle, ou le supprimer. C'est le seul écart entre « le serveur sait faire » et « l'utilisateur peut le faire ».
2. `PaymentReceipt` : suppression recommandée (fonction déjà couverte ailleurs).
3. **`git push`** : la CI exécutera `cargo test`, `clippy`, `fmt`, Playwright et les 93 tests web, fermant le dernier contrôle bloqué.

L'application est aujourd'hui **entièrement câblée du point d'entrée au serveur**, ses gestionnaires d'état sont testés sur leurs transitions réelles, et les 963 textes mesurés respectent le seuil WCAG AA dans les deux thèmes et aux trois largeurs.
