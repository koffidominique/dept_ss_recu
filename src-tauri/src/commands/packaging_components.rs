// ============================================================================
// Commandes IPC Tauri : Composants emballages, assemblage & profils
// ============================================================================

use depotpro_core::application::auth::{self, Permission};
use depotpro_core::application::packaging_components;
use tauri::State;

use super::verify_desktop_perm;
use crate::state::DesktopState;

#[tauri::command]
pub async fn get_packaging_components_overview(
    state: State<'_, DesktopState>,
    token: String,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsRead).await?;
    let db = state.db().await;
    let ov = auth::with_actor(actor, packaging_components::get_components_overview(&db))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(ov).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_crate_components_pc(
    state: State<'_, DesktopState>,
    token: String,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsRead).await?;
    let db = state.db().await;
    let list = auth::with_actor(actor, async {
        Ok::<_, depotpro_core::CoreError>(
            packaging_components::get_components_overview(&db)
                .await?
                .crate_components,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_crate_component_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::CreateCrateComponentInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let c = auth::with_actor(
        actor,
        packaging_components::create_crate_component(&db, payload),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(c).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_packaging_stock(
    state: State<'_, DesktopState>,
    token: String,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsRead).await?;
    let db = state.db().await;
    let list = auth::with_actor(actor, async {
        Ok::<_, depotpro_core::CoreError>(
            packaging_components::get_components_overview(&db)
                .await?
                .component_stock,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_component_stock_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::UpdateComponentStockInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let mv = auth::with_actor(
        actor,
        packaging_components::update_component_stock(&db, payload),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(mv).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assemble_crates_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::AssembleCratesInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let rec = auth::with_actor(actor, packaging_components::assemble_crates(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(rec).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn disassemble_crates_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::DisassembleCratesInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::ConsignmentsWrite).await?;
    let db = state.db().await;
    let rec = auth::with_actor(
        actor,
        packaging_components::disassemble_crates(&db, payload),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(rec).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_bottle_profiles_pc_cmd(
    state: State<'_, DesktopState>,
    token: String,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogRead).await?;
    let db = state.db().await;
    let list = auth::with_actor(
        actor,
        packaging_components::get_bottle_profiles_by_material(&db, "glass".into()),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_bottle_profile_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::CreateBottleProfileInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let p = auth::with_actor(
        actor,
        packaging_components::create_bottle_profile(&db, payload),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_crate_types_pc_cmd(
    state: State<'_, DesktopState>,
    token: String,
    active_only: Option<bool>,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogRead).await?;
    let db = state.db().await;
    let list = auth::with_actor(
        actor,
        packaging_components::get_crate_types(&db, active_only.unwrap_or(true)),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_crate_type_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::CreateCrateTypeInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let t = auth::with_actor(actor, packaging_components::create_crate_type(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(t).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_crate_type_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: packaging_components::UpdateCrateTypeInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let t = auth::with_actor(actor, packaging_components::update_crate_type(&db, id, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(t).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_crate_type_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<(), String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    auth::with_actor(actor, packaging_components::delete_crate_type(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Packaging Profiles (Profils d'emballages physiques)
// ============================================================================

#[tauri::command]
pub async fn list_packaging_profiles_pc(
    state: State<'_, DesktopState>,
    token: String,
    include_archived: Option<bool>,
    verification_status: Option<String>,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogRead).await?;
    let db = state.db().await;
    let list = auth::with_actor(
        actor,
        packaging_components::list_packaging_profiles(&db, include_archived.unwrap_or(false), verification_status),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_packaging_profile_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogRead).await?;
    let db = state.db().await;
    let profile = auth::with_actor(actor, packaging_components::get_packaging_profile(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(profile).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_packaging_profile_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::CreatePackagingProfileInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let p = auth::with_actor(actor, packaging_components::create_packaging_profile(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_packaging_profile_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: packaging_components::UpdatePackagingProfileInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let p = auth::with_actor(actor, packaging_components::update_packaging_profile(&db, id, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_packaging_profile_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<(), String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    auth::with_actor(actor, packaging_components::delete_packaging_profile(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Variant Packaging Options (Options de conditionnement par variante)
// ============================================================================

#[tauri::command]
pub async fn list_variant_packaging_options_pc(
    state: State<'_, DesktopState>,
    token: String,
    variant_id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogRead).await?;
    let db = state.db().await;
    let list = auth::with_actor(actor, packaging_components::list_variant_packaging_options(&db, variant_id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_variant_packaging_option_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogRead).await?;
    let db = state.db().await;
    let opt = auth::with_actor(actor, packaging_components::get_variant_packaging_option(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(opt).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_variant_packaging_option_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::CreateVariantPackagingOptionInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let opt = auth::with_actor(actor, packaging_components::create_variant_packaging_option(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(opt).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_variant_packaging_option_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
    payload: packaging_components::UpdateVariantPackagingOptionInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let opt = auth::with_actor(actor, packaging_components::update_variant_packaging_option(&db, id, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(opt).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_variant_packaging_option_pc(
    state: State<'_, DesktopState>,
    token: String,
    id: i64,
) -> Result<(), String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    auth::with_actor(actor, packaging_components::delete_variant_packaging_option(&db, id))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Catalogue Verification Log
// ============================================================================

#[tauri::command]
pub async fn create_catalogue_verification_log_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::CreateCatalogueVerificationLogInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogWrite).await?;
    let db = state.db().await;
    let id = auth::with_actor(actor, packaging_components::create_catalogue_verification_log(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(serde_json::json!({ "id": id })).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_catalogue_verification_logs_pc(
    state: State<'_, DesktopState>,
    token: String,
    entity_type: String,
    entity_id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::CatalogRead).await?;
    let db = state.db().await;
    let logs = auth::with_actor(actor, packaging_components::list_catalogue_verification_logs(&db, entity_type, entity_id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(logs).map_err(|e| e.to_string())
}

// ============================================================================
// Return Packaging Calculation (Calcul centralisé des emballages retour)
// ============================================================================

#[tauri::command]
pub async fn calculate_line_return_packaging_pc(
    state: State<'_, DesktopState>,
    token: String,
    payload: packaging_components::LineReturnPackagingInput,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::SalesRead).await?;
    let db = state.db().await;
    let result = auth::with_actor(actor, packaging_components::calculate_line_return_packaging(&db, payload))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn calculate_sale_return_packaging_pc(
    state: State<'_, DesktopState>,
    token: String,
    lines: Vec<packaging_components::LineReturnPackagingInput>,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::SalesRead).await?;
    let db = state.db().await;
    let result = auth::with_actor(actor, packaging_components::calculate_sale_return_packaging(&db, lines))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_crate_mix_compatibility_pc(
    state: State<'_, DesktopState>,
    token: String,
    variant_ids: Vec<i64>,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::SalesRead).await?;
    let db = state.db().await;
    let result = auth::with_actor(actor, packaging_components::check_crate_mix_compatibility(&db, variant_ids))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pos_packaging_display_pc(
    state: State<'_, DesktopState>,
    token: String,
    variant_id: i64,
) -> Result<serde_json::Value, String> {
    let actor = verify_desktop_perm(&state, &token, Permission::SalesRead).await?;
    let db = state.db().await;
    let result = auth::with_actor(actor, packaging_components::get_pos_packaging_display(&db, variant_id))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}
