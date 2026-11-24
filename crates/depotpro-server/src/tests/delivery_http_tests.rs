// ============================================================================
// Tests HTTP Axum : Tournées de livraison (Lots 13 & 14)
// ============================================================================
// Ces routes n'existaient pas : le cœur des tournées était testé en direct mais
// aucun client HTTP ne pouvait l'atteindre. Ce test couvre le câblage — c'est
// exactement ce qui manquait, et ce qu'aucun test unitaire ne peut prouver.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use tokio::sync::RwLock;

use depotpro_core::application::auth::SessionStore;
use depotpro_core::infrastructure::db::DepotDb;

use crate::router::build_router;
use crate::state::{AppState, AuthRateLimiter};

use super::send_http;

async fn spawn_app() -> (SocketAddr, String) {
    let uid = uuid::Uuid::new_v4();
    let dir = std::env::temp_dir().join(format!("depotpro_axum_delivery_{uid}"));
    let db = DepotDb::connect(&dir.join("test.db")).await.unwrap();

    let state = AppState {
        db: Arc::new(RwLock::new(db)),
        backup_dir: dir.join("backups"),
        sessions: Arc::new(RwLock::new(SessionStore::default())),
        auth_limiter: Arc::new(RwLock::new(AuthRateLimiter::default())),
    };
    let app: Router = build_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let (st, setup_body) = send_http(
        addr,
        "POST",
        "/api/auth/setup",
        &[],
        Some(r#"{"pin":"246810"}"#),
    )
    .await;
    assert_eq!(st, 200, "setup du propriétaire");
    let token = serde_json::from_str::<serde_json::Value>(&setup_body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    (addr, format!("Bearer {token}"))
}

#[tokio::test]
async fn delivery_routes_are_reachable_and_guarded() {
    let (addr, auth) = spawn_app().await;

    // Sans jeton : refusé. Ce n'est pas la route qui manque, c'est l'accès.
    let (st_anon, _) = send_http(addr, "GET", "/api/delivery-runs", &[], None).await;
    assert_eq!(
        st_anon, 401,
        "les tournées ne sont pas accessibles sans session"
    );

    let hdrs = [("Authorization", auth.as_str())];

    // La liste répond.
    let (st, body) = send_http(addr, "GET", "/api/delivery-runs", &hdrs, None).await;
    assert_eq!(st, 200, "GET /api/delivery-runs");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap(),
        serde_json::json!([]),
        "aucune tournée au départ"
    );

    // Une tournée inexistante renvoie 404, pas 500 : la route est bien branchée
    // et le domaine répond correctement.
    let (st_404, _) = send_http(addr, "GET", "/api/delivery-runs/999", &hdrs, None).await;
    assert_eq!(st_404, 404, "tournée inconnue = 404");
}

#[tokio::test]
async fn a_run_can_be_created_and_read_through_http() {
    let (addr, auth) = spawn_app().await;
    let hdrs = [("Authorization", auth.as_str())];

    // Un livreur est nécessaire : le rôle driver doit exister et être accepté.
    let (st_user, user_body) = send_http(
        addr,
        "POST",
        "/api/auth/users",
        &hdrs,
        Some(
            r#"{"username":"chauffeur","displayName":"Chauffeur Test","role":"driver","pin":"123456"}"#,
        ),
    )
    .await;
    assert_eq!(st_user, 201, "création d'un livreur : {user_body}");
    let driver_id = serde_json::from_str::<serde_json::Value>(&user_body).unwrap()["id"]
        .as_i64()
        .unwrap();

    let payload = format!(
        r#"{{"run_date":"2026-11-24","driver_user_id":{driver_id},"vehicle_label":"Triporteur","request_key":"http-run-1"}}"#
    );
    let (st, body) = send_http(addr, "POST", "/api/delivery-runs", &hdrs, Some(&payload)).await;
    assert_eq!(st, 201, "création de tournée : {body}");
    let run = serde_json::from_str::<serde_json::Value>(&body).unwrap();
    assert_eq!(run["status"], "draft");
    assert!(
        run["reference"].as_str().unwrap().starts_with("TRN-"),
        "référence générée"
    );
    let run_id = run["id"].as_i64().unwrap();

    // Rejouer la même requête ne crée pas de doublon, même par HTTP.
    let (st2, body2) = send_http(addr, "POST", "/api/delivery-runs", &hdrs, Some(&payload)).await;
    assert_eq!(st2, 201);
    let again = serde_json::from_str::<serde_json::Value>(&body2).unwrap();
    assert_eq!(
        again["id"].as_i64().unwrap(),
        run_id,
        "idempotence par request_key"
    );

    // Lecture détaillée : le contrat de sortie est celui attendu par le front.
    let (st_get, body_get) = send_http(
        addr,
        "GET",
        &format!("/api/delivery-runs/{run_id}"),
        &hdrs,
        None,
    )
    .await;
    assert_eq!(st_get, 200);
    let detail = serde_json::from_str::<serde_json::Value>(&body_get).unwrap();
    assert_eq!(detail["run"]["id"].as_i64().unwrap(), run_id);
    assert_eq!(detail["stops"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn reconciling_without_a_stop_or_session_is_refused_over_http() {
    let (addr, auth) = spawn_app().await;
    let hdrs = [("Authorization", auth.as_str())];

    let (_, user_body) = send_http(
        addr,
        "POST",
        "/api/auth/users",
        &hdrs,
        Some(
            r#"{"username":"chauffeur2","displayName":"Chauffeur 2","role":"driver","pin":"123456"}"#,
        ),
    )
    .await;
    let driver_id = serde_json::from_str::<serde_json::Value>(&user_body).unwrap()["id"]
        .as_i64()
        .unwrap();

    let payload = format!(
        r#"{{"run_date":"2026-11-24","driver_user_id":{driver_id},"vehicle_label":null,"request_key":"http-run-2","notes":null}}"#
    );
    let (_, body) = send_http(addr, "POST", "/api/delivery-runs", &hdrs, Some(&payload)).await;
    let run_id = serde_json::from_str::<serde_json::Value>(&body).unwrap()["id"]
        .as_i64()
        .unwrap();

    // Charger une tournée vide est refusé par le cœur, et le refus remonte en
    // 400 (VALIDATION_ERROR), pas en 500 : une erreur métier n'est pas une panne.
    let (st, msg) = send_http(
        addr,
        "POST",
        &format!("/api/delivery-runs/{run_id}/load"),
        &hdrs,
        None,
    )
    .await;
    assert_eq!(st, 400, "tournée vide refusée : {msg}");

    // Réconcilier une tournée au statut draft est refusé.
    let (st_rec, msg_rec) = send_http(
        addr,
        "POST",
        &format!("/api/delivery-runs/{run_id}/reconcile"),
        &hdrs,
        Some(r#"{"counted_amount":0,"discrepancy_reason":null,"request_key":null}"#),
    )
    .await;
    assert_eq!(
        st_rec, 400,
        "réconciliation impossible en draft : {msg_rec}"
    );
    // Le code applicatif reste distinct, c'est lui que le front lit.
    let corps = serde_json::from_str::<serde_json::Value>(&msg_rec).unwrap();
    assert_eq!(corps["code"], "VALIDATION_ERROR");
}

#[tokio::test]
async fn a_driver_can_start_but_not_reconcile_over_http() {
    let (addr, auth) = spawn_app().await;
    let hdrs = [("Authorization", auth.as_str())];

    let (_, user_body) = send_http(
        addr,
        "POST",
        "/api/auth/users",
        &hdrs,
        Some(
            r#"{"username":"chauffeur3","displayName":"Chauffeur 3","role":"driver","pin":"123456"}"#,
        ),
    )
    .await;
    let driver_id = serde_json::from_str::<serde_json::Value>(&user_body).unwrap()["id"]
        .as_i64()
        .unwrap();

    let payload = format!(
        r#"{{"run_date":"2026-11-24","driver_user_id":{driver_id},"request_key":"http-run-3"}}"#
    );
    let (_, body) = send_http(addr, "POST", "/api/delivery-runs", &hdrs, Some(&payload)).await;
    let run_id = serde_json::from_str::<serde_json::Value>(&body).unwrap()["id"]
        .as_i64()
        .unwrap();

    // Le livreur se connecte avec son PIN pour obtenir son propre jeton.
    let (st_login, login_body) = send_http(
        addr,
        "POST",
        "/api/auth/login",
        &[],
        Some(r#"{"username":"chauffeur3","pin":"123456"}"#),
    )
    .await;
    assert_eq!(st_login, 200, "connexion du livreur : {login_body}");
    let driver_token = serde_json::from_str::<serde_json::Value>(&login_body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let driver_hdrs = [("Authorization", format!("Bearer {driver_token}"))];
    let driver_hdrs_ref: Vec<(&str, &str)> =
        driver_hdrs.iter().map(|(k, v)| (*k, v.as_str())).collect();

    // Le livreur n'a pas DeliveryRunsManage : créer une tournée lui est refusé.
    let (st_create, _) = send_http(
        addr,
        "POST",
        "/api/delivery-runs",
        &driver_hdrs_ref,
        Some(&payload),
    )
    .await;
    assert_eq!(st_create, 403, "le livreur ne crée pas de tournée");

    // Il n'a pas DeliveryRunsReconcile non plus : réconcilier lui est refusé,
    // et ce avant même de regarder le statut de la tournée.
    let (st_rec, _) = send_http(
        addr,
        "POST",
        &format!("/api/delivery-runs/{run_id}/reconcile"),
        &driver_hdrs_ref,
        Some(r#"{"counted_amount":0,"discrepancy_reason":null,"request_key":null}"#),
    )
    .await;
    assert_eq!(st_rec, 403, "le livreur ne réconcilie pas");

    // Il a DeliveryRunsRead : il doit pouvoir consulter la tournée, sinon il
    // peut partir sans savoir où aller. C'est ce défaut que ce test a révélé :
    // le rôle driver n'avait que Execute.
    let (st_get, body_get) = send_http(
        addr,
        "GET",
        &format!("/api/delivery-runs/{run_id}"),
        &driver_hdrs_ref,
        None,
    )
    .await;
    assert_eq!(
        st_get, 200,
        "le livreur doit pouvoir lire ses arrêts : {body_get}"
    );

    // Mais pas charger la tournée : c'est le gérant qui fige l'attendu.
    let (st_load, _) = send_http(
        addr,
        "POST",
        &format!("/api/delivery-runs/{run_id}/load"),
        &driver_hdrs_ref,
        None,
    )
    .await;
    assert_eq!(st_load, 403, "le livreur ne charge pas la tournée");
}
