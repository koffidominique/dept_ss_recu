# MASTER PROMPT — REFONTE DEPOTPRO PREMIUM
## Gestion commerciale, reçus clients, commandes fournisseurs, réceptions et documents comptables

---

# 1. RÔLE ET OBJECTIF DE LA MISSION

Tu interviens en qualité de développeur logiciel senior Full-Stack, architecte Rust, React/TypeScript, SQLite et Axum, spécialisé dans les applications ERP, la gestion commerciale, la comptabilité opérationnelle, la gestion des stocks et les systèmes de traçabilité.

Tu dois travailler directement dans le dépôt :

**Repository :** https://github.com/koffidominique/ss_depot_rust.git

**Branche principale :** `main`

**Application :** DEPOTPRO — Gestion intelligente de sous-dépôts de boissons.

L'objectif est de réaliser une refonte approfondie du système de gestion des commandes, des reçus et des bons de commande, avec une véritable intégration dans l'architecture métier existante.

Il ne s'agit pas de créer de simples modèles PDF indépendants.

Il faut construire un véritable système documentaire et opérationnel connecté à la base SQLite, aux commandes, aux fournisseurs, aux clients, aux produits, aux stocks, aux emballages consignés, aux paiements et aux dettes.

La solution doit être adaptée aux réalités commerciales des sous-dépôts de boissons en Côte d'Ivoire.

**RÈGLE FONDAMENTALE : chaque document doit représenter fidèlement une opération réellement enregistrée dans DEPOTPRO. Aucun montant, paiement, retour d'emballage, produit ou mouvement de stock ne doit être inventé ou déduit d'une simple impression.**

---

# 2. AUDIT OBLIGATOIRE AVANT TOUTE MODIFICATION

Avant d'écrire du code, examiner intégralement le dépôt et identifier les fonctionnalités déjà présentes.

Architecture connue :

- Frontend : React 19, TypeScript, Vite, Tailwind CSS.
- Backend : Rust, Axum.
- Base de données : SQLite.
- Accès aux données : SQLx.
- Gestion documentaire : moteur PDF vectoriel Rust et rendu HTML React.
- Application desktop : Tauri.
- Gestion des accès : RBAC et permissions métier.

Examiner particulièrement :

### Documents clients

- `src/components/documents/PrintableDocumentSheet.tsx`
- `src/components/documents/DocumentPrintModal.tsx`
- `src/features/orders/utils/orderPrintDocument.ts`
- `src/features/orders/components/OrderStepConfirm.tsx`
- Les composants et hooks du module `src/features/orders/`.

### Documents fournisseurs

- `src/pages/PurchasesPage.tsx`
- `src/features/purchases/components/PurchasesTable.tsx`
- `src/features/purchases/components/PurchaseOrderModal.tsx`
- `src/features/purchases/components/PurchaseReceiveModal.tsx`
- `src/features/purchases/components/PurchaseDetailModal.tsx`
- Les hooks de `src/features/purchases/`.

### Backend Rust

- `crates/depotpro-core/src/application/orders/`
- `crates/depotpro-core/src/application/purchases/`
- `crates/depotpro-core/src/application/pdf/`
- `crates/depotpro-server/src/handlers/orders.rs`
- Les routeurs Axum associés.
- Les commandes Tauri associées.

### Base de données

Examiner les tables et migrations concernant :

- `orders`
- `order_lines`
- `order_packaging_allocations`
- `order_line_packaging_links`
- `sales`
- `sale_lines`
- `payments`
- `payment_parts`
- `payment_methods`
- `clients`
- `suppliers`
- `products`
- `product_variants`
- `purchase_orders`
- `purchase_order_lines`
- `purchase_receipts`
- `purchase_order_packaging_requirements`
- `supplier_packaging_exchange_lines`
- `app_settings`
- `users`

Vérifier également les migrations existantes, notamment les migrations 0021, 0022 et 0023.

### Précaution concernant les travaux déjà réalisés

La branche principale possède déjà un système d'émission de reçus de commande client, un instantané historique versionné, un moteur PDF A4 dédié et un circuit de réception fournisseur.

Une Pull Request de rapprochement graphique du reçu avec le modèle fourni a également été ouverte :

https://github.com/koffidominique/ss_depot_rust/pull/13

Inspecter son état avant toute intervention.

Ne pas recréer les fonctionnalités déjà disponibles. Réutiliser, corriger et compléter ce qui existe.

Ne supprimer aucune fonctionnalité opérationnelle sans justification technique démontrée.

À la fin de l'audit, établir un tableau indiquant :

| Fonctionnalité | État actuel | Amélioration à réaliser |
|---|---|---|
| Commandes clients | À vérifier | Parcours et traçabilité |
| Reçus clients | À vérifier | Modèle et données complètes |
| Bons fournisseurs | À vérifier | Document commercial complet |
| Réceptions fournisseurs | À vérifier | Traçabilité physique et financière |
| Paiements | À vérifier | Références et ventilation |
| Emballages consignés | À vérifier | Sorties, retours et soldes |
| Historique documentaire | À vérifier | Archivage centralisé |
| PDF et impression | À vérifier | Parité visuelle et fonctionnelle |

L'audit ne doit pas devenir une raison pour retarder l'implémentation : une fois les écarts identifiés, procéder aux corrections.

---

# 3. DISTINCTION OBLIGATOIRE ENTRE LES DOCUMENTS

Le système doit gérer séparément quatre documents commerciaux.

## A. REÇU DE COMMANDE CLIENT

Document délivré au client lorsque sa commande est effectivement validée.

Il confirme :

- les produits commandés ;
- les quantités ;
- les prix convenus ;
- les emballages concernés ;
- les modalités de retrait ou de livraison ;
- le montant à régler ;
- les éventuels acomptes réellement enregistrés ;
- le solde restant à payer.

Il ne doit jamais présenter une commande non payée comme une vente intégralement encaissée.

## B. REÇU DE PAIEMENT CLIENT

Document délivré lorsqu'un encaissement réel est enregistré.

Il doit préciser :

- le numéro de reçu de paiement ;
- le client ;
- la commande ou facture associée ;
- la somme effectivement encaissée ;
- la date et l'heure ;
- le mode de règlement ;
- la référence de transaction Mobile Money lorsqu'elle existe ;
- le montant restant dû après paiement.

Un paiement partiel doit générer une preuve correspondant uniquement au montant effectivement reçu.

## C. BON DE COMMANDE FOURNISSEUR

Document émis par le sous-dépôt à destination de son fournisseur.

Il représente une demande d'approvisionnement.

Il indique les produits, variantes, conditionnements, quantités, prix négociés, montants, besoins d'emballages, conditions de livraison et références de commande.

Il ne doit pas être confondu avec un bon de réception.

La création ou l'impression d'un bon de commande fournisseur ne doit pas augmenter le stock physique.

## D. BON DE RÉCEPTION FOURNISSEUR

Document créé uniquement après constatation physique d'une livraison fournisseur.

Il précise :

- les quantités commandées ;
- les quantités effectivement reçues ;
- les quantités manquantes ;
- les quantités refusées ou endommagées ;
- les écarts constatés ;
- les emballages effectivement remis ;
- le montant des marchandises réceptionnées ;
- la dette fournisseur éventuellement créée.

Une commande fournisseur peut avoir plusieurs bons de réception si les livraisons sont partielles.

Chaque document doit posséder son propre numéro, son propre statut et ses propres règles de modification.

---

# 4. REFONTE COMPLÈTE DU REÇU DE COMMANDE CLIENT

## 4.1. Référence graphique obligatoire

Utiliser le fichier PDF fourni :

`Modele_Recu_Commande_Sous_Depot_Logo_CI.pdf`

Ce document constitue la référence visuelle à reproduire.

Il comporte deux pages A4 portrait.

La première page contient l'intégralité du reçu opérationnel et financier.

La deuxième page contient le message :

« Merci pour votre confiance ! Veuillez vérifier vos quantités et emballages avant de quitter le dépôt. »

Ne pas remplacer ce modèle par un reçu commercial générique.

Reproduire fidèlement son organisation graphique :

- identité du sous-dépôt en haut à gauche ;
- logo ;
- encadré vert « REÇU DE COMMANDE » en haut à droite ;
- ligne de séparation orange ;
- bloc d'informations client ;
- bloc retrait/livraison ;
- grand tableau des boissons ;
- tableau des casiers et bouteilles consignés ;
- tableau financier ;
- zone de règlement ;
- deux zones de signature.

Conserver les couleurs principales de la maquette : orange, vert, bleu foncé et gris clair.

## 4.2. En-tête et identité du sous-dépôt

Afficher :

- logo du sous-dépôt ;
- nom commercial ;
- activité : Distribution & Vente de Boissons (Gros / Demi-Gros / Détail) ;
- commune ;
- quartier ;
- adresse ;
- téléphone ;
- numéro WhatsApp ;
- RCCM ;
- NCC.

Les informations non disponibles doivent être configurables dans les paramètres de l'entreprise.

Prévoir une interface réservée au propriétaire pour modifier ces paramètres.

Ne jamais afficher de fausses données pour compléter un document.

## 4.3. Informations du reçu

Afficher :

- numéro unique du reçu ;
- numéro de la commande associée ;
- date d'émission ;
- heure d'émission ;
- caissier ou utilisateur ayant émis le document ;
- statut de la commande.

Le numéro du reçu doit être distinct de celui de la commande.

Exemple :

- Commande : `CMD-2026-000125`
- Reçu : `REC-2026-000125`

Garantir l'unicité des références.

## 4.4. Informations du client

Afficher :

- nom du client ;
- nom de l'établissement ;
- type de client ;
- numéro de téléphone ;
- quartier ;
- commune ;
- adresse ;
- repère géographique ;
- personne à contacter si disponible.

Prévoir les catégories :

- Maquis ;
- Cave ;
- Bar ;
- Restaurant ;
- Particulier ;
- Événement ;
- Autre.

Ne pas imposer une catégorie artificielle à un client lorsque celle-ci n'est pas renseignée.

## 4.5. Mode de retrait ou de livraison

Deux possibilités :

**Enlèvement sur place :**
- case cochée ;
- lieu : sous-dépôt.

**Livraison à domicile ou sur site :**
- case cochée ;
- adresse de livraison ;
- quartier et repère ;
- livreur ou conducteur de tricycle ;
- date prévue ;
- heure prévue ;
- frais de livraison.

Ajouter un véritable champ `delivery_mode`.

Ne pas déduire automatiquement le mode de retrait à partir de la simple présence d'une adresse.

Le document doit afficher les informations effectivement enregistrées.

## 4.6. Tableau détaillé des produits commandés

Reproduire les colonnes du PDF :

| N° | Désignation de la boisson et format (CL) | Conditionnement (casier / pack) | Qté | Prix unitaire (FCFA) | Montant total (FCFA) |

Chaque ligne doit provenir des lignes réelles de la commande.

Afficher les caractéristiques disponibles :

- brasserie ;
- marque ;
- désignation commerciale ;
- variante ;
- volume : 33 cl, 50 cl, 65 cl, 1 L, 1,5 L, etc. ;
- type de bouteille ;
- conditionnement ;
- capacité du casier ;
- quantité commandée ;
- prix unitaire ;
- total de la ligne.

Gérer les unités :

- bouteille ;
- canette ;
- unité ;
- demi-casier ;
- casier ;
- pack ;
- carton ;
- palette ;
- conditionnement personnalisé.

### Commandes mélangées

Le système doit prendre en charge les casiers mixtes.

Exemple :

Un client commande un demi-casier de Beaufort 33 cl et un demi-casier d'une autre boisson.

Le reçu doit présenter clairement :

- chaque boisson ;
- les quantités correspondantes ;
- leur format ;
- le nombre de casiers ou demi-casiers ;
- la composition physique ;
- les prix correspondants.

Ne jamais regrouper plusieurs produits différents dans une ligne ambiguë.

Les calculs doivent être fondés sur les quantités et prix enregistrés, jamais sur une estimation lors de l'impression.

Prévoir dix lignes visibles sur la première page, comme dans la maquette, puis une pagination automatique pour les commandes plus longues.

Les colonnes doivent rester lisibles à l'impression.

---

# 5. SUIVI DES CASIERS ET BOUTEILLES VIDES

Cette partie est prioritaire.

Le reçu doit disposer d'un tableau spécifique aux emballages consignés.

Reproduire les colonnes :

| Type d'emballage | Sortis | Rendus | Solde dû |

Prévoir les types suivants lorsqu'ils existent dans le catalogue d'emballages :

- Casier 24 trous (33 cl) ;
- Casier 12 trous (65 cl) ;
- Casier 20 trous (50 cl) ;
- Bouteilles vides (unité) ;
- autres emballages configurables.

Chaque ligne doit utiliser les données réelles du suivi des emballages.

### Règles métier

- Sortis = quantité effectivement remise au client.
- Rendus = quantité effectivement restituée.
- Solde dû = sortis - rendus.
- Le solde ne peut jamais être négatif.
- Un emballage prévu mais non remis ne doit pas être présenté comme sorti.
- Une impression ne doit jamais créer un mouvement d'emballage.

La maquette contient la note :

« Tout emballage non restitué à la livraison est facturé au tarif de consigne en vigueur. »

Afficher cette note lorsque le régime de consigne correspondant s'applique.

Prévoir le tarif de consigne unitaire par type d'emballage.

Le système doit pouvoir calculer la valeur des emballages encore dus, en distinguant :

- valeur des emballages sortis ;
- valeur des emballages restitués ;
- valeur des emballages restant dus.

Le retour d'emballages doit être enregistré dans une opération métier dédiée.

Une impression ou une réimpression ne doit jamais modifier ces soldes.

---

# 6. DÉCOMPTE FINANCIER DU REÇU CLIENT

Reproduire le tableau financier du modèle.

Afficher les lignes suivantes :

1. Total liquide (boissons).
2. Consignes emballages.
3. Frais de livraison.
4. Remise accordée.
5. NET À PAYER.
6. Montant versé (avance / cash).
7. RESTE À PAYER.

Tous les montants sont exprimés en FCFA.

### Calculs

Définir une source de vérité financière unique.

Établir précisément :

`Montant net boissons = sous-total des boissons - remises + taxes applicables`

`Net à payer = montant net boissons + consignes dues + frais de livraison`

`Reste à payer = net à payer - paiements effectivement enregistrés`

Adapter ces formules aux champs métiers existants, en évitant les doubles comptabilisations.

Le champ `total_to_collect_xof` ne doit pas être additionné à nouveau avec des montants déjà inclus dans son calcul.

Les remises ne doivent être soustraites qu'une seule fois.

Les consignes doivent être distinguées du chiffre d'affaires des boissons.

Les frais de livraison doivent être comptisés séparément lorsqu'ils sont applicables.

Si une opération est annulée, ses montants ne doivent pas être présentés comme une dette ou une vente active.

### Contrôles obligatoires

- Aucun reste à payer négatif.
- Aucun paiement fictif.
- Aucun montant encaissé supérieur au montant justifié sans traitement explicite d'un éventuel trop-perçu.
- Aucun écart entre le reçu et les montants persistés dans la commande.
- Le total du reçu doit être contrôlable par rapprochement avec la commande et les paiements.

Afficher un indicateur clair :

- NON PAYÉ ;
- PARTIELLEMENT PAYÉ ;
- SOLDÉ ;
- ANNULÉ.

---

# 7. MODES DE RÈGLEMENT ET PAIEMENTS

Reproduire les cases de règlement du modèle :

- Espèces ;
- Wave ;
- Orange Money ;
- MTN MoMo ;
- Moov Money ;
- Autre.

Prendre en charge les paiements mixtes.

Exemple :

- 20 000 FCFA en espèces ;
- 15 000 FCFA par Wave ;
- 10 000 FCFA par Orange Money.

Le document doit afficher les différents moyens et leurs montants.

Prévoir :

- référence externe Mobile Money ;
- référence interne du paiement ;
- date et heure ;
- utilisateur ayant enregistré le paiement ;
- observation ;
- montant encaissé ;
- commande concernée.

La référence interne du paiement ne doit jamais être présentée comme la référence de transaction du prestataire Mobile Money.

Ne pas cocher un mode de paiement uniquement parce qu'il était envisagé lors de la commande : distinguer le mode prévu des modes réellement encaissés.

---

# 8. BON DE COMMANDE FOURNISSEUR — REFONTE COMPLÈTE

Créer un modèle professionnel distinct du reçu client.

Le document est adressé au fournisseur et représente un engagement d'approvisionnement.

## 8.1. En-tête

Afficher :

- logo ;
- identité du sous-dépôt ;
- coordonnées ;
- numéro du bon de commande ;
- date et heure de création ;
- utilisateur émetteur ;
- statut ;
- date de livraison souhaitée.

Titre :

**BON DE COMMANDE FOURNISSEUR**

## 8.2. Informations fournisseur

Afficher :

- raison sociale ;
- nom commercial ;
- code fournisseur ;
- contact principal ;
- téléphone ;
- WhatsApp ;
- e-mail ;
- adresse ;
- commune ;
- personne de contact.

## 8.3. Produits commandés

Prévoir les colonnes :

| N° | Brasserie / Produit | Marque / Variante / Format | Conditionnement | Quantité commandée | Prix unitaire | Total |

Afficher les informations physiques et commerciales des produits :

- brasserie ;
- marque ;
- référence ;
- format ;
- volume ;
- conditionnement fournisseur ;
- coefficient de conversion ;
- quantité commandée ;
- unité de commande ;
- quantité en unités de base ;
- prix unitaire ;
- montant total.

Gérer les commandes multi-produits et multi-brasseries.

## 8.4. Emballages et conditionnements fournisseur

Afficher les emballages nécessaires à la préparation de la commande :

- type de casier ;
- capacité ;
- type de bouteilles ;
- nombre de pièces requis ;
- quantité réservée ;
- quantité déjà remise ;
- solde à remettre.

Le calcul doit provenir de `purchase_order_packaging_requirements` et des mouvements réellement enregistrés.

Un bon de commande ne doit pas être interprété comme une livraison physique.

## 8.5. Décompte financier fournisseur

Afficher :

- montant brut des produits ;
- remise éventuelle ;
- taxes éventuelles ;
- frais supplémentaires éventuels ;
- montant total commandé ;
- acompte réellement payé ;
- paiements enregistrés ;
- solde dû au fournisseur.

Les conditions de paiement doivent être clairement identifiées :

- paiement comptant ;
- avance ;
- paiement partiel ;
- paiement à crédit ;
- échéance convenue.

Ne pas générer artificiellement une dette fournisseur lors de la simple création d'un document.

La dette doit être reconnue conformément au processus de réception et aux règles comptables déjà présentes.

## 8.6. Conditions commerciales

Prévoir :

- date souhaitée de livraison ;
- adresse de livraison ;
- délai convenu ;
- conditions particulières ;
- observations ;
- signature du sous-dépôt ;
- zone d'acceptation fournisseur.

Inscrire clairement :

« Document de commande fournisseur. La réception physique des produits est constatée séparément au moyen d'un bon de réception. »

---

# 9. BON DE RÉCEPTION FOURNISSEUR

Le bon de réception doit être généré après enregistrement d'une livraison physique.

Il doit être lié à un bon de commande fournisseur existant.

Afficher :

- référence du bon de réception ;
- référence du bon de commande initial ;
- fournisseur ;
- date et heure ;
- utilisateur ayant réceptionné ;
- produits attendus ;
- quantités effectivement reçues ;
- quantités manquantes ;
- quantités refusées ;
- produits endommagés ;
- écarts et motifs.

Prévoir les statuts :

- Réception complète ;
- Réception partielle ;
- Réception avec écarts ;
- Réception clôturée.

Les emballages remis au fournisseur doivent faire l'objet d'une section distincte.

Ils doivent être reliés à `supplier_packaging_exchange_lines` lorsqu'ils existent.

Le bon de réception doit présenter les mouvements physiques réels et leurs conséquences financières.

### Règles impératives

- Le stock augmente uniquement pour les produits effectivement reçus et validés.
- Une réception partielle ne doit pas marquer automatiquement toute la commande comme réceptionnée.
- Plusieurs REC peuvent être rattachés au même CMD.
- Les quantités déjà reçues doivent être déduites des quantités restantes.
- Une réception ne doit pas être exécutée deux fois en cas de double clic ou de requête répétée.
- Toute correction doit être historisée.
- Les emballages remis au fournisseur ne doivent pas être comptabilisés comme des ventes ou des consignes client.

---

# 10. ESPACE CENTRALISÉ « REÇUS ET BONS DE COMMANDES »

Créer ou refondre un onglet dédié dans DEPOTPRO :

**REÇUS ET BONS DE COMMANDES**

Cet espace doit devenir le centre de consultation et de suivi de tous les documents commerciaux.

Il doit présenter quatre grandes catégories :

1. Reçus de commandes clients.
2. Reçus de paiement clients.
3. Bons de commande fournisseurs.
4. Bons de réception fournisseurs.

Prévoir des cartes de synthèse :

- Nombre de reçus clients ;
- Montant total des commandes clients ;
- Total des paiements encaissés ;
- Solde client restant à recouvrer ;
- Nombre de commandes fournisseurs ;
- Montant total commandé aux fournisseurs ;
- Total des réceptions fournisseurs ;
- Dette fournisseur restante.

Les indicateurs doivent être calculés à partir des données de la base, en respectant les filtres et les périodes.

## 10.1. Tableau documentaire

Afficher au minimum :

| Référence | Type | Date | Client / Fournisseur | Montant | Paiement / Solde | Statut | Actions |

Actions disponibles :

- Voir ;
- Aperçu ;
- Imprimer ;
- Télécharger PDF ;
- Réimprimer ;
- Voir l'historique ;
- Consulter l'opération source ;
- Corriger selon les permissions ;
- Annuler selon les règles métier.

## 10.2. Recherche avancée

Prévoir les filtres suivants :

- recherche par numéro de document ;
- recherche par numéro de commande ;
- nom du client ;
- nom du fournisseur ;
- téléphone ;
- type de document ;
- statut ;
- période de création ;
- date minimale et maximale ;
- montant minimum ;
- montant maximum ;
- mode de paiement ;
- commandes non payées ;
- commandes partiellement payées ;
- commandes soldées ;
- bons fournisseurs partiellement réceptionnés ;
- bons fournisseurs totalement réceptionnés ;
- commandes annulées ;
- références Mobile Money.

Les filtres doivent pouvoir être combinés.

Prévoir :

- pagination serveur ;
- tri par date ;
- tri par montant ;
- nombre de résultats ;
- export CSV ;
- export PDF des résultats lorsqu'il est pertinent.

Ne pas télécharger intégralement tous les documents pour filtrer uniquement dans le navigateur.

## 10.3. Vue détaillée d'un document

Au clic sur un document, afficher un panneau de détail contenant :

- informations du document ;
- informations de l'opération source ;
- produits ;
- quantités ;
- montants ;
- paiements ;
- emballages ;
- historique ;
- utilisateur ayant créé le document ;
- versions successives ;
- opérations associées.

La vue doit permettre une navigation rapide entre le document et la commande d'origine.

---

# 11. BASE DE DONNÉES SQLITE ET MIGRATIONS

Ne pas repartir de zéro.

Examiner d'abord le schéma existant et les migrations déjà appliquées.

Préserver les données historiques.

Créer des migrations additives et réversibles lorsque la stratégie du projet le permet.

## 11.1. Compléments d'identité entreprise

Ajouter les champs réellement manquants :

- activité commerciale ;
- WhatsApp distinct si nécessaire ;
- commune et quartier ;
- RCCM ;
- NCC.

Les informations doivent rester modifiables par le propriétaire.

## 11.2. Compléments de commandes clients

Ajouter lorsque nécessaire :

- mode de retrait/livraison ;
- livreur ;
- heure de livraison prévue ;
- date et heure prévues ;
- frais de livraison ;
- repère géographique.

## 11.3. Paiements

Ajouter lorsque nécessaire :

- référence externe du prestataire ;
- informations de transaction ;
- observation ;
- identifiant de l'utilisateur ayant encaissé.

Conserver la distinction entre référence interne et référence externe.

## 11.4. Historique documentaire

Conserver le système existant `customer_order_receipt_snapshots`.

Créer des mécanismes équivalents pour les documents fournisseurs lorsque les données existantes ne garantissent pas leur conservation historique.

Examiner la pertinence de :

- snapshots de bons de commande fournisseurs ;
- snapshots de bons de réception ;
- numéro de version ;
- identité de l'émetteur ;
- date d'émission ;
- motif de correction ;
- relation au document précédent.

Chaque PDF historique doit être reproductible à partir de son instantané.

Un changement ultérieur de nom de produit, de fournisseur ou de prix ne doit pas altérer le document déjà émis.

## 11.5. Intégrité

Prévoir :

- clés étrangères ;
- index de recherche ;
- contraintes d'unicité ;
- transactions SQLite ;
- clés d'idempotence ;
- contrôle des quantités positives ;
- contrôles financiers ;
- cohérence des versions documentaires.

Utiliser les transactions pour les opérations qui combinent commandes, paiements, emballages et stocks.

Ne jamais exécuter une opération partiellement si un élément essentiel échoue.

---

# 12. BACKEND RUST / AXUM

Respecter les couches et conventions déjà présentes dans `depotpro-core` et `depotpro-server`.

Éviter d'introduire une nouvelle architecture parallèle.

Prévoir des services métier distincts :

### Commandes clients

- émission du reçu de commande ;
- récupération d'un reçu ;
- récupération de l'historique ;
- création d'une version corrigée ;
- génération du PDF ;
- association aux paiements.

### Paiements clients

- enregistrement ;
- validation ;
- référence externe ;
- historique ;
- reçu de paiement ;
- calcul du solde restant.

### Commandes fournisseurs

- création ;
- modification avant validation ;
- validation ;
- génération du bon de commande ;
- historique documentaire ;
- suivi des quantités restantes.

### Réceptions fournisseurs

- enregistrement d'une réception ;
- validation des quantités ;
- gestion des écarts ;
- mise à jour des stocks ;
- mise à jour des coûts ;
- actualisation de la dette fournisseur ;
- génération du bon de réception.

### Documents

Prévoir des endpoints adaptés aux conventions existantes, par exemple :

`POST /api/orders/:id/receipt`

`GET /api/orders/:id/receipts`

`POST /api/orders/:id/receipts`

`GET /api/purchases/orders/:id/document`

`GET /api/purchases/orders/:id/receipts`

`POST /api/purchases/orders/:id/receipts`

`GET /api/documents`

`GET /api/documents/:id`

`GET /api/documents/:id/pdf`

Ces URL sont des propositions : vérifier les routes actuelles et préserver la compatibilité des endpoints existants.

Pour chaque endpoint, prévoir :

- validation des données ;
- permissions ;
- contrôle des états ;
- réponses cohérentes ;
- erreurs métier explicites ;
- tests d'intégration.

L'émission d'un document ne doit pas être réalisable en contournant les permissions métier.

Les commandes Tauri doivent conserver les mêmes garanties que les endpoints HTTP.

---

# 13. FRONTEND REACT / TYPESCRIPT

Refondre les interfaces des commandes clients et fournisseurs afin de rendre les opérations plus simples et plus fiables.

## 13.1. Parcours commande client

Le parcours doit permettre :

1. Sélection du client.
2. Création ou sélection des produits.
3. Choix des formats et conditionnements.
4. Saisie des quantités.
5. Création de casiers mixtes.
6. Affectation des casiers.
7. Vérification des emballages consignés.
8. Calcul des montants.
9. Application des remises.
10. Choix du retrait ou de la livraison.
11. Enregistrement des paiements éventuels.
12. Vérification du récapitulatif.
13. Validation de la commande.
14. Émission automatique du reçu de commande.
15. Ouverture de l'aperçu du reçu.

Le reçu doit être accessible immédiatement après la validation autorisée.

Une commande en brouillon ou en attente d'approbation ne doit pas émettre un reçu de commande définitif.

Prévoir un bouton dédié pour réimprimer le reçu.

## 13.2. Parcours commande fournisseur

Permettre :

1. Sélection du fournisseur.
2. Choix de la brasserie.
3. Sélection des produits.
4. Sélection des variantes.
5. Choix des conditionnements.
6. Saisie des quantités.
7. Calcul des équivalences en unités de base.
8. Calcul des emballages requis.
9. Vérification des réservations.
10. Saisie des prix.
11. Calcul du montant total.
12. Définition des modalités commerciales.
13. Validation de la commande.
14. Génération du bon de commande fournisseur.
15. Impression ou transmission du document.

## 13.3. Parcours réception fournisseur

Permettre :

1. Sélection du bon de commande.
2. Consultation des quantités attendues.
3. Saisie des quantités reçues.
4. Signalement des produits manquants.
5. Signalement des produits endommagés ou refusés.
6. Saisie du motif des écarts.
7. Enregistrement des emballages remis.
8. Validation de la réception.
9. Mise à jour du stock réel.
10. Mise à jour de la dette fournisseur.
11. Génération du bon de réception.

## 13.4. Design

Adopter un design professionnel, moderne et cohérent avec DEPOTPRO PREMIUM.

Prévoir :

- interface responsive ;
- tableaux lisibles ;
- formulaires intelligents ;
- calculs en temps réel ;
- validation explicite ;
- confirmation avant les opérations irréversibles ;
- retours visuels ;
- états vides pertinents ;
- erreurs compréhensibles ;
- actions rapides ;
- navigation claire.

Ne pas surcharger les formulaires.

Organiser les données en sections logiques et afficher les champs avancés uniquement lorsqu'ils sont nécessaires.

---

# 14. MOTEUR PDF ET IMPRESSION

Le moteur PDF doit devenir la source fiable des documents officiels de l'application.

Prévoir quatre modèles distincts :

- reçu de commande client ;
- reçu de paiement client ;
- bon de commande fournisseur ;
- bon de réception fournisseur.

Chaque modèle doit posséder :

- un rendu A4 propre ;
- une pagination dynamique ;
- un en-tête professionnel ;
- les coordonnées de l'entreprise ;
- les références uniques ;
- les produits détaillés ;
- les tableaux financiers ;
- les signatures ;
- les mentions spécifiques à son type.

Pour le reçu client, respecter le modèle PDF fourni.

Pour les bons fournisseurs, employer une présentation cohérente avec la charte du reçu, sans recopier la mise en page du reçu client de façon inappropriée.

### Contraintes techniques

- Rendu HTML React et rendu PDF Rust cohérents.
- Support des caractères français et des accents.
- Logo conservé dans l'instantané documentaire.
- Montants FCFA correctement formatés.
- Aucune colonne coupée.
- Aucun texte superposé.
- Aucune page blanche inutile.
- Pagination automatique pour les longues commandes.
- Impression A4.
- Téléchargement PDF.
- Aperçu avant impression.
- Envoi WhatsApp avec génération et téléchargement du document.

La génération d'un PDF historique doit utiliser les données sauvegardées côté serveur.

Ne pas accepter des montants envoyés librement par le navigateur comme source de vérité d'un document officiel.

---

# 15. HISTORIQUE, CORRECTIONS ET SÉCURITÉ

Un document émis doit être conservé.

Ne jamais remplacer silencieusement son contenu.

Lorsqu'une correction est nécessaire :

- conserver le document original ;
- demander un motif ;
- créer une nouvelle version ;
- enregistrer l'auteur ;
- enregistrer la date ;
- relier les deux versions ;
- afficher clairement la version actuelle ;
- permettre la réimpression de chaque version.

Réserver les corrections sensibles au rôle propriétaire selon les règles RBAC du projet.

Un utilisateur ne doit pas pouvoir modifier un document en contournant l'interface.

Les documents annulés doivent rester consultables dans l'historique avec leur statut.

La suppression physique d'une opération financière ou d'un document déjà émis ne doit pas être utilisée pour masquer une erreur.

Prévoir un journal d'audit pour les opérations sensibles :

- validation de commandes ;
- émissions de reçus ;
- paiements ;
- corrections ;
- annulations ;
- réceptions ;
- retours d'emballages.

---

# 16. TESTS AUTOMATISÉS ET SCÉNARIOS MÉTIER

Créer ou compléter les tests Rust, TypeScript et Playwright.

Tester au minimum les scénarios suivants.

## A. Reçus clients

1. Création d'une commande simple.
2. Validation et émission du reçu.
3. Contrôle du numéro unique.
4. Double clic sur l'émission.
5. Réimpression sans duplication.
6. Paiement intégral.
7. Paiement partiel.
8. Paiement mixte.
9. Remise commerciale.
10. Livraison avec frais.
11. Emballages consignés.
12. Retour partiel de casiers.
13. Casiers mixtes.
14. Commande longue avec pagination.
15. Commande annulée.
16. Commande non encore approuvée.
17. Correction versionnée.
18. Réimpression d'une ancienne version.

## B. Bons de commande fournisseurs

1. Création d'un CMD multi-produits.
2. Commande multi-brasseries.
3. Plusieurs conditionnements.
4. Calcul des unités de base.
5. Besoin en emballages.
6. Réservation d'emballages.
7. Impression du CMD.
8. Modification autorisée.
9. Annulation.
10. Vérification qu'aucun stock n'est augmenté lors de la création du CMD.

## C. Bons de réception

1. Réception complète.
2. Réception partielle.
3. Réceptions successives.
4. Quantité inférieure à la quantité commandée.
5. Produit endommagé.
6. Produit refusé.
7. Motif d'écart obligatoire.
8. Mise à jour du stock.
9. Mise à jour des coûts.
10. Dette fournisseur cohérente.
11. Emballages remis au fournisseur.
12. Double enregistrement empêché.
13. Annulation ou régularisation selon le cycle métier.

## D. Tests documentaires

Vérifier que :

- les données proviennent bien de SQLite ;
- les montants sont exacts ;
- les paiements réels sont affichés ;
- les références sont uniques ;
- les instantanés sont immuables ;
- les documents sont fidèles aux modèles ;
- les PDF sont correctement paginés ;
- les permissions sont respectées.

---

# 17. LIVRABLES ATTENDUS

Ne pas se limiter à un rapport d'audit ou à une proposition d'architecture.

La mission exige une véritable implémentation.

Produire :

1. Le diagnostic de l'architecture existante.
2. Les migrations SQLite nécessaires.
3. Les DTO Rust.
4. Les services métier.
5. Les endpoints Axum.
6. Les commandes Tauri correspondantes.
7. Les hooks React.
8. Les interfaces TypeScript.
9. Les composants de commande client.
10. Les composants de commande fournisseur.
11. Le système de réception fournisseur.
12. Les quatre modèles documentaires.
13. Le système d'archivage centralisé.
14. Les filtres et recherches avancés.
15. Les tests automatisés.
16. Une documentation technique de la solution.
17. Un rapport de validation.

Tous les changements doivent être réellement enregistrés dans le dépôt.

Créer une branche de travail dédiée.

Ne pas effectuer de modifications destructives directement sur `main`.

Créer une Pull Request documentant les changements, les migrations, les tests et les éventuelles limitations.

---

# 18. ORDRE DE PRIORITÉ DE L'IMPLÉMENTATION

Travailler dans cet ordre :

### PRIORITÉ 1 — Reçu de commande client

- Refonte fidèle au PDF fourni.
- Connexion aux données réelles.
- Montants et paiements fiables.
- Suivi physique des casiers.
- Émission automatique après validation autorisée.
- Impression et téléchargement PDF.
- Historique des versions.

### PRIORITÉ 2 — Bon de commande fournisseur

- Refonte du document.
- Détail des produits et conditionnements.
- Suivi des emballages réservés.
- Calcul du montant commandé.
- Impression et historique.

### PRIORITÉ 3 — Bon de réception fournisseur

- Réception complète ou partielle.
- Gestion des écarts.
- Emballages réellement remis.
- Mise à jour du stock et des dettes.
- PDF de réception.

### PRIORITÉ 4 — Reçu de paiement client

- Ventilation des moyens de paiement.
- Références de transaction.
- Paiements partiels et mixtes.
- Reçu individuel d'encaissement.

### PRIORITÉ 5 — Centre documentaire

- Onglet « Reçus et Bons de commandes ».
- Recherche avancée.
- Filtres comptables.
- Historique.
- Export et réimpression.

Ne pas inverser cet ordre au détriment du reçu client.

---

# 19. CRITÈRES D'ACCEPTATION FINAUX

La mission ne pourra être déclarée terminée que lorsque les conditions suivantes seront satisfaites :

- Le nouveau reçu remplace effectivement l'ancien dans le parcours réel de commande.
- Le client reçoit un reçu détaillé après validation de sa commande.
- Le document reprend la structure du modèle PDF fourni.
- Les produits et conditionnements sont correctement identifiés.
- Les casiers sortis, rendus et dus sont justes.
- Les montants sont cohérents avec les données enregistrées.
- Les modes de paiement affichés correspondent aux opérations réelles.
- Le bon de commande fournisseur est distinct du reçu client.
- Le bon de réception est distinct du bon de commande fournisseur.
- Une réception partielle fonctionne correctement.
- Aucune génération documentaire ne provoque de mouvement de stock ou de paiement.
- Les anciennes versions restent consultables.
- Tous les PDF peuvent être téléchargés et imprimés.
- La recherche documentaire fonctionne.
- Les permissions sont contrôlées côté backend.
- Les migrations sont applicables sur une base existante sans perte de données.
- Les tests et builds disponibles passent.

### Commandes de validation à exécuter

Utiliser les commandes adaptées au dépôt, notamment :

`npm run typecheck`

`npm run lint`

`npm run build`

`cargo test --workspace`

`npm run test:e2e`

`git diff --check`

Si une commande ne peut pas être exécutée, indiquer précisément la raison et ne jamais prétendre qu'elle a réussi.

---

# 20. RAPPORT FINAL OBLIGATOIRE

À la fin, fournir un rapport comprenant :

**A. État initial**
- Fonctionnalités existantes.
- Défauts constatés.
- Éléments réutilisés.

**B. Modifications effectuées**
- Fichiers modifiés.
- Nouveaux fichiers.
- Migrations.
- Endpoints.
- Composants.
- Modèles PDF.

**C. Résultat fonctionnel**
- Reçu client.
- Reçu de paiement.
- Bon de commande fournisseur.
- Bon de réception.
- Historique documentaire.
- Recherche avancée.

**D. Validation**
- Résultat du typecheck.
- Résultat du lint.
- Résultat du build.
- Résultat des tests Rust.
- Résultat des tests E2E.

**E. GitHub**
- Nom de la branche.
- Numéro de commit.
- Lien de la Pull Request.
- Liste des changements.
- État de fusion.

**F. Limites éventuelles**
- Fonctionnalités non terminées.
- Champs métier qui nécessitent une configuration.
- Tests non exécutés.
- Risques connus.

---

# DIRECTIVE FINALE

Construis un système documentaire commercial et comptable fiable, cohérent et professionnel pour DEPOTPRO.

La priorité n'est pas uniquement de produire de beaux PDF.

La priorité est de garantir que chaque reçu, chaque bon de commande et chaque bon de réception représente exactement ce qui s'est passé dans le sous-dépôt.

Un client doit pouvoir comprendre ce qu'il a commandé, ce qu'il doit payer, ce qu'il a déjà payé et quels emballages il doit restituer.

Le propriétaire du sous-dépôt doit pouvoir retrouver chaque opération, suivre ses recettes, ses créances, ses achats, ses dettes fournisseurs et ses emballages.

Le caissier doit pouvoir remettre un document fiable sans effectuer de calcul manuel.

Le gestionnaire doit pouvoir rapprocher les commandes, les paiements, les réceptions, les stocks et les documents.

**Implémente réellement les fonctionnalités, teste-les et documente les résultats. Ne te contente pas de fournir des recommandations, des maquettes ou du pseudo-code.**
