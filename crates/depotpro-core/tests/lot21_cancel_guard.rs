//! Tests du Lot 21 — on n'annule pas une tournée qui porte de l'argent.
//!
//! Le trou que ces tests ferment :
//!
//! `cancel_run` acceptait `draft | loaded | in_progress` sans autre condition.
//! Or les déclarations d'encaissement d'un livreur (`delivery_run_collections`)
//! ne sont visibles que par deux chemins très étroits :
//!
//! - l'état de caisse, qui ne liste que les tournées `in_progress` ;
//! - la réconciliation, qui n'existe qu'à partir de `returned`.
//!
//! Annuler une tournée `in_progress` la faisait donc sortir des deux. Ses
//! encaissements restaient en base — `cancel_run` ne supprime rien — mais plus
//! aucun écran ne pouvait les montrer, et `reconcile_run` refuse tout statut
//! autre que `returned`. L'argent disparaissait de la comptabilité en restant
//! dans les tables.
//!
//! La garde ne supprime pas l'annulation : elle la refuse **dès qu'une
//! déclaration existe**. Le besoin d'annuler une tournée partie par erreur, ou
//! dont le véhicule ne part pas, reste couvert — c'était une demande explicite
//! du lot précédent, et le test unitaire du front l'affirme encore.

use depotpro_core::application::auth::{self, Role, SessionIdentity};
use depotpro_core::application::cash;
use depotpro_core::application::delivery_reconciliation::{self, DeclareCollectionInput};
use depotpro_core::application::delivery_runs::{self, AddStopInput, CreateRunInput};
use depotpro_core::infrastructure::db::DepotDb;

fn owner() -> SessionIdentity {
    SessionIdentity::from_role("lot21-owner", "lot21", "Propriétaire Lot 21", Role::Owner)
}

async fn fresh_db(tag: &str) -> DepotDb {
    let path = std::env::temp_dir().join(format!("depotpro_lot21_{tag}_{}.db", uuid::Uuid::new_v4()));
    DepotDb::connect(&path).await.expect("connect")
}

/// Un client, un livreur, une tournée `draft` avec un arrêt dont la commande
/// laisse 4 600 FCFA à encaisser.
async fn seed(tag: &str) -> (DepotDb, i64) {
    let db = fresh_db(tag).await;
    let (_g, mut tx) = db.begin_write().await.unwrap();
    sqlx::query(
        "INSERT INTO clients (code, name, client_type) VALUES ('CLI-21', 'Maquis Lot 21', 'professionnel')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO users (username, display_name, role, pin_hash) \
         VALUES ('chauffeur21', 'Chauffeur Lot 21', 'driver', 'x')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let client_id: i64 = sqlx::query_scalar("SELECT id FROM clients WHERE code = 'CLI-21'")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    let driver_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = 'chauffeur21'")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO orders (order_number, customer_id, order_type, status,
            subtotal_xof, discount_xof, total_xof, total_to_collect_xof, paid_xof)
         VALUES ('ORD-21-1', ?, 'mixte', 'confirmed', 10000, 0, 10000, 4600, 0)",
    )
    .bind(client_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let order_id: i64 = sqlx::query_scalar("SELECT id FROM orders WHERE order_number = 'ORD-21-1'")
        .fetch_one(&db.pool)
        .await
        .unwrap();

    let run = auth::with_actor(
        owner(),
        delivery_runs::create_run(
            &db,
            CreateRunInput {
                run_date: "2026-11-23".into(),
                driver_user_id: driver_id,
                vehicle_label: None,
                request_key: Some(format!("lot21-{tag}")),
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

    (db, run.id)
}

/// Ouvre une session de caisse : la réconciliation l'exige.
async fn open_session(db: &DepotDb) {
    auth::with_actor(
        owner(),
        cash::open_cash_session(
            db,
            cash::OpenCashInput {
                opening_cash: 1000,
                request_key: "lot21-open".into(),
            },
        ),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_draft_run_still_cancels() {
    let (db, run_id) = seed("draft").await;
    let cancelled = auth::with_actor(owner(), delivery_runs::cancel_run(&db, run_id, None))
        .await
        .unwrap();
    assert_eq!(cancelled.status, "cancelled");
}

#[tokio::test]
async fn a_loaded_run_still_cancels_when_no_money_was_declared() {
    let (db, run_id) = seed("loaded").await;

    auth::with_actor(owner(), delivery_runs::load_run(&db, run_id))
        .await
        .unwrap();

    // Le véhicule ne part pas : annuler doit rester possible.
    let cancelled = auth::with_actor(owner(), delivery_runs::cancel_run(&db, run_id, None))
        .await
        .unwrap();
    assert_eq!(cancelled.status, "cancelled");
}

#[tokio::test]
async fn an_in_progress_run_still_cancels_while_the_sack_is_empty() {
    let (db, run_id) = seed("started-empty").await;

    auth::with_actor(owner(), delivery_runs::load_run(&db, run_id))
        .await
        .unwrap();
    auth::with_actor(owner(), delivery_runs::start_run(&db, run_id))
        .await
        .unwrap();

    // Départ cliqué par erreur, rien d'encaissé : l'annulation reste ouverte.
    let cancelled = auth::with_actor(owner(), delivery_runs::cancel_run(&db, run_id, None))
        .await
        .unwrap();
    assert_eq!(cancelled.status, "cancelled");
}

/// Le cœur du trou, de bout en bout.
///
/// On démarre une tournée, le livreur déclare 4 600, puis on tente d'annuler.
/// Le test exige trois choses :
///
/// 1. l'annulation est refusée, avec un message qui dit pourquoi et indique la
///    sortie ;
/// 2. l'argent reste visible dans l'état de caisse, inchangé ;
/// 3. le chemin propre — retour puis réconciliation — aboutit, et l'argent
///    quitte alors le transit pour la caisse.
///
/// Si l'annulation redevenait possible ici, ces 4 600 sortiraient de tous les
/// écrans sans sortir des tables.
#[tokio::test]
async fn money_already_declared_cannot_be_cancelled_away() {
    let (db, run_id) = seed("hide").await;
    open_session(&db).await;

    auth::with_actor(owner(), delivery_runs::load_run(&db, run_id))
        .await
        .unwrap();
    auth::with_actor(owner(), delivery_runs::start_run(&db, run_id))
        .await
        .unwrap();

    // L'arrêt est livré, et le livreur déclare ce qu'il a pris.
    let stop_id: i64 =
        sqlx::query_scalar("SELECT id FROM delivery_run_stops WHERE run_id = ? LIMIT 1")
            .bind(run_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    auth::with_actor(
        owner(),
        delivery_reconciliation::record_stop_outcome(
            &db,
            run_id,
            delivery_reconciliation::RecordStopOutcomeInput {
                stop_id,
                status: "delivered".into(),
                failure_reason: None,
            },
        ),
    )
    .await
    .unwrap();
    auth::with_actor(
        owner(),
        delivery_reconciliation::register_collection(
            &db,
            run_id,
            DeclareCollectionInput {
                stop_id,
                method_code: "cash".into(),
                amount: 4600,
            },
        ),
    )
    .await
    .unwrap();

    // Tant que la tournée roule, l'argent est vu : c'est l'objet du Lot 19.
    let transit = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    let seen_in_transit: i64 = transit
        .runs_in_transit
        .iter()
        .filter(|r| r.run_id == run_id)
        .map(|r| r.declared_amount)
        .sum();
    assert_eq!(
        seen_in_transit, 4600,
        "en cours de tournée, le déclaré doit être visible hors caisse"
    );

    // L'annulation est refusée dès qu'une déclaration existe : c'est la
    // fermeture du trou.
    let refused = auth::with_actor(owner(), delivery_runs::cancel_run(&db, run_id, None)).await;
    let err = refused.expect_err(
        "annuler une tournée qui porte de l'argent le ferait disparaître de tout écran",
    );
    let message = err.to_string();
    assert!(
        message.contains("déclaré") && message.contains("réconciliez"),
        "le refus doit dire pourquoi et indiquer la sortie : {message}"
    );

    // Et la tournée est toujours en cours, l'argent toujours visible.
    let after = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    let still_seen: i64 = after
        .runs_in_transit
        .iter()
        .filter(|r| r.run_id == run_id)
        .map(|r| r.declared_amount)
        .sum();
    assert_eq!(still_seen, 4600, "rien ne doit disparaître");

    // Le chemin propre, lui, fonctionne de bout en bout.
    auth::with_actor(owner(), delivery_reconciliation::return_run(&db, run_id))
        .await
        .unwrap();
    let reconciliation = auth::with_actor(
        owner(),
        delivery_reconciliation::reconcile_run(
            &db,
            run_id,
            delivery_reconciliation::ReconcileRunInput {
                counted_amount: 4600,
                discrepancy_reason: None,
                request_key: Some("lot21-reconcile".into()),
            },
        ),
    )
    .await
    .unwrap();
    assert_eq!(reconciliation.declared_amount, 4600);
    assert_eq!(reconciliation.cash_gap, 0);

    // Une fois réconciliée, plus rien en transit : l'argent est en caisse.
    let after_reconcile = auth::with_actor(owner(), cash::get_cash_status(&db))
        .await
        .unwrap();
    assert!(
        !after_reconcile
            .runs_in_transit
            .iter()
            .any(|r| r.run_id == run_id),
        "la réconciliation transfère l'argent du transit vers la caisse"
    );
}
