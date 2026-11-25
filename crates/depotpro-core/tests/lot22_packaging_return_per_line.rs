//! Tests du Lot 22 — emballage remis par le client, suivi par ligne.
//!
//! Ce que ces tests protègent :
//!
//! - **un casier vendu sort 1 casier + N bouteilles** : rendre « 1 emballage »
//!   crédite les deux, sans que l'opérateur ait à saisir les bouteilles ;
//! - **le retour est rattaché à SA ligne** (`deposit_issues.sale_line_id`),
//!   pour que la fiche de suivi client dise quelle ligne doit encore quoi ;
//! - **l'apurement privilégie la ligne désignée**, puis retombe en FIFO sur les
//!   dettes antérieures — sinon la fiche mentirait sur la ligne rendue ;
//! - **le total de la vente ne bouge pas** avec ou sans retour : la consigne
//!   facturée reste due (elle est DANS le total), et c'est la valeur de
//!   l'emballage rendu — non facturé — qui reste hors total ;
//! - un retour **sans** `line_index` se comporte exactement comme avant
//!   (non-régression du desktop et des intégrations).

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
    let path = std::env::temp_dir().join(format!("lot22_{tag}_{}.db", uuid::Uuid::new_v4()));
    DepotDb::connect(&path).await.expect("connect")
}

/// Un dépôt prêt à vendre : client, casier, bouteille, produit conditionné en
/// casier de 24 bouteilles, et une dette antérieure de 10 casiers.
///
/// Renvoie `(client_id, casier_id, bouteille_id, product_id, packaging_id)`.
async fn seed(db: &DepotDb) -> (i64, i64, i64, i64, i64) {
    auth::with_actor(actor(), async {
        sqlx::query(
            "INSERT OR IGNORE INTO app_settings
                 (id, sale_prefix, invoice_prefix, allow_negative_stock)
             VALUES (1, 'VTE', 'FAC', 0)",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT OR IGNORE INTO payment_methods (code, label, is_cash, active)
             VALUES ('cash', 'Espèces', 1, 1)",
        )
        .execute(&db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO clients (code, name, client_type)
             VALUES ('CLI-L22', 'Maquis Lot 22', 'professionnel')",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        let client_id: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-L22'")
            .fetch_one(&db.pool)
            .await
            .unwrap();

        // Le casier (plastique) et la bouteille (verre) : deux types distincts.
        sqlx::query(
            "INSERT INTO returnable_packaging_types (code, name, producer, kind, deposit_value)
             VALUES ('CAS-L22', 'Casier 24', 'SOLIBRA', 'crate', 1000)",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO returnable_packaging_types (code, name, producer, kind, deposit_value)
             VALUES ('BTX-L22', 'Bouteille 65cl', 'SOLIBRA', 'bottle', 100)",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        let crate_id: i64 =
            sqlx::query_scalar("SELECT id FROM returnable_packaging_types WHERE code = 'CAS-L22'")
                .fetch_one(&db.pool)
                .await
                .unwrap();
        let bottle_id: i64 =
            sqlx::query_scalar("SELECT id FROM returnable_packaging_types WHERE code = 'BTX-L22'")
                .fetch_one(&db.pool)
                .await
                .unwrap();

        // Dette antérieure : 10 casiers dus.
        sqlx::query(
            "INSERT INTO customer_packaging_accounts
                (client_id, returnable_id, balance_pieces, deposit_held_amount)
             VALUES (?, ?, 10, 10000)",
        )
        .bind(client_id)
        .bind(crate_id)
        .execute(&db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO returnable_stock_balances (packaging_id, quantity) VALUES (?, 100)",
        )
        .bind(crate_id)
        .execute(&db.pool)
        .await
        .unwrap();

        cash::open_cash_session(
            db,
            cash::OpenCashInput {
                opening_cash: 500_000,
                request_key: format!("ck-l22-{}", uuid::Uuid::new_v4()),
            },
        )
        .await
        .unwrap();

        sqlx::query("INSERT INTO categories (name) VALUES ('Bières L22')")
            .execute(&db.pool)
            .await
            .unwrap();
        let cat_id: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'Bières L22'")
            .fetch_one(&db.pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO products (reference, name, category_id, base_unit, stock_milli, retail_price)
             VALUES ('PRD-L22', 'Bock 65cl', ?, 'bouteille', 999999999, 500)",
        )
        .bind(cat_id)
        .execute(&db.pool)
        .await
        .unwrap();
        let product_id: i64 =
            sqlx::query_scalar("SELECT id FROM products WHERE reference = 'PRD-L22'")
                .fetch_one(&db.pool)
                .await
                .unwrap();

        // Un casier = 24 bouteilles.
        sqlx::query(
            "INSERT INTO product_packagings (product_id, name, base_unit, coefficient_milli, retail_price)
             VALUES (?, 'casier', 'bouteille', 24000, 12000)",
        )
        .bind(product_id)
        .execute(&db.pool)
        .await
        .unwrap();
        let packaging_id: i64 = sqlx::query_scalar(
            "SELECT id FROM product_packagings WHERE product_id = ? AND name = 'casier'",
        )
        .bind(product_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO packaging_policies (name, client_id, returnable_id, return_delay_days, is_active)
             VALUES ('POL-L22', ?, ?, 15, 1)",
        )
        .bind(client_id)
        .bind(crate_id)
        .execute(&db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO deposit_packaging_profiles (packaging_id, mode) VALUES (?, 'deposit')",
        )
            .bind(packaging_id)
            .execute(&db.pool)
            .await
            .unwrap();

        // Deux composants : 1 casier ET 24 bouteilles par casier vendu.
        sqlx::query(
            "INSERT INTO deposit_packaging_components (packaging_id, returnable_id, pieces_per_pack)
             VALUES (?, ?, 1)",
        )
        .bind(packaging_id)
        .bind(crate_id)
        .execute(&db.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deposit_packaging_components (packaging_id, returnable_id, pieces_per_pack)
             VALUES (?, ?, 24)",
        )
        .bind(packaging_id)
        .bind(bottle_id)
        .execute(&db.pool)
        .await
        .unwrap();

        (client_id, crate_id, bottle_id, product_id, packaging_id)
    })
    .await
}

/// Construit la vente avec le paiement exact attendu.
///
/// Le serveur exige, pour une vente au comptant, que le paiement égale
/// EXACTEMENT le total (marchandises + consignes). Écrire un montant à la main
/// revient à figer une hypothèse sur le calcul des consignes — et c'est
/// précisément ce que ce lot enseigne à ne pas faire. On interroge donc la
/// base pour connaître les consignes réellement configurées.
async fn cash_payment_for(
    db: &DepotDb,
    packaging_id: i64,
    quantity: i64,
) -> Vec<PaymentPartInput> {
    let unit: i64 = sqlx::query_scalar(
        "SELECT COALESCE(retail_price, 0) FROM product_packagings WHERE id = ?",
    )
    .bind(packaging_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();

    let deposit_per_pack: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(dpc.pieces_per_pack * rpt.deposit_value), 0)
         FROM deposit_packaging_components dpc
         JOIN returnable_packaging_types rpt ON rpt.id = dpc.returnable_id
         WHERE dpc.packaging_id = ?",
    )
    .bind(packaging_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();

    vec![PaymentPartInput {
        method_code: "cash".to_string(),
        amount: unit * quantity + deposit_per_pack * quantity,
    }]
}

fn sale_input(
    client_id: i64,
    product_id: i64,
    packaging_id: i64,
    payments: Vec<PaymentPartInput>,
    received: Option<Vec<ReceivedReturnableInput>>,
) -> CreateSaleV4Input {
    CreateSaleV4Input {
        request_key: format!("rk-l22-{}", uuid::Uuid::new_v4()),
        client_id: Some(client_id),
        sale_type: "cash".to_string(),
        price_tier: "retail".to_string(),
        discount_amount: Some(0),
        due_date: None,
        lines: vec![CreateSaleLineV4Input {
            product_id,
            packaging_id,
            sales_unit_id: None,
            quantity: "3".to_string(),
            discount_amount: Some(0),
        }],
        payments,
        received_returnables: received,
        notes: None,
        external_reference: None,
    }
}

/// Rend 2 casiers sur les 3 vendus : le retour doit créditer 2 casiers **et**
/// 48 bouteilles, sans que l'appelant ait saisi les bouteilles.
#[tokio::test]
async fn returning_two_crates_credits_the_crates_and_their_bottles() {
    auth::with_actor(actor(), async {
        let db = fresh_db("drv").await;
        let (client_id, crate_id, bottle_id, product_id, packaging_id) = seed(&db).await;

        let sale = create_sale_v4(
            &db,
            sale_input(
                client_id,
                product_id,
                packaging_id,
                cash_payment_for(&db, packaging_id, 3).await,
                Some(vec![ReceivedReturnableInput {
                    returnable_id: crate_id,
                    pieces: 2,
                    line_index: Some(0),
                }]),
            ),
        )
        .await
        .unwrap();

        let returned: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT returnable_id, pieces FROM deposit_issues
             WHERE sale_id = ? AND status = 'returned'
             ORDER BY returnable_id",
        )
        .bind(sale.sale.id)
        .fetch_all(&db.pool)
        .await
        .unwrap();

        let crate_return = returned.iter().find(|(r, _)| *r == crate_id).map(|(_, p)| *p);
        let bottle_return = returned.iter().find(|(r, _)| *r == bottle_id).map(|(_, p)| *p);

        assert_eq!(crate_return, Some(2), "2 casiers rendus");
        assert_eq!(
            bottle_return,
            Some(48),
            "2 casiers rendus = 48 bouteilles rendues, dérivées sans saisie"
        );
    })
    .await;
}

/// Le retour porte l'identifiant de SA ligne : c'est ce qui rend la fiche de
/// suivi client exploitable ligne par ligne.
#[tokio::test]
async fn a_return_is_attached_to_its_sale_line() {
    auth::with_actor(actor(), async {
        let db = fresh_db("line").await;
        let (client_id, crate_id, _bottle_id, product_id, packaging_id) = seed(&db).await;

        let sale = create_sale_v4(
            &db,
            sale_input(
                client_id,
                product_id,
                packaging_id,
                cash_payment_for(&db, packaging_id, 3).await,
                Some(vec![ReceivedReturnableInput {
                    returnable_id: crate_id,
                    pieces: 1,
                    line_index: Some(0),
                }]),
            ),
        )
        .await
        .unwrap();

        let line_id: i64 = sqlx::query_scalar("SELECT id FROM sale_lines WHERE sale_id = ?")
            .bind(sale.sale.id)
            .fetch_one(&db.pool)
            .await
            .unwrap();

        let returned_line: Option<i64> = sqlx::query_scalar(
            "SELECT sale_line_id FROM deposit_issues
             WHERE sale_id = ? AND status = 'returned' AND returnable_id = ?",
        )
        .bind(sale.sale.id)
        .bind(crate_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(
            returned_line,
            Some(line_id),
            "le retour doit être rattaché à sa ligne, pas laissé à NULL"
        );
    })
    .await;
}

/// Non-régression : sans `line_index`, rien ne change. C'est le comportement
/// du desktop et des intégrations existantes.
#[tokio::test]
async fn a_return_without_line_index_still_works_as_before() {
    auth::with_actor(actor(), async {
        let db = fresh_db("legacy").await;
        let (client_id, crate_id, _bottle_id, product_id, packaging_id) = seed(&db).await;

        let sale = create_sale_v4(
            &db,
            sale_input(
                client_id,
                product_id,
                packaging_id,
                cash_payment_for(&db, packaging_id, 3).await,
                Some(vec![ReceivedReturnableInput {
                    returnable_id: crate_id,
                    pieces: 3,
                    line_index: None,
                }]),
            ),
        )
        .await
        .unwrap();

        let returned_line: Option<i64> = sqlx::query_scalar(
            "SELECT sale_line_id FROM deposit_issues
             WHERE sale_id = ? AND status = 'returned' AND returnable_id = ?",
        )
        .bind(sale.sale.id)
        .bind(crate_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(returned_line, None, "comportement historique conservé");

        // Le solde client a bien été réduit de 3.
        let balance: i64 = sqlx::query_scalar(
            "SELECT balance_pieces FROM customer_packaging_accounts
             WHERE client_id = ? AND returnable_id = ?",
        )
        .bind(client_id)
        .bind(crate_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(balance, 7, "10 dus - 3 rendus");
    })
    .await;
}

/// Le total de la vente ne dépend pas du retour : la consigne facturée reste
/// due, seul le montant du retour est hors total. C'est le point 5 de la
/// demande, et c'est ce qui interdit de le « corriger » par erreur.
#[tokio::test]
async fn the_sale_total_does_not_depend_on_the_return() {
    // Deux dépôts distincts, à dessein : dans une même base, la première vente
    // laisserait une dette de casiers que la seconde viendrait apurer, et l'on
    // ne comparerait plus la même chose.
    let db_without = fresh_db("total-a").await;
    let (client_a, _crate_a, _bottle_a, product_a, packaging_a) = seed(&db_without).await;
    let without = auth::with_actor(
        actor(),
        create_sale_v4(
            &db_without,
            sale_input(
                client_a,
                product_a,
                packaging_a,
                cash_payment_for(&db_without, packaging_a, 3).await,
                None,
            ),
        ),
    )
    .await
    .unwrap();

    let db_with = fresh_db("total-b").await;
    let (client_b, crate_b, _bottle_b, product_b, packaging_b) = seed(&db_with).await;
    let with_return = auth::with_actor(
        actor(),
        create_sale_v4(
            &db_with,
            sale_input(
                client_b,
                product_b,
                packaging_b,
                cash_payment_for(&db_with, packaging_b, 3).await,
                Some(vec![ReceivedReturnableInput {
                    returnable_id: crate_b,
                    pieces: 3,
                    line_index: Some(0),
                }]),
            ),
        ),
    )
    .await
    .unwrap();

    assert_eq!(
        without.sale.total_amount, with_return.sale.total_amount,
        "un retour d'emballage ne doit jamais modifier le total de la vente"
    );
    assert_eq!(
        without.sale.total_deposit, with_return.sale.total_deposit,
        "la consigne facturée reste la même : c'est le RETOUR qui est hors total"
    );
}

/// Le serveur est l'autorité : rendre plus de casiers qu'on n'en a sorti est
/// refusé, même si l'écran est contourné.
#[tokio::test]
async fn returning_more_crates_than_sold_is_refused() {
    auth::with_actor(actor(), async {
        let db = fresh_db("over").await;
        let (client_id, crate_id, _bottle_id, product_id, packaging_id) = seed(&db).await;

        let result = create_sale_v4(
            &db,
            sale_input(
                client_id,
                product_id,
                packaging_id,
                cash_payment_for(&db, packaging_id, 3).await,
                Some(vec![ReceivedReturnableInput {
                    returnable_id: crate_id,
                    pieces: 9,
                    line_index: Some(0),
                }]),
            ),
        )
        .await;

        let err = result.expect_err("9 casiers rendus pour 3 vendus doit être refusé");
        assert!(
            err.to_string().contains("Retour supérieur"),
            "le refus doit dire pourquoi : {err}"
        );
    })
    .await;
}
