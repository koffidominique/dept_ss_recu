//! L'argent en transit, visible sans être compté en caisse (Lot 19).
//!
//! Ce que ces tests protègent :
//! - le déclaré d'une tournée en cours apparaît dans l'état de caisse ;
//! - il n'entre PAS dans le théorique du tiroir (c'est le point le plus
//!   important : compter deux fois le même argent est pire que ne pas le voir) ;
//! - une tournée rentrée ou réconciliée disparaît du transit ;
//! - un arrêt en échec ne compte pas dans l'attendu ;
//! - l'écran se calcule même sans session de caisse ouverte.

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::cash;
use depotpro_core::application::delivery_reconciliation::{
    self, DeclareCollectionInput, RecordStopOutcomeInput,
};
use depotpro_core::application::delivery_runs::{self, AddStopInput, CreateRunInput};
use depotpro_core::infrastructure::db::DepotDb;

fn owner() -> SessionIdentity {
    SessionIdentity::from_role("lot19-owner", "lot19", "Propriétaire Lot 19", Role::Owner)
}

fn driver() -> SessionIdentity {
    SessionIdentity::from_role("lot19-driver", "lot19d", "Chauffeur Lot 19", Role::Driver)
}

async fn fresh_db(tag: &str) -> DepotDb {
    let path =
        std::env::temp_dir().join(format!("depotpro_lot19_{tag}_{}.db", uuid::Uuid::new_v4()));
    DepotDb::connect(&path).await.expect("connect")
}

/// Un client, un livreur. Renvoie (client_id, driver_id).
async fn seed(db: &DepotDb) -> (i64, i64) {
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query("INSERT INTO clients (code, name) VALUES ('CLI-T', 'Maquis Transit')")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO users (username, display_name, role, pin_hash) \
         VALUES ('chauffeur19','Chauffeur Transit','driver','x')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    let client_id: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-T'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let driver_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = 'chauffeur19'")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    (client_id, driver_id)
}

/// Une commande portant un reste à payer.
///
/// Reprend le seed du Lot 14 à la lettre : `orders` n'a ni `reference` ni
/// `client_id` (c'est `order_number` et `customer_id`), et **aucune colonne
/// `sale_id`**. Inventer le schéma ici produirait un test qui échoue à la
/// compilation sqlx au lieu de tester ce qu'il prétend.
async fn make_order(db: &DepotDb, client_id: i64, number: &str, to_collect: i64) -> i64 {
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query(
        "INSERT INTO orders (order_number, customer_id, order_type, status,
            subtotal_xof, discount_xof, total_xof, total_to_collect_xof, paid_xof)
         VALUES (?, ?, 'mixte', 'confirmed', 10000, 0, 10000, ?, 0)",
    )
    .bind(number)
    .bind(client_id)
    .bind(to_collect)
    .execute(&mut *tx)
    .await
    .unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM orders WHERE order_number = ?")
        .bind(number)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    id
}

/// Tournée chargée et partie, avec un arrêt. Renvoie (run_id, stop_id).
async fn started_run(
    db: &DepotDb,
    client_id: i64,
    driver_id: i64,
    to_collect: i64,
    tag: &str,
) -> (i64, i64) {
    let order_id = make_order(db, client_id, &format!("ORD-T-{tag}"), to_collect).await;
    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            db,
            CreateRunInput {
                run_date: "2026-11-24".into(),
                driver_user_id: driver_id,
                vehicle_label: None,
                request_key: Some(format!("k19-{tag}")),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();
    let detail = auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            db,
            run.id,
            AddStopInput {
                client_id,
                order_id: Some(order_id),
                sequence: None,
            },
        ),
    )
    .await
    .unwrap();
    let stop_id = detail.stops[0].id;
    auth::with_actor(owner(), delivery_runs::load_run(db, run.id))
        .await
        .unwrap();
    auth::with_actor(owner(), delivery_runs::start_run(db, run.id))
        .await
        .unwrap();
    (run.id, stop_id)
}

/// Constate l'arrêt comme livré.
///
/// Le flux réel est : le gérant constate (arrêt -> `delivered`), puis le
/// livreur déclare ce qu'il a encaissé. Déclarer sans constat laisse l'arrêt
/// `planned`, et un arrêt `planned` ne compte pas dans l'attendu.
async fn mark_delivered(db: &DepotDb, run_id: i64, stop_id: i64) {
    auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            db,
            run_id,
            RecordStopOutcomeInput {
                stop_id,
                status: "delivered".into(),
                failure_reason: None,
            },
        ),
    )
    .await
    .unwrap();
}

async fn declare(db: &DepotDb, run_id: i64, stop_id: i64, amount: i64) {
    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount,
            },
        ),
    )
    .await
    .unwrap();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn declared_money_shows_up_in_transit() {
    let db = fresh_db("show").await;
    let (client_id, driver_id) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_id, driver_id, 4_600, "show").await;

    mark_delivered(&db, run_id, stop_id).await;
    declare(&db, run_id, stop_id, 4_600).await;

    let status = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    assert_eq!(
        status.runs_in_transit.len(),
        1,
        "une tournée est sur la route"
    );
    let line = &status.runs_in_transit[0];
    assert_eq!(line.run_id, run_id);
    assert_eq!(line.declared_amount, 4_600);
    assert_eq!(line.expected_amount, 4_600);
    assert_eq!(line.status, "in_progress");
}

#[tokio::test]
async fn transit_money_never_enters_the_theoretical_cash() {
    // Le point central. Compter deux fois le même argent est pire que ne pas le
    // voir : le tiroir serait faux chaque soir, dans le sens flatteur.
    let db = fresh_db("theorique").await;
    let (client_id, driver_id) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_id, driver_id, 4_600, "theorique").await;

    auth::with_actor(
        owner(),
        cash::open_cash_session(
            &db,
            cash::OpenCashInput {
                opening_cash: 100_000,
                request_key: "open19-theorique".into(),
            },
        ),
    )
    .await
    .unwrap();

    let before = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    let theoretical_before = before.summary.as_ref().map(|s| s.theoretical_cash).unwrap();

    mark_delivered(&db, run_id, stop_id).await;
    declare(&db, run_id, stop_id, 4_600).await;

    let after = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    let theoretical_after = after.summary.as_ref().map(|s| s.theoretical_cash).unwrap();

    assert_eq!(
        theoretical_before, theoretical_after,
        "déclarer n'est pas encaisser : le théorique ne doit pas bouger d'un franc"
    );
    assert_eq!(after.runs_in_transit[0].declared_amount, 4_600);
}

#[tokio::test]
async fn a_returned_run_leaves_the_transit_list() {
    // Dès que la tournée rentre, ce n'est plus de l'argent en circulation :
    // il est dans le dépôt, en attente de comptage. Il sort donc du transit
    // (et n'entre pas encore en caisse : c'est la réconciliation qui décide).
    let db = fresh_db("retour").await;
    let (client_id, driver_id) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_id, driver_id, 4_600, "retour").await;
    mark_delivered(&db, run_id, stop_id).await;
    declare(&db, run_id, stop_id, 4_600).await;

    auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            &db,
            run_id,
            RecordStopOutcomeInput {
                stop_id,
                status: "delivered".into(),
                failure_reason: None,
            },
        ),
    )
    .await
    .unwrap();
    auth::with_actor(owner(), delivery_reconciliation::return_run(&db, run_id))
        .await
        .unwrap();

    let status = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    assert!(
        status.runs_in_transit.is_empty(),
        "une tournée rentrée n'est plus en transit"
    );
}

#[tokio::test]
async fn a_failed_stop_counts_in_neither_expected_nor_declared() {
    let db = fresh_db("echec").await;
    let (client_id, driver_id) = seed(&db).await;

    // Le deuxième arrêt doit être ajouté AVANT le départ : `add_stop` refuse
    // une tournée `in_progress` (« ses arrêts ne peuvent plus être modifiés »).
    // Une tournée se prépare, puis part — on ne la modifie pas en route.
    let order_a = make_order(&db, client_id, "ORD-T-ECHEC-A", 4_600).await;
    let order_b = make_order(&db, client_id, "ORD-T-ECHEC-B", 2_400).await;
    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-24".into(),
                driver_user_id: driver_id,
                vehicle_label: None,
                request_key: Some("k19-echec".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();
    for order_id in [order_a, order_b] {
        auth::with_actor(
            owner(),
            delivery_runs::add_stop(
                &db,
                run.id,
                AddStopInput {
                    client_id,
                    order_id: Some(order_id),
                    sequence: None,
                },
            ),
        )
        .await
        .unwrap();
    }
    let detail = auth::with_actor(owner(), delivery_runs::load_run(&db, run.id))
        .await
        .unwrap();
    let run_id = run.id;
    let stop_a = detail.stops[0].id;
    let stop_b = detail.stops[1].id;
    auth::with_actor(owner(), delivery_runs::start_run(&db, run_id))
        .await
        .unwrap();

    mark_delivered(&db, run_id, stop_a).await;
    declare(&db, run_id, stop_a, 4_600).await;
    auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            &db,
            run_id,
            RecordStopOutcomeInput {
                stop_id: stop_b,
                status: "failed".into(),
                failure_reason: Some("Rideau fermé".into()),
            },
        ),
    )
    .await
    .unwrap();

    let status = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    let line = &status.runs_in_transit[0];
    assert_eq!(
        line.expected_amount, 4_600,
        "l'arrêt en échec n'attend rien"
    );
    assert_eq!(line.declared_amount, 4_600);
    assert_eq!(line.declared_stops, 1);
    assert_eq!(
        line.planned_stops, 2,
        "mais il reste un arrêt prévu sur deux"
    );
}

#[tokio::test]
async fn transit_is_readable_without_an_open_cash_session() {
    // Une tournée peut partir avant que le tiroir ne soit ouvert. Le gérant
    // doit quand même pouvoir voir ce qui circule.
    let db = fresh_db("sanssession").await;
    let (client_id, driver_id) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_id, driver_id, 4_600, "sanssession").await;
    mark_delivered(&db, run_id, stop_id).await;
    declare(&db, run_id, stop_id, 4_600).await;

    let status = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    assert!(status.active_session.is_none(), "aucune session ouverte");
    assert_eq!(status.runs_in_transit.len(), 1);
    assert_eq!(status.runs_in_transit[0].declared_amount, 4_600);
}

#[tokio::test]
async fn a_draft_or_loaded_run_is_not_in_transit() {
    // L'argent ne circule qu'une fois la tournée partie. Une tournée préparée
    // ne doit pas apparaître : elle n'a encore rien encaissé.
    let db = fresh_db("brouillon").await;
    let (client_id, driver_id) = seed(&db).await;
    let order_id = make_order(&db, client_id, "ORD-T-BROUILLON", 4_600).await;
    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-24".into(),
                driver_user_id: driver_id,
                vehicle_label: None,
                request_key: Some("k19-brouillon".into()),
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
                client_id,
                order_id: Some(order_id),
                sequence: None,
            },
        ),
    )
    .await
    .unwrap();
    auth::with_actor(owner(), delivery_runs::load_run(&db, run.id))
        .await
        .unwrap();

    let status = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    assert!(
        status.runs_in_transit.is_empty(),
        "une tournée chargée mais pas partie n'est pas en transit"
    );
}
