-- ============================================================================
-- Migration 0029: Add verification status for crate type capacity
-- Allow NULL capacity with verification status tracking
-- ============================================================================

-- 1. Add capacity_verification_status column to crate_types
-- Values: 'to_verify' (default for new records with NULL capacity), 'verified', 'owner_confirmed'
ALTER TABLE crate_types ADD COLUMN capacity_verification_status TEXT NULL 
    CHECK (capacity_verification_status IN ('to_verify', 'verified', 'owner_confirmed'));

-- 2. Make capacity nullable (remove NOT NULL constraint)
-- SQLite doesn't support ALTER COLUMN directly, so we need to recreate the table
-- First, create a new table with the updated schema
CREATE TABLE crate_types_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    producer TEXT NOT NULL CHECK (length(trim(producer)) > 0),
    capacity INTEGER NULL CHECK (capacity IS NULL OR capacity > 0),
    bottle_capacity_ml INTEGER NOT NULL CHECK (bottle_capacity_ml > 0),
    bottle_profile_id INTEGER NOT NULL REFERENCES bottle_profiles(id),
    compatibility_group_id INTEGER NULL, -- FK to crate_compatibility_groups
    dimensions TEXT NULL, -- JSON: {length_mm, width_mm, height_mm}
    weight_g INTEGER NULL CHECK (weight_g IS NULL OR weight_g > 0),
    material TEXT NOT NULL CHECK (material IN ('plastic', 'wood', 'metal', 'other')),
    deposit_value INTEGER NOT NULL DEFAULT 0 CHECK (deposit_value >= 0),
    description TEXT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    capacity_verification_status TEXT NULL 
        CHECK (capacity_verification_status IN ('to_verify', 'verified', 'owner_confirmed'))
);

-- 3. Copy data from old table to new table
INSERT INTO crate_types_new (
    id, code, name, producer, capacity, bottle_capacity_ml, bottle_profile_id,
    compatibility_group_id, dimensions, weight_g, material, deposit_value,
    description, is_active, created_at, capacity_verification_status
)
SELECT 
    id, code, name, producer, capacity, bottle_capacity_ml, bottle_profile_id,
    compatibility_group_id, dimensions, weight_g, material, deposit_value,
    description, is_active, created_at,
    CASE 
        WHEN capacity IS NULL THEN 'to_verify'
        ELSE 'verified'
    END as capacity_verification_status
FROM crate_types;

-- 4. Drop old table and rename new table
DROP TABLE crate_types;
ALTER TABLE crate_types_new RENAME TO crate_types;

-- 5. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_crate_types_code ON crate_types(code);
CREATE INDEX IF NOT EXISTS idx_crate_types_active ON crate_types(is_active);
CREATE INDEX IF NOT EXISTS idx_crate_types_capacity_verification ON crate_types(capacity_verification_status);