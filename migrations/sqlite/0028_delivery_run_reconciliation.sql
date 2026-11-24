-- 0028 : réconciliation des tournées (Lot 14)
--
-- Trois ajouts, tous en ALTER TABLE ADD COLUMN (pas de reconstruction) :
--   1. la répartition des vides ramenés par tournée, PAR CLIENT
--   2. la perte constatée au comptage, par tournée
--   3. le motif obligatoire, par tournée
--
-- POINT DÉLICAT : `deposit_issues` est par CLIENT, mais le livreur rapporte ses
-- vides par TOURNÉE. Répartir en FIFO entre tous les clients de la tournée
-- solderait la dette d'un client avec les casiers repris chez un autre. La
-- répartition est donc déclarée par le gérant au retour : il sait chez qui le
-- livreur a repris, c'est une observation, pas une reconstruction.
--
-- Aucune table n'est reconstruite : ces colonnes sont toutes nullables ou
-- pourvues d'un défaut, et SQLite les ajoute en place.

-- ---------------------------------------------------------------------------
-- 1. Répartition des vides par client
-- ---------------------------------------------------------------------------
-- `delivery_run_returns` dit COMBIEN de vides sont revenus, par consignable.
-- Cette table dit CHEZ QUI ils ont été repris. Les deux ensemble permettent de
-- solder les bonnes consignes.
--
-- good + damaged ne peut pas dépasser ce qui a été rapporté pour ce
-- consignable : sinon le stock de vides augmenterait de lui-même. La contrainte
-- est posée dans le code (le total rapporté est connu à ce moment-là), SQLite
-- ne sachant pas exprimer un agrégat dans un CHECK.
CREATE TABLE IF NOT EXISTS delivery_run_return_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES delivery_runs(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    returnable_id INTEGER NOT NULL REFERENCES returnable_packaging_types(id),
    good_pieces INTEGER NOT NULL DEFAULT 0 CHECK (good_pieces >= 0),
    damaged_pieces INTEGER NOT NULL DEFAULT 0 CHECK (damaged_pieces >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (run_id, client_id, returnable_id)
);

CREATE INDEX IF NOT EXISTS idx_drra_run ON delivery_run_return_allocations(run_id);
CREATE INDEX IF NOT EXISTS idx_drra_client ON delivery_run_return_allocations(client_id);

-- ---------------------------------------------------------------------------
-- 2. Le comptage et son écart
-- ---------------------------------------------------------------------------
-- `counted_amount` est ce que le gérant trouve physiquement dans le sac du
-- livreur. Il peut différer du déclaré : c'est là que se cachent les manquants.
--
-- Les deux colonnes sont nullables : une tournée revenue mais pas encore
-- réconciliée n'a pas de comptage. La réconciliation les renseigne une fois
-- pour toutes, et `reconciled` étant terminal, elles ne bougent plus.
ALTER TABLE delivery_runs ADD COLUMN counted_amount INTEGER NULL;
ALTER TABLE delivery_runs ADD COLUMN discrepancy_reason TEXT NULL;

-- ---------------------------------------------------------------------------
-- 3. Trace des vides attendus non rendus
-- ---------------------------------------------------------------------------
-- Une tournée peut revenir avec moins de casiers que la somme des attendus.
-- Ce manque n'est PAS une perte : le client détient peut-être encore ses
-- casiers. On se contente de ne pas solder les consignes non couvertes, ce qui
-- laisse la dette ouverte et visible. Aucune écriture de perte n'est faite ici,
-- contrairement à l'argent où le manquant est constaté le jour même.
