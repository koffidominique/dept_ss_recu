//! Tests métier du retour d'emballages reçus lors d'une nouvelle vente (received_returnables).
//! Couvre la persistance dans create_persistence.rs : réduction du compte client,
//! mise à jour du stock sous-dépôt, création des deposit_issues en statut 'returned'.

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::cash;
use depotpro_core::application::sales::{
    create_sale_v4, CreateSaleLineV4Input, CreateSaleV4Input, PaymentPartInput,
    ReceivedReturnableInput,
};
use depotpro_core::infrastructure::db::DepotDb;

fn actor() -> SessionIdentity {
    SessionIdentity::from_role("1", "owner", "Propriétaire", Role::Owner)
}

async fn fresh_db(tag: &str) -> DepotDb {
    let path = std::env::temp_dir().join(format!("sale_ret_{tag}_{}.db", uuid::Uuid::new_v4()));
    DepotDb::connect(&path).await.expect("connect")
}

async fn seed_full(db: &DepotDb) -> (i64, i64, i64, i64) {
    auth::with_actor(actor(), async {
        // App settings (required by create_sale_v4)
        sqlx::query(
            "INSERT OR IGNORE INTO app_settings (id, sale_prefix, invoice_prefix, allow_negative_stock)
             VALUES (1, 'VTE', 'FAC', 0)",
        )
        .execute(&db.pool).await.unwrap();

        // Payment methods
        sqlx::query("INSERT OR IGNORE INTO payment_methods (code, label, is_cash, active) VALUES ('cash', 'Espèces', 1, 1)")
            .execute(&db.pool).await.unwrap();

        // Client avec solde emballage préexistant
        sqlx::query("INSERT INTO clients (code, name, client_type) VALUES ('CLI-RET', 'Client Retour', 'particulier')")
            .execute(&db.pool).await.unwrap();
        let client_id: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-RET'")
            .fetch_one(&db.pool).await.unwrap();

        // Type d'emballage (casier)
        sqlx::query(
            "INSERT INTO returnable_packaging_types (code, name, producer, kind, description, deposit_value)
             VALUES ('EMB-RET', 'Casier Retour', 'SOLIBRA', 'crate', 'Casier de retour', 3600)",
        )
        .execute(&db.pool).await.unwrap();
        let rid: i64 = sqlx::query_scalar("SELECT id FROM returnable_packaging_types WHERE code = 'EMB-RET'")
            .fetch_one(&db.pool).await.unwrap();

        // Solde client : 10 casiers dus
        sqlx::query(
            "INSERT INTO customer_packaging_accounts (client_id, returnable_id, balance_pieces, deposit_held_amount)
             VALUES (?, ?, 10, 36000)",
        )
        .bind(client_id).bind(rid).execute(&db.pool).await.unwrap();

        // Stock sous-dépôt initial : 100 casiers vides
        sqlx::query("INSERT INTO returnable_stock_balances (packaging_id, quantity) VALUES (?, 100)")
            .bind(rid).execute(&db.pool).await.unwrap();

        // Cash session (required by create_sale_v4)
        cash::open_cash_session(
            db,
            cash::OpenCashInput {
                opening_cash: 200_000,
                request_key: format!("ck-seed-{}", uuid::Uuid::new_v4()),
            },
        )
        .await
        .unwrap();

        // Catégorie + produit avec prix de vente
        sqlx::query("INSERT INTO categories (name) VALUES ('Bières ret')")
            .execute(&db.pool).await.unwrap();
        let cat_id: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'Bières ret'")
            .fetch_one(&db.pool).await.unwrap();

        sqlx::query(
            "INSERT INTO products (reference, name, category_id, base_unit, stock_milli, retail_price)
             VALUES ('PROD-RET', 'Bière Retour', ?, 'bouteille', 999999999, 12000)",
        )
        .bind(cat_id).execute(&db.pool).await.unwrap();
        let product_id: i64 = sqlx::query_scalar("SELECT id FROM products WHERE reference = 'PROD-RET'")
            .fetch_one(&db.pool).await.unwrap();
        let (stock_after,): (i64,) = sqlx::query_as("SELECT stock_milli FROM products WHERE id = ?")
            .bind(product_id).fetch_one(&db.pool).await.unwrap();
        eprintln!("DEBUG: product_id={}, stock_milli={}", product_id, stock_after);

        sqlx::query(
            "INSERT INTO product_packagings (product_id, name, base_unit, coefficient_milli, retail_price)
             VALUES (?, 'casier', 'bouteille', 24000, 12000)",
        )
        .bind(product_id).execute(&db.pool).await.unwrap();
        let packaging_id: i64 = sqlx::query_scalar(
            "SELECT id FROM product_packagings WHERE product_id = ? AND name = 'casier'",
        )
        .bind(product_id).fetch_one(&db.pool).await.unwrap();

        // Politique d'emballage
        sqlx::query(
            "INSERT INTO packaging_policies (name, client_id, returnable_id, return_delay_days, is_active)
             VALUES ('POL-RET', ?, ?, 30, 1)",
        )
        .bind(client_id).bind(rid).execute(&db.pool).await.unwrap();

        // Profil de consigne pour le casier
        sqlx::query(
            "INSERT INTO deposit_packaging_profiles (packaging_id, mode) VALUES (?, 'deposit')",
        )
        .bind(packaging_id).execute(&db.pool).await.unwrap();

        // Composant d'emballage : 1 casier = 1 unité de retourable (casier vide)
        sqlx::query(
            "INSERT INTO deposit_packaging_components (packaging_id, returnable_id, pieces_per_pack)
             VALUES (?, ?, 1)",
        )
        .bind(packaging_id).bind(rid).execute(&db.pool).await.unwrap();

        (client_id, rid, product_id, packaging_id)
    }).await
}

async fn make_sale_input(client_id: i64, product_id: i64, packaging_id: i64, received: Vec<ReceivedReturnableInput>) -> CreateSaleV4Input {
    CreateSaleV4Input {
        request_key: format!("rk-sale-ret-{}", uuid::Uuid::new_v4()),
        client_id: Some(client_id),
        sale_type: "cash".to_string(),
        price_tier: "retail".to_string(),
        discount_amount: Some(0),
        due_date: None,
        lines: vec![CreateSaleLineV4Input {
            product_id,
            packaging_id,
            sales_unit_id: None,
            quantity: "1".to_string(),
            discount_amount: Some(0),
        }],
        payments: vec![PaymentPartInput {
            method_code: "cash".to_string(),
            amount: 15600,
        }],
        received_returnables: Some(received),
        notes: None,
        external_reference: None,
    }
}

#[tokio::test]
async fn test_receive_returnables_reduces_client_balance() {
    // Retour de 3 casiers : le solde client passe de 10 à 7.
    auth::with_actor(actor(), async {
        let db = fresh_db("reduce").await;
        let (client_id, rid, product_id, packaging_id) = seed_full(&db).await;

        let input = make_sale_input(client_id, product_id, packaging_id, vec![ReceivedReturnableInput {
            returnable_id: rid,
            pieces: 3,
        }]).await;

    let sale = create_sale_v4(&db, input).await;
    match &sale {
        Ok(s) => assert!(s.sale.id > 0, "Vente créée"),
        Err(e) => panic!("create_sale_v4 failed: {:?}", e),
    }

        let bal: i64 = sqlx::query_scalar(
            "SELECT balance_pieces FROM customer_packaging_accounts WHERE client_id = ? AND returnable_id = ?",
        )
        .bind(client_id).bind(rid)
        .fetch_one(&db.pool).await.unwrap();
        assert_eq!(bal, 8, "Solde client: 10 + 1 (dépôt vente) - 3 (retour) = 8");
    }).await;
}

#[tokio::test]
async fn test_receive_returnables_increases_depot_stock() {
    // Retour de 3 casiers : le stock sous-dépôt passe de 100 à 103.
    auth::with_actor(actor(), async {
        let db = fresh_db("stock").await;
        let (client_id, rid, product_id, packaging_id) = seed_full(&db).await;

        let input = make_sale_input(client_id, product_id, packaging_id, vec![ReceivedReturnableInput {
            returnable_id: rid,
            pieces: 3,
        }]).await;

        create_sale_v4(&db, input).await.unwrap();

        let stock: i64 = sqlx::query_scalar(
            "SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?",
        )
        .bind(rid).fetch_one(&db.pool).await.unwrap();
        assert_eq!(stock, 103, "Stock sous-dépôt augmenté de 100 à 103");

        // Vérifier le mouvement de stock
        let mv_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM returnable_stock_movements WHERE packaging_id = ? AND movement_type = 'entry'",
        )
        .bind(rid).fetch_one(&db.pool).await.unwrap();
        assert_eq!(mv_count, 1, "Un mouvement d'entrée créé");
    }).await;
}

#[tokio::test]
async fn test_receive_returnables_creates_deposit_issue_returned() {
    // Retour de 3 casiers : un deposit_issues en statut 'returned' est créé.
    auth::with_actor(actor(), async {
        let db = fresh_db("issue").await;
        let (client_id, rid, product_id, packaging_id) = seed_full(&db).await;

        let input = make_sale_input(client_id, product_id, packaging_id, vec![ReceivedReturnableInput {
            returnable_id: rid,
            pieces: 3,
        }]).await;

        create_sale_v4(&db, input).await.unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM deposit_issues WHERE client_id = ? AND returnable_id = ? AND status = 'returned'",
        )
        .bind(client_id).bind(rid).fetch_one(&db.pool).await.unwrap();
        assert_eq!(count, 1, "Un deposit_issues en statut 'returned' créé");

        let pieces: i64 = sqlx::query_scalar(
            "SELECT pieces FROM deposit_issues WHERE client_id = ? AND returnable_id = ? AND status = 'returned'",
        )
        .bind(client_id).bind(rid).fetch_one(&db.pool).await.unwrap();
        assert_eq!(pieces, 3, "3 pièces retournées enregistrées");
    }).await;
}

#[tokio::test]
async fn test_insufficient_balance_returns_error() {
    // Tentative de retourner 15 casiers alors que le solde est de 10 : doit échouer.
    auth::with_actor(actor(), async {
        let db = fresh_db("insuff").await;
        let (client_id, rid, product_id, packaging_id) = seed_full(&db).await;

        let input = make_sale_input(client_id, product_id, packaging_id, vec![ReceivedReturnableInput {
            returnable_id: rid,
            pieces: 15,
        }]).await;

        let err = create_sale_v4(&db, input).await.unwrap_err();
        assert!(err.to_string().contains("Solde insuffisant"), "Erreur solde insuffisant attendue");
    }).await;
}

#[tokio::test]
async fn test_zero_pieces_is_ignored() {
    // Retour de 0 pièces : rien ne change, pas d'erreur.
    auth::with_actor(actor(), async {
        let db = fresh_db("zero").await;
        let (client_id, rid, product_id, packaging_id) = seed_full(&db).await;

        let input = make_sale_input(client_id, product_id, packaging_id, vec![ReceivedReturnableInput {
            returnable_id: rid,
            pieces: 0,
        }]).await;

        let sale = create_sale_v4(&db, input).await.unwrap();
        assert!(sale.sale.id > 0, "Vente créée même avec 0 retour");

        let bal: i64 = sqlx::query_scalar(
            "SELECT balance_pieces FROM customer_packaging_accounts WHERE client_id = ? AND returnable_id = ?",
        )
        .bind(client_id).bind(rid).fetch_one(&db.pool).await.unwrap();
        assert_eq!(bal, 11, "Solde: 10 + 1 (dépôt vente), retour 0 ignoré");

        let stock: i64 = sqlx::query_scalar(
            "SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?",
        )
        .bind(rid).fetch_one(&db.pool).await.unwrap();
        assert_eq!(stock, 100, "Stock inchangé (100)");
    }).await;
}

#[tokio::test]
async fn test_multiple_returnables() {
    // Retour de deux types d'emballages différents en une seule vente.
    auth::with_actor(actor(), async {
        let db = fresh_db("multi").await;
        let (client_id, rid1, product_id, packaging_id) = seed_full(&db).await;

        // Ajouter un second type d'emballage avec solde client
        sqlx::query(
            "INSERT INTO returnable_packaging_types (code, name, producer, kind, description, deposit_value)
             VALUES ('EMB-RET2', 'Bouteille Retour', 'SOLIBRA', 'bottle', 'Bouteille de retour', 500)",
        )
        .execute(&db.pool).await.unwrap();
        let rid2: i64 = sqlx::query_scalar("SELECT id FROM returnable_packaging_types WHERE code = 'EMB-RET2'")
            .fetch_one(&db.pool).await.unwrap();

        sqlx::query(
            "INSERT INTO customer_packaging_accounts (client_id, returnable_id, balance_pieces, deposit_held_amount)
             VALUES (?, ?, 5, 2500)",
        )
        .bind(client_id).bind(rid2).execute(&db.pool).await.unwrap();

        sqlx::query("INSERT INTO returnable_stock_balances (packaging_id, quantity) VALUES (?, 50)")
            .bind(rid2).execute(&db.pool).await.unwrap();

        let input = make_sale_input(client_id, product_id, packaging_id, vec![
            ReceivedReturnableInput { returnable_id: rid1, pieces: 3 },
            ReceivedReturnableInput { returnable_id: rid2, pieces: 2 },
        ]).await;

        create_sale_v4(&db, input).await.unwrap();

        let bal1: i64 = sqlx::query_scalar(
            "SELECT balance_pieces FROM customer_packaging_accounts WHERE client_id = ? AND returnable_id = ?",
        )
        .bind(client_id).bind(rid1).fetch_one(&db.pool).await.unwrap();
        assert_eq!(bal1, 8, "Solde casier: 10 + 1 (dépôt vente) - 3 (retour) = 8");

        let bal2: i64 = sqlx::query_scalar(
            "SELECT balance_pieces FROM customer_packaging_accounts WHERE client_id = ? AND returnable_id = ?",
        )
        .bind(client_id).bind(rid2).fetch_one(&db.pool).await.unwrap();
        assert_eq!(bal2, 3, "Solde bouteille: 5 - 2 = 3");

        let stock1: i64 = sqlx::query_scalar("SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?")
            .bind(rid1).fetch_one(&db.pool).await.unwrap();
        assert_eq!(stock1, 103, "Stock casier: 100 + 3 = 103");

        let stock2: i64 = sqlx::query_scalar("SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?")
            .bind(rid2).fetch_one(&db.pool).await.unwrap();
        assert_eq!(stock2, 52, "Stock bouteille: 50 + 2 = 52");
    }).await;
}
