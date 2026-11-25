//! Tests pour les composants d'emballage (packaging_profiles, variant_packaging_options,
//! catalogue_verification_logs) et le service de calcul de retour.
//! Couvre MAJ.md Sections 4-6, 10-11.

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::packaging_components::{
    create_catalogue_verification_log, create_packaging_profile, create_variant_packaging_option,
    delete_variant_packaging_option, get_packaging_profile, list_catalogue_verification_logs,
    list_packaging_profiles, list_variant_packaging_options, update_packaging_profile,
    update_variant_packaging_option,
    CreateCatalogueVerificationLogInput, CreatePackagingProfileInput,
    CreateVariantPackagingOptionInput, UpdatePackagingProfileInput,
    UpdateVariantPackagingOptionInput,
};
use depotpro_core::infrastructure::db::DepotDb;

fn actor() -> SessionIdentity {
    SessionIdentity::from_role("1", "owner", "Propriétaire", Role::Owner)
}

async fn fresh_db(tag: &str) -> DepotDb {
    let path = std::env::temp_dir()
        .join(format!("pkg_{tag}_{}.db", uuid::Uuid::new_v4()))
        .join("depotpro.db");
    DepotDb::connect(&path).await.expect("connect")
}

async fn seed_base(db: &DepotDb) -> (i64, i64, i64, i64, i64) {
    auth::with_actor(actor(), async {
        // Brasserie SOLIBRA (déjà seedée par la migration)
        let brewery_id: i64 = sqlx::query_scalar("SELECT id FROM breweries WHERE code = 'BRW-SOLIBRA'")
            .fetch_one(&db.pool)
            .await
            .unwrap();

        // Marque Bock
        let brand_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM brands WHERE code = 'BRD-BOCK'")
            .fetch_optional(&db.pool)
            .await
            .unwrap();
        let brand_id = match brand_exists {
            Some(id) => id,
            None => {
                sqlx::query(
                    "INSERT INTO brands (brewery_id, code, name, description, is_active)
                     VALUES (?, 'BRD-BOCK', 'Bock', 'Marque Bock', 1)",
                )
                .bind(brewery_id)
                .execute(&db.pool)
                .await
                .unwrap();
                sqlx::query_scalar("SELECT id FROM brands WHERE code = 'BRD-BOCK'")
                    .fetch_one(&db.pool)
                    .await
                    .unwrap()
            }
        };

        let cat_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'Bières'")
            .fetch_optional(&db.pool)
            .await
            .unwrap();
        let cat_id = match cat_exists {
            Some(id) => id,
            None => {
                sqlx::query("INSERT INTO categories (name, description) VALUES ('Bières', 'Bières')")
                    .execute(&db.pool)
                    .await
                    .unwrap();
                sqlx::query_scalar("SELECT id FROM categories WHERE name = 'Bières'")
                    .fetch_one(&db.pool)
                    .await
                    .unwrap()
            }
        };

        let container_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM container_types WHERE code = 'CT-VERRE'")
            .fetch_optional(&db.pool)
            .await
            .unwrap();
        let _container_id = match container_exists {
            Some(id) => id,
            None => {
                sqlx::query(
                    "INSERT INTO container_types (code, name, material, description, is_active)
                     VALUES ('CT-VERRE', 'Verre', 'glass', 'Bouteille en verre', 1)",
                )
                .execute(&db.pool)
                .await
                .unwrap();
                sqlx::query_scalar("SELECT id FROM container_types WHERE code = 'CT-VERRE'")
                    .fetch_one(&db.pool)
                    .await
                    .unwrap()
            }
        };

        let cpt_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM packaging_types WHERE code = 'CPT-CRATE'")
            .fetch_optional(&db.pool)
            .await
            .unwrap();
        let cpt_id = match cpt_exists {
            Some(id) => id,
            None => {
                sqlx::query(
                    "INSERT INTO packaging_types (code, name, default_name, is_reusable, is_returnable, is_active)
                     VALUES ('CPT-CRATE', 'Casier', 'casier', 1, 1, 1)",
                )
                .execute(&db.pool)
                .await
                .unwrap();
                sqlx::query_scalar("SELECT id FROM packaging_types WHERE code = 'CPT-CRATE'")
                    .fetch_one(&db.pool)
                    .await
                    .unwrap()
            }
        };

        let product_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM products WHERE name = 'Bock'")
            .fetch_optional(&db.pool)
            .await
            .unwrap();
        let product_id = match product_exists {
            Some(id) => id,
            None => {
                sqlx::query(
                    "INSERT INTO products (brand_id, category_id, reference, name, description, is_active)
                     VALUES (?, ?, 'BOCK-001', 'Bock', 'Bock bière', 1)",
                )
                .bind(brand_id)
                .bind(cat_id)
                .execute(&db.pool)
                .await
                .unwrap();
                sqlx::query_scalar("SELECT id FROM products WHERE name = 'Bock'")
                    .fetch_one(&db.pool)
                    .await
                    .unwrap()
            }
        };

        let variant_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM product_variants WHERE sku = 'BOCK-33CL'")
            .fetch_optional(&db.pool)
            .await
            .unwrap();
        let variant_id = match variant_exists {
            Some(id) => id,
            None => {
                sqlx::query(
                    "INSERT INTO product_variants (product_id, sku, name, volume_ml, container_type, barcode, is_active)
                     VALUES (?, 'BOCK-33CL', 'Bock 33cl', 330, 'glass_returnable', '1234567890128', 1)",
                )
                .bind(product_id)
                .execute(&db.pool)
                .await
                .unwrap();
                sqlx::query_scalar("SELECT id FROM product_variants WHERE sku = 'BOCK-33CL'")
                    .fetch_one(&db.pool)
                    .await
                    .unwrap()
            }
        };

        (brewery_id, brand_id, cat_id, variant_id, cpt_id)
    })
    .await
}

#[tokio::test]
async fn test_packaging_profile_crud() {
    let db = fresh_db("pkg_crud").await;
    seed_base(&db).await;

    auth::with_actor(actor(), async {
        let profile = create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-24".to_string(),
                name: "Casier 24 trous".to_string(),
                description: Some("Casier plastique 24 bouteilles".to_string()),
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: Some(24),
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(1000),
                verification_status: Some("verified".to_string()),
                verification_source: Some("catalogue_seed".to_string()),
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap();
        assert_eq!(profile.code, "CASE-24");
        assert_eq!(profile.name, "Casier 24 trous");
        assert_eq!(profile.capacity_units, Some(24));
        assert_eq!(profile.default_value_xof, 1000);
        assert_eq!(profile.verification_status, "verified");
        assert!(profile.is_returnable);
        assert!(profile.is_physically_tracked);
        assert!(profile.is_active);

        let fetched = get_packaging_profile(&db, profile.id).await.unwrap();
        assert_eq!(fetched.id, profile.id);
        assert_eq!(fetched.code, "CASE-24");

        let updated = update_packaging_profile(
            &db,
            profile.id,
            UpdatePackagingProfileInput {
                name: Some("Casier 24 trous v2".to_string()),
                description: Some("Casier plastique 24 bouteilles v2".to_string()),
                packaging_material: None,
                is_returnable: None,
                is_physically_tracked: None,
                tracking_mode: None,
                capacity_units: None,
                capacity_unit_label: None,
                compatible_group_id: None,
                default_value_xof: Some(1200),
                verification_status: None,
                verification_source: None,
                verification_comment: None,
                is_active: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.name, "Casier 24 trous v2");
        assert_eq!(updated.default_value_xof, 1200);

        let profiles = list_packaging_profiles(&db, false, None).await.unwrap();
        assert!(profiles.iter().any(|p| p.code == "CASE-24"));
        let created = profiles.iter().find(|p| p.code == "CASE-24").unwrap();
        assert_eq!(created.code, "CASE-24");
    })
    .await;
}

#[tokio::test]
async fn test_packaging_profile_null_capacity() {
    let db = fresh_db("pkg_null_cap").await;
    seed_base(&db).await;

    auth::with_actor(actor(), async {
        let profile = create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-UNK".to_string(),
                name: "Casier capacité inconnue".to_string(),
                description: Some("Capacité à confirmer".to_string()),
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: None,
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(0),
                verification_status: Some("needs_verification".to_string()),
                verification_source: Some("owner_declared".to_string()),
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap();
        assert_eq!(profile.capacity_units, None);
        assert_eq!(profile.verification_status, "needs_verification");
        assert_eq!(profile.default_value_xof, 0);
    })
    .await;
}

#[tokio::test]
async fn test_variant_packaging_option_crud() {
    let db = fresh_db("pkg_vpo_crud").await;
    let (_, _, _, variant_id, cpt_id) = seed_base(&db).await;

    let profile = auth::with_actor(actor(), async {
        create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-24".to_string(),
                name: "Casier 24".to_string(),
                description: None,
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: Some(24),
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(1000),
                verification_status: Some("verified".to_string()),
                verification_source: None,
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap()
    })
    .await;

    auth::with_actor(actor(), async {
        let option = create_variant_packaging_option(
            &db,
            CreateVariantPackagingOptionInput {
                variant_id,
                commercial_packaging_type_id: cpt_id,
                packaging_profile_id: Some(profile.id),
                units_per_package: 24,
                is_returnable: Some(true),
                is_default_sale: Some(true),
                is_default_purchase: Some(false),
                verification_status: Some("verified".to_string()),
                verification_source: None,
                verification_comment: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(option.variant_id, variant_id);
        assert_eq!(option.packaging_profile_id, Some(profile.id));
        assert_eq!(option.units_per_package, 24);
        assert!(option.is_returnable);
        assert_eq!(option.verification_status, "verified");

        let updated = update_variant_packaging_option(
            &db,
            option.id,
            UpdateVariantPackagingOptionInput {
                packaging_profile_id: None,
                units_per_package: Some(24),
                is_returnable: Some(true),
                is_default_sale: Some(false),
                is_default_purchase: None,
                verification_status: None,
                verification_source: None,
                verification_comment: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.units_per_package, 24);
        assert!(!updated.is_default_sale);

        delete_variant_packaging_option(&db, option.id).await.unwrap();
        let remaining = list_variant_packaging_options(&db, variant_id).await.unwrap();
        assert_eq!(remaining.len(), 0);
    })
    .await;
}

#[tokio::test]
async fn test_packaging_profile_different_capacities() {
    let db = fresh_db("pkg_diff_cap").await;
    seed_base(&db).await;

    auth::with_actor(actor(), async {
        let p24 = create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-24".to_string(),
                name: "Casier 24".to_string(),
                description: None,
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: Some(24),
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(1000),
                verification_status: Some("verified".to_string()),
                verification_source: None,
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap();

        let p12 = create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-12".to_string(),
                name: "Casier 12".to_string(),
                description: None,
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: Some(12),
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(800),
                verification_status: Some("verified".to_string()),
                verification_source: None,
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap();

        let p20 = create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-20".to_string(),
                name: "Casier 20".to_string(),
                description: None,
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: Some(20),
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(900),
                verification_status: Some("owner_confirmed".to_string()),
                verification_source: Some("owner_verified".to_string()),
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap();

        assert_eq!(p24.capacity_units, Some(24));
        assert_eq!(p12.capacity_units, Some(12));
        assert_eq!(p20.capacity_units, Some(20));
        assert_eq!(p20.verification_status, "owner_confirmed");
        assert_eq!(p24.default_value_xof, 1000);
        assert_eq!(p12.default_value_xof, 800);
        assert_eq!(p20.default_value_xof, 900);
    })
    .await;
}

#[tokio::test]
async fn test_verification_statuses() {
    let db = fresh_db("pkg_verif").await;
    seed_base(&db).await;

    auth::with_actor(actor(), async {
        let statuses = vec![
            ("verified", "CASE-VER"),
            ("needs_verification", "CASE-NV"),
            ("owner_confirmed", "CASE-OC"),
            ("inactive", "CASE-INACTIVE"),
        ];

        for (status, code) in statuses {
            create_packaging_profile(
                &db,
                CreatePackagingProfileInput {
                    code: code.to_string(),
                    name: format!("Casier {}", code),
                    description: None,
                    packaging_material: Some("plastic".to_string()),
                    is_returnable: Some(true),
                    is_physically_tracked: Some(true),
                    tracking_mode: Some("crate_physical".to_string()),
                    capacity_units: Some(24),
                    capacity_unit_label: Some("bouteilles".to_string()),
                    compatible_group_id: None,
                    default_value_xof: Some(1000),
                    verification_status: Some(status.to_string()),
                    verification_source: None,
                    verification_comment: None,
                    is_active: Some(true),
                },
            )
            .await
            .unwrap();
        }

        let all = list_packaging_profiles(&db, false, None).await.unwrap();
        let all_codes: Vec<&str> = all.iter().map(|p| p.code.as_str()).collect();
        assert!(all_codes.contains(&"CASE-VER"));
        assert!(all_codes.contains(&"CASE-NV"));
        assert!(all_codes.contains(&"CASE-OC"));
        assert!(all_codes.contains(&"CASE-INACTIVE"));

        // Verify each created profile has its expected status by checking all profiles
        let case_ver = all.iter().find(|p| p.code == "CASE-VER").unwrap();
        assert_eq!(case_ver.verification_status, "verified");
        let case_nv = all.iter().find(|p| p.code == "CASE-NV").unwrap();
        assert_eq!(case_nv.verification_status, "needs_verification");
        let case_oc = all.iter().find(|p| p.code == "CASE-OC").unwrap();
        assert_eq!(case_oc.verification_status, "owner_confirmed");
        let case_inactive = all.iter().find(|p| p.code == "CASE-INACTIVE").unwrap();
        assert_eq!(case_inactive.verification_status, "inactive");
    })
    .await;
}

#[tokio::test]
async fn test_snapshot_persistence_in_sale() {
    let db = fresh_db("pkg_snapshot").await;
    let (_, _, _, _, cpt_id) = seed_base(&db).await;

    auth::with_actor(actor(), async {
        sqlx::query(
            "INSERT OR IGNORE INTO app_settings (id, sale_prefix, invoice_prefix, allow_negative_stock)
             VALUES (1, 'VTE', 'FAC', 0)",
        )
        .execute(&db.pool)
        .await
        .unwrap();

        sqlx::query("INSERT OR IGNORE INTO payment_methods (code, label, is_cash, active) VALUES ('cash', 'Espèces', 1, 1)")
            .execute(&db.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO clients (code, name, client_type) VALUES ('CLI-SNP', 'Client Snapshot', 'particulier')")
            .execute(&db.pool)
            .await
            .unwrap();
        let client_id: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-SNP'")
            .fetch_one(&db.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO categories (name) VALUES ('Bières snp')")
            .execute(&db.pool)
            .await
            .unwrap();
        let cat_id: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'Bières snp'")
            .fetch_one(&db.pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO products (brand_id, category_id, reference, name, description, is_active, base_unit, stock_milli, retail_price)
             VALUES (1, ?, 'SNP-001', 'Produit Snapshot', 'Test snapshot', 1, 'bouteille', 100000, 500)",
        )
        .bind(cat_id)
        .execute(&db.pool)
        .await
        .unwrap();
        let product_id: i64 = sqlx::query_scalar("SELECT id FROM products WHERE name = 'Produit Snapshot'")
            .fetch_one(&db.pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO product_variants (product_id, sku, name, volume_ml, container_type, barcode, is_active)
             VALUES (?, 'SNP-33CL', 'Produit Snapshot 33cl', 330, 'glass_returnable', '1111111111111', 1)",
        )
        .bind(product_id)
        .execute(&db.pool)
        .await
        .unwrap();
        let snapshot_variant_id: i64 = sqlx::query_scalar("SELECT id FROM product_variants WHERE sku = 'SNP-33CL'")
            .fetch_one(&db.pool)
            .await
            .unwrap();

        let packaging_result = sqlx::query(
            "INSERT INTO product_packagings (product_id, packaging_type_id, variant_id, name, base_unit, coefficient_milli, retail_price, bottle_deposit_amount, is_active)
             VALUES (?, ?, ?, 'casier', 'casier', 24000, 5000, 200, 1)",
        )
        .bind(product_id)
        .bind(cpt_id)
        .bind(snapshot_variant_id)
        .execute(&db.pool)
        .await
        .unwrap();
        let packaging_id: i64 = packaging_result.last_insert_rowid();

        sqlx::query(
            "INSERT INTO deposit_packaging_profiles (packaging_id, mode) VALUES (?, 'deposit')",
        )
        .bind(packaging_id)
        .execute(&db.pool)
        .await
        .unwrap();

        // Create packaging profile and variant_packaging_option for snapshot test
        let profile_result = sqlx::query(
            "INSERT INTO packaging_profiles (code, name, packaging_material, is_returnable, is_physically_tracked, tracking_mode, capacity_units, capacity_unit_label, compatible_group_id, default_value_xof, verification_status, verification_source, is_active)
             VALUES ('PP-SNAP-24', 'Casier Snapshot 24', 'plastic', 1, 1, 'crate_physical', 24, 'bouteille', 1, 1000, 'verified', 'catalog_officiel', 1)",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        let profile_id: i64 = profile_result.last_insert_rowid();

        sqlx::query(
            "INSERT INTO variant_packaging_options (variant_id, commercial_packaging_type_id, packaging_profile_id, units_per_package, is_returnable, is_default_sale, verification_status)
             VALUES (?, ?, ?, 24, 1, 1, 'verified')",
        )
        .bind(snapshot_variant_id)
        .bind(cpt_id)
        .bind(profile_id)
        .execute(&db.pool)
        .await
        .unwrap();

        depotpro_core::application::cash::open_cash_session(
            &db,
            depotpro_core::application::cash::OpenCashInput {
                opening_cash: 200_000,
                request_key: "ck-snap-001".to_string(),
            },
        )
        .await
        .unwrap();

        use depotpro_core::application::sales::{create_sale_v4, CreateSaleLineV4Input, CreateSaleV4Input, PaymentPartInput};

        let sale = create_sale_v4(
            &db,
            CreateSaleV4Input {
                request_key: "sale-snap-001".to_string(),
                client_id: Some(client_id),
                sale_type: "cash".to_string(),
                price_tier: "retail".to_string(),
                discount_amount: None,
                notes: Some("Vente avec snapshot de casier".to_string()),
                lines: vec![CreateSaleLineV4Input {
                    product_id,
                    packaging_id,
                    sales_unit_id: None,
                    quantity: "1".to_string(),
                    discount_amount: Some(0),
                    crate_capacity_snapshot: Some(24),
                    crate_capacity_verification_snapshot: Some("verified".to_string()),
                    crate_value_xof_snapshot: Some(1000),
                    crate_compatibility_group_snapshot: Some(1),
                    bottles_equivalent_snapshot: Some(24),
                    is_returnable_snapshot: Some(true),
                    crate_received_quantity_snapshot: Some(0),
                    crate_missing_quantity_snapshot: Some(1),
                }],
                payments: vec![PaymentPartInput {
                    method_code: "cash".to_string(),
                    amount: 5200,
                }],
                due_date: None,
                external_reference: None,
                crate_debt_snapshot_xof: Some(1000),
                crate_received_snapshot_xof: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let line: Option<(i64, Option<i64>, Option<String>, i64, Option<i64>, i64, i64)> =
            sqlx::query_as(
                "SELECT id, crate_capacity_snapshot, crate_capacity_verification_snapshot,
                        crate_value_xof_snapshot, crate_compatibility_group_snapshot,
                        bottles_equivalent_snapshot, is_returnable_snapshot
                 FROM sale_lines WHERE sale_id = ?",
            )
            .bind(sale.sale.id)
            .fetch_optional(&db.pool)
            .await
            .unwrap();

        assert!(line.is_some());
        let (_, capacity, verification, value, compat_group, bottles_equiv, is_returnable) = line.unwrap();
        assert_eq!(capacity, Some(24));
        assert_eq!(verification, Some("verified".to_string()));
        assert_eq!(value, 1000);
        assert_eq!(compat_group, Some(1));
        assert_eq!(bottles_equiv, 24);
        assert_eq!(is_returnable, 1);

        let sale_snapshot: Option<(i64, i64, Option<String>)> =
            sqlx::query_as(
                "SELECT crate_debt_snapshot_xof, crate_received_snapshot_xof, crate_return_composition_snapshot
                 FROM sales WHERE id = ?",
            )
            .bind(sale.sale.id)
            .fetch_optional(&db.pool)
            .await
            .unwrap();

        assert!(sale_snapshot.is_some());
        let (debt, received, composition) = sale_snapshot.unwrap();
        assert_eq!(debt, 1000);
        assert_eq!(received, 0);
        assert!(composition.is_none() || composition.as_deref().map(|s| s.is_empty()).unwrap_or(true));
    })
    .await;
}

#[tokio::test]
async fn test_brassivoire_null_capacity() {
    let db = fresh_db("pkg_bs_null").await;
    seed_base(&db).await;

    auth::with_actor(actor(), async {
        let profile = create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-BS-UNK".to_string(),
                name: "Casier BRASSIVOIRE capacité inconnue".to_string(),
                description: Some("À confirmer par l'OWNER".to_string()),
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: None,
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(0),
                verification_status: Some("needs_verification".to_string()),
                verification_source: Some("owner_declared".to_string()),
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap();

        assert_eq!(profile.capacity_units, None);
        assert_eq!(profile.verification_status, "needs_verification");
        assert_eq!(profile.default_value_xof, 0);

        let profiles = list_packaging_profiles(&db, false, None).await.unwrap();
        let unknown = profiles.iter().find(|p| p.code == "CASE-BS-UNK").unwrap();
        assert_eq!(unknown.verification_status, "needs_verification");
        assert_eq!(unknown.capacity_units, None);
    })
    .await;
}

#[tokio::test]
async fn test_catalogue_verification_log() {
    let db = fresh_db("pkg_verif_log").await;
    seed_base(&db).await;

    let profile = auth::with_actor(actor(), async {
        create_packaging_profile(
            &db,
            CreatePackagingProfileInput {
                code: "CASE-LOG".to_string(),
                name: "Casier Log".to_string(),
                description: None,
                packaging_material: Some("plastic".to_string()),
                is_returnable: Some(true),
                is_physically_tracked: Some(true),
                tracking_mode: Some("crate_physical".to_string()),
                capacity_units: Some(24),
                capacity_unit_label: Some("bouteilles".to_string()),
                compatible_group_id: None,
                default_value_xof: Some(1000),
                verification_status: Some("needs_verification".to_string()),
                verification_source: None,
                verification_comment: None,
                is_active: Some(true),
            },
        )
        .await
        .unwrap()
    })
    .await;

    auth::with_actor(actor(), async {
        // Ensure a user exists for verified_by NOT NULL constraint
        sqlx::query(
            "INSERT OR IGNORE INTO users (id, username, display_name, role, pin_hash, active)
             VALUES (1, 'owner_test', 'Propriétaire Test', 'owner', 'pin123', 1)",
        )
        .execute(&db.pool)
        .await
        .unwrap();

        let log_id = create_catalogue_verification_log(
            &db,
            CreateCatalogueVerificationLogInput {
                entity_type: "packaging_profile".to_string(),
                entity_id: profile.id,
                field_name: Some("capacity_units".to_string()),
                old_value: None,
                new_value: Some("24".to_string()),
                verification_status: "verified".to_string(),
                verification_source: Some("owner_verified".to_string()),
                comment: Some("Capacité vérifiée physiquement".to_string()),
            },
        )
        .await
        .unwrap();

        assert!(log_id > 0);

        let logs = list_catalogue_verification_logs(
            &db,
            "packaging_profile".to_string(),
            profile.id,
        )
        .await
        .unwrap();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].entity_type, "packaging_profile");
        assert_eq!(logs[0].entity_id, profile.id);
        assert_eq!(logs[0].field_name, Some("capacity_units".to_string()));
        assert_eq!(logs[0].new_value, Some("24".to_string()));
        assert_eq!(logs[0].verification_status, "verified");
        assert_eq!(logs[0].verified_by, 1);
        assert_eq!(logs[0].comment, Some("Capacité vérifiée physiquement".to_string()));

        let updated = update_packaging_profile(
            &db,
            profile.id,
            UpdatePackagingProfileInput {
                name: None,
                description: None,
                packaging_material: None,
                is_returnable: None,
                is_physically_tracked: None,
                tracking_mode: None,
                capacity_units: None,
                capacity_unit_label: None,
                compatible_group_id: None,
                default_value_xof: None,
                verification_status: Some("verified".to_string()),
                verification_source: Some("owner_verified".to_string()),
                verification_comment: Some("Capacité vérifiée physiquement".to_string()),
                is_active: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(updated.verification_status, "verified");
        assert_eq!(updated.verified_by, None);
    })
    .await;
}
