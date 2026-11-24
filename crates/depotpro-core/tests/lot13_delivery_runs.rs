//! Tests du socle des tournees de livraison (Lot 13).
//!
//! Ce que ces tests protegent :
//! - le role `driver` est le seul a pouvoir etre designe comme livreur ;
//! - les montants attendus sont figes au chargement et ne bougent plus ;
//! - les transitions de statut sont gardees et idempotentes ;
//! - une tournee ne peut pas livrer la commande d'un autre client ;
//! - une tournee revenue ne peut plus etre annulee.

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::delivery_runs::{
    self, AddStopInput, CreateRunInput,
};
use depotpro_core::infrastructure::db::DepotDb;

fn owner() -> SessionIdentity {
    SessionIdentity::from_role("lot13-owner", "lot13", "Propriétaire Lot 13", Role::Owner)
}

fn cashier() -> SessionIdentity {
    SessionIdentity::from_role("lot13-cashier", "lot13", "Caissier Lot 13", Role::Cashier)
}

async fn fresh_db(tag: &str) -> DepotDb {
    let path = std::env::temp_dir().join(format!(
        "depotpro_lot13_{tag}_{}.db",
        uuid::Uuid::new_v4()
    ));
    DepotDb::connect(&path).await.expect("connect")
}

/// Cree deux clients et deux livreurs, renvoie (client_a, client_b, driver1, driver2).
async fn seed(db: &DepotDb) -> (i64, i64, i64, i64) {
    let (_g, mut tx) = db.begin_write().await.unwrap();
    for (code, name) in [("CLI-A", "Maquis A"), ("CLI-B", "Maquis B")] {
        sqlx::query("INSERT INTO clients (code, name, client_type) VALUES (?, ?, 'professionnel')")
            .bind(code)
            .bind(name)
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    let client_a: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-A'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let client_b: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-B'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();

    for (username, role) in [("chauffeur1", "driver"), ("chauffeur2", "driver")] {
        sqlx::query("INSERT INTO users (username, display_name, role, pin_hash) VALUES (?, ?, ?, 'x')")
            .bind(username)
            .bind(username)
            .bind(role)
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    // Un caissier, pour verifier qu'il ne peut PAS etre livreur.
    sqlx::query("INSERT INTO users (username, display_name, role, pin_hash) VALUES ('caissier','Caissier','cashier','x')")
        .execute(&mut *tx)
        .await
        .unwrap();

    let d1: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = 'chauffeur1'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let d2: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = 'chauffeur2'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    (client_a, client_b, d1, d2)
}

#[tokio::test]
async fn run_can_only_be_assigned_to_a_driver() {
    let db = fresh_db("driver_role").await;
    let (_a, _b, d1, _d2) = seed(&db).await;
    let cashier_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = 'caissier'")
        .fetch_one(&db.pool)
        .await
        .unwrap();

    // Un livreur valide : accepte.
    let ok = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: d1,
                vehicle_label: Some("Triporteur 1".into()),
                request_key: Some("k-driver-ok".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();
    assert_eq!(ok.status, "draft");
    assert_eq!(ok.driver_name, "chauffeur1");
    assert!(ok.reference.starts_with("TRN-"));

    // Un caissier designe comme livreur : refuse.
    let err = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: cashier_id,
                vehicle_label: None,
                request_key: Some("k-driver-bad".into()),
                notes: None,
            },
        ),
    )
    .await;
    assert!(err.is_err(), "un caissier ne peut pas être livreur");
}

#[tokio::test]
async fn create_run_is_idempotent_on_request_key() {
    let db = fresh_db("idempotent").await;
    let (_a, _b, d1, _d2) = seed(&db).await;

    let make = |key: &str| CreateRunInput {
        run_date: "2026-11-23".into(),
        driver_user_id: d1,
        vehicle_label: None,
        request_key: Some(key.to_string()),
        notes: None,
    };

    let first = auth::with_actor(owner(), delivery_runs::create_run(&db, make("same-key")))
        .await
        .unwrap();
    let second = auth::with_actor(owner(), delivery_runs::create_run(&db, make("same-key")))
        .await
        .unwrap();

    assert_eq!(first.id, second.id, "rejouer la requête ne crée pas de doublon");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM delivery_runs")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn stop_cannot_target_another_clients_order() {
    let db = fresh_db("stop_owner").await;
    let (client_a, client_b, d1, _d2) = seed(&db).await;

    // Une commande de client B.
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query(
        "INSERT INTO orders (order_number, customer_id, order_type, status,
            subtotal_xof, discount_xof, total_xof, total_to_collect_xof, paid_xof)
         VALUES ('ORD-B-1', ?, 'mixte', 'confirmed', 1000, 0, 1000, 1000, 0)",
    )
    .bind(client_b)
    .execute(&mut *tx)
    .await
    .unwrap();
    let order_b: i64 = sqlx::query_scalar("SELECT id FROM orders WHERE order_number = 'ORD-B-1'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: d1,
                vehicle_label: None,
                request_key: Some("k-owner-check".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();

    // Arret sur le client A avec la commande du client B : refuse.
    let err = auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            &db,
            run.id,
            AddStopInput {
                client_id: client_a,
                order_id: Some(order_b),
                sequence: None,
            },
        ),
    )
    .await;
    assert!(
        err.is_err(),
        "une tournée ne doit pas livrer la commande d'un autre client"
    );
}

#[tokio::test]
async fn load_freezes_expected_amounts_and_status_flow_is_guarded() {
    let db = fresh_db("freeze").await;
    let (client_a, _b, d1, _d2) = seed(&db).await;

    // Une commande de 10 600 F dont 6 000 deja payes -> attendu 4 600.
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query(
        "INSERT INTO orders (order_number, customer_id, order_type, status,
            subtotal_xof, discount_xof, total_xof, total_to_collect_xof, paid_xof)
         VALUES ('ORD-A-1', ?, 'mixte', 'confirmed', 9600, 0, 9600, 10600, 6000)",
    )
    .bind(client_a)
    .execute(&mut *tx)
    .await
    .unwrap();
    let order_a: i64 = sqlx::query_scalar("SELECT id FROM orders WHERE order_number = 'ORD-A-1'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: d1,
                vehicle_label: None,
                request_key: Some("k-freeze".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();

    // Charger sans arret : refuse.
    let empty = auth::with_actor(owner(), delivery_runs::load_run(&db, run.id)).await;
    assert!(empty.is_err(), "une tournée vide ne peut pas être chargée");

    auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            &db,
            run.id,
            AddStopInput {
                client_id: client_a,
                order_id: Some(order_a),
                sequence: None,
            },
        ),
    )
    .await
    .unwrap();

    let loaded = auth::with_actor(owner(), delivery_runs::load_run(&db, run.id))
        .await
        .unwrap();
    assert_eq!(loaded.run.status, "loaded");
    assert_eq!(loaded.stops.len(), 1);
    assert_eq!(loaded.stops[0].expected_amount, 4600, "reste à payer figé");
    assert_eq!(loaded.run.planned_stops, 1);

    // Le snapshot ne bouge plus : on modifie la commande APRES chargement.
    sqlx::query("UPDATE orders SET paid_xof = 0 WHERE id = ?")
        .bind(order_a)
        .execute(&db.pool)
        .await
        .unwrap();
    let reloaded = auth::with_actor(owner(), delivery_runs::load_run(&db, run.id))
        .await
        .unwrap();
    assert_eq!(
        reloaded.stops[0].expected_amount, 4600,
        "recharger ne doit PAS refiger le snapshot"
    );

    // Depart : loaded -> in_progress.
    let started = auth::with_actor(owner(), delivery_runs::start_run(&db, run.id))
        .await
        .unwrap();
    assert_eq!(started.status, "in_progress");

    // Un arret ne peut plus etre ajoute apres le depart.
    let late_stop = auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            &db,
            run.id,
            AddStopInput {
                client_id: client_a,
                order_id: None,
                sequence: None,
            },
        ),
    )
    .await;
    assert!(late_stop.is_err(), "plus d'arrêt après le départ");
}

#[tokio::test]
async fn cancel_is_refused_once_the_run_has_returned() {
    let db = fresh_db("cancel_guard").await;
    let (client_a, _b, d1, _d2) = seed(&db).await;

    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: d1,
                vehicle_label: None,
                request_key: Some("k-cancel".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();

    // Annulation possible depuis draft.
    let cancelled = auth::with_actor(owner(), delivery_runs::cancel_run(&db, run.id, None))
        .await
        .unwrap();
    assert_eq!(cancelled.status, "cancelled");

    // Idempotent : annuler deux fois ne change rien.
    let again = auth::with_actor(owner(), delivery_runs::cancel_run(&db, run.id, None))
        .await
        .unwrap();
    assert_eq!(again.status, "cancelled");

    // Une tournee au statut returned ne peut plus etre annulee.
    let run2 = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-24".into(),
                driver_user_id: d1,
                vehicle_label: None,
                request_key: Some("k-cancel2".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE delivery_runs SET status = 'returned' WHERE id = ?")
        .bind(run2.id)
        .execute(&db.pool)
        .await
        .unwrap();
    let refused = auth::with_actor(owner(), delivery_runs::cancel_run(&db, run2.id, None)).await;
    assert!(
        refused.is_err(),
        "une tournée revenue porte des constats : elle ne s'annule pas"
    );

    // Un caissier a DeliveryRunsRead + Reconcile, mais pas Manage.
    let cashier_denied = auth::with_actor(
        cashier(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: d1,
                vehicle_label: None,
                request_key: Some("k-cashier".into()),
                notes: None,
            },
        ),
    )
    .await;
    assert!(
        cashier_denied.is_err(),
        "un caissier ne peut pas créer de tournée (pas DeliveryRunsManage)"
    );
}

#[tokio::test]
async fn expected_empty_pieces_follow_open_deposit_issues() {
    let db = fresh_db("empty_pieces").await;
    let (client_a, _b, d1, _d2) = seed(&db).await;

    // Deux consignes ouvertes de 3 et 2 casiers -> 5 vides attendus.
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query(
        "INSERT INTO returnable_packaging_types (code, name, producer, kind, deposit_value)
         VALUES ('EMB-L13', 'Casier L13', 'SOLIBRA', 'crate', 1000)",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    let rid: i64 = sqlx::query_scalar("SELECT id FROM returnable_packaging_types WHERE code = 'EMB-L13'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO sales (reference, request_key, sale_type, subtotal_merchandise,
            total_merchandise, total_amount) VALUES ('VTE-L13','rk-l13','cash',12000,12000,12000)",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    let sale_id: i64 = sqlx::query_scalar("SELECT id FROM sales WHERE reference = 'VTE-L13'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    for (pieces, status) in [(3, "pending"), (2, "partially_returned")] {
        sqlx::query(
            "INSERT INTO deposit_issues (sale_id, sale_line_id, client_id, returnable_id,
                pieces, unit_value, amount, status)
             VALUES (?, NULL, ?, ?, ?, 1000, ?, ?)",
        )
        .bind(sale_id)
        .bind(client_a)
        .bind(rid)
        .bind(pieces)
        .bind(pieces * 1000)
        .bind(status)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();

    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: d1,
                vehicle_label: None,
                request_key: Some("k-empty".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();
    auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            &db,
            run.id,
            AddStopInput {
                client_id: client_a,
                order_id: None,
                sequence: None,
            },
        ),
    )
    .await
    .unwrap();

    let loaded = auth::with_actor(owner(), delivery_runs::load_run(&db, run.id))
        .await
        .unwrap();
    assert_eq!(
        loaded.stops[0].expected_empty_pieces, 5,
        "3 + 2 casiers ouverts = 5 vides attendus"
    );
    assert_eq!(loaded.stops[0].expected_amount, 0, "pas de commande liée");
}
