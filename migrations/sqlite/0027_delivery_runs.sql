-- 0027 : socle des tournées de livraison
--
-- Trois objets créés :
--   1. le rôle 'driver' dans le CHECK de users.role (reconstruction de table)
--   2. les quatre tables de tournée
--   3. deux colonnes de traçabilité sur cash_movements
--
-- POINT DÉLICAT : SQLite ne sait pas modifier une contrainte CHECK. Ajouter
-- 'driver' impose de reconstruire `users`, table référencée par 12 clés
-- étrangères dans le schéma. La procédure officielle SQLite est appliquée
-- intégralement (les 12 étapes), et la migration doit être déclarée dans
-- `needs_fk_off` (migrations.rs) — sinon les FK bloquent la reconstruction.
--
-- Pourquoi le rôle doit entrer MAINTENANT et pas plus tard : le refaire dans six
-- mois, c'est reconstruire `users` sur une base de production remplie de
-- données réelles au lieu d'une installation neuve. Le coût est très différent.

-- ---------------------------------------------------------------------------
-- 1. Ajouter le rôle 'driver'
-- ---------------------------------------------------------------------------
CREATE TABLE users_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'stock_manager', 'accountant', 'driver')),
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (
    id, username, display_name, role, pin_hash, active,
    failed_attempts, locked_until, created_at, updated_at
)
SELECT
    id, username, display_name, role, pin_hash, active,
    failed_attempts, locked_until, created_at, updated_at
FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- L'index de 0005 disparaît avec l'ancienne table : il faut le recréer.
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, active);

-- ---------------------------------------------------------------------------
-- 2. Tournées de livraison
-- ---------------------------------------------------------------------------
-- Une tournée = un chargement qui part et revient. Elle n'est PAS une caisse :
-- l'argent encaissé sur le terrain reste en transit jusqu'à la réconciliation
-- (cf. docs/DECISIONS_TOURNEES_ET_CONSIGNES.md §2).
--
-- Cycle : draft -> loaded -> in_progress -> returned -> reconciled
--         (cancel depuis draft, loaded ou in_progress)
CREATE TABLE IF NOT EXISTS delivery_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    run_date TEXT NOT NULL,
    driver_user_id INTEGER NOT NULL REFERENCES users(id),
    vehicle_label TEXT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'loaded', 'in_progress', 'returned', 'reconciled', 'cancelled')),
    planned_stops INTEGER NOT NULL DEFAULT 0 CHECK (planned_stops >= 0),
    opened_key TEXT NOT NULL UNIQUE,
    closed_key TEXT NULL UNIQUE,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT NULL,
    notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_dr_status_date ON delivery_runs(status, run_date);
CREATE INDEX IF NOT EXISTS idx_dr_driver ON delivery_runs(driver_user_id);

-- Les montants attendus sont FIGÉS au chargement de la tournée. Sans cela, une
-- commande annulée pendant la tournée modifierait l'attendu après coup et
-- l'écart du soir serait faux. Même principe que deposit_issues.unit_value.
CREATE TABLE IF NOT EXISTS delivery_run_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES delivery_runs(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    order_id INTEGER NULL REFERENCES orders(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    expected_amount INTEGER NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
    expected_empty_pieces INTEGER NOT NULL DEFAULT 0 CHECK (expected_empty_pieces >= 0),
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'delivered', 'failed', 'skipped')),
    failure_reason TEXT NULL,
    UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_drs_run ON delivery_run_stops(run_id);
CREATE INDEX IF NOT EXISTS idx_drs_client ON delivery_run_stops(client_id);

-- Déclarations du livreur : AUCUN mouvement de caisse. Une déclaration n'est
-- pas une comptabilisation. L'unicité (arrêt, moyen) rend l'opération
-- idempotente et interdit la double saisie.
CREATE TABLE IF NOT EXISTS delivery_run_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stop_id INTEGER NOT NULL REFERENCES delivery_run_stops(id),
    method_code TEXT NOT NULL REFERENCES payment_methods(code),
    amount INTEGER NOT NULL CHECK (amount > 0),
    declared_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (stop_id, method_code)
);

-- Les vides reviennent PAR TOURNÉE, pas par arrêt : le livreur rapporte
-- l'ensemble du chargement. Rattacher chaque casier à son client d'origine
-- serait une reconstruction fragile.
CREATE TABLE IF NOT EXISTS delivery_run_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES delivery_runs(id),
    returnable_id INTEGER NOT NULL REFERENCES returnable_packaging_types(id),
    good_pieces INTEGER NOT NULL DEFAULT 0 CHECK (good_pieces >= 0),
    damaged_pieces INTEGER NOT NULL DEFAULT 0 CHECK (damaged_pieces >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (run_id, returnable_id)
);

-- ---------------------------------------------------------------------------
-- 3. Traçabilité des encaissements issus d'une tournée
-- ---------------------------------------------------------------------------
-- `cash_movements.kind` est protégé par un CHECK non modifiable : ajouter une
-- valeur imposerait une reconstruction. On distingue donc par des colonnes.
-- À la réconciliation, un encaissement de tournée s'écrit avec un `kind`
-- existant ('sale' ou 'receivable') et se reconnaît à `delivery_run_id`.
ALTER TABLE cash_movements ADD COLUMN delivery_run_id INTEGER NULL REFERENCES delivery_runs(id);
ALTER TABLE cash_movements ADD COLUMN collected_by_user_id INTEGER NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_cm_delivery_run ON cash_movements(delivery_run_id);
