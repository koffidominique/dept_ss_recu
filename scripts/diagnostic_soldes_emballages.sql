-- ============================================================================
-- Diagnostic des soldes d'emballages
--
-- Objectif : mesurer l'écart entre les trois sources de vérité avant toute
-- refonte. Aucun ordre ne modifie de données (lecture seule).
--
-- Usage : sqlite3 depotpro.db < scripts/diagnostic_soldes_emballages.sql
--
-- Résultat attendu sur une base saine : tous les écarts à 0.
-- Un écart durable indique un chemin d'écriture défaillant.
-- ============================================================================

.headers on
.mode column

-- ----------------------------------------------------------------------------
-- 1. Solde de référence : agrége de deposit_issues (calculé, jamais maintenu)
--    C'est la seule source qui ne peut pas dériver.
-- ----------------------------------------------------------------------------
SELECT
    'Q1. Solde de reference (deposit_issues)' AS section;

SELECT
    di.client_id,
    c.name                                   AS client,
    rpt.code                                 AS consignable,
    SUM(di.pieces - di.returned_pieces - di.converted_pieces - di.lost_pieces) AS pieces_dues,
    COUNT(*)                                 AS nb_consignes_ouvertes
FROM deposit_issues di
JOIN clients c                        ON c.id = di.client_id
JOIN returnable_packaging_types rpt   ON rpt.id = di.returnable_id
WHERE di.status IN ('pending', 'partially_returned')
GROUP BY di.client_id, di.returnable_id
HAVING SUM(di.pieces - di.returned_pieces - di.converted_pieces - di.lost_pieces) <> 0
ORDER BY pieces_dues DESC;

-- ----------------------------------------------------------------------------
-- 2. Écart avec customer_packaging_accounts (agrégat maintenu, par consignable)
--    Même granularité que Q1 : la comparaison est directe.
-- ----------------------------------------------------------------------------
SELECT
    'Q2. Ecart != customer_packaging_accounts' AS section;

WITH reference AS (
    SELECT di.client_id, di.returnable_id,
           SUM(di.pieces - di.returned_pieces - di.converted_pieces - di.lost_pieces) AS pieces
    FROM deposit_issues di
    WHERE di.status IN ('pending', 'partially_returned')
    GROUP BY di.client_id, di.returnable_id
)
SELECT
    c.name                        AS client,
    rpt.code                      AS consignable,
    COALESCE(r.pieces, 0)         AS ref_pieces,
    COALESCE(cpa.balance_pieces, 0) AS cache_pieces,
    COALESCE(r.pieces, 0) - COALESCE(cpa.balance_pieces, 0) AS ecart
FROM reference r
JOIN clients c                      ON c.id = r.client_id
JOIN returnable_packaging_types rpt ON rpt.id = r.returnable_id
LEFT JOIN customer_packaging_accounts cpa
       ON cpa.client_id = r.client_id AND cpa.returnable_id = r.returnable_id
WHERE COALESCE(r.pieces, 0) - COALESCE(cpa.balance_pieces, 0) <> 0
ORDER BY ABS(COALESCE(r.pieces, 0) - COALESCE(cpa.balance_pieces, 0)) DESC;

-- ----------------------------------------------------------------------------
-- 3. Consignes sans échéance : elles ne seront jamais converties ni signalées
--    en retard, et n'entrent dans aucune pression de retour.
-- ----------------------------------------------------------------------------
SELECT
    'Q3. Consignes ouvertes sans echeance' AS section;

SELECT COUNT(*) AS nb_sans_echeance
FROM deposit_issues
WHERE status IN ('pending', 'partially_returned')
  AND due_date IS NULL;

-- ----------------------------------------------------------------------------
-- 4. Consignes dont pieces_returned + sorties depasse le total
--    Impossible si la logique est saine ; signale une corruption.
-- ----------------------------------------------------------------------------
SELECT
    'Q4. Coherence interne des consignes' AS section;

SELECT id, client_id, returnable_id, pieces, returned_pieces,
       converted_pieces, lost_pieces, destroyed_pieces
FROM deposit_issues
WHERE returned_pieces + converted_pieces + lost_pieces + destroyed_pieces > pieces;

-- ----------------------------------------------------------------------------
-- 5. Comptes clients sans aucune consigne rattachable
--    Signale un chemin qui a ecrit le cache sans ecrire la reference.
-- ----------------------------------------------------------------------------
SELECT
    'Q5. Cache sans reference (vente directe ?)' AS section;

SELECT
    c.name                        AS client,
    rpt.code                      AS consignable,
    cpa.balance_pieces            AS cache_pieces,
    0                             AS ref_pieces
FROM customer_packaging_accounts cpa
JOIN clients c                      ON c.id = cpa.client_id
JOIN returnable_packaging_types rpt ON rpt.id = cpa.returnable_id
WHERE cpa.balance_pieces <> 0
  AND NOT EXISTS (
    SELECT 1 FROM deposit_issues di
    WHERE di.client_id = cpa.client_id
      AND di.returnable_id = cpa.returnable_id
      AND di.status IN ('pending', 'partially_returned')
  );
