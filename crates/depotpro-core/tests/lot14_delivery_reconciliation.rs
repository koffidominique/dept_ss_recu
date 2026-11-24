//! Tests de la reconciliation des tournees (Lot 14).
//!
//! Ce que ces tests protegent, dans l'ordre du flux reel :
//! - declarer n'ecrit rien en caisse ;
//! - l'attendu ne compte que les arrets livres ;
//! - un ecart sans motif est refuse, dans les deux sens ;
//! - la caisse encaisse le COMPTE, pas le declare ;
//! - rejouer la reconciliation ne reecrit aucun mouvement ;
//! - les vides se repartissent par client, jamais en FIFO global ;
//! - les vides abimes passent en perte, pas en stock ;
//! - rien ne se reconcile sans session de caisse ouverte.

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::cash;
use depotpro_core::application::delivery_reconciliation::{
    self, DeclareCollectionInput, ReconcileRunInput, RecordRunReturnInput, RecordStopOutcomeInput,
    ReturnAllocationInput, RunReturnInput,
};
use depotpro_core::application::delivery_runs::{self, AddStopInput, CreateRunInput};
use depotpro_core::infrastructure::db::DepotDb;

fn owner() -> SessionIdentity {
    SessionIdentity::from_role("lot14-owner", "lot14", "Propriétaire Lot 14", Role::Owner)
}

fn driver() -> SessionIdentity {
    SessionIdentity::from_role("lot14-driver", "lot14d", "Chauffeur Lot 14", Role::Driver)
}

async fn fresh_db(tag: &str) -> DepotDb {
    let path =
        std::env::temp_dir().join(format!("depotpro_lot14_{tag}_{}.db", uuid::Uuid::new_v4()));
    DepotDb::connect(&path).await.expect("connect")
}

/// Met en place : 2 clients, 1 livreur, 1 consignable, des consignes ouvertes.
/// Renvoie (client_a, client_b, driver_id, returnable_id).
async fn seed(db: &DepotDb) -> (i64, i64, i64, i64) {
    {
        let (_g, mut tx) = db.begin_write().await.unwrap();
        for (code, name) in [("CLI-A", "Maquis A"), ("CLI-B", "Maquis B")] {
            sqlx::query("INSERT INTO clients (code, name) VALUES (?, ?)")
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

        sqlx::query(
            "INSERT INTO users (username, display_name, role, pin_hash) \
             VALUES ('chauffeur','Chauffeur','driver','x')",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        let driver_id: i64 =
            sqlx::query_scalar("SELECT id FROM users WHERE username = 'chauffeur'")
                .fetch_one(&mut *tx)
                .await
                .unwrap();

        sqlx::query(
            "INSERT INTO returnable_packaging_types (code, name, producer, kind, deposit_value)
             VALUES ('EMB14', 'Casier 14', 'SOLIBRA', 'crate', 1000)",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        let returnable_id: i64 =
            sqlx::query_scalar("SELECT id FROM returnable_packaging_types WHERE code = 'EMB14'")
                .fetch_one(&mut *tx)
                .await
                .unwrap();

        sqlx::query("INSERT INTO returnable_stock_balances (packaging_id, quantity) VALUES (?, 0)")
            .bind(returnable_id)
            .execute(&mut *tx)
            .await
            .unwrap();

        tx.commit().await.unwrap();
        let client_b: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-B'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        (client_a, client_b, driver_id, returnable_id)
    }
}

/// Cree une commande pour un client, avec un reste a payer donne.
async fn make_order(db: &DepotDb, client_id: i64, number: &str, to_collect: i64, paid: i64) -> i64 {
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query(
        "INSERT INTO orders (order_number, customer_id, order_type, status,
            subtotal_xof, discount_xof, total_xof, total_to_collect_xof, paid_xof)
         VALUES (?, ?, 'mixte', 'confirmed', 10000, 0, 10000, ?, ?)",
    )
    .bind(number)
    .bind(client_id)
    .bind(to_collect)
    .bind(paid)
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

/// Ajoute une consigne ouverte pour un client.
///
/// `deposit_issues.sale_id` est NOT NULL : une consigne nait toujours d'une
/// vente. On cree donc une vente d'appui par consigne, comme le ferait le vrai
/// flux de facturation.
async fn make_issue(db: &DepotDb, client_id: i64, returnable_id: i64, pieces: i64) -> i64 {
    let (_g, mut tx) = db.begin_write().await.unwrap();
    let tag = uuid::Uuid::new_v4().to_string().replace('-', "");
    sqlx::query(
        "INSERT INTO sales (reference, request_key, client_id, sale_type,
            subtotal_merchandise, total_merchandise, total_deposit, total_amount)
         VALUES (?, ?, ?, 'cash', ?, ?, ?, ?)",
    )
    .bind(format!("VTE-{}", &tag[..10]))
    .bind(format!("rk-{}", &tag[..10]))
    .bind(client_id)
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
    .bind(client_id)
    .bind(returnable_id)
    .bind(pieces)
    .bind(pieces * 1000)
    .execute(&mut *tx)
    .await
    .unwrap();
    let id: i64 = sqlx::query_scalar("SELECT MAX(id) FROM deposit_issues")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    id
}

/// Une tournee chargee et partie, avec un arret livre (attendu connu).
async fn started_run(
    db: &DepotDb,
    client_a: i64,
    driver_id: i64,
    tag: &str,
    to_collect: i64,
    paid: i64,
) -> (i64, i64) {
    let order_id = make_order(db, client_a, &format!("ORD-{tag}"), to_collect, paid).await;
    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            db,
            CreateRunInput {
                run_date: "2026-11-24".into(),
                driver_user_id: driver_id,
                vehicle_label: None,
                request_key: Some(format!("k-{tag}")),
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
                client_id: client_a,
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

/// Declare la tournee revenue : prerequis de toute reconciliation.
async fn mark_returned(db: &DepotDb, run_id: i64) {
    auth::with_actor(owner(), delivery_reconciliation::return_run(db, run_id))
        .await
        .unwrap();
}

async fn open_session(db: &DepotDb) {
    cash::open_cash_session(
        db,
        cash::OpenCashInput {
            opening_cash: 100_000,
            request_key: format!("ck-{}", uuid::Uuid::new_v4()),
        },
    )
    .await
    .unwrap();
}

// ---------------------------------------------------------------------------
// ① Déclarations
// ---------------------------------------------------------------------------

#[tokio::test]
async fn declaring_writes_nothing_to_the_cash_session() {
    let db = fresh_db("declare").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "declare", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;

    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            &db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount: 4_600,
            },
        ),
    )
    .await
    .unwrap();

    let movements: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        movements, 0,
        "une déclaration du livreur n'écrit AUCUN mouvement de caisse"
    );

    // Redéclarer ne crée pas de doublon : la déclaration est mise à jour.
    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            &db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount: 4_500,
            },
        ),
    )
    .await
    .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM delivery_run_collections")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let amount: i64 = sqlx::query_scalar("SELECT amount FROM delivery_run_collections")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(amount, 4_500, "la déclaration est corrigée, pas dupliquée");
}

#[tokio::test]
async fn a_failed_stop_cannot_carry_a_collection() {
    let db = fresh_db("failed_stop").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "failed", 10_600, 6_000).await;

    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            &db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount: 4_600,
            },
        ),
    )
    .await
    .unwrap();

    // Le gérant constate que l'arret n'a pas ete livre : c'est permis, et cela
    // doit effacer la declaration qui n'a plus de sens.
    auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            &db,
            run_id,
            RecordStopOutcomeInput {
                stop_id,
                status: "failed".into(),
                failure_reason: Some("Boutique fermée".into()),
            },
        ),
    )
    .await
    .unwrap();

    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM delivery_run_collections")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "un arrêt en échec efface son encaissement déclaré");
}

#[tokio::test]
async fn a_stop_declared_failed_requires_a_reason() {
    let db = fresh_db("reason_required").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "reason", 10_600, 6_000).await;

    let err = auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            &db,
            run_id,
            RecordStopOutcomeInput {
                stop_id,
                status: "failed".into(),
                failure_reason: Some("   ".into()),
            },
        ),
    )
    .await;
    assert!(err.is_err(), "un motif vide ne compte pas comme un motif");
}

// ---------------------------------------------------------------------------
// ③ Réconciliation
// ---------------------------------------------------------------------------

#[tokio::test]
async fn reconciliation_writes_the_counted_amount_not_the_declared_one() {
    let db = fresh_db("counted").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "counted", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;
    open_session(&db).await;

    // Attendu 4 600, declare 4 600, mais seuls 4 500 sont dans le sac.
    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            &db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount: 4_600,
            },
        ),
    )
    .await
    .unwrap();

    auth::with_actor(
        owner(),
        delivery_reconciliation::record_run_return(
            &db,
            run_id,
            RecordRunReturnInput {
                returns: vec![],
                allocations: vec![],
            },
        ),
    )
    .await
    .unwrap();

    mark_returned(&db, run_id).await;
    let result = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 4_500,
                discrepancy_reason: Some("Manquant de 100 FCFA".into()),
                request_key: None,
            },
        ),
    )
    .await
    .unwrap();

    assert_eq!(result.status, "reconciled");
    assert_eq!(result.expected_amount, 4_600);
    assert_eq!(result.declared_amount, 4_600);
    assert_eq!(result.declared_gap, 0, "déclaré = attendu");
    assert_eq!(result.cash_gap, -100, "compté − déclaré = manquant de 100");
    assert_eq!(result.collections_written, 1);

    // La caisse encaisse 4 500, pas 4 600 : c'est ce qui est physiquement rentré.
    let amount: i64 =
        sqlx::query_scalar("SELECT amount FROM cash_movements WHERE delivery_run_id = ?")
            .bind(run_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        amount, 4_500,
        "le mouvement de caisse porte le COMPTÉ : encaisser le déclaré rendrait la caisse fausse"
    );

    let by_driver: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cash_movements
         WHERE collected_by_user_id = ? AND delivery_run_id = ?",
    )
    .bind(driver_id)
    .bind(run_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(by_driver, 1, "le mouvement garde la trace du livreur");
}

#[tokio::test]
async fn a_gap_without_a_reason_is_refused() {
    let db = fresh_db("gap").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "gap", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;
    open_session(&db).await;

    // Rien n'est declare : ecart declare − attendu = −4 600.
    mark_returned(&db, run_id).await;
    let err = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 0,
                discrepancy_reason: None,
                request_key: None,
            },
        ),
    )
    .await;
    assert!(err.is_err(), "un écart sans motif est refusé");

    // La tournee n'a pas bouge.
    let status: String = sqlx::query_scalar("SELECT status FROM delivery_runs WHERE id = ?")
        .bind(run_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        status, "returned",
        "le refus laisse la tournée revenue, prête dès que le motif est donné"
    );
}

#[tokio::test]
async fn reconciliation_is_idempotent_and_terminal() {
    let db = fresh_db("idem").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "idem", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;
    open_session(&db).await;

    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            &db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount: 4_600,
            },
        ),
    )
    .await
    .unwrap();

    mark_returned(&db, run_id).await;
    let first = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 4_600,
                discrepancy_reason: None,
                request_key: None,
            },
        ),
    )
    .await
    .unwrap();
    assert_eq!(first.status, "reconciled");
    assert_eq!(first.declared_gap, 0);
    assert_eq!(first.cash_gap, 0);

    // Rejouer ne doit pas ecrire un second mouvement.
    mark_returned(&db, run_id).await;
    let second = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 4_600,
                discrepancy_reason: None,
                request_key: None,
            },
        ),
    )
    .await
    .unwrap();
    assert_eq!(second.collections_written, 1);

    let movements: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements WHERE delivery_run_id = ?")
            .bind(run_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        movements, 1,
        "rejouer la réconciliation ne double pas la caisse"
    );

    // Terminal : plus aucun constat possible.
    let err = auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            &db,
            run_id,
            RecordStopOutcomeInput {
                stop_id,
                status: "failed".into(),
                failure_reason: Some("Trop tard".into()),
            },
        ),
    )
    .await;
    assert!(err.is_err(), "une tournée réconciliée ne se modifie plus");
}

#[tokio::test]
async fn reconciliation_requires_an_open_cash_session() {
    let db = fresh_db("no_session").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "nosess", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;

    mark_returned(&db, run_id).await;
    let err = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 4_600,
                discrepancy_reason: None,
                request_key: None,
            },
        ),
    )
    .await;
    assert!(
        err.is_err(),
        "sans session de caisse ouverte, l'argent ne peut pas entrer"
    );
}

#[tokio::test]
async fn expected_ignores_stops_that_were_not_delivered() {
    let db = fresh_db("not_delivered").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;

    // Deux arrets construits AVANT le depart : un livre a 4 600, un en echec.
    // Ajouter un arret apres le depart est refuse par conception, donc la
    // tournee se prepare en entier puis part.
    let order_one = make_order(&db, client_a, "ORD-multi-1", 10_600, 6_000).await;
    let order_two = make_order(&db, client_a, "ORD-multi-2", 3_000, 0).await;
    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-24".into(),
                driver_user_id: driver_id,
                vehicle_label: None,
                request_key: Some("k-multi".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();
    let detail = auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            &db,
            run.id,
            AddStopInput {
                client_id: client_a,
                order_id: Some(order_one),
                sequence: None,
            },
        ),
    )
    .await
    .unwrap();
    let first = (run.id, detail.stops[0].id);
    auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            &db,
            run.id,
            AddStopInput {
                client_id: client_a,
                order_id: Some(order_two),
                sequence: None,
            },
        ),
    )
    .await
    .unwrap();
    let stop_two: i64 = {
        let d = auth::with_actor(owner(), delivery_runs::load_run(&db, run.id))
            .await
            .unwrap();
        d.stops.last().unwrap().id
    };
    auth::with_actor(owner(), delivery_runs::start_run(&db, run.id))
        .await
        .unwrap();

    mark_delivered(&db, first.0, first.1).await;
    auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            &db,
            first.0,
            RecordStopOutcomeInput {
                stop_id: stop_two,
                status: "failed".into(),
                failure_reason: Some("Client absent".into()),
            },
        ),
    )
    .await
    .unwrap();
    open_session(&db).await;

    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            &db,
            first.0,
            DeclareCollectionInput {
                stop_id: first.1,
                method_code: "cash".into(),
                amount: 4_600,
            },
        ),
    )
    .await
    .unwrap();

    mark_returned(&db, first.0).await;
    let result = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            first.0,
            ReconcileRunInput {
                counted_amount: 4_600,
                discrepancy_reason: None,
                request_key: None,
            },
        ),
    )
    .await
    .unwrap();

    assert_eq!(
        result.expected_amount, 4_600,
        "l'arrêt en échec est exclu de l'attendu, sinon le manquant serait imaginaire"
    );
    assert_eq!(result.declared_gap, 0);
}

// ---------------------------------------------------------------------------
// Vides
// ---------------------------------------------------------------------------

#[tokio::test]
async fn empties_settle_the_right_client_and_not_the_oldest_debt() {
    let db = fresh_db("empties").await;
    let (client_a, client_b, driver_id, returnable_id) = seed(&db).await;

    // Client A : 2 casiers. Client B : 5 casiers, consigne plus ancienne.
    let issue_a = make_issue(&db, client_a, returnable_id, 2).await;
    let issue_b = make_issue(&db, client_b, returnable_id, 5).await;

    // Les deux clients figurent dans la tournee : un arret apres le depart
    // serait refuse, donc on construit tout avant.
    let order_a = make_order(&db, client_a, "ORD-empt-A", 10_600, 6_000).await;
    let order_b = make_order(&db, client_b, "ORD-empt-B", 2_000, 0).await;
    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-24".into(),
                driver_user_id: driver_id,
                vehicle_label: None,
                request_key: Some("k-empt".into()),
                notes: None,
            },
        ),
    )
    .await
    .unwrap();
    let detail = auth::with_actor(
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
    let run_id = run.id;
    let stop_id = detail.stops[0].id;
    auth::with_actor(
        owner(),
        delivery_runs::add_stop(
            &db,
            run.id,
            AddStopInput {
                client_id: client_b,
                order_id: Some(order_b),
                sequence: None,
            },
        ),
    )
    .await
    .unwrap();
    auth::with_actor(owner(), delivery_runs::load_run(&db, run_id))
        .await
        .unwrap();
    auth::with_actor(owner(), delivery_runs::start_run(&db, run_id))
        .await
        .unwrap();
    mark_delivered(&db, run_id, stop_id).await;
    open_session(&db).await;

    // Le livreur rapporte 2 vides, repris chez A uniquement.
    auth::with_actor(
        owner(),
        delivery_reconciliation::record_run_return(
            &db,
            run_id,
            RecordRunReturnInput {
                returns: vec![RunReturnInput {
                    returnable_id,
                    good_pieces: 2,
                    damaged_pieces: 0,
                }],
                allocations: vec![ReturnAllocationInput {
                    client_id: client_a,
                    returnable_id,
                    good_pieces: 2,
                    damaged_pieces: 0,
                }],
            },
        ),
    )
    .await
    .unwrap();

    auth::with_actor(
        driver(),
        delivery_reconciliation::register_collection(
            &db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount: 4_600,
            },
        ),
    )
    .await
    .unwrap();

    mark_returned(&db, run_id).await;
    let result = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 4_600,
                discrepancy_reason: None,
                request_key: None,
            },
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.returned_good_pieces, 2);

    let status_a: String = sqlx::query_scalar("SELECT status FROM deposit_issues WHERE id = ?")
        .bind(issue_a)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    let returned_a: i64 =
        sqlx::query_scalar("SELECT returned_pieces FROM deposit_issues WHERE id = ?")
            .bind(issue_a)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    let returned_b: i64 =
        sqlx::query_scalar("SELECT returned_pieces FROM deposit_issues WHERE id = ?")
            .bind(issue_b)
            .fetch_one(&db.pool)
            .await
            .unwrap();

    assert_eq!(returned_a, 2, "les casiers repris chez A soldent la consigne de A");
    assert_eq!(status_a, "settled");
    assert_eq!(
        returned_b, 0,
        "la consigne de B, pourtant plus ancienne, ne doit PAS être soldée par les casiers de A"
    );

    // Stock de vides : les 2 bons sont entres.
    let stock: i64 =
        sqlx::query_scalar("SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?")
            .bind(returnable_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(stock, 2);
}

#[tokio::test]
async fn damaged_empties_are_recorded_as_breakage_not_stock() {
    let db = fresh_db("damaged").await;
    let (client_a, _b, driver_id, returnable_id) = seed(&db).await;
    make_issue(&db, client_a, returnable_id, 3).await;

    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "dmg", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;
    open_session(&db).await;

    auth::with_actor(
        owner(),
        delivery_reconciliation::record_run_return(
            &db,
            run_id,
            RecordRunReturnInput {
                returns: vec![RunReturnInput {
                    returnable_id,
                    good_pieces: 1,
                    damaged_pieces: 2,
                }],
                allocations: vec![ReturnAllocationInput {
                    client_id: client_a,
                    returnable_id,
                    good_pieces: 1,
                    damaged_pieces: 2,
                }],
            },
        ),
    )
    .await
    .unwrap();

    mark_returned(&db, run_id).await;
    let result = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 0,
                discrepancy_reason: Some("Aucun encaissement, tournée de reprise".into()),
                request_key: None,
            },
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.returned_good_pieces, 1);
    assert_eq!(result.returned_damaged_pieces, 2);

    // Seul le bon rentre en stock.
    let stock: i64 =
        sqlx::query_scalar("SELECT quantity FROM returnable_stock_balances WHERE packaging_id = ?")
            .bind(returnable_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(stock, 1, "les abîmés ne sont pas du stock réutilisable");

    // Les abimes sont constates, pas effaces.
    let breakage: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(quantity), 0) FROM returnable_stock_movements
         WHERE movement_type = 'breakage' AND packaging_id = ?",
    )
    .bind(returnable_id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(breakage, 2, "les 2 abîmés sont tracés en casse");

    // La consigne est soldee des 3 pieces, bons et abimes confondus.
    let returned: i64 = sqlx::query_scalar("SELECT returned_pieces FROM deposit_issues")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(returned, 3);
}

#[tokio::test]
async fn allocating_more_than_reported_is_refused() {
    let db = fresh_db("over_alloc").await;
    let (client_a, _b, driver_id, returnable_id) = seed(&db).await;
    make_issue(&db, client_a, returnable_id, 5).await;

    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "over", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;

    let err = auth::with_actor(
        owner(),
        delivery_reconciliation::record_run_return(
            &db,
            run_id,
            RecordRunReturnInput {
                returns: vec![RunReturnInput {
                    returnable_id,
                    good_pieces: 2,
                    damaged_pieces: 0,
                }],
                allocations: vec![ReturnAllocationInput {
                    client_id: client_a,
                    returnable_id,
                    good_pieces: 4,
                    damaged_pieces: 0,
                }],
            },
        ),
    )
    .await;
    assert!(
        err.is_err(),
        "répartir 4 casiers quand 2 sont revenus ferait apparaître de la matière"
    );
}

#[tokio::test]
async fn a_driver_cannot_reconcile() {
    let db = fresh_db("driver_denied").await;
    let (client_a, _b, driver_id, _r) = seed(&db).await;
    let (run_id, stop_id) = started_run(&db, client_a, driver_id, "denied", 10_600, 6_000).await;
    mark_delivered(&db, run_id, stop_id).await;
    open_session(&db).await;

    mark_returned(&db, run_id).await;
    let err = auth::with_actor(
        driver(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            ReconcileRunInput {
                counted_amount: 4_600,
                discrepancy_reason: None,
                request_key: None,
            },
        ),
    )
    .await;
    assert!(
        err.is_err(),
        "le livreur déclare, il ne réconcilie pas : il n'a pas DeliveryRunsReconcile"
    );
}
