// ============================================================================
// Import catalogue seed data from JSON (SOLIBRA/BRASSIVOIRE)
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedBrewery {
    pub code: String,
    pub name: String,
    pub short_name: String,
    pub country_code: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub website: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedBrand {
    pub code: String,
    pub name: String,
    pub country_of_origin: String,
    pub brewery_code: String,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedCategory {
    pub name: String,
    pub description: String,
    pub slug: String,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedSubcategory {
    pub name: String,
    pub description: String,
    pub slug: String,
    pub parent: String,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedContainerType {
    pub code: String,
    pub name: String,
    pub is_returnable: bool,
    pub description: Option<String>,
    pub is_active: bool,
    pub material: String,
    pub is_recyclable: bool,
    pub default_volume_ml: i64,
    pub default_deposit_value: i64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedPackagingType {
    pub code: String,
    pub name: String,
    pub default_name: String,
    pub is_reusable: bool,
    pub is_returnable: bool,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedPackagingProfile {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub packaging_material: String,
    pub is_returnable: bool,
    pub is_physically_tracked: bool,
    pub tracking_mode: String,
    pub capacity_units: Option<i64>,
    pub capacity_unit_label: String,
    pub compatible_group_id: Option<i64>,
    pub default_value_xof: i64,
    pub verification_status: String,
    pub verification_source: String,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedVariantPackaging {
    pub packaging_type_code: String,
    pub units_per_package: i64,
    pub packaging_profile_code: Option<String>,
    pub is_returnable: bool,
    pub is_default_sale: bool,
    pub is_default_purchase: bool,
    pub bottle_deposit: i64,
    pub crate_deposit: i64,
    pub verification_status: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedVariant {
    pub name: String,
    pub container_type_code: String,
    pub volume_ml: i64,
    pub barcode: Option<String>,
    pub sku: String,
    pub packagings: Vec<SeedVariantPackaging>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedProduct {
    pub reference: String,
    pub barcode: Option<String>,
    pub name: String,
    pub brand_code: String,
    pub category: String,
    pub subcategory: Option<String>,
    pub brewery_code: String,
    pub description: Option<String>,
    pub base_unit: String,
    pub volume_ml: i64,
    pub alcohol_degree_milli: i64,
    pub is_alcoholic: bool,
    pub ingredients: Option<String>,
    pub beverage_color: Option<String>,
    pub storage_temp: Option<String>,
    pub shelf_life_days: i64,
    pub is_perishable: bool,
    pub track_batches: bool,
    pub track_expiry: bool,
    pub allow_credit_sale: bool,
    pub allow_unit_sale: bool,
    pub allow_mixed_sale: bool,
    pub status: String,
    pub variants: Vec<SeedVariant>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SeedStockLocation {
    pub code: String,
    pub name: String,
    pub location_type: String,
    pub is_default: bool,
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CatalogSeedData {
    pub version: String,
    pub description: String,
    pub breweries: Vec<SeedBrewery>,
    pub brands: Vec<SeedBrand>,
    pub categories: Vec<SeedCategory>,
    pub subcategories: Vec<SeedSubcategory>,
    pub container_types: Vec<SeedContainerType>,
    pub packaging_types: Vec<SeedPackagingType>,
    pub packaging_profiles: Vec<SeedPackagingProfile>,
    pub products: Vec<SeedProduct>,
    pub stock_locations: Vec<SeedStockLocation>,
}

#[derive(Debug, Serialize)]
pub struct SeedImportResult {
    pub breweries_created: usize,
    pub brands_created: usize,
    pub categories_created: usize,
    pub subcategories_created: usize,
    pub container_types_created: usize,
    pub packaging_types_created: usize,
    pub packaging_profiles_created: usize,
    pub products_created: usize,
    pub variants_created: usize,
    pub variant_packagings_created: usize,
    pub stock_locations_created: usize,
    pub errors: Vec<String>,
}

fn get_seed_file_path() -> String {
    // Try multiple locations
    let paths = vec![
        "catalog/catalog_seed.json",
        "../catalog/catalog_seed.json",
        "../../catalog/catalog_seed.json",
        "../../../catalog/catalog_seed.json",
    ];

    for path in paths {
        if Path::new(path).exists() {
            return path.to_string();
        }
    }

    "catalog/catalog_seed.json".to_string()
}

pub async fn import_catalog_seed(db: &DepotDb) -> CoreResult<SeedImportResult> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let file_path = get_seed_file_path();
    let content = fs::read_to_string(&file_path)
        .map_err(|e| CoreError::Validation(format!("Impossible de lire le fichier seed: {}", e)))?;

    let seed_data: CatalogSeedData = serde_json::from_str(&content)
        .map_err(|e| CoreError::Validation(format!("JSON invalide: {}", e)))?;

    let mut result = SeedImportResult {
        breweries_created: 0,
        brands_created: 0,
        categories_created: 0,
        subcategories_created: 0,
        container_types_created: 0,
        packaging_types_created: 0,
        packaging_profiles_created: 0,
        products_created: 0,
        variants_created: 0,
        variant_packagings_created: 0,
        stock_locations_created: 0,
        errors: Vec::new(),
    };

    let (_guard, mut tx) = db.begin_write().await?;

    // 1. Import Breweries
    for brewery in &seed_data.breweries {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM breweries WHERE code = ?")
            .bind(&brewery.code)
            .fetch_one(&mut *tx)
            .await?;
        if exists == 0 {
            sqlx::query(
                r#"
                INSERT INTO breweries (code, name, short_name, country_code, address, phone, email, website, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&brewery.code)
            .bind(&brewery.name)
            .bind(&brewery.short_name)
            .bind(&brewery.country_code)
            .bind(&brewery.address)
            .bind(&brewery.phone)
            .bind(&brewery.email)
            .bind(&brewery.website)
            .bind(if brewery.is_active { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?;
            result.breweries_created += 1;
        }
    }

    // Build brewery code -> id map
    let mut brewery_ids: HashMap<String, i64> = HashMap::new();
    let rows = sqlx::query("SELECT id, code FROM breweries")
        .fetch_all(&mut *tx)
        .await?;
    for row in rows {
        brewery_ids.insert(row.get::<String, _>("code"), row.get::<i64, _>("id"));
    }

    // 2. Import Brands
    for brand in &seed_data.brands {
        let brewery_id = brewery_ids.get(&brand.brewery_code).copied();
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM brands WHERE code = ?")
            .bind(&brand.code)
            .fetch_one(&mut *tx)
            .await?;
        if exists == 0 {
            sqlx::query(
                "INSERT INTO brands (code, name, country_of_origin, brewery_id, is_active) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&brand.code)
            .bind(&brand.name)
            .bind(&brand.country_of_origin)
            .bind(brewery_id)
            .bind(if brand.is_active { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?;
            result.brands_created += 1;
        }
    }

    // 3. Import Categories
    let mut category_ids: HashMap<String, i64> = HashMap::new();
    for cat in &seed_data.categories {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE slug = ?")
            .bind(&cat.slug)
            .fetch_one(&mut *tx)
            .await?;
        let cat_id = if exists == 0 {
            let id = sqlx::query(
                "INSERT INTO categories (name, description, slug, is_active) VALUES (?, ?, ?, ?)",
            )
            .bind(&cat.name)
            .bind(&cat.description)
            .bind(&cat.slug)
            .bind(if cat.is_active { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?
            .last_insert_rowid();
            result.categories_created += 1;
            id
        } else {
            sqlx::query_scalar("SELECT id FROM categories WHERE slug = ?")
                .bind(&cat.slug)
                .fetch_one(&mut *tx)
                .await?
        };
        category_ids.insert(cat.name.clone(), cat_id);
    }

    // 4. Import Subcategories
    for subcat in &seed_data.subcategories {
        let parent_id = category_ids.get(&subcat.parent).copied();
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE slug = ?")
            .bind(&subcat.slug)
            .fetch_one(&mut *tx)
            .await?;
        if exists == 0 {
            sqlx::query(
                "INSERT INTO categories (name, description, slug, parent_id, is_active) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&subcat.name)
            .bind(&subcat.description)
            .bind(&subcat.slug)
            .bind(parent_id)
            .bind(if subcat.is_active { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?;
            result.subcategories_created += 1;
        }
    }

    // Refresh category_ids after subcategories
    let rows = sqlx::query("SELECT id, name FROM categories")
        .fetch_all(&mut *tx)
        .await?;
    category_ids.clear();
    for row in rows {
        category_ids.insert(row.get::<String, _>("name"), row.get::<i64, _>("id"));
    }

    // 5. Import Container Types
    for ct in &seed_data.container_types {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM container_types WHERE code = ?")
            .bind(&ct.code)
            .fetch_one(&mut *tx)
            .await?;
        if exists == 0 {
            sqlx::query(
                r#"
                INSERT INTO container_types (code, name, is_returnable, description, is_active, material, is_recyclable, default_volume_ml, default_deposit_value)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&ct.code)
            .bind(&ct.name)
            .bind(if ct.is_returnable { 1_i64 } else { 0_i64 })
            .bind(&ct.description)
            .bind(if ct.is_active { 1_i64 } else { 0_i64 })
            .bind(&ct.material)
            .bind(if ct.is_recyclable { 1_i64 } else { 0_i64 })
            .bind(ct.default_volume_ml)
            .bind(ct.default_deposit_value)
            .execute(&mut *tx)
            .await?;
            result.container_types_created += 1;
        }
    }

    // Build container_type code -> id map
    let mut container_type_ids: HashMap<String, i64> = HashMap::new();
    let rows = sqlx::query("SELECT id, code FROM container_types")
        .fetch_all(&mut *tx)
        .await?;
    for row in rows {
        container_type_ids.insert(row.get::<String, _>("code"), row.get::<i64, _>("id"));
    }

    // 6. Import Packaging Types
    for pt in &seed_data.packaging_types {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM packaging_types WHERE code = ?")
            .bind(&pt.code)
            .fetch_one(&mut *tx)
            .await?;
        if exists == 0 {
            sqlx::query(
                "INSERT INTO packaging_types (code, name, default_name, is_reusable, is_returnable, is_active) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&pt.code)
            .bind(&pt.name)
            .bind(&pt.default_name)
            .bind(if pt.is_reusable { 1_i64 } else { 0_i64 })
            .bind(if pt.is_returnable { 1_i64 } else { 0_i64 })
            .bind(if pt.is_active { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?;
            result.packaging_types_created += 1;
        }
    }

    // Build packaging_type code -> id map
    let mut packaging_type_ids: HashMap<String, i64> = HashMap::new();
    let rows = sqlx::query("SELECT id, code FROM packaging_types")
        .fetch_all(&mut *tx)
        .await?;
    for row in rows {
        packaging_type_ids.insert(row.get::<String, _>("code"), row.get::<i64, _>("id"));
    }

    // 7. Import Packaging Profiles
    for pp in &seed_data.packaging_profiles {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM packaging_profiles WHERE code = ?")
            .bind(&pp.code)
            .fetch_one(&mut *tx)
            .await?;
        if exists == 0 {
            sqlx::query(
                r#"
                INSERT INTO packaging_profiles (code, name, description, packaging_material, is_returnable, is_physically_tracked, tracking_mode, capacity_units, capacity_unit_label, compatible_group_id, default_value_xof, verification_status, verification_source, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&pp.code)
            .bind(&pp.name)
            .bind(&pp.description)
            .bind(&pp.packaging_material)
            .bind(if pp.is_returnable { 1_i64 } else { 0_i64 })
            .bind(if pp.is_physically_tracked { 1_i64 } else { 0_i64 })
            .bind(&pp.tracking_mode)
            .bind(pp.capacity_units)
            .bind(&pp.capacity_unit_label)
            .bind(pp.compatible_group_id)
            .bind(pp.default_value_xof)
            .bind(&pp.verification_status)
            .bind(&pp.verification_source)
            .bind(if pp.is_active { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?;
            result.packaging_profiles_created += 1;
        }
    }

    // Build packaging_profile code -> id map
    let mut packaging_profile_ids: HashMap<String, i64> = HashMap::new();
    let rows = sqlx::query("SELECT id, code FROM packaging_profiles")
        .fetch_all(&mut *tx)
        .await?;
    for row in rows {
        packaging_profile_ids.insert(row.get::<String, _>("code"), row.get::<i64, _>("id"));
    }

    // 8. Import Brand code -> id map
    let mut brand_ids: HashMap<String, i64> = HashMap::new();
    let rows = sqlx::query("SELECT id, code FROM brands")
        .fetch_all(&mut *tx)
        .await?;
    for row in rows {
        brand_ids.insert(row.get::<String, _>("code"), row.get::<i64, _>("id"));
    }

    // 9. Import Products and Variants
    for product in &seed_data.products {
        let _brand_id = brand_ids.get(&product.brand_code).copied();
        let category_id = category_ids.get(&product.category).copied();
        let subcategory_id = product.subcategory.as_ref().and_then(|s| category_ids.get(s).copied());
        let brewery_id = brewery_ids.get(&product.brewery_code).copied();

        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE reference = ?")
            .bind(&product.reference)
            .fetch_one(&mut *tx)
            .await?;

        let product_id = if exists == 0 {
            let id = sqlx::query(
                r#"
                INSERT INTO products (reference, barcode, name, brand, category_id, supplier_id, description, base_unit, stock_milli, min_stock_milli, max_stock_milli, purchase_price, wholesale_price, semi_wholesale_price, retail_price, is_active, brewery_id, subcategory_id, variant_label, alcohol_degree_milli, is_alcoholic, ingredients, beverage_color, storage_temp, shelf_life_days, is_perishable, track_batches, track_expiry, allow_credit_sale, allow_unit_sale, allow_mixed_sale, status)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 0, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&product.reference)
            .bind(&product.barcode)
            .bind(&product.name)
            .bind(&product.brand_code)
            .bind(category_id)
            .bind(&product.description)
            .bind(&product.base_unit)
            .bind(if product.status == "active" { 1_i64 } else { 0_i64 })
            .bind(brewery_id)
            .bind(subcategory_id)
            .bind(product.alcohol_degree_milli)
            .bind(if product.is_alcoholic { 1_i64 } else { 0_i64 })
            .bind(&product.ingredients)
            .bind(&product.beverage_color)
            .bind(&product.storage_temp)
            .bind(product.shelf_life_days)
            .bind(if product.is_perishable { 1_i64 } else { 0_i64 })
            .bind(if product.track_batches { 1_i64 } else { 0_i64 })
            .bind(if product.track_expiry { 1_i64 } else { 0_i64 })
            .bind(if product.allow_credit_sale { 1_i64 } else { 0_i64 })
            .bind(if product.allow_unit_sale { 1_i64 } else { 0_i64 })
            .bind(if product.allow_mixed_sale { 1_i64 } else { 0_i64 })
            .bind(&product.status)
            .execute(&mut *tx)
            .await?
            .last_insert_rowid();
            result.products_created += 1;
            id
        } else {
            sqlx::query_scalar("SELECT id FROM products WHERE reference = ?")
                .bind(&product.reference)
                .fetch_one(&mut *tx)
                .await?
        };

        // Import Variants
        for variant in &product.variants {
            let _container_type_id = container_type_ids.get(&variant.container_type_code).copied();

            let var_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM product_variants WHERE product_id = ? AND name = ?")
                .bind(product_id)
                .bind(&variant.name)
                .fetch_one(&mut *tx)
                .await?;

            let variant_id = if var_exists == 0 {
                let id = sqlx::query(
                    r#"
                    INSERT INTO product_variants (product_id, name, volume_ml, container_type, bottle_profile_id, crate_type_id, compatibility_group_id, disposable_packaging_id, barcode, is_active)
                    VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 1)
                    "#,
                )
                .bind(product_id)
                .bind(&variant.name)
                .bind(variant.volume_ml)
                .bind(&variant.container_type_code)
                .bind(&variant.barcode)
                .execute(&mut *tx)
                .await?
                .last_insert_rowid();
                result.variants_created += 1;
                id
            } else {
                sqlx::query_scalar("SELECT id FROM product_variants WHERE product_id = ? AND name = ?")
                    .bind(product_id)
                    .bind(&variant.name)
                    .fetch_one(&mut *tx)
                    .await?
            };

            // Import Variant Packagings
            for pkg in &variant.packagings {
                let packaging_type_id = packaging_type_ids.get(&pkg.packaging_type_code).copied();
                let packaging_profile_id = pkg.packaging_profile_code.as_ref().and_then(|c| packaging_profile_ids.get(c).copied());

                // Check if this variant already has this packaging type
                let vpo_exists: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM variant_packaging_options WHERE variant_id = ? AND commercial_packaging_type_id = ?"
                )
                .bind(variant_id)
                .bind(packaging_type_id.unwrap_or(0))
                .fetch_one(&mut *tx)
                .await?;

                if vpo_exists == 0 && packaging_type_id.is_some() {
                    sqlx::query(
                        r#"
                        INSERT INTO variant_packaging_options (variant_id, commercial_packaging_type_id, packaging_profile_id, units_per_package, is_returnable, is_default_sale, is_default_purchase, verification_status, verification_source)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        "#,
                    )
                    .bind(variant_id)
                    .bind(packaging_type_id.unwrap())
                    .bind(packaging_profile_id)
                    .bind(pkg.units_per_package)
                    .bind(if pkg.is_returnable { 1_i64 } else { 0_i64 })
                    .bind(if pkg.is_default_sale { 1_i64 } else { 0_i64 })
                    .bind(if pkg.is_default_purchase { 1_i64 } else { 0_i64 })
                    .bind(&pkg.verification_status)
                    .bind(&pkg.verification_status) // verification_source
                    .execute(&mut *tx)
                    .await?;
                    result.variant_packagings_created += 1;
                }

                // Also create product_packagings entry for POS
                let _pkg_type_name = pkg.packaging_type_code.replace("PT-", "").to_lowercase();
                let pp_exists: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM product_packagings WHERE product_id = ? AND variant_id = ? AND packaging_type_id = ?"
                )
                .bind(product_id)
                .bind(variant_id)
                .bind(packaging_type_id.unwrap_or(0))
                .fetch_one(&mut *tx)
                .await?;

                if pp_exists == 0 && packaging_type_id.is_some() {
                    sqlx::query(
                        r#"
                        INSERT INTO product_packagings (product_id, variant_id, packaging_type_id, name, base_unit, coefficient_milli, purchase_price, wholesale_price, semi_wholesale_price, retail_price, barcode, allow_fraction, is_active, is_reusable, is_returnable, package_deposit_amount, bottle_deposit_amount, package_cost, min_selling_price, is_default_sale, is_default_purchase, capacity_verification_status, capacity_verification_source)
                        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0, 1, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
                        "#,
                    )
                    .bind(product_id)
                    .bind(variant_id)
                    .bind(packaging_type_id.unwrap())
                    .bind(&pkg.packaging_type_code)
                    .bind(&product.base_unit)
                    .bind(pkg.units_per_package * 1000)
                    .bind(if pkg.is_returnable { 1_i64 } else { 0_i64 })
                    .bind(if pkg.is_returnable { 1_i64 } else { 0_i64 })
                    .bind(pkg.crate_deposit)
                    .bind(pkg.bottle_deposit)
                    .bind(0)
                    .bind(if pkg.is_default_sale { 1_i64 } else { 0_i64 })
                    .bind(if pkg.is_default_purchase { 1_i64 } else { 0_i64 })
                    .bind(&pkg.verification_status)
                    .bind(&pkg.verification_status)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }
    }

    // 10. Import Stock Locations
    for loc in &seed_data.stock_locations {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock_locations WHERE code = ?")
            .bind(&loc.code)
            .fetch_one(&mut *tx)
            .await?;
        if exists == 0 {
            sqlx::query(
                "INSERT INTO stock_locations (code, name, location_type, is_default, is_active) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&loc.code)
            .bind(&loc.name)
            .bind(&loc.location_type)
            .bind(if loc.is_default { 1_i64 } else { 0_i64 })
            .bind(if loc.is_active { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?;
            result.stock_locations_created += 1;
        }
    }

    tx.commit().await?;

    Ok(result)
}

pub async fn _import_catalog_seed_from_path(db: &DepotDb, file_path: String) -> CoreResult<SeedImportResult> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let content = fs::read_to_string(&file_path)
        .map_err(|e| CoreError::Validation(format!("Impossible de lire le fichier seed: {}", e)))?;

    let _seed_data: CatalogSeedData = serde_json::from_str(&content)
        .map_err(|e| CoreError::Validation(format!("JSON invalide: {}", e)))?;

    // Temporarily override the file path logic by using the provided path
    // For now, just call the main function - in a real implementation we'd pass the path
    import_catalog_seed(db).await
}