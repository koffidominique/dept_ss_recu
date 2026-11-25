// ============================================================================
// Handlers HTTP : Emballages composants, assemblage & profils bouteilles/casiers
// ============================================================================

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};

use depotpro_core::application::auth::{self, Permission};
use depotpro_core::application::packaging_components;
use depotpro_core::CoreError;

use crate::state::{map_err, require_perm, AppState};

pub(crate) async fn packaging_components_overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::get_components_overview(&db)).await {
        Ok(ov) => (StatusCode::OK, Json(serde_json::to_value(ov).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn list_crate_components(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, async {
        Ok::<_, CoreError>(
            packaging_components::get_components_overview(&db)
                .await?
                .crate_components,
        )
    })
    .await
    {
        Ok(list) => (StatusCode::OK, Json(serde_json::to_value(list).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn create_crate_component(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::CreateCrateComponentInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_components::create_crate_component(&db, payload),
    )
    .await
    {
        Ok(c) => (StatusCode::CREATED, Json(serde_json::to_value(c).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn packaging_stock_overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, async {
        Ok::<_, CoreError>(
            packaging_components::get_components_overview(&db)
                .await?
                .component_stock,
        )
    })
    .await
    {
        Ok(list) => (StatusCode::OK, Json(serde_json::to_value(list).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn update_component_stock(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::UpdateComponentStockInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_components::update_component_stock(&db, payload),
    )
    .await
    {
        Ok(mv) => (StatusCode::CREATED, Json(serde_json::to_value(mv).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn assemble_crates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::AssembleCratesInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::assemble_crates(&db, payload)).await {
        Ok(rec) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(rec).unwrap()),
        )
            .into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn disassemble_crates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::DisassembleCratesInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_components::disassemble_crates(&db, payload),
    )
    .await
    {
        Ok(rec) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(rec).unwrap()),
        )
            .into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn list_bottle_profiles_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_components::get_bottle_profiles_by_material(&db, "glass".into()),
    )
    .await
    {
        Ok(list) => (StatusCode::OK, Json(serde_json::to_value(list).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn create_bottle_profile_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::CreateBottleProfileInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(
        actor,
        packaging_components::create_bottle_profile(&db, payload),
    )
    .await
    {
        Ok(p) => (StatusCode::CREATED, Json(serde_json::to_value(p).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn list_crate_types_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, async {
        Ok::<_, CoreError>(packaging_components::get_crate_types(&db, true).await)
    })
    .await
    {
        Ok(list) => (StatusCode::OK, Json(serde_json::to_value(list).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn create_crate_type_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::CreateCrateTypeInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::create_crate_type(&db, payload)).await {
        Ok(t) => (StatusCode::CREATED, Json(serde_json::to_value(t).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn update_crate_type_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<packaging_components::UpdateCrateTypeInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::update_crate_type(&db, id, payload)).await {
        Ok(t) => (StatusCode::OK, Json(serde_json::to_value(t).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn delete_crate_type_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::ConsignmentsWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::delete_crate_type(&db, id)).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

// ============================================================================
// Packaging Profiles (Profils d'emballages physiques)
// ============================================================================

pub(crate) async fn list_packaging_profiles_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let include_archived = params.get("include_archived").and_then(|v| v.parse::<bool>().ok()).unwrap_or(false);
    let verification_status = params.get("verification_status").cloned();
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::list_packaging_profiles(&db, include_archived, verification_status)).await {
        Ok(list) => (StatusCode::OK, Json(serde_json::to_value(list).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn get_packaging_profile_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::get_packaging_profile(&db, id)).await {
        Ok(profile) => (StatusCode::OK, Json(serde_json::to_value(profile).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn create_packaging_profile_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::CreatePackagingProfileInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::create_packaging_profile(&db, payload)).await {
        Ok(p) => (StatusCode::CREATED, Json(serde_json::to_value(p).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn update_packaging_profile_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<packaging_components::UpdatePackagingProfileInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::update_packaging_profile(&db, id, payload)).await {
        Ok(p) => (StatusCode::OK, Json(serde_json::to_value(p).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn delete_packaging_profile_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::delete_packaging_profile(&db, id)).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

// ============================================================================
// Variant Packaging Options (Options de conditionnement par variante)
// ============================================================================

pub(crate) async fn list_variant_packaging_options_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(variant_id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::list_variant_packaging_options(&db, variant_id)).await {
        Ok(list) => (StatusCode::OK, Json(serde_json::to_value(list).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn get_variant_packaging_option_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::get_variant_packaging_option(&db, id)).await {
        Ok(opt) => (StatusCode::OK, Json(serde_json::to_value(opt).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn create_variant_packaging_option_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::CreateVariantPackagingOptionInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::create_variant_packaging_option(&db, payload)).await {
        Ok(opt) => (StatusCode::CREATED, Json(serde_json::to_value(opt).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn update_variant_packaging_option_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(payload): Json<packaging_components::UpdateVariantPackagingOptionInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::update_variant_packaging_option(&db, id, payload)).await {
        Ok(opt) => (StatusCode::OK, Json(serde_json::to_value(opt).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn delete_variant_packaging_option_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::delete_variant_packaging_option(&db, id)).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

// ============================================================================
// Catalogue Verification Log
// ============================================================================

pub(crate) async fn create_catalogue_verification_log_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::CreateCatalogueVerificationLogInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogWrite).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::create_catalogue_verification_log(&db, payload)).await {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({ "id": id }))).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn list_catalogue_verification_logs_pc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((entity_type, entity_id)): Path<(String, i64)>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::CatalogRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::list_catalogue_verification_logs(&db, entity_type, entity_id)).await {
        Ok(logs) => (StatusCode::OK, Json(serde_json::to_value(logs).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

// ============================================================================
// Return Packaging Calculation (Calcul centralisé des emballages retour)
// ============================================================================

pub(crate) async fn calculate_line_return_packaging_http(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<packaging_components::LineReturnPackagingInput>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::SalesRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::calculate_line_return_packaging(&db, payload)).await {
        Ok(result) => (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn calculate_sale_return_packaging_http(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Vec<packaging_components::LineReturnPackagingInput>>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::SalesRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::calculate_sale_return_packaging(&db, payload)).await {
        Ok(result) => (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn check_crate_mix_compatibility_http(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Vec<i64>>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::SalesRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::check_crate_mix_compatibility(&db, payload)).await {
        Ok(result) => (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}

pub(crate) async fn get_pos_packaging_display_http(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(variant_id): Path<i64>,
) -> impl IntoResponse {
    let actor = match require_perm(&state, &headers, Permission::SalesRead).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let db = state.db().await;
    match auth::with_actor(actor, packaging_components::get_pos_packaging_display(&db, variant_id)).await {
        Ok(result) => (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response(),
        Err(e) => map_err(e).into_response(),
    }
}
