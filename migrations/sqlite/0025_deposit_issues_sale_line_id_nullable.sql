-- ---------------------------------------------------------------------------
-- 0025 : Rendre sale_line_id nullable sur deposit_issues
--          Pour permettre l'enregistrement des retours d'emballages reçus
--          (received_returnables) qui ne sont pas liés à une ligne de vente.
--          SQLite ne supporte pas ALTER COLUMN DROP NOT NULL nativement :
--          recréation de la table requise.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deposit_issues_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    sale_line_id INTEGER NULL REFERENCES sale_lines(id),
    client_id INTEGER NULL REFERENCES clients(id),
    returnable_id INTEGER NOT NULL REFERENCES returnable_packaging_types(id),
    pieces INTEGER NOT NULL CHECK (pieces > 0),
    returned_pieces INTEGER NOT NULL DEFAULT 0 CHECK (returned_pieces >= 0 AND returned_pieces <= pieces),
    unit_value INTEGER NOT NULL CHECK (unit_value >= 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    due_date TEXT NULL,
    policy_id INTEGER NULL REFERENCES packaging_policies(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO deposit_issues_new (id, sale_id, sale_line_id, client_id, returnable_id, pieces, returned_pieces, unit_value, amount, due_date, policy_id, status, created_at)
SELECT id, sale_id, sale_line_id, client_id, returnable_id, pieces, returned_pieces, unit_value, amount, due_date, policy_id, status, created_at
FROM deposit_issues;

DROP TABLE deposit_issues;

ALTER TABLE deposit_issues_new RENAME TO deposit_issues;
