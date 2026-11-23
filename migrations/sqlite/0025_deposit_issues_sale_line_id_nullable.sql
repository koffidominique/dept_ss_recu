-- ---------------------------------------------------------------------------
-- 0025 : Rendre sale_line_id nullable sur deposit_issues et autoriser le
--          statut 'returned' pour l'enregistrement des retours d'emballages
--          reçus lors d'une vente (received_returnables), tout en préservant
--          intégralement les colonnes et index d'obligations (0015).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deposit_issues_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    sale_line_id INTEGER NULL REFERENCES sale_lines(id),
    client_id INTEGER NULL REFERENCES clients(id),
    returnable_id INTEGER NOT NULL REFERENCES returnable_packaging_types(id),
    pieces INTEGER NOT NULL CHECK (pieces > 0),
    returned_pieces INTEGER NOT NULL DEFAULT 0 CHECK (returned_pieces >= 0 AND returned_pieces <= pieces),
    lost_pieces INTEGER NOT NULL DEFAULT 0 CHECK (lost_pieces >= 0 AND lost_pieces <= pieces),
    destroyed_pieces INTEGER NOT NULL DEFAULT 0 CHECK (destroyed_pieces >= 0 AND destroyed_pieces <= pieces),
    converted_pieces INTEGER NOT NULL DEFAULT 0 CHECK (converted_pieces >= 0 AND converted_pieces <= pieces),
    unit_value INTEGER NOT NULL CHECK (unit_value >= 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    due_date TEXT NULL,
    policy_id INTEGER NULL REFERENCES packaging_policies(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_returned', 'settled', 'converted', 'cancelled', 'returned')),
    converted_at TEXT NULL,
    updated_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO deposit_issues_new (
    id, sale_id, sale_line_id, client_id, returnable_id,
    pieces, returned_pieces, lost_pieces, destroyed_pieces, converted_pieces,
    unit_value, amount, due_date, policy_id, status,
    converted_at, updated_at, created_at
)
SELECT
    id, sale_id, sale_line_id, client_id, returnable_id,
    pieces, returned_pieces, lost_pieces, destroyed_pieces, converted_pieces,
    unit_value, amount, due_date, policy_id, status,
    converted_at, updated_at, created_at
FROM deposit_issues;

DROP TABLE deposit_issues;

ALTER TABLE deposit_issues_new RENAME TO deposit_issues;

CREATE INDEX IF NOT EXISTS idx_deposit_issues_client_due ON deposit_issues(client_id, due_date);
CREATE INDEX IF NOT EXISTS idx_deposit_issues_status ON deposit_issues(status);
