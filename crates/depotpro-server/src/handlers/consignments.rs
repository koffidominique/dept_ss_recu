// ============================================================================
// Handlers HTTP : Consignations, retours d'emballages & obligations financières
// ============================================================================

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};

use depotpro_core::application::auth::{self, Permission};
use depotpro_core::application::{consignments, packaging_obligations};

use crate::dto::{PackagingLateReturnPayload, PackagingObligationsQuery};
use crate::state::{map_err, require_auth, require_perm, AppState};

pub(crate) async fn consignments_overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, consignments::get_overview(&db)).await {
        Ok(ov) => (StatusCode::OK, Json(serde_json::to_value(ov).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn create_returnable_type(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<consignments::CreateReturnableTypeInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, consignments::create_returnable_type(&db, payload)).await {
        Ok(t) => (StatusCode::CREATED, Json(serde_json::to_value(t).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn adjust_returnable_stock(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<consignments::AdjustReturnableStockInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, consignments::adjust_returnable_stock(&db, payload)).await {
        Ok(mv) => (StatusCode::CREATED, Json(serde_json::to_value(mv).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn return_client_empties(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<consignments::ReturnClientEmptiesInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, consignments::return_client_empties(&db, payload)).await {
        Ok(ret) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(ret).unwrap()),
        )
            .into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_obligations_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<PackagingObligationsQuery>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_obligations::list_obligations(&db, q.client_id),
    )
    .await
    {
        Ok(list) => Json(serde_json::to_value(list).unwrap()).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_obligations::get_client_packaging_dashboard(&db, client_id),
    )
    .await
    {
        Ok(dto) => Json(serde_json::to_value(dto).unwrap()).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn client_packaging_balances(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_auth(&state, &headers).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    if !actor.has_permission(Permission::ConsignmentsRead)
        && !actor.has_permission(Permission::SalesRead)
    {
        if let Err(e) = auth::require_permission(&actor, Permission::ConsignmentsRead) {
            return map_err(e).into_response();
        }
    }
    let db = state.db().await;
    match auth::with_actor(
        actor,
        consignments::get_client_packaging_balances(&db, client_id),
    )
    .await
    {
        Ok(dto) => Json(serde_json::to_value(dto).unwrap()).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_pay_debt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_obligations::PayPackagingDebtInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ReceivablesPay).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor.clone(),
        packaging_obligations::pay_packaging_financial_debt(&db, payload, Some(&actor.username)),
    )
    .await
    {
        Ok(dto) => Json(serde_json::to_value(dto).unwrap()).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_process_due(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor.clone(),
        packaging_obligations::process_due_obligations(&db, Some(&actor.username)),
    )
    .await
    {
        Ok(summary) => Json(serde_json::to_value(summary).unwrap()).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_late_return(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(deposit_issue_id): Path<i64>,
    Json(payload): Json<PackagingLateReturnPayload>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor.clone(),
        packaging_obligations::register_late_return(
            &db,
            deposit_issue_id,
            payload.pieces,
            Some(&actor.username),
        ),
    )
    .await
    {
        Ok(credited_amount) => Json(serde_json::json!({
            "deposit_issue_id": deposit_issue_id,
            "credited_amount": credited_amount
        }))
        .into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_losses_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<PackagingObligationsQuery>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_obligations::list_loss_declarations(&db, q.client_id),
    )
    .await
    {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_declare_loss(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_obligations::DeclareLossInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor.clone(),
        packaging_obligations::declare_loss(&db, payload, Some(&actor.username)),
    )
    .await
    {
        Ok(declaration_id) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "declaration_id": declaration_id })),
        )
            .into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_validate_loss(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(declaration_id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor.clone(),
        packaging_obligations::validate_loss_declaration(
            &db,
            declaration_id,
            Some(&actor.username),
        ),
    )
    .await
    {
        Ok(converted_amount) => Json(serde_json::json!({
            "declaration_id": declaration_id,
            "converted_amount": converted_amount
        }))
        .into_response(),
        Err(e) => map_err(e).into_response(),
    }
}
