-- ============================================================================
-- Migration 0024 : Refonte complète des documents commerciaux & reçus
-- Identité dépôt/clients/livraison, conditions CMD, écarts REC, références
-- Mobile Money et snapshots immuables pour CMD, REC et REÇU DE PAIEMENT.
-- ============================================================================

-- 1. Enrichissement identité société / sous-dépôt
ALTER TABLE app_settings ADD COLUMN business_activity TEXT NULL DEFAULT 'Distribution & Vente de Boissons (Gros / Demi-Gros / Détail)';
ALTER TABLE app_settings ADD COLUMN whatsapp TEXT NULL;
ALTER TABLE app_settings ADD COLUMN commune TEXT NULL;
ALTER TABLE app_settings ADD COLUMN quartier TEXT NULL;
ALTER TABLE app_settings ADD COLUMN rccm TEXT NULL;
ALTER TABLE app_settings ADD COLUMN ncc TEXT NULL;

-- 2. Enrichissement fiche client (Maquis, Cave, Bar, Événement, repère)
ALTER TABLE clients ADD COLUMN establishment_name TEXT NULL;
ALTER TABLE clients ADD COLUMN category TEXT NULL;
ALTER TABLE clients ADD COLUMN commune TEXT NULL;
ALTER TABLE clients ADD COLUMN quartier TEXT NULL;
ALTER TABLE clients ADD COLUMN landmark TEXT NULL;

-- 3. Enrichissement commandes clients (retrait / livraison / frais / canal prévu)
ALTER TABLE orders ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_mode IN ('pickup', 'delivery'));
ALTER TABLE orders ADD COLUMN courier_name TEXT NULL;
ALTER TABLE orders ADD COLUMN planned_delivery_time TEXT NULL;
ALTER TABLE orders ADD COLUMN delivery_fee_xof INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_xof >= 0);
ALTER TABLE orders ADD COLUMN delivery_landmark TEXT NULL;
ALTER TABLE orders ADD COLUMN planned_payment_channel TEXT NULL;

-- 4. Enrichissement paiements (réf Mobile Money externe + auteur encaissement)
ALTER TABLE payments ADD COLUMN external_reference TEXT NULL;
ALTER TABLE payments ADD COLUMN recorded_by_user_id TEXT NULL;
ALTER TABLE payments ADD COLUMN recorded_by_name TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_external_ref ON payments(external_reference);

-- 5. Enrichissement bons de commande fournisseurs
ALTER TABLE purchase_orders ADD COLUMN payment_terms_label TEXT NULL;
ALTER TABLE purchase_orders ADD COLUMN delivery_address TEXT NULL;
ALTER TABLE purchase_orders ADD COLUMN commercial_conditions TEXT NULL;
ALTER TABLE purchase_orders ADD COLUMN discount_xof INTEGER NOT NULL DEFAULT 0 CHECK (discount_xof >= 0);
ALTER TABLE purchase_orders ADD COLUMN tax_xof INTEGER NOT NULL DEFAULT 0 CHECK (tax_xof >= 0);
ALTER TABLE purchase_orders ADD COLUMN extra_fees_xof INTEGER NOT NULL DEFAULT 0 CHECK (extra_fees_xof >= 0);
ALTER TABLE purchase_orders ADD COLUMN paid_deposit_xof INTEGER NOT NULL DEFAULT 0 CHECK (paid_deposit_xof >= 0);
ALTER TABLE purchase_orders ADD COLUMN created_by_name TEXT NULL;

-- 6. Enrichissement réceptions fournisseurs (statut & écarts quantitatifs)
ALTER TABLE purchase_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'partial', 'discrepancy'));
ALTER TABLE purchase_receipts ADD COLUMN received_by_name TEXT NULL;

ALTER TABLE purchase_receipt_lines ADD COLUMN missing_quantity_milli INTEGER NOT NULL DEFAULT 0 CHECK (missing_quantity_milli >= 0);
ALTER TABLE purchase_receipt_lines ADD COLUMN damaged_quantity_milli INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity_milli >= 0);
ALTER TABLE purchase_receipt_lines ADD COLUMN refused_quantity_milli INTEGER NOT NULL DEFAULT 0 CHECK (refused_quantity_milli >= 0);

-- 7. Motif explicite sur les révisions de reçus client
ALTER TABLE customer_order_receipt_snapshots ADD COLUMN revision_reason TEXT NULL;

-- 8. Snapshots immuables pour Bon de Commande Fournisseur (CMD)
CREATE TABLE IF NOT EXISTS purchase_document_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    document_number TEXT NOT NULL,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    issued_by_user_id TEXT NULL,
    issued_by_name TEXT NOT NULL,
    issued_by_role TEXT NOT NULL,
    revision_reason TEXT NULL,
    UNIQUE (purchase_order_id, version)
);
CREATE INDEX IF NOT EXISTS idx_purchase_doc_snap_po
    ON purchase_document_snapshots(purchase_order_id, version DESC);

-- 9. Snapshots immuables pour Bon de Réception Fournisseur (REC)
CREATE TABLE IF NOT EXISTS purchase_receipt_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL REFERENCES purchase_receipts(id),
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    document_number TEXT NOT NULL UNIQUE,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    issued_by_user_id TEXT NULL,
    issued_by_name TEXT NOT NULL,
    issued_by_role TEXT NOT NULL,
    UNIQUE (receipt_id, version)
);
CREATE INDEX IF NOT EXISTS idx_purchase_rec_snap_rec
    ON purchase_receipt_snapshots(receipt_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_rec_snap_po
    ON purchase_receipt_snapshots(purchase_order_id, version DESC);

-- 10. Snapshots immuables pour Reçu de Paiement (PAY)
CREATE TABLE IF NOT EXISTS payment_receipt_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL REFERENCES payments(id),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    receipt_number TEXT NOT NULL UNIQUE,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    issued_by_user_id TEXT NULL,
    issued_by_name TEXT NOT NULL,
    issued_by_role TEXT NOT NULL,
    UNIQUE (payment_id, version)
);
CREATE INDEX IF NOT EXISTS idx_payment_rec_snap_pay
    ON payment_receipt_snapshots(payment_id, version DESC);

-- 11. Canaux Mobile Money standard Côte d'Ivoire
INSERT OR IGNORE INTO payment_methods (code, label, is_cash, active) VALUES
    ('wave', 'Wave', 0, 1),
    ('orange_money', 'Orange Money', 0, 1),
    ('mtn_money', 'MTN MoMo', 0, 1),
    ('moov_money', 'Moov Money', 0, 1);

-- 12. Enregistrement de version
INSERT OR REPLACE INTO schema_version (version, name, applied_at)
VALUES (24, '0024_documents_refactor_premium', datetime('now'));
