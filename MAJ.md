Voici un **prompt maître d’implémentation** à transmettre à un agent de développement travaillant sur le dépôt GitHub de DEPOTPRO. Il couvre la structure de la base SQLite, les catalogues SOLIBRA et BRASSIVOIRE, les capacités des casiers, les règles de retour des emballages et leur intégration au formulaire de vente, au stock et aux reçus.

# PROMPT MAÎTRE — IMPLÉMENTATION DU CATALOGUE DES BRASSERIES IVOIRIENNES ET DES RÈGLES DE CONDITIONNEMENT DANS DEPOTPRO

## 1. CONTEXTE DU PROJET

Tu interviens sur le projet **DEPOTPRO**, une application de gestion commerciale et de stock destinée aux sous-dépôts de boissons en Côte d’Ivoire.

Le dépôt communiqué le plus récemment est :

`https://github.com/koffidominique/dept_ss_recu.git`

L’architecture cible à respecter est celle du projet existant : **React, TypeScript, Rust, Axum, SQLite et Tauri 2**, si ces technologies sont bien présentes dans le dépôt.

Avant toute modification :

- Examine intégralement l’architecture et les conventions du dépôt.
- Identifie les tables SQLite, modèles Rust, DTO, services, routes Axum, commandes Tauri et composants React existants.
- Identifie les mécanismes actuels de gestion des produits, variantes, conditionnements, stock, ventes, clients, fournisseurs et reçus.
- Réutilise les structures existantes lorsqu'elles sont adaptées.
- Ne crée pas une deuxième architecture parallèle.
- Ne remplace pas une fonctionnalité existante sans analyser ses dépendances.
- Ne crée pas de backend Node.js ou Express supplémentaire : le backend métier doit rester en Rust.

L’objectif est d’intégrer un véritable système de catalogue multi-brasseries, adapté aux réalités commerciales ivoiriennes.

## 2. OBJECTIF PRINCIPAL

Mettre en place dans la base de données un système permettant de gérer :

1. Les brasseries et fabricants.
2. Les marques et sous-marques.
3. Les catégories et types de boissons.
4. Les formats et volumes des produits.
5. Les types de contenants.
6. Les conditionnements commerciaux.
7. Les casiers physiques réutilisables.
8. La capacité réelle de chaque casier.
9. La compatibilité physique des casiers entre produits.
10. Les règles de retour des emballages.
11. Les valeurs financières configurables des casiers.
12. La traçabilité et la vérification des informations du catalogue.

Le système doit permettre à l’OWNER de créer, modifier, désactiver, activer et compléter les catalogues sans intervention d’un développeur.

**Règle fondamentale : les caractéristiques d’un produit ne doivent jamais être déduites uniquement de son nom, de sa marque ou de son volume. Chaque variante possède ses propres caractéristiques et son propre conditionnement.**

## 3. PRINCIPES MÉTIER NON NÉGOCIABLES

### 3.1. Différencier produit, contenant et emballage

Ne pas confondre :

- Le produit : Bock, Beaufort, Castel, Heineken, Ivoire Classic, etc.
- La variante : Bock 33 cl, Bock 50 cl, Heineken 33 cl, etc.
- Le contenant : bouteille en verre, canette, bouteille PET.
- Le conditionnement commercial : bouteille, casier, carton, pack, lot.
- L’emballage réutilisable : casier plastique physique utilisé pour transporter les bouteilles.

Un produit peut être proposé dans plusieurs contenants ou conditionnements. Il faut donc modéliser ces informations séparément.

### 3.2. Règle de suivi des emballages retour

Dans DEPOTPRO, l’objet réutilisable suivi physiquement et financièrement est principalement le **casier plastique**.

Les bouteilles en verre contenues dans ce casier ne doivent pas devenir chacune un objet financier indépendant de consignation.

Le système doit néanmoins connaître la capacité du casier afin d'afficher la composition des emballages vides attendus.

Exemples de présentation :

- Casier de 24 bouteilles : `1 casier(s) + 24 bouteille(s) rendus`.
- Casier de 12 bouteilles : `1 casier(s) + 12 bouteille(s) rendus`.
- Casier de 20 bouteilles : `1 casier(s) + 20 bouteille(s) rendus`.

La quantité de bouteilles est une information descriptive liée au casier. Elle ne doit pas créer automatiquement une dette financière individuelle pour chaque bouteille.

### 3.3. Ne pas appliquer une règle générale de capacité

Il est interdit d’implémenter une règle globale comme :

- 33 cl = 24 bouteilles ;
- 50 cl et plus = 12 bouteilles.

Cette approximation serait incorrecte.

Exemple : Racines 50 cl peut être conditionnée en casier de 20 bouteilles dans le catalogue de référence établi pour le projet.

La capacité doit donc être stockée individuellement dans la configuration de conditionnement de chaque variante.

### 3.4. Emballages non retournables

Les produits en canette, PET, pack ou carton ne doivent pas générer automatiquement une obligation de retour de casier.

Une obligation de retour n’est créée que lorsque le conditionnement est effectivement configuré comme réutilisable et retournable.

### 3.5. Casier mélangé

Le système doit permettre de composer un casier avec plusieurs marques uniquement si leurs emballages physiques sont compatibles.

Exemple :

- Une partie du casier contient de la Beaufort 33 cl.
- Une autre partie contient de la Bock 33 cl.
- Le mélange est autorisé uniquement si les variantes possèdent le même profil physique compatible.

En revanche, un mélange de formats ou contenants incompatibles doit être interdit.

Ne pas déterminer cette compatibilité seulement à partir du volume. Elle doit être définie par un profil physique de casier ou un groupe de compatibilité administrable.

## 4. MODÈLE DE DONNÉES À METTRE EN PLACE

Conçois un modèle relationnel normalisé qui s’intègre au schéma SQLite existant.

Les entités suivantes doivent être couvertes. Les noms exacts pourront être adaptés aux conventions déjà présentes dans le projet.

### A. Table `breweries`

Gestion des brasseries et fabricants.

Champs recommandés :

- `id`
- `name`
- `code`
- `country`
- `description`
- `website`
- `is_active`
- `created_at`
- `updated_at`

Exemples :

- SOLIBRA
- BRASSIVOIRE

### B. Table `brands`

Gestion des marques.

Champs :

- `id`
- `brewery_id`
- `name`
- `code`
- `description`
- `is_active`
- `created_at`
- `updated_at`

Une marque appartient à une brasserie.

### C. Tables de classification

Créer ou adapter les tables suivantes :

- `product_categories`
- `drink_types`
- `container_types`
- `commercial_packaging_types`

Exemples de catégories :

- Bières
- Boissons gazeuses
- Boissons maltées
- Boissons énergisantes
- Vins et boissons alcoolisées
- Eaux et autres boissons

Exemples de contenants :

- Verre
- PET
- Canette aluminium
- Autre contenant configurable

Exemples de conditionnements commerciaux :

- Bouteille individuelle
- Casier
- Carton
- Pack
- Lot
- Canette individuelle

Ces classifications doivent être administrables lorsque cela est pertinent.

### D. Table `packaging_profiles`

Cette table est essentielle. Elle représente le profil physique du casier ou de l’emballage.

Champs recommandés :

- `id`
- `code`
- `name`
- `packaging_material` : plastique, carton, autre
- `is_returnable`
- `is_physically_tracked`
- `tracking_mode`
- `capacity_units`
- `capacity_unit_label`
- `compatible_group_id`
- `default_value_xof`
- `verification_status`
- `is_active`
- `created_at`
- `updated_at`

Pour les casiers réutilisables, `tracking_mode` doit permettre de distinguer un suivi physique et financier du casier d'un simple conditionnement non retournable.

La capacité doit être un nombre entier nullable.

**Ne jamais remplacer une capacité inconnue par 0, 12 ou 24.** Utiliser `NULL` et un statut de vérification approprié.

La valeur financière est configurable en XOF par l’OWNER. Ne pas inventer de montant par défaut.

### E. Table `products`

Champs recommandés :

- `id`
- `brand_id`
- `category_id`
- `drink_type_id`
- `name`
- `description`
- `is_active`
- `created_at`
- `updated_at`

### F. Table `product_variants`

Une variante représente une référence commerciale précise.

Exemples :

- Bock 33 cl
- Bock 50 cl
- Guinness 65 cl
- Heineken 33 cl
- Heineken 50 cl en canette

Champs recommandés :

- `id`
- `product_id`
- `sku`
- `volume_ml`
- `container_type_id`
- `barcode`
- `is_active`
- `created_at`
- `updated_at`

Ne pas mélanger les variantes ayant des volumes ou contenants différents.

### G. Table `variant_packaging_options`

Cette table associe une variante aux conditionnements dans lesquels elle peut être vendue, stockée ou achetée.

Champs recommandés :

- `id`
- `variant_id`
- `commercial_packaging_type_id`
- `packaging_profile_id` nullable
- `units_per_package`
- `is_returnable`
- `is_default`
- `verification_status`
- `created_at`
- `updated_at`

Exemples :

- Beaufort 33 cl vendue en bouteille individuelle ou en casier de 24.
- Heineken 50 cl en canette vendue en carton ou en conditionnement non retournable.
- Bock 50 cl en bouteille vendue en casier de 12.

La capacité doit venir de cette configuration, jamais d'une constante codée en dur.

### H. Traçabilité des données catalogue

Prévoir un mécanisme de provenance, soit par table dédiée, soit par champs adaptés :

- source de l'information ;
- date de consultation ;
- date de vérification ;
- statut de vérification ;
- personne ayant validé la donnée ;
- commentaire ou justification.

Statuts possibles :

- `verified`
- `needs_verification`
- `owner_confirmed`
- `inactive`

Une information non confirmée ne doit pas être présentée comme une donnée officielle vérifiée.

## 5. CATALOGUE INITIAL À PRÉCHARGER

Créer un seed initial structuré, par exemple `catalog_seed.json`, puis son mécanisme d’import dans SQLite.

Les informations ci-dessous constituent la base de départ du catalogue. Conserver une provenance et un statut de vérification pour chaque capacité.

### A. SOLIBRA — Bières et boissons maltées

| Marque             | Variante     | Capacité de référence |
| ------------------ | ------------ | --------------------- |
| Beaufort           | 33 cl verre  | 24                    |
| Beaufort           | 50 cl verre  | 12                    |
| Bock               | 33 cl verre  | 24                    |
| Bock               | 50 cl verre  | 12                    |
| Bock               | 65 cl verre  | 12                    |
| Bock               | 100 cl verre | 12                    |
| Castel             | 33 cl verre  | 24                    |
| Castel             | 50 cl verre  | 12                    |
| Chill Citron       | 50 cl verre  | 12                    |
| Doppel Munich      | 33 cl verre  | 24                    |
| Doppel Munich      | 50 cl verre  | 12                    |
| Doppel Energy Malt | 33 cl verre  | 24                    |
| Guinness           | 33 cl verre  | 24                    |
| Guinness           | 65 cl verre  | 12                    |
| Malta Guinness     | 30 cl verre  | 24                    |
| Racines            | 33 cl verre  | 24                    |
| Racines            | 50 cl verre  | **20**                |
| Racines Fort       | 50 cl verre  | 12                    |
| Sombreros          | 33 cl verre  | 24                    |
| Sombreros          | 50 cl verre  | 12                    |

### B. SOLIBRA — Boissons gazeuses

| Marque   | Variante    | Capacité de référence |
| -------- | ----------- | --------------------- |
| Orangina | 30 cl verre | 24                    |
| Orangina | 50 cl verre | 12                    |
| Youki    | 30 cl verre | 24                    |
| Youki    | 50 cl verre | 12                    |
| Youzou   | 30 cl verre | 24                    |
| Youzou   | 50 cl verre | 12                    |

Les variantes PET et canettes doivent être créées séparément lorsqu'elles sont présentes dans le catalogue, avec leurs conditionnements commerciaux propres et sans obligation de retour automatique.

### C. BRASSIVOIRE — Bières et boissons

Créer les marques et variantes de départ suivantes :

| Marque            | Variante        | Capacité du casier |
| ----------------- | --------------- | ------------------ |
| Ivoire Classic    | 33 cl verre     | À confirmer        |
| Ivoire Classic    | 60 cl verre     | À confirmer        |
| Ivoire Black      | 33 cl verre     | À confirmer        |
| Ivoire Black      | 60 cl verre     | À confirmer        |
| Heineken          | 25 cl bouteille | À confirmer        |
| Heineken          | 33 cl bouteille | À confirmer        |
| Heineken          | 50 cl bouteille | À confirmer        |
| Heineken          | 50 cl canette   | Non retournable    |
| Desperados        | 25 cl bouteille | À confirmer        |
| Desperados        | 33 cl bouteille | À confirmer        |
| Desperados        | 50 cl canette   | Non retournable    |
| Rhino Energy Malt | 33 cl bouteille | À confirmer        |

Pour les capacités inconnues :

- Enregistrer `NULL`.
- Utiliser `needs_verification`.
- Ne pas inventer une capacité de 12 ou 24.
- Permettre à l’OWNER de renseigner et confirmer la capacité après vérification physique ou documentaire.

Pour les produits en canette, utiliser un conditionnement non retournable par défaut, sauf configuration contraire expressément justifiée et validée.

### D. Qualité et fiabilité du seed

Ne pas présenter l'ensemble des données du seed comme étant automatiquement certifiées par les brasseries.

Chaque donnée doit conserver son statut de vérification. L'application doit permettre de corriger les catalogues sans effacer l'historique des opérations commerciales déjà réalisées.

## 6. CALCUL AUTOMATIQUE DES EMBALLAGES RETOUR

Développer un service Rust centralisé de calcul des emballages.

Il ne doit pas y avoir plusieurs formules divergentes dans les composants React, les reçus, le stock ou les commandes.

### Formule de référence

Pour un conditionnement retournable :

`bouteilles_equivalentes = nombre_casiers_manquants × capacité_du_casier`

La capacité est récupérée depuis `variant_packaging_options` ou le profil associé.

Exemples :

| Produit        | Casiers manquants | Capacité | Composition affichée      |
| -------------- | ----------------- | -------- | ------------------------- |
| Beaufort 33 cl | 1                 | 24       | 1 casier + 24 bouteilles  |
| Bock 50 cl     | 1                 | 12       | 1 casier + 12 bouteilles  |
| Racines 50 cl  | 1                 | 20       | 1 casier + 20 bouteilles  |
| Guinness 65 cl | 2                 | 12       | 2 casiers + 24 bouteilles |

Pour un produit non retournable, le résultat est zéro obligation de retour de casier.

Si la capacité est inconnue :

- Ne pas inventer de nombre de bouteilles.
- Afficher une alerte de configuration.
- Permettre la vente selon les règles commerciales existantes.
- Ne pas calculer automatiquement une quantité de casiers à partir de bouteilles individuelles tant que la capacité nécessaire manque.
- Ne pas bloquer arbitrairement toutes les opérations si une information non indispensable est absente.

Utiliser des entiers pour les quantités et des transactions SQLite pour garantir la cohérence des écritures.

## 7. INTÉGRATION AU FORMULAIRE « NOUVELLE VENTE »

Le formulaire de vente doit exploiter directement les caractéristiques du catalogue.

Lorsqu'un utilisateur sélectionne un produit :

- Afficher sa marque.
- Afficher son volume.
- Afficher son type de contenant.
- Afficher son conditionnement commercial.
- Afficher si le casier est retournable.
- Afficher la capacité exacte lorsqu'elle est connue.
- Afficher la valeur du casier lorsqu'elle est configurée.
- Afficher un indicateur de compatibilité pour les casiers mélangés.

L'utilisateur doit pouvoir enregistrer, pour chaque ligne de vente :

- Quantité vendue ;
- Unité de vente ;
- Nombre de casiers remis ;
- Nombre de casiers vides reçus du client ;
- Nombre de casiers restant à rendre ;
- Composition descriptive des casiers attendus.

Le calcul doit être effectué et validé côté Rust. React peut afficher le résultat du calcul, mais ne doit pas être l'unique responsable de la règle métier.

Exemple d'affichage :

**BEAUFORT 33 CL**

`1 casier(s) + 24 bouteille(s) rendus`

**BOCK 50 CL**

`1 casier(s) + 12 bouteille(s) rendus`

**RACINES 50 CL**

`1 casier(s) + 20 bouteille(s) rendus`

L'affichage doit pouvoir être adapté au contexte : casiers déjà reçus, casiers restant à rendre ou emballages attendus.

Il faut éviter toute confusion entre les emballages remis au client et ceux que le client doit restituer.

## 8. GESTION DES CASIERS MÉLANGÉS

Mettre en place une validation de compatibilité.

Une composition mélangée est autorisée uniquement si les variantes concernées :

- utilisent un emballage réutilisable ;
- sont associées à un profil physique compatible ;
- partagent le même groupe de compatibilité ;
- respectent la capacité physique du casier.

Exemples :

- Beaufort 33 cl + Bock 33 cl : autorisé uniquement si le profil physique est compatible.
- Beaufort 33 cl + un produit 50 cl : interdit si les emballages physiques sont incompatibles.
- Heineken en canette + Beaufort en bouteille : interdit comme casier de retour.

Ne jamais supposer que deux produits sont compatibles uniquement parce qu'ils ont le même volume.

En cas d'incompatibilité, afficher une explication claire et empêcher la validation du mélange.

## 9. INTÉGRATION AU STOCK ET À L'INVENTAIRE

Le catalogue doit être relié au stock.

Les mouvements doivent différencier :

- Stock de boissons pleines ;
- Stock de casiers physiques ;
- Casiers pleins ;
- Casiers vides ;
- Casiers chez les clients ;
- Casiers indisponibles, perdus ou détruits, selon les règles existantes.

La capacité en bouteilles sert à décrire le conditionnement et à convertir les quantités commerciales lorsque cela est nécessaire.

Ne pas transformer chaque bouteille vide en actif ou dette financière indépendante.

Une éventuelle perte ou non-restitution de casier doit pouvoir donner lieu à une créance financière sur le client selon les règles métier déjà établies.

Éviter les doublons de mouvements de stock lorsque la vente déclenche plusieurs documents.

## 10. GESTION DES VALEURS FINANCIÈRES

L'OWNER doit pouvoir définir :

- Valeur du casier ;
- Valeur éventuelle par type de casier ;
- Date d'effet d'une nouvelle valeur ;
- Statut actif ou inactif.

La valeur doit être stockée en XOF avec un type numérique adapté aux montants monétaires.

Lorsqu'une valeur de casier change, ne jamais recalculer rétroactivement les anciennes ventes ou les anciennes créances.

Les documents historiques doivent conserver la valeur applicable au moment de l'opération, par exemple grâce à un champ de snapshot dans les mouvements ou documents concernés.

La capacité du casier et sa valeur financière sont deux propriétés différentes.

## 11. INTÉGRATION AUX REÇUS ET BONS DE COMMANDE

Les reçus clients doivent présenter les produits et leurs variantes exactes.

Pour chaque ligne :

- Marque ;
- Désignation ;
- Volume ;
- Contenant ;
- Conditionnement ;
- Quantité vendue ;
- Prix unitaire ;
- Montant ;
- Casier applicable ;
- Capacité ;
- Quantité de casiers reçus ;
- Quantité de casiers restant à rendre, si applicable.

Le document doit distinguer les montants commerciaux, les paiements, les dettes commerciales et les éventuelles créances liées aux casiers.

Les bons de commande fournisseur doivent reprendre les références et conditionnements réellement commandés.

Le système doit conserver la distinction métier déjà définie : le réapprovisionnement fournisseur ne doit pas être transformé en procédure de retour ou de dette client.

Les documents doivent utiliser un snapshot des informations utiles afin qu'une modification ultérieure du catalogue ne modifie pas les reçus historiques.

## 12. API RUST / AXUM ET SERVICES MÉTIER

Adapter les routes existantes et créer les services manquants.

Fonctionnalités à exposer :

- Lister les brasseries ;
- Créer et modifier une brasserie ;
- Gérer les marques ;
- Gérer les classifications ;
- Gérer les produits ;
- Gérer les variantes ;
- Gérer les conditionnements ;
- Configurer les capacités ;
- Configurer les profils de casiers ;
- Gérer les groupes de compatibilité ;
- Vérifier la configuration d'un produit ;
- Calculer les obligations de retour ;
- Importer le catalogue initial ;
- Consulter les informations de provenance et de vérification.

Créer des DTO séparés pour les entrées et sorties API.

Valider côté Rust :

- Volumes positifs ;
- Capacités entières strictement positives lorsqu'elles sont renseignées ;
- Relations entre produits et brasseries ;
- Compatibilité des conditionnements ;
- Cohérence de la règle de retour ;
- Valeurs financières non négatives ;
- Existence des références étrangères ;
- Absence de doublons de références commerciales.

Les opérations critiques doivent être exécutées dans des transactions SQLite.

## 13. INTERFACE D'ADMINISTRATION DU CATALOGUE

Créer ou adapter une interface intitulée :

**Catalogue des produits et brasseries**

L'OWNER doit pouvoir :

- Ajouter une brasserie ;
- Ajouter une marque ;
- Créer un produit ;
- Créer plusieurs variantes ;
- Choisir le volume ;
- Choisir le contenant ;
- Choisir le conditionnement ;
- Définir la capacité exacte du casier ;
- Définir si l'emballage est retournable ;
- Définir son profil physique ;
- Définir son groupe de compatibilité ;
- Définir sa valeur financière ;
- Modifier les informations ;
- Activer ou désactiver un produit ;
- Consulter le statut de vérification.

Prévoir des filtres par :

- Brasserie ;
- Marque ;
- Catégorie ;
- Volume ;
- Type de contenant ;
- Conditionnement ;
- Retournable ou non retournable ;
- Capacité connue ou inconnue ;
- Statut de vérification.

Ajouter des avertissements visuels pour les configurations incomplètes.

Une capacité inconnue ne doit pas être affichée comme une capacité de 0 bouteille.

## 14. MIGRATIONS SQLITE ET COMPATIBILITÉ

Créer des migrations versionnées et réversibles lorsque le mécanisme du projet le permet.

Exigences :

- Ne pas supprimer les tables existantes sans justification.
- Ne pas perdre les données commerciales historiques.
- Prévoir les clés étrangères et les index.
- Prévoir les contraintes d'unicité nécessaires.
- Prévoir les valeurs nullables quand une information n'est pas connue.
- Garantir que les migrations peuvent être exécutées sur une base contenant déjà des clients, produits, ventes et mouvements de stock.
- Vérifier les transactions et les contraintes SQLite.
- Respecter le mécanisme de migration déjà utilisé dans le projet.

Le script de seed doit être idempotent : son exécution plusieurs fois ne doit pas créer de doublons.

## 15. TESTS OBLIGATOIRES

Créer des tests unitaires Rust, des tests d'intégration SQLite et les tests frontend pertinents.

### Tests de capacité

1. Beaufort 33 cl : capacité = 24.
2. Bock 50 cl : capacité = 12.
3. Racines 50 cl : capacité = 20.
4. BRASSIVOIRE avec capacité inconnue : aucune capacité fictive ne doit être générée.
5. Canette Heineken 50 cl : pas de casier retournable par défaut.

### Tests de calcul

- 1 casier de 24 = 24 bouteilles équivalentes.
- 2 casiers de 24 = 48 bouteilles équivalentes.
- 1 casier de 12 = 12 bouteilles équivalentes.
- 3 casiers de 12 = 36 bouteilles équivalentes.
- 1 casier de 20 = 20 bouteilles équivalentes.

### Tests de compatibilité

- Deux produits du même groupe compatible : mélange autorisé.
- Deux produits de groupes différents : mélange interdit.
- Une canette et une bouteille : mélange interdit dans un casier retournable.
- Un produit sans profil de casier : aucune compatibilité supposée.

### Tests de protection des données

- Une modification du catalogue ne modifie pas un reçu historique.
- Un changement de valeur de casier ne modifie pas une ancienne créance.
- Un import de seed répété ne crée aucun doublon.
- Une migration ne supprime aucune donnée existante.
- Une transaction interrompue ne laisse pas de mouvements partiellement enregistrés.

## 16. LIVRABLES TECHNIQUES ATTENDUS

Réaliser les changements dans le dépôt, et non simplement produire une proposition théorique.

Livrer :

1. Le diagnostic de l'architecture et des tables existantes.
2. Le schéma relationnel final.
3. Les migrations SQLite.
4. Le fichier `catalog_seed.json` ou son équivalent conforme au projet.
5. Le mécanisme d'import initial.
6. Les modèles Rust.
7. Les DTO et validations.
8. Les services métier Rust.
9. Les routes Axum ou commandes Tauri nécessaires.
10. Les composants React/TypeScript.
11. Le formulaire d'administration des produits.
12. L'intégration au formulaire de nouvelle vente.
13. L'intégration au stock et aux reçus.
14. Les tests automatisés.
15. La documentation des règles métier.

## 17. CRITÈRES D'ACCEPTATION FINALE

L'implémentation sera considérée comme achevée uniquement si :

- Les brasseries SOLIBRA et BRASSIVOIRE sont présentes dans le catalogue initial.
- Les marques et variantes sont structurées correctement.
- Un produit peut avoir plusieurs formats et conditionnements.
- La capacité est définie individuellement pour chaque variante et conditionnement.
- Racines 50 cl peut conserver une capacité de 20 sans être écrasée par une règle globale de 12.
- Les produits BRASSIVOIRE dont la capacité est inconnue restent configurables sans donnée inventée.
- Les packs, cartons, PET et canettes ne génèrent pas de dette de casier par défaut.
- Les casiers réutilisables sont suivis physiquement et financièrement selon les règles de DEPOTPRO.
- La quantité équivalente de bouteilles est calculée depuis la capacité réellement configurée.
- Les casiers mélangés sont soumis à une validation de compatibilité.
- Le formulaire de vente affiche les bonnes informations.
- Les reçus reprennent les données exactes de la vente.
- Les anciennes opérations restent cohérentes après les migrations et les modifications du catalogue.
- Les tests passent et l'application se compile.

## 18. DIRECTIVE FINALE À L'AGENT DE DÉVELOPPEMENT

Travaille progressivement et directement dans le dépôt.

Ne te contente pas de créer des tables inutilisées ou une interface décorative.

Chaque nouvelle donnée doit être réellement exploitée par les services métier, le formulaire de vente, les calculs d'emballage, le stock et les documents commerciaux.

Respecte les données existantes et les règles métier du sous-dépôt ivoirien.

Ne fabrique jamais une information commerciale manquante : une capacité inconnue doit rester inconnue jusqu'à sa vérification par l'OWNER.

**Priorité absolue : garantir une seule source de vérité pour les produits, leurs variantes, leurs conditionnements, la capacité des casiers et les règles de retour dans toute l'application DEPOTPRO.**

À la fin, fournis un rapport indiquant :

- Les fichiers créés et modifiés ;
- Les migrations appliquées ;
- Les données initiales importées ;
- Les fonctionnalités réellement opérationnelles ;
- Les tests exécutés et leurs résultats ;
- Les éventuelles informations catalogue encore à confirmer ;
- Les points restant à traiter.

**Point essentiel :** ce prompt impose une source unique de vérité pour la capacité des casiers. Ainsi, DEPOTPRO ne confondra plus automatiquement un casier de 12, 20 ou 24 bouteilles selon le seul volume du produit. Les informations non confirmées resteront modifiables par l’OWNER, sans fausser les ventes ni les reçus.
