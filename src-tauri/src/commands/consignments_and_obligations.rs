// ============================================================================
// Commandes IPC Tauri : Consignations & obligations financières d'emballages
// ============================================================================

use depotpro_core::application::auth::{self, Permission};
use depotpro_core::application::{consignments, packaging_obligations};
use tauri::State;

use super::{verify_desktop_perm, verify_desktop_session};
use crate::state::DesktopState;

#[tauri::command]
pub async fn get_consignments_overview(
    state: State<'_, DesktopState>,
    token: String,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsRead).await?;
    let db = state.db().await;
    let ov = auth::with_actor(actor, consignments::get_overview(&db))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(ov).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_returnable_type(
    state: State<'_, DesktopState>,
    token: String,
    payload: consignments::CreateReturnableTypeInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let rt = auth::with_actor(actor, consignments::create_returnable_type(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(rt).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn adjust_returnable_stock(
    state: State<'_, DesktopState>,
    token: String,
    payload: consignments::AdjustReturnableStockInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let mv = auth::with_actor(actor, consignments::adjust_returnable_stock(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(mv).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn return_client_empties(
    state: State<'_, DesktopState>,
    token: String,
    payload: consignments::ReturnClientEmptiesInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let ret = auth::with_actor(actor, consignments::return_client_empties(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(ret).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_packaging_obligations(
    state: State<'_, DesktopState>,
    token: String,
    client_id: Option<i64>,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsRead).await?;
    let db = state.db().await;
    let list = auth::with_actor(
        actor,
        packaging_obligations::list_obligations(&db, client_id),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_packaging_dashboard(
    state: State<'_, DesktopState>,
    token: String,
    client_id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsRead).await?;
    let db = state.db().await;
    let dto = auth::with_actor(
        actor,
        packaging_obligations::get_client_packaging_dashboard(&db, client_id),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(dto).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_client_packaging_balances(
    state: State<'_, DesktopState>,
    token: String,
    client_id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_session(&state, &token).await?;
    if !actor.has_permission(Permission::ConsignmentsRead)
        && !actor.has_permission(Permission::SalesRead)
    {
        auth::require_permission(&actor, Permission::ConsignmentsRead)
            .map_err(|e| e.to_string())?;
    }
    let db = state.db().await;
    let rows = auth::with_actor(
        actor,
        consignments::get_client_packaging_balances(&db, client_id),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pay_packaging_debt(
    state: State<'_, DesktopState>,
    token: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ReceivablesPay).await?;
    let db = state.db().await;
    let username = actor.username.clone();
    let input: packaging_obligations::PayPackagingDebtInput =
        serde_json::from_value(payload).map_err(|e| e.to_string())?;
    let dto = auth::with_actor(
        actor,
        packaging_obligations::pay_packaging_financial_debt(&db, input, Some(&username)),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(dto).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn process_due_packaging_obligations(
    state: State<'_, DesktopState>,
    token: String,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let username = actor.username.clone();
    let summary = auth::with_actor(
        actor,
        packaging_obligations::process_due_obligations(&db, Some(&username)),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(summary).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn register_packaging_late_return(
    state: State<'_, DesktopState>,
    token: String,
    deposit_issue_id: i64,
    pieces: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let username = actor.username.clone();
    let credited_amount = auth::with_actor(
        actor,
        packaging_obligations::register_late_return(&db, deposit_issue_id, pieces, Some(&username)),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "deposit_issue_id": deposit_issue_id,
        "credited_amount": credited_amount
    }))
}

#[tauri::command]
pub async fn list_packaging_loss_declarations(
    state: State<'_, DesktopState>,
    token: String,
    client_id: Option<i64>,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsRead).await?;
    let db = state.db().await;
    let rows = auth::with_actor(
        actor,
        packaging_obligations::list_loss_declarations(&db, client_id),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn declare_packaging_loss(
    state: State<'_, DesktopState>,
    token: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let username = actor.username.clone();
    let input: packaging_obligations::DeclareLossInput =
        serde_json::from_value(payload).map_err(|e| e.to_string())?;
    let declaration_id = auth::with_actor(
        actor,
        packaging_obligations::declare_loss(&db, input, Some(&username)),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "declaration_id": declaration_id }))
}

#[tauri::command]
pub async fn validate_packaging_loss(
    state: State<'_, DesktopState>,
    token: String,
    declaration_id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let username = actor.username.clone();
    let converted_amount = auth::with_actor(
        actor,
        packaging_obligations::validate_loss_declaration(&db, declaration_id, Some(&username)),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "declaration_id": declaration_id,
        "converted_amount": converted_amount
    }))
}
