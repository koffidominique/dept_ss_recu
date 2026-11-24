// ============================================================================
// Tests d'intégration : Commandes clientèle mixtes & allocations d'emballages
// Couvre les cas 1 à 7 du §6.4 ainsi que le cycle de vie complet & consignes
// ============================================================================

use std::path::PathBuf;

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::{orders, pdf, products, sales};
use depotpro_core::infrastructure::db::DepotDb;

fn temp_db_path(tag: &str) -> PathBuf {
    std::env::temp_dir()
        .join(format!(
            "depotpro_orders_mixed_{tag}_{}",
            uuid::Uuid::new_v4()
        ))
        .join("depotpro.db")
}

#[allow(clippy::too_many_arguments)]
async fn make_beverage_variant(
    db: &DepotDb,
    cat_id: i64,
    name: &str,
    sku: &str,
    volume_ml: i64,
    container_type: &str,
    unit_price: i64,
    initial_stock_units: &str,
) -> (i64, i64) {
    let created = products::create_product_v4(
        db,
        products::CreateProductInput {
            name: name.to_string(),
            brand: Some(name.to_string()),
            barcode: None,
            category_id: cat_id,
            supplier_id: None,
            description: None,
            base_unit: "bouteille".to_string(),
            initial_stock: Some(initial_stock_units.to_string()),
            min_stock: Some("0".to_string()),
            max_stock: Some("0".to_string()),
            purchase_price: Some(unit_price - 100),
            wholesale_price: Some(unit_price),
            semi_wholesale_price: Some(unit_price),
            retail_price: Some(unit_price),
            image_path: None,
            packagings: Some(vec![products::PackagingInput {
                id: None,
                name: "bouteille".to_string(),
                coefficient: "1".to_string(),
                purchase_price: Some(unit_price - 100),
                wholesale_price: Some(unit_price),
                semi_wholesale_price: Some(unit_price),
                retail_price: Some(unit_price),
                barcode: None,
                allow_fraction: Some(false),
                is_active: Some(true),
                deposit_mode: Some("none".to_string()),
                components: None,
            }]),
        },
        products::ProductV4CreateExtras {
            sku: Some(sku.to_string()),
            variant: Some(products::InitialVariantInput {
                name: Some(format!("{name} {volume_ml}ml")),
                sku: Some(format!("{sku}-VAR")),
                barcode: None,
                container_type_id: None,
                container_type: Some(container_type.to_string()),
                volume_ml,
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
    let var_id = created.variant_id.expect("variant_id créé");
    (created.id, var_id)
}

#[tokio::test]
async fn orders_mixed_cases_1_to_7_and_lifecycle() {
    let db = DepotDb::connect(&temp_db_path("cases")).await.unwrap();
    // confirm_order enregistre l'approbation directe du proprietaire : sans
    // session identifiee l'operation echoue volontairement (echec ferme).
    // Cet acteur ne sert qu'a l'approbation ; le nom fige dans les recus
    // reste celui de l'emetteur explicite (`actor`, plus bas).
    // C'est deliver_order qui emet le recu v1, avec l'acteur courant : cet
    // acteur doit donc porter l'identite attendue par l'assertion plus bas
    // (issued_by_name = "Test proprietaire"), sinon le nom fige serait faux.
    let approver = SessionIdentity::from_role(
        "receipt-test-user",
        "receipt-test",
        "Test propriétaire",
        Role::Owner,
    );
    sqlx::query("INSERT OR IGNORE INTO payment_methods (code, label, is_cash, active) VALUES ('cash', 'Espèces', 1, 1)")
            .execute(&db.pool)
            .await
            .unwrap();
    let cat = products::create_category(&db, "Bières Mixtes", None)
        .await
        .unwrap();

    let (bock_id, bock_var) = make_beverage_variant(
        &db,
        cat.id,
        "Bock 33cl",
        "BOCK-GL-330",
        330,
        "glass_returnable",
        400,
        "200",
    )
    .await;
    let (_drogba_id, drogba_var) = make_beverage_variant(
        &db,
        cat.id,
        "Drogba 33cl",
        "DROGBA-GL-330",
        330,
        "glass_returnable",
        400,
        "200",
    )
    .await;
    let (_guinness_id, guinness_var) = make_beverage_variant(
        &db,
        cat.id,
        "Guinness 33cl",
        "GUIN-GL-330",
        330,
        "glass_returnable",
        600,
        "200",
    )
    .await;
    let (_valpierre_id, valpierre_var) = make_beverage_variant(
        &db,
        cat.id,
        "Valpierre 50cl",
        "VALP-GL-500",
        500,
        "glass_returnable",
        500,
        "200",
    )
    .await;

    let client = sales::create_client(
        &db,
        sales::CreateClientInput {
            name: "Maquis Abidjan".to_string(),
            client_type: "professionnel".to_string(),
            phone: Some("0707070707".to_string()),
            address: None,
            city: Some("Abidjan".to_string()),
            email: None,
            contact_person: None,
            credit_policy: "limited".to_string(),
            credit_limit: Some(500_000),
            payment_terms_days: Some(15),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Cas 1 : 12 Bock 33cl + 12 Drogba 33cl -> 1 casier 24x33cl, consigne 1x1000, 2 lignes
    let c1 = orders::compose_preview(
        &db,
        orders::ComposePreviewInput {
            lines: vec![
                orders::OrderLineInput {
                    variant_id: bock_var,
                    requested_unit: "half_crate".into(),
                    requested_quantity: 1,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
                orders::OrderLineInput {
                    variant_id: drogba_var,
                    requested_unit: "half_crate".into(),
                    requested_quantity: 1,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
            ],
            discount_xof: None,
            tax_xof: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(c1.lines.len(), 2);
    assert_eq!(c1.allocations.len(), 1);
    assert_eq!(c1.allocations[0].quantity, 1);
    assert_eq!(c1.allocations[0].capacity, 24);
    assert_eq!(c1.totals.subtotal_xof, 9600);
    assert_eq!(c1.totals.deposit_total_xof, 1000);
    assert_eq!(c1.totals.total_xof, 9600);
    assert_eq!(c1.totals.total_to_collect_xof, 10600);

    // Cas 2 : 24 Bock 33cl -> 1 casier 24x33cl, consigne 1000, 1 ligne
    let c2 = orders::compose_preview(
        &db,
        orders::ComposePreviewInput {
            lines: vec![orders::OrderLineInput {
                variant_id: bock_var,
                requested_unit: "crate".into(),
                requested_quantity: 1,
                unit_price_xof: Some(400),
                discount_xof: None,
                notes: None,
            }],
            discount_xof: None,
            tax_xof: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(c2.allocations.len(), 1);
    assert_eq!(c2.allocations[0].quantity, 1);
    assert_eq!(c2.totals.deposit_total_xof, 1000);

    // Cas 3 : 6 Bock 33cl + 6 Drogba 33cl -> 1 casier partiel (warning), consigne 1000
    let c3 = orders::compose_preview(
        &db,
        orders::ComposePreviewInput {
            lines: vec![
                orders::OrderLineInput {
                    variant_id: bock_var,
                    requested_unit: "unit".into(),
                    requested_quantity: 6,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
                orders::OrderLineInput {
                    variant_id: drogba_var,
                    requested_unit: "unit".into(),
                    requested_quantity: 6,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
            ],
            discount_xof: None,
            tax_xof: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(c3.allocations.len(), 1);
    assert_eq!(c3.allocations[0].quantity, 1);
    assert_eq!(c3.totals.deposit_total_xof, 1000);
    assert!(!c3.warnings.is_empty());

    // Cas 4 : 12 Bock 33cl + 12 Valpierre 50cl -> 1 casier 24x33cl (partiel) + 1 casier 12x50cl
    let c4 = orders::compose_preview(
        &db,
        orders::ComposePreviewInput {
            lines: vec![
                orders::OrderLineInput {
                    variant_id: bock_var,
                    requested_unit: "unit".into(),
                    requested_quantity: 12,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
                orders::OrderLineInput {
                    variant_id: valpierre_var,
                    requested_unit: "unit".into(),
                    requested_quantity: 12,
                    unit_price_xof: Some(500),
                    discount_xof: None,
                    notes: None,
                },
            ],
            discount_xof: None,
            tax_xof: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(c4.allocations.len(), 2);
    assert_eq!(c4.totals.deposit_total_xof, 2000);

    // Cas 5 : 30 Bock 33cl -> 1 casier plein + 1 casier partiel (6 >= 6) avec warning
    let c5 = orders::compose_preview(
        &db,
        orders::ComposePreviewInput {
            lines: vec![orders::OrderLineInput {
                variant_id: bock_var,
                requested_unit: "unit".into(),
                requested_quantity: 30,
                unit_price_xof: Some(400),
                discount_xof: None,
                notes: None,
            }],
            discount_xof: None,
            tax_xof: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(c5.allocations[0].quantity, 2);
    assert!(!c5.warnings.is_empty());

    // Cas 6 : 12 Bock + 12 Drogba + 6 Guinness -> 2 casiers 24x33cl (30 btl / 48 slots), 3 lignes
    let c6 = orders::compose_preview(
        &db,
        orders::ComposePreviewInput {
            lines: vec![
                orders::OrderLineInput {
                    variant_id: bock_var,
                    requested_unit: "unit".into(),
                    requested_quantity: 12,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
                orders::OrderLineInput {
                    variant_id: drogba_var,
                    requested_unit: "unit".into(),
                    requested_quantity: 12,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
                orders::OrderLineInput {
                    variant_id: guinness_var,
                    requested_unit: "unit".into(),
                    requested_quantity: 6,
                    unit_price_xof: Some(600),
                    discount_xof: None,
                    notes: None,
                },
            ],
            discount_xof: None,
            tax_xof: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(c6.lines.len(), 3);
    assert_eq!(c6.allocations.len(), 1);
    assert_eq!(c6.allocations[0].quantity, 2);
    assert_eq!(c6.totals.deposit_total_xof, 2000);

    // Cas 7 + cycle complet sur Cas 1 (create -> confirm -> deliver -> return 1 casier)
    let created = orders::create_order(
        &db,
        orders::CreateOrderInput {
            customer_id: client.id,
            order_type: Some("mixte".into()),
            payment_method: Some("cash".into()),
            discount_xof: None,
            tax_xof: None,
            delivery_date: None,
            delivery_address: None,
            notes: Some("Casier mixte Bock + Drogba".into()),
            allow_price_override: None,
            lines: vec![
                orders::OrderLineInput {
                    variant_id: bock_var,
                    requested_unit: "half_crate".into(),
                    requested_quantity: 1,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
                orders::OrderLineInput {
                    variant_id: drogba_var,
                    requested_unit: "half_crate".into(),
                    requested_quantity: 1,
                    unit_price_xof: Some(400),
                    discount_xof: None,
                    notes: None,
                },
            ],
            allocations: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(created.order.status, "draft");
    let draft_receipt_actor = SessionIdentity::from_role(
        "draft-receipt-user",
        "draft-receipt",
        "Test propriétaire",
        Role::Owner,
    );
    let draft_receipt = auth::with_actor(
        draft_receipt_actor,
        orders::issue_or_get_customer_order_receipt(&db, created.order.id),
    )
    .await;
    assert!(
        draft_receipt.is_err(),
        "un brouillon ne doit pas émettre de reçu"
    );
    assert_eq!(created.lines.len(), 2);
    assert_eq!(created.allocations.len(), 1);
    assert_eq!(created.links.len(), 2);
    let linked_sum: i64 = created.links.iter().map(|l| l.units_in_packaging).sum();
    assert_eq!(linked_sum, 24);
    assert_eq!(created.order.total_xof, 9600);
    assert_eq!(created.order.deposit_due_xof, 1000);
    assert_eq!(created.order.total_to_collect_xof, 10600);

    // En draft : aucun mouvement de stock ou solde consigne
    let deps_draft = orders::get_customer_deposits(&db, client.id).await.unwrap();
    assert!(deps_draft.is_empty());

    // Le catalogue seedé ne renseigne pas returnable_id, et une base neuve n'a
    // aucun consignable (test d'architecture). C'est deliver_order qui rattache
    // l'actif à la volée : on vérifie donc l'état AVANT, puis le résultat.
    let asset_id_for_link = created.allocations[0].packaging_asset_id;
    let linked_before: Option<i64> =
        sqlx::query_scalar("SELECT returnable_id FROM packaging_assets WHERE id = ?")
            .bind(asset_id_for_link)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(
        linked_before.is_none(),
        "l'actif seedé n'est pas rattaché avant la première livraison"
    );

    // Confirm : décrémente le stock en unités de base (200 -> 188), sans créer d'achat fournisseur.
    let confirmed = auth::with_actor(
        approver.clone(),
        orders::confirm_order(&db, created.order.id),
    )
    .await
    .unwrap();
    assert_eq!(confirmed.order.status, "confirmed");
    let supplier_orders: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM purchase_orders")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        supplier_orders, 0,
        "confirmer une commande client ne doit pas créer de bon fournisseur"
    );
    let bock_stock: i64 = sqlx::query_scalar("SELECT stock_milli FROM products WHERE id = ?")
        .bind(bock_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(bock_stock, 188_000);

    // Deliver : crée mouvement LIVRAISON_CLIENT & incrémente customer_deposit_balances
    let delivered = auth::with_actor(
        approver.clone(),
        orders::deliver_order(&db, created.order.id),
    )
    .await
    .unwrap();
    assert_eq!(delivered.order.status, "delivered");
    assert_eq!(delivered.customer_deposits.len(), 1);
    assert_eq!(delivered.customer_deposits[0].quantity_held, 1);
    assert_eq!(delivered.customer_deposits[0].amount_held_xof, 1000);



    // Retour d'1 casier vide -> décrémente solde consigné & incrémente stock_empty
    let asset_id = created.allocations[0].packaging_asset_id;
    let after_ret = orders::return_order_packaging(
        &db,
        created.order.id,
        orders::OrderReturnInput {
            packaging_asset_id: asset_id,
            quantity: 1,
            notes: Some("Casier rendu".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(after_ret.customer_deposits[0].quantity_held, 0);
    assert_eq!(after_ret.customer_deposits[0].amount_held_xof, 0);

    let ret_hist = orders::get_customer_deposit_history(&db, client.id)
        .await
        .unwrap();
    assert!(ret_hist
        .iter()
        .any(|m| m.movement_type == "LIVRAISON_CLIENT"));
    assert!(ret_hist.iter().any(|m| m.movement_type == "RETOUR_CLIENT"));

    let stock_empty: i64 =
        sqlx::query_scalar("SELECT stock_empty FROM packaging_assets WHERE id = ?")
            .bind(asset_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(stock_empty, 1);

    // Facturer une commande client crée une vente client, jamais un bon fournisseur.
    let invoice_order = orders::create_order(
        &db,
        orders::CreateOrderInput {
            customer_id: client.id,
            order_type: Some("vente".into()),
            payment_method: Some("cash".into()),
            discount_xof: None,
            tax_xof: None,
            delivery_date: None,
            delivery_address: None,
            notes: Some("Commande client test de séparation".into()),
            allow_price_override: None,
            lines: vec![orders::OrderLineInput {
                variant_id: bock_var,
                requested_unit: "unit".into(),
                requested_quantity: 1,
                unit_price_xof: Some(400),
                discount_xof: None,
                notes: None,
            }],
            allocations: Some(vec![]),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    auth::with_actor(
        approver.clone(),
        orders::confirm_order(&db, invoice_order.order.id),
    )
    .await
    .unwrap();
    sqlx::query(
        "UPDATE orders SET paid_xof = total_to_collect_xof, payment_status = 'paid' WHERE id = ?",
    )
    .bind(invoice_order.order.id)
    .execute(&db.pool)
    .await
    .unwrap();
    let invoiced = auth::with_actor(
        approver.clone(),
        orders::invoice_order(&db, invoice_order.order.id),
    )
    .await
    .unwrap();
    assert_eq!(invoiced.order.status, "paid");
    let (sales_count, supplier_order_count): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM sales WHERE order_id = ?), (SELECT COUNT(*) FROM purchase_orders)",
        )
        .bind(invoice_order.order.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(sales_count, 1);
    assert_eq!(supplier_order_count, 0);
    let sale_reference: String =
        sqlx::query_scalar("SELECT reference FROM sales WHERE order_id = ?")
            .bind(invoice_order.order.id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(sale_reference.starts_with("VTE-"));

    // Le reçu est émis depuis la commande livrée, figé en base et idempotent à la réimpression.
    let actor = approver.clone();
    let payments_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE order_id = ?")
            .bind(created.order.id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let first_receipt = auth::with_actor(
        actor.clone(),
        orders::issue_or_get_customer_order_receipt(&db, created.order.id),
    )
    .await
    .unwrap();
    assert_eq!(first_receipt.version, 1);
    assert_eq!(
        first_receipt.receipt_number,
        format!("REC-{}", created.order.order_number)
    );
    assert!(first_receipt.snapshot_json.contains("Test propriétaire"));

    // Une modification métier ultérieure ne remplace pas silencieusement le reçu émis.
    sqlx::query("UPDATE clients SET name = 'Nom client modifié après émission' WHERE id = ?")
        .bind(client.id)
        .execute(&db.pool)
        .await
        .unwrap();
    let second_receipt = auth::with_actor(
        actor,
        orders::issue_or_get_customer_order_receipt(&db, created.order.id),
    )
    .await
    .unwrap();
    assert_eq!(first_receipt.id, second_receipt.id);
    assert_eq!(first_receipt.snapshot_json, second_receipt.snapshot_json);
    assert!(second_receipt.snapshot_json.contains(&client.name));
    let payments_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE order_id = ?")
            .bind(created.order.id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        payments_before, payments_after,
        "l'émission ne crée aucun paiement"
    );

    // Les données poussées par le navigateur ne peuvent pas falsifier le PDF du reçu.
    let pdf_actor = SessionIdentity::from_role(
        "pdf-test-user",
        "pdf-test",
        "Test propriétaire",
        Role::Owner,
    );
    let (_pdf_name, receipt_pdf) = auth::with_actor(
        pdf_actor,
        pdf::generate_document_pdf(
            &db,
            pdf::DocumentPdfInput {
                doc_type: "REÇU DE COMMANDE".into(),
                reference: first_receipt.receipt_number.clone(),
                order_reference: None,
                date: "2000-01-01".into(),
                status_label: None,
                party_title: None,
                party_name: Some("CLIENT FORGE".into()),
                party_details: None,
                party_phone: None,
                secondary_party_title: None,
                secondary_party_name: None,
                secondary_party_details: None,
                delivery_date: None,
                cashier_name: Some("CAISSIER FORGÉ".into()),
                planned_payment_method: None,
                company_logo_jpeg: None,
                lines: vec![pdf::DocumentPdfLine {
                    label: "PRODUIT FORGE".into(),
                    sublabel: None,
                    quantity: "999".into(),
                    discount: None,
                    unit_price: Some(1),
                    total: Some(1),
                    ..Default::default()
                }],
                packaging_lines: vec![],
                summary_rows: vec![pdf::DocumentPdfSummaryRow {
                    label: "TOTAL FORGÉ".into(),
                    value: "1 FCFA".into(),
                    bold: true,
                    tone: None,
                }],
                payments: None,
                notes: None,
                ..Default::default()
            },
        ),
    )
    .await
    .unwrap();
    let receipt_pdf_text = String::from_utf8_lossy(&receipt_pdf);
    assert!(receipt_pdf_text.contains("Bock"));
    assert!(receipt_pdf_text.contains("Maquis Abidjan"));
    assert!(!receipt_pdf_text.contains("PRODUIT FORGE"));
    assert!(!receipt_pdf_text.contains("CLIENT FORGE"));
}

// ============================================================================
// Lot 9c : la consigne d'une commande nait dans deposit_issues
//
// Le catalogue d'emballages seede par la migration 0019 ne renseigne pas
// packaging_assets.returnable_id, donc deliver_order ne peut creer aucune
// consigne. La migration 0026 relie les actifs existants aux consignables, et
// deliver_order refuse desormais explicitement un actif non rattache.
//
// Ce test couvre l'ordre correct du parcours : la consigne n'est ecrite que si
// la commande est deja facturee (existing_sale_id), il faut donc facturer
// AVANT de livrer pour que la dette d'emballages soit tracee.
// ============================================================================
#[tokio::test]
async fn order_consignment_is_traced_in_deposit_issues_when_invoiced_then_delivered() {
    let db = DepotDb::connect(&temp_db_path("lot9c_deposit_issues"))
        .await
        .unwrap();
    let approver = SessionIdentity::from_role(
        "lot9c-owner",
        "lot9c",
        "Propriétaire Lot 9c",
        Role::Owner,
    );

    // Base neuve : aucun consignable, l'actif 24x33 n'est pas rattache.
    let asset_id: i64 =
        sqlx::query_scalar("SELECT id FROM packaging_assets WHERE code = 'PA-CASIER-24X33'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let linked_before: Option<i64> =
        sqlx::query_scalar("SELECT returnable_id FROM packaging_assets WHERE id = ?")
            .bind(asset_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(linked_before.is_none(), "aucun consignable sur une base neuve");
    // stock_empty suffisant pour allouer un casier
    sqlx::query("UPDATE packaging_assets SET stock_empty = 10 WHERE id = ?")
        .bind(asset_id)
        .execute(&db.pool)
        .await
        .unwrap();

    let cat = products::create_category(&db, "Bières Lot 9c", None)
        .await
        .unwrap();
    let cat_id = cat.id;
    let (bock_var, _) = make_beverage_variant(
        &db,
        cat_id,
        "Bock Lot 9c",
        "SKU-LOT9C",
        330,
        "glass_returnable",
        400,
        "200",
    )
    .await;

    let client = sales::create_client(
        &db,
        sales::CreateClientInput {
            name: "Client Lot 9c".to_string(),
            client_type: "professionnel".to_string(),
            phone: None,
            address: None,
            city: Some("Abidjan".to_string()),
            email: None,
            contact_person: None,
            credit_policy: "limited".to_string(),
            credit_limit: Some(500_000),
            payment_terms_days: Some(15),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let created = orders::create_order(
        &db,
        orders::CreateOrderInput {
            customer_id: client.id,
            order_type: Some("mixte".into()),
            payment_method: Some("cash".into()),
            lines: vec![orders::OrderLineInput {
                variant_id: bock_var,
                requested_unit: "crate".into(),
                requested_quantity: 1,
                unit_price_xof: Some(400),
                discount_xof: None,
                notes: None,
            }],
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(created.allocations.len(), 1, "un casier doit être alloué");

    auth::with_actor(
        approver.clone(),
        orders::confirm_order(&db, created.order.id),
    )
    .await
    .unwrap();

    // Facturer AVANT livrer : sinon deliver_order ne trouve aucune vente et
    // la consigne ne serait pas ecrite.
    sqlx::query("UPDATE orders SET paid_xof = total_to_collect_xof, payment_status = 'paid' WHERE id = ?")
        .bind(created.order.id)
        .execute(&db.pool)
        .await
        .unwrap();
    auth::with_actor(
        approver.clone(),
        orders::invoice_order(&db, created.order.id),
    )
    .await
    .unwrap();

    auth::with_actor(approver.clone(), orders::deliver_order(&db, created.order.id))
        .await
        .unwrap();

    // deliver_order a cree le consignable manquant ET rattache l'actif
    let returnable_id: i64 =
        sqlx::query_scalar("SELECT returnable_id FROM packaging_assets WHERE id = ?")
            .bind(asset_id)
            .fetch_one(&db.pool)
            .await
            .expect("deliver_order doit rattacher l'actif à un consignable");
    assert!(
        sqlx::query_scalar::<_, String>(
            "SELECT code FROM returnable_packaging_types WHERE id = ?"
        )
        .bind(returnable_id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
        .starts_with("EMB-AUTO-"),
        "le consignable doit être déduit de l'actif"
    );

    // La consigne existe dans deposit_issues : c'est elle qui porte les
    // echeances, conversions et pertes. Avant le correctif, elle n'existait pas.
    let row: (i64, i64, i64, i64, String) = sqlx::query_as(
        "SELECT pieces, returned_pieces, unit_value, amount, status
         FROM deposit_issues WHERE client_id = ? AND returnable_id = ?",
    )
    .bind(client.id)
    .bind(returnable_id)
    .fetch_one(&db.pool)
    .await
    .expect("deliver_order doit créer une consigne dans deposit_issues");
    assert_eq!(row.0, 1, "1 casier consigné");
    assert_eq!(row.1, 0, "aucun retour à la livraison");
    assert_eq!(row.2, 1000, "valeur unitaire figée");
    assert_eq!(row.3, 1000, "montant consigné");
    assert_eq!(row.4, "pending");

    // Une echeance exploitable est posee : sans elle, aucune conversion ni
    // signalement de retard n'est possible.
    let due: Option<String> = sqlx::query_scalar(
        "SELECT due_date FROM deposit_issues WHERE client_id = ? AND returnable_id = ?",
    )
    .bind(client.id)
    .bind(returnable_id)
    .fetch_optional(&db.pool)
    .await
    .unwrap()
    .flatten();
    assert!(due.is_some(), "une échéance doit être posée");
    assert!(!due.unwrap().is_empty());

    // La politique appliquee est celle du depot, pas une retombee en dur.
    let policy_delay: i64 = sqlx::query_scalar(
        "SELECT return_delay_days FROM packaging_policies
         WHERE returnable_id IS NULL AND client_id IS NULL",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        policy_delay, 15,
        "la politique globale doit être alignée à 15 jours (migration 0026)"
    );
}
