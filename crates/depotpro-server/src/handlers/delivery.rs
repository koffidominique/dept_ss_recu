// ============================================================================
// Handlers HTTP : Tournées de livraison (Lots 13 & 14)
// ============================================================================
//
// Sans ces routes, tout le socle des tournées était inatteignable depuis
// l'application : le cœur et la réconciliation existaient, testés, mais aucun
// client ne pouvait les appeler. C'est exactement le genre de travail qui a
// l'air terminé en revue de code et qui ne l'est pas.
//
// Les permissions sont vérifiées deux fois, volontairement :
//   1. ici, pour renvoyer 403 avant d'ouvrir une transaction ;
//   2. dans le cœur, parce que le cœur est aussi appelé par Tauri sans passer
//      par ces handlers.
// Une seule des deux serait suffisante pour l'HTTP, aucune ne l'est pour le
// reste.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};

use depotpro_core::application::auth::{self, Permission};
use depotpro_core::application::delivery_reconciliation;
use depotpro_core::application::delivery_runs;

use crate::state::{map_err, require_perm, AppState};

// ---------------------------------------------------------------------------
// Tournées : cycle de vie
// ---------------------------------------------------------------------------

pub(crate) async fn list_runs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_runs::list_runs(&db)).await {
        Ok(items) => (StatusCode::OK, Json(serde_json::to_value(items).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn create_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<delivery_runs::CreateRunInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsManage).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_runs::create_run(&db, payload)).await {
        Ok(res) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(res).unwrap()),
        )
            .into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn get_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_runs::get_run(&db, id)).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn add_stop(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<delivery_runs::AddStopInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsManage).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_runs::add_stop(&db, id, payload)).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn load_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsManage).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_runs::load_run(&db, id)).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

/// Départ de la tournée.
///
/// `DeliveryRunsExecute` et non `Manage` : c'est le livreur qui part, et il n'a
/// que cette permission. Le gérant, lui, peut aussi (il a Read+Manage).
pub(crate) async fn start_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsExecute).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_runs::start_run(&db, id)).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn cancel_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsManage).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_runs::cancel_run(&db, id, None)).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

// ---------------------------------------------------------------------------
// Réconciliation
// ---------------------------------------------------------------------------

pub(crate) async fn register_collection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<delivery_reconciliation::DeclareCollectionInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsExecute).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        delivery_reconciliation::register_collection(&db, id, payload),
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn record_stop_outcome(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<delivery_reconciliation::RecordStopOutcomeInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsManage).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        delivery_reconciliation::record_stop_outcome(&db, id, payload),
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn record_run_return(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<delivery_reconciliation::RecordRunReturnInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsManage).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        delivery_reconciliation::record_run_return(&db, id, payload),
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn return_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsManage).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_reconciliation::return_run(&db, id)).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn reconcile_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<delivery_reconciliation::ReconcileRunInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsReconcile).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        delivery_reconciliation::reconcile_run(&db, id, payload),
    )
    .await
    {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn get_reconciliation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::DeliveryRunsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, delivery_reconciliation::get_reconciliation(&db, id)).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}
