// ============================================================================
// Vides rapportés par le client AU MOMENT de la commande
// ============================================================================
// Le client rapporte ses casiers vides en passant commande, au dépôt. Ces
// retours doivent solder ses consignes ouvertes dans la MÊME transaction que
// la commande : une commande enregistrée avec des consignes non déduites
// laisserait le client avec une dette qu'il vient justement de payer.

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::orders::{self, ReturnedEmptyInput};
use depotpro_core::infrastructure::db::DepotDb;

fn owner() -> SessionIdentity {
    SessionIdentity::from_role("1", "owner", "Propriétaire", Role::Owner)
}

async fn fresh_db(tag: &str) -> DepotDb {
    let path = std::env::temp_dir().join(format!("lot15_ret_{tag}_{}.db", uuid::Uuid::new_v4()));
    DepotDb::connect(&path).await.expect("connect")
}

struct Fixture {
    client_id: i64,
    variant_id: i64,
    asset_id: i64,
    returnable_id: i64,
}

/// Client, produit vendable, et un solde de 5 casiers détenus par le client.
async fn seed(db: &DepotDb) -> Fixture {
    sqlx::query(
        "INSERT OR IGNORE INTO payment_methods (code, label, is_cash, active)
         VALUES ('cash', 'Espèces', 1, 1)",
    )
    .execute(&db.pool)
    .await
    .unwrap();

    let cat = orders_seed_category(db).await;

    let created = depotpro_core::application::products::create_product_v4(
        db,
        depotpro_core::application::products::CreateProductInput {
            name: "Bock Retour".to_string(),
            brand: Some("Bock".to_string()),
            barcode: None,
            category_id: cat,
            supplier_id: None,
            description: None,
            base_unit: "bouteille".to_string(),
            initial_stock: Some("100".to_string()),
            min_stock: Some("0".to_string()),
            max_stock: Some("0".to_string()),
            purchase_price: Some(300),
            wholesale_price: Some(400),
            semi_wholesale_price: Some(400),
            retail_price: Some(400),
            image_path: None,
            packagings: Some(vec![depotpro_core::application::products::PackagingInput {
                id: None,
                name: "bouteille".to_string(),
                coefficient: "1".to_string(),
                purchase_price: Some(300),
                wholesale_price: Some(400),
                semi_wholesale_price: Some(400),
                retail_price: Some(400),
                barcode: None,
                allow_fraction: Some(false),
                is_active: Some(true),
                deposit_mode: Some("none".to_string()),
                components: None,
            }]),
        },
        depotpro_core::application::products::ProductV4CreateExtras {
            sku: Some("BOCK-RET".to_string()),
            variant: Some(depotpro_core::application::products::InitialVariantInput {
                name: Some("Bock Retour 33cl".to_string()),
                sku: Some("BOCK-RET-VAR".to_string()),
                barcode: None,
                container_type_id: None,
                container_type: Some("glass_returnable".to_string()),
                volume_ml: 330,
                container_material: Some("glass".to_string()),
                container_returnable: Some(true),
                container_recyclable: Some(true),
                container_deposit_amount: Some(0),
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let variant_id = created.variant_id.expect("variant_id");

    // Client, consignable, asset, et 5 casiers détenus.
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query("INSERT INTO clients (code, name) VALUES ('CLI-RET', 'Maquis Retour')")
        .execute(&mut *tx)
        .await
        .unwrap();
    let client_id: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-RET'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO returnable_packaging_types (code, name, producer, kind, deposit_value)
         VALUES ('EMB-RET', 'Casier Retour', 'SOLIBRA', 'crate', 1000)",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    let returnable_id: i64 =
        sqlx::query_scalar("SELECT id FROM returnable_packaging_types WHERE code = 'EMB-RET'")
            .fetch_one(&mut *tx)
            .await
            .unwrap();

    sqlx::query(
        "INSERT INTO packaging_assets (code, name, returnable_id, capacity, deposit_value,
            compatibility_class, stock_empty)
         VALUES ('AST-RET', 'Casier Retour', ?, 24, 1000, 'crate_24', 0)",
    )
    .bind(returnable_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    let asset_id: i64 = sqlx::query_scalar("SELECT id FROM packaging_assets WHERE code = 'AST-RET'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO customer_deposit_balances
            (customer_id, packaging_asset_id, quantity_held, amount_held_xof)
         VALUES (?, ?, 5, 5000)",
    )
    .bind(client_id)
    .bind(asset_id)
    .execute(&mut *tx)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO customer_packaging_accounts
            (client_id, returnable_id, balance_pieces, deposit_held_amount)
         VALUES (?, ?, 5, 5000)",
    )
    .bind(client_id)
    .bind(returnable_id)
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.commit().await.unwrap();

    Fixture {
        client_id,
        variant_id,
        asset_id,
        returnable_id,
    }
}

async fn orders_seed_category(db: &DepotDb) -> i64 {
    depotpro_core::application::products::create_category(db, "Bières Retour", None)
        .await
        .unwrap()
        .id
}

/// Une consigne ouverte de `pieces` casiers pour ce client.
async fn make_issue(db: &DepotDb, fx: &Fixture, pieces: i64) {
    let (_g, mut tx) = db.begin_write().await.unwrap();
    let tag = uuid::Uuid::new_v4().to_string().replace('-', "");
    sqlx::query(
        "INSERT INTO sales (reference, request_key, client_id, sale_type,
            subtotal_merchandise, total_merchandise, total_deposit, total_amount)
         VALUES (?, ?, ?, 'cash', ?, ?, ?, ?)",
    )
    .bind(format!("VTE-{}", &tag[..10]))
    .bind(format!("rk-{}", &tag[..10]))
    .bind(fx.client_id)
    .bind(pieces * 1000)
    .bind(pieces * 1000)
    .bind(pieces * 1000)
    .bind(pieces * 2000)
    .execute(&mut *tx)
    .await
    .unwrap();
    let sale_id: i64 = sqlx::query_scalar("SELECT MAX(id) FROM sales")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO deposit_issues (sale_id, sale_line_id, client_id, returnable_id,
            pieces, unit_value, amount, status)
         VALUES (?, NULL, ?, ?, ?, 1000, ?, 'pending')",
    )
    .bind(sale_id)
    .bind(fx.client_id)
    .bind(fx.returnable_id)
    .bind(pieces)
    .bind(pieces * 1000)
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

fn order_input(
    fx: &Fixture,
    returned: Option<Vec<ReturnedEmptyInput>>,
) -> orders::CreateOrderInput {
    orders::CreateOrderInput {
        customer_id: fx.client_id,
        order_type: Some("vente".into()),
        payment_method: Some("cash".into()),
        lines: vec![orders::OrderLineInput {
            variant_id: fx.variant_id,
            requested_unit: "unit".into(),
            requested_quantity: 12,
            unit_price_xof: Some(400),
            discount_xof: None,
            notes: None,
        }],
        returned_empties: returned,
        ..Default::default()
    }
}

#[tokio::test]
async fn returned_empties_settle_open_consignments_during_order_creation() {
    let db = fresh_db("settle").await;
    let fx = seed(&db).await;
    make_issue(&db, &fx, 3).await;

    auth::with_actor(
        owner(),
        orders::create_order(
            &db,
            order_input(
                &fx,
                Some(vec![ReturnedEmptyInput {
                    packaging_asset_id: fx.asset_id,
                    quantity: 3,
                }]),
            ),
        ),
    )
    .await
    .unwrap();

    let (status, returned): (String, i64) = sqlx::query_as(
        "SELECT status, returned_pieces FROM deposit_issues WHERE client_id = ?",
    )
    .bind(fx.client_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();

    assert_eq!(returned, 3, "la consigne est soldée des 3 casiers rendus");
    assert_eq!(status, "settled");
}

#[tokio::test]
async fn a_partial_return_leaves_the_rest_due() {
    let db = fresh_db("partial").await;
    let fx = seed(&db).await;
    make_issue(&db, &fx, 5).await;

    auth::with_actor(
        owner(),
        orders::create_order(
            &db,
            order_input(
                &fx,
                Some(vec![ReturnedEmptyInput {
                    packaging_asset_id: fx.asset_id,
                    quantity: 2,
                }]),
            ),
        ),
    )
    .await
    .unwrap();

    let (status, returned, pieces): (String, i64, i64) = sqlx::query_as(
        "SELECT status, returned_pieces, pieces FROM deposit_issues WHERE client_id = ?",
    )
    .bind(fx.client_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();

    assert_eq!(returned, 2);
    assert_eq!(status, "partially_returned", "il reste 3 casiers dus");
    assert_eq!(pieces, 5);

    // Le solde détenu par le client diminue d'autant : il ne détient plus que 3.
    let held: i64 = sqlx::query_scalar(
        "SELECT quantity_held FROM customer_deposit_balances WHERE customer_id = ?",
    )
    .bind(fx.client_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(held, 3);
}

#[tokio::test]
async fn the_stock_of_empties_increases_by_what_was_returned() {
    let db = fresh_db("stock").await;
    let fx = seed(&db).await;
    make_issue(&db, &fx, 4).await;

    auth::with_actor(
        owner(),
        orders::create_order(
            &db,
            order_input(
                &fx,
                Some(vec![ReturnedEmptyInput {
                    packaging_asset_id: fx.asset_id,
                    quantity: 4,
                }]),
            ),
        ),
    )
    .await
    .unwrap();

    let stock: i64 =
        sqlx::query_scalar("SELECT stock_empty FROM packaging_assets WHERE id = ?")
            .bind(fx.asset_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(stock, 4, "les casiers rendus reviennent dans le parc vide");
}

#[tokio::test]
async fn returning_more_than_held_rolls_back_the_whole_order() {
    let db = fresh_db("rollback").await;
    let fx = seed(&db).await;

    // Le client détient 5 casiers, il en prétend 9.
    let err = auth::with_actor(
        owner(),
        orders::create_order(
            &db,
            order_input(
                &fx,
                Some(vec![ReturnedEmptyInput {
                    packaging_asset_id: fx.asset_id,
                    quantity: 9,
                }]),
            ),
        ),
    )
    .await;
    assert!(
        err.is_err(),
        "un retour supérieur au solde détenu doit être refusé"
    );

    let orders_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        orders_count, 0,
        "la commande entière est annulée : pas de commande avec une déduction ratée"
    );
}

#[tokio::test]
async fn no_returned_empties_keeps_the_previous_behaviour() {
    let db = fresh_db("none").await;
    let fx = seed(&db).await;
    make_issue(&db, &fx, 2).await;

    auth::with_actor(owner(), orders::create_order(&db, order_input(&fx, None)))
        .await
        .unwrap();

    let returned: i64 = sqlx::query_scalar("SELECT returned_pieces FROM deposit_issues")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(returned, 0, "sans retour saisi, rien n'est soldé");

    let held: i64 = sqlx::query_scalar(
        "SELECT quantity_held FROM customer_deposit_balances WHERE customer_id = ?",
    )
    .bind(fx.client_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(held, 5, "le solde détenu est intact");
}
