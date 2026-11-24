// ============================================================================
// Commandes IPC Tauri : Tournées de livraison (Lots 13, 14, 16)
// ============================================================================
//
// Sans ces commandes, l'écran des tournées aurait fonctionné dans le
// navigateur et échoué dans l'application de bureau, sans message
// compréhensible : `invoke` sur une commande inconnue lève une erreur de
// runtime Tauri, pas un 404 applicatif.
//
// Les permissions sont les mêmes que celles des handlers HTTP. Les gestes de
// terrain (`start`, déclaration d'encaissement) demandent DeliveryRunsExecute,
// ceux de comptoir (chargement, retour, réconciliation) une permission plus
// haute : un livreur ne fige pas l'attendu et n'écrit pas en caisse.

use depotpro_core::application::auth::{self, Permission};
use depotpro_core::application::{delivery_reconciliation, delivery_runs};
use tauri::State;

use super::verify_desktop_perm;
use crate::state::DesktopState;

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_delivery_runs(
    state: State<'_, DesktopState>,
    token: String,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsRead).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_runs::list_runs(&db))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_delivery_run(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsRead).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_runs::get_run(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_delivery_run(
    state: State<'_, DesktopState>,
    token: String,
    payload: delivery_runs::CreateRunInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsManage).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_runs::create_run(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_delivery_stop(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: delivery_runs::AddStopInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsManage).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_runs::add_stop(&db, id, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_delivery_run(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsManage).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_runs::load_run(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_delivery_run(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsExecute).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_runs::start_run(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_delivery_run(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsManage).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_runs::cancel_run(&db, id, None))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Réconciliation
// ---------------------------------------------------------------------------

/// Déclaration d'encaissement : aucun mouvement de caisse, donc aucune
/// permission de caisse n'est exigée. Le livreur déclare ce qu'il a pris.
#[tauri::command]
pub async fn declare_delivery_collection(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: delivery_reconciliation::DeclareCollectionInput,
) -> Result<(), String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsExecute).await?;
    let db = state.db().await;
    auth::with_actor(
        actor,
        delivery_reconciliation::register_collection(&db, id, payload),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_delivery_stop_outcome(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: delivery_reconciliation::RecordStopOutcomeInput,
) -> Result<(), String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsManage).await?;
    let db = state.db().await;
    auth::with_actor(
        actor,
        delivery_reconciliation::record_stop_outcome(&db, id, payload),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_delivery_run_return(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: delivery_reconciliation::RecordRunReturnInput,
) -> Result<(), String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsManage).await?;
    let db = state.db().await;
    auth::with_actor(
        actor,
        delivery_reconciliation::record_run_return(&db, id, payload),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn return_delivery_run(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsManage).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_reconciliation::return_run(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reconcile_delivery_run(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: delivery_reconciliation::ReconcileRunInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsReconcile).await?;
    let db = state.db().await;
    let res = auth::with_actor(
        actor,
        delivery_reconciliation::reconcile_run(&db, id, payload),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_delivery_reconciliation(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::DeliveryRunsRead).await?;
    let db = state.db().await;
    let res = auth::with_actor(actor, delivery_reconciliation::get_reconciliation(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(res).map_err(|e| e.to_string())
}
