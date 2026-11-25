-- ============================================================================
-- Migration 0030: Catalogue multi-brasseries - Variantes, conditionnements et profils physiques
-- Tables manquantes et enrichissements pour le catalogue SOLIBRA/BRASSIVOIRE
-- ============================================================================

-- 1. Table packaging_profiles (profils physiques des casiers/emballages)
-- Représente le profil physique d'un casier réutilisable avec traçabilité et vérification
CREATE TABLE IF NOT EXISTS packaging_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NULL,
    packaging_material TEXT NOT NULL DEFAULT 'plastic' CHECK (packaging_material IN ('plastic', 'wood', 'metal', 'cardboard', 'other')),
    is_returnable INTEGER NOT NULL DEFAULT 1 CHECK (is_returnable IN (0, 1)),
    is_physically_tracked INTEGER NOT NULL DEFAULT 1 CHECK (is_physically_tracked IN (0, 1)),
    tracking_mode TEXT NOT NULL DEFAULT 'crate_physical' CHECK (tracking_mode IN ('crate_physical', 'bottle_individual', 'none')),
    capacity_units INTEGER NULL CHECK (capacity_units IS NULL OR capacity_units > 0),
    capacity_unit_label TEXT NOT NULL DEFAULT 'bouteille',
    compatible_group_id INTEGER NULL, -- FK vers crate_compatibility_groups
    default_value_xof INTEGER NOT NULL DEFAULT 0 CHECK (default_value_xof >= 0),
    verification_status TEXT NOT NULL DEFAULT 'needs_verification' CHECK (verification_status IN ('verified', 'needs_verification', 'owner_confirmed', 'inactive')),
    verification_source TEXT NULL, -- provenance de l'info: 'catalog_officiel', 'mesure_physique', 'doc_fournisseur', 'owner_declaration'
    verification_date TEXT NULL,
    verified_by INTEGER NULL, -- user_id qui a validé
    verification_comment TEXT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_packaging_profiles_code ON packaging_profiles(code);
CREATE INDEX IF NOT EXISTS idx_packaging_profiles_active ON packaging_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_packaging_profiles_verification ON packaging_profiles(verification_status);
CREATE INDEX IF NOT EXISTS idx_packaging_profiles_compat_group ON packaging_profiles(compatible_group_id);

-- 2. Table variant_packaging_options (conditionnements par variante)
-- Associe une variante aux conditionnements commerciaux dans lesquels elle est vendue/achetée/stockée
CREATE TABLE IF NOT EXISTS variant_packaging_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    commercial_packaging_type_id INTEGER NOT NULL REFERENCES packaging_types(id),
    packaging_profile_id INTEGER NULL REFERENCES packaging_profiles(id),
    units_per_package INTEGER NOT NULL CHECK (units_per_package > 0),
    is_returnable INTEGER NOT NULL DEFAULT 0 CHECK (is_returnable IN (0, 1)),
    is_default_sale INTEGER NOT NULL DEFAULT 0 CHECK (is_default_sale IN (0, 1)),
    is_default_purchase INTEGER NOT NULL DEFAULT 0 CHECK (is_default_purchase IN (0, 1)),
    verification_status TEXT NOT NULL DEFAULT 'needs_verification' CHECK (verification_status IN ('verified', 'needs_verification', 'owner_confirmed', 'inactive')),
    verification_source TEXT NULL,
    verification_date TEXT NULL,
    verified_by INTEGER NULL,
    verification_comment TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (variant_id, commercial_packaging_type_id)
);

CREATE INDEX IF NOT EXISTS idx_vpo_variant ON variant_packaging_options(variant_id);
CREATE INDEX IF NOT EXISTS idx_vpo_packaging_type ON variant_packaging_options(commercial_packaging_type_id);
CREATE INDEX IF NOT EXISTS idx_vpo_profile ON variant_packaging_options(packaging_profile_id);
CREATE INDEX IF NOT EXISTS idx_vpo_verification ON variant_packaging_options(verification_status);

-- 3. Enrichir product_packagings avec vérification capacité
ALTER TABLE product_packagings ADD COLUMN capacity_verification_status TEXT NULL CHECK (capacity_verification_status IN ('verified', 'needs_verification', 'owner_confirmed', 'inactive'));
ALTER TABLE product_packagings ADD COLUMN capacity_verification_source TEXT NULL;
ALTER TABLE product_packagings ADD COLUMN capacity_verification_date TEXT NULL;
ALTER TABLE product_packagings ADD COLUMN capacity_verified_by INTEGER NULL;
ALTER TABLE product_packagings ADD COLUMN capacity_verification_comment TEXT NULL;

-- 4. Enrichir sales_units avec vérification
ALTER TABLE sales_units ADD COLUMN capacity_verification_status TEXT NULL CHECK (capacity_verification_status IN ('verified', 'needs_verification', 'owner_confirmed', 'inactive'));
ALTER TABLE sales_units ADD COLUMN capacity_verification_source TEXT NULL;
ALTER TABLE sales_units ADD COLUMN capacity_verification_date TEXT NULL;
ALTER TABLE sales_units ADD COLUMN capacity_verified_by INTEGER NULL;
ALTER TABLE sales_units ADD COLUMN capacity_verification_comment TEXT NULL;

-- 5. Table de traçabilité des données catalogue (provenance, vérifications)
CREATE TABLE IF NOT EXISTS catalogue_verification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('brewery', 'brand', 'category', 'container_type', 'packaging_type', 'product', 'variant', 'packaging_profile', 'variant_packaging', 'product_packaging', 'sales_unit', 'crate_type')),
    entity_id INTEGER NOT NULL,
    field_name TEXT NULL, -- champ spécifique vérifié (ex: 'capacity', 'volume_ml', 'compatible_group_id')
    old_value TEXT NULL,
    new_value TEXT NULL,
    verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'needs_verification', 'owner_confirmed', 'inactive')),
    verification_source TEXT NULL,
    verified_by INTEGER NOT NULL,
    verified_at TEXT NOT NULL DEFAULT (datetime('now')),
    comment TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalogue_verif_entity ON catalogue_verification_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_catalogue_verif_status ON catalogue_verification_log(verification_status);
CREATE INDEX IF NOT EXISTS idx_catalogue_verif_date ON catalogue_verification_log(verified_at);

-- 6. Insérer les profils de casiers physiques par défaut (basés sur SOLIBRA/BRASSIVOIRE)
INSERT OR IGNORE INTO packaging_profiles (code, name, description, packaging_material, is_returnable, is_physically_tracked, tracking_mode, capacity_units, capacity_unit_label, compatible_group_id, default_value_xof, verification_status, verification_source)
VALUES
    -- SOLIBRA
    ('PP-SOL-CR-24-33', 'Casier SOLIBRA 24x33cl', 'Casier plastique standard SOLIBRA pour bouteilles 33cl', 'plastic', 1, 1, 'crate_physical', 24, 'bouteille', NULL, 1500, 'needs_verification', 'catalog_officiel'),
    ('PP-SOL-CR-12-50', 'Casier SOLIBRA 12x50cl', 'Casier plastique standard SOLIBRA pour bouteilles 50cl', 'plastic', 1, 1, 'crate_physical', 12, 'bouteille', NULL, 1800, 'needs_verification', 'catalog_officiel'),
    ('PP-SOL-CR-12-65', 'Casier SOLIBRA 12x65cl', 'Casier plastique standard SOLIBRA pour bouteilles 65cl', 'plastic', 1, 1, 'crate_physical', 12, 'bouteille', NULL, 2000, 'needs_verification', 'catalog_officiel'),
    ('PP-SOL-CR-20-50', 'Casier SOLIBRA 20x50cl (Racines)', 'Casier spécifique Racines 50cl - capacité 20 bouteilles', 'plastic', 1, 1, 'crate_physical', 20, 'bouteille', NULL, 2200, 'needs_verification', 'catalog_officiel'),
    -- BRASSIVOIRE
    ('PP-BRV-CR-24-33', 'Casier BRASSIVOIRE 24x33cl', 'Casier plastique BRASSIVOIRE pour bouteilles 33cl', 'plastic', 1, 1, 'crate_physical', NULL, 'bouteille', NULL, 1500, 'needs_verification', 'catalog_officiel'),
    ('PP-BRV-CR-12-60', 'Casier BRASSIVOIRE 12x60cl', 'Casier plastique BRASSIVOIRE pour bouteilles 60cl', 'plastic', 1, 1, 'crate_physical', NULL, 'bouteille', NULL, 2000, 'needs_verification', 'catalog_officiel'),
    -- Génériques
    ('PP-GEN-CR-24-33', 'Casier générique 24x33cl', 'Casier standard 24 bouteilles 33cl verre consigné', 'plastic', 1, 1, 'crate_physical', 24, 'bouteille', NULL, 1200, 'verified', 'mesure_physique'),
    ('PP-GEN-CR-12-50', 'Casier générique 12x50cl', 'Casier standard 12 bouteilles 50cl verre consigné', 'plastic', 1, 1, 'crate_physical', 12, 'bouteille', NULL, 1500, 'verified', 'mesure_physique'),
    ('PP-GEN-CR-12-65', 'Casier générique 12x65cl', 'Casier standard 12 bouteilles 65cl verre consigné', 'plastic', 1, 1, 'crate_physical', 12, 'bouteille', NULL, 1800, 'verified', 'mesure_physique'),
    ('PP-GEN-CR-20-50', 'Casier générique 20x50cl', 'Casier standard 20 bouteilles 50cl verre consigné (Racines)', 'plastic', 1, 1, 'crate_physical', 20, 'bouteille', NULL, 1800, 'verified', 'mesure_physique');

-- 7. Créer les types de contenants manquants pour BRASSIVOIRE
INSERT OR IGNORE INTO container_types (code, name, is_returnable, description, is_active, material, is_recyclable, default_volume_ml, default_deposit_value)
VALUES
    ('CT-BRV-33-GLASS', 'Bouteille BRASSIVOIRE 33cl verre', 1, 'Bouteille verre consignée BRASSIVOIRE 33cl', 1, 'glass', 1, 330, 0),
    ('CT-BRV-60-GLASS', 'Bouteille BRASSIVOIRE 60cl verre', 1, 'Bouteille verre consignée BRASSIVOIRE 60cl', 1, 'glass', 1, 600, 0),
    ('CT-HEI-25-GLASS', 'Bouteille Heineken 25cl', 1, 'Bouteille verre consignée Heineken 25cl', 1, 'glass', 1, 250, 0),
    ('CT-HEI-33-GLASS', 'Bouteille Heineken 33cl', 1, 'Bouteille verre consignée Heineken 33cl', 1, 'glass', 1, 330, 0),
    ('CT-HEI-50-GLASS', 'Bouteille Heineken 50cl', 1, 'Bouteille verre consignée Heineken 50cl', 1, 'glass', 1, 500, 0),
    ('CT-HEI-50-CAN', 'Canette Heineken 50cl', 0, 'Canette aluminium Heineken 50cl', 1, 'aluminium', 1, 500, 0),
    ('CT-DES-25-GLASS', 'Bouteille Desperados 25cl', 1, 'Bouteille verre consignée Desperados 25cl', 1, 'glass', 1, 250, 0),
    ('CT-DES-33-GLASS', 'Bouteille Desperados 33cl', 1, 'Bouteille verre consignée Desperados 33cl', 1, 'glass', 1, 330, 0),
    ('CT-DES-50-CAN', 'Canette Desperados 50cl', 0, 'Canette aluminium Desperados 50cl', 1, 'aluminium', 1, 500, 0),
    ('CT-RHI-33-GLASS', 'Bouteille Rhino Energy 33cl', 1, 'Bouteille verre consignée Rhino Energy Malt 33cl', 1, 'glass', 1, 330, 0);

-- 8. Créer les types d'emballages commerciaux manquants
INSERT OR IGNORE INTO packaging_types (code, name, default_name, is_reusable, is_returnable)
VALUES
    ('PT-HALF-CRATE', 'Demi-casier', 'casier', 1, 1),
    ('PT-SIX-PACK', 'Pack 6 bouteilles', 'pack', 0, 0),
    ('PT-TWELVE-PACK', 'Pack 12 bouteilles', 'pack', 0, 0);

-- 9. Insérer les catégories de boissons
INSERT OR IGNORE INTO categories (name, description, slug, is_active)
VALUES
    ('Bières', 'Bières et boissons maltées', 'bieres', 1),
    ('Boissons gazeuses', 'Sodas et boissons gazeuses', 'boissons-gazeuses', 1),
    ('Boissons maltées', 'Boissons à base de malt sans alcool', 'boissons-maltées', 1),
    ('Boissons énergisantes', 'Boissons énergisantes', 'boissons-energisantes', 1),
    ('Vins et alcools', 'Vins, spiritueux et boissons alcoolisées', 'vins-alcools', 1),
    ('Eaux et autres', 'Eaux minérales, jus et autres boissons', 'eaux-autres', 1);

-- Sous-catégories
INSERT OR IGNORE INTO categories (name, description, slug, parent_id, is_active)
SELECT 'Bières locales', 'Bières produites en Côte d''Ivoire', 'bieres-locales', id, 1 FROM categories WHERE name = 'Bières';
INSERT OR IGNORE INTO categories (name, description, slug, parent_id, is_active)
SELECT 'Bières importées', 'Bières importées', 'bieres-importees', id, 1 FROM categories WHERE name = 'Bières';

-- 10. Marquer les capacités de crate_types existants comme à vérifier
UPDATE crate_types SET 
    capacity_verification_status = 'needs_verification'
WHERE capacity_verification_status IS NULL;