-- Migration 0032: Differentiate crate vs bottle tracking in stock movements
-- Section 9 of MAJ.md: Intégration stock/mouvements — différencier suivi casiers vs bouteilles

PRAGMA foreign_keys = ON;

-- Add tracking_unit column to stock_movements to differentiate crate vs bottle tracking
-- Values: 'crate', 'bottle', 'unit' (for non-returnable items)
ALTER TABLE stock_movements ADD COLUMN tracking_unit TEXT NULL CHECK (tracking_unit IN ('crate', 'bottle', 'unit'));

-- Add returnable_packaging_id to link to the specific returnable packaging type (crate or bottle)
ALTER TABLE stock_movements ADD COLUMN returnable_packaging_id INTEGER NULL REFERENCES returnable_packaging_types(id);

-- Add tracking_unit column to returnable_stock_movements for explicit crate vs bottle differentiation
ALTER TABLE returnable_stock_movements ADD COLUMN tracking_unit TEXT NOT NULL DEFAULT 'crate' CHECK (tracking_unit IN ('crate', 'bottle'));

-- Index for filtering by tracking unit
CREATE INDEX IF NOT EXISTS idx_stock_movements_tracking_unit ON stock_movements(tracking_unit);
CREATE INDEX IF NOT EXISTS idx_stock_movements_returnable_packaging ON stock_movements(returnable_packaging_id);
CREATE INDEX IF NOT EXISTS idx_returnable_stock_movements_tracking_unit ON returnable_stock_movements(tracking_unit);