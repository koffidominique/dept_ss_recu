-- Migration 0031: Snapshot pattern for historical crate values in sales documents
-- Section 11 of MAJ.md: Integration with receipts and order documents
-- Preserves historical crate capacity, value, and verification status at time of sale

PRAGMA foreign_keys = ON;

-- Add snapshot fields to sales table for crate financial values
ALTER TABLE sales ADD COLUMN crate_debt_snapshot_xof INTEGER NOT NULL DEFAULT 0 CHECK (crate_debt_snapshot_xof >= 0);
ALTER TABLE sales ADD COLUMN crate_received_snapshot_xof INTEGER NOT NULL DEFAULT 0 CHECK (crate_received_snapshot_xof >= 0);
ALTER TABLE sales ADD COLUMN crate_return_composition_snapshot TEXT NULL;

-- Add snapshot fields to sale_lines for per-line crate data
ALTER TABLE sale_lines ADD COLUMN crate_capacity_snapshot INTEGER NULL;
ALTER TABLE sale_lines ADD COLUMN crate_capacity_verification_snapshot TEXT NULL CHECK (crate_capacity_verification_snapshot IN ('verified', 'needs_verification', 'owner_confirmed', 'inactive'));
ALTER TABLE sale_lines ADD COLUMN crate_value_xof_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (crate_value_xof_snapshot >= 0);
ALTER TABLE sale_lines ADD COLUMN crate_compatibility_group_snapshot INTEGER NULL;
ALTER TABLE sale_lines ADD COLUMN bottles_equivalent_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (bottles_equivalent_snapshot >= 0);
ALTER TABLE sale_lines ADD COLUMN is_returnable_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (is_returnable_snapshot IN (0, 1));
ALTER TABLE sale_lines ADD COLUMN crate_received_quantity_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (crate_received_quantity_snapshot >= 0);
ALTER TABLE sale_lines ADD COLUMN crate_missing_quantity_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (crate_missing_quantity_snapshot >= 0);

-- Add snapshot fields to sales_returns for return tracking
ALTER TABLE sales_returns ADD COLUMN crate_value_xof_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (crate_value_xof_snapshot >= 0);
ALTER TABLE sales_returns ADD COLUMN crate_capacity_snapshot INTEGER NULL;

-- Index for historical queries
CREATE INDEX IF NOT EXISTS idx_sales_crate_snapshot ON sales(crate_debt_snapshot_xof, crate_received_snapshot_xof);
CREATE INDEX IF NOT EXISTS idx_sale_lines_crate_snapshot ON sale_lines(crate_capacity_snapshot, crate_value_xof_snapshot);