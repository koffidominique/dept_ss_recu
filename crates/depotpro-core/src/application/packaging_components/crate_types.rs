// ============================================================================
// CRUD des types de casiers consignés
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{CrateTypeDto, CreateCrateTypeInput, UpdateCrateTypeInput};

const SELECT_CRATE_TYPE_SQL: &str =
    "SELECT id, code, name, producer, capacity, bottle_capacity_ml, bottle_profile_id,
            compatibility_group_id, dimensions, weight_g, material, deposit_value,
            description, is_active, created_at, created_at AS updated_at
     FROM crate_types";

pub async fn create_crate_type(
    db: &DepotDb,
    input: CreateCrateTypeInput,
) -> CoreResult<CrateTypeDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO crate_types (code, name, producer, capacity, bottle_capacity_ml, bottle_profile_id, compatibility_group_id, dimensions, weight_g, material, deposit_value, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(input.code.trim())
    .bind(input.name.trim())
    .bind(input.producer.trim())
    .bind(input.capacity)
    .bind(input.bottle_capacity_ml)
    .bind(input.bottle_profile_id)
    .bind(input.compatibility_group_id)
    .bind(input.dimensions)
    .bind(input.weight_g)
    .bind(input.material.trim())
    .bind(input.deposit_value)
    .bind(input.description)
    .bind(if input.is_active { 1 } else { 0 })
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    get_crate_type(db, id).await
}

pub async fn get_crate_type(db: &DepotDb, crate_type_id: i64) -> CoreResult<CrateTypeDto> {
    require_current_actor_permission(Permission::CatalogRead)?;

    let crate_type = sqlx::query_as::<_, CrateTypeDto>(&format!(
        "{SELECT_CRATE_TYPE_SQL} WHERE id = ?"
    ))
    .bind(crate_type_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| CoreError::NotFound("Type de casier introuvable.".to_string()))?;

    Ok(crate_type)
}

pub async fn get_crate_types(db: &DepotDb, active_only: bool) -> CoreResult<Vec<CrateTypeDto>> {
    require_current_actor_permission(Permission::CatalogRead)?;

    let crate_types = if active_only {
        sqlx::query_as::<_, CrateTypeDto>(&format!(
            "{SELECT_CRATE_TYPE_SQL} WHERE is_active = 1 ORDER BY name ASC"
        ))
        .fetch_all(&db.pool)
        .await?
    } else {
        sqlx::query_as::<_, CrateTypeDto>(&format!(
            "{SELECT_CRATE_TYPE_SQL} ORDER BY name ASC"
        ))
        .fetch_all(&db.pool)
        .await?
    };

    Ok(crate_types)
}

pub async fn update_crate_type(
    db: &DepotDb,
    crate_type_id: i64,
    input: UpdateCrateTypeInput,
) -> CoreResult<CrateTypeDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let existing = get_crate_type(db, crate_type_id).await?;
    let next_name = input.name.unwrap_or(existing.name);
    let next_capacity = input.capacity.unwrap_or(existing.capacity);
    let next_bottle_capacity_ml = input
        .bottle_capacity_ml
        .unwrap_or(existing.bottle_capacity_ml);
    let next_compat_id = input
        .compatibility_group_id
        .or(existing.compatibility_group_id);
    let next_dimensions = input.dimensions.or(existing.dimensions);
    let next_weight_g = input.weight_g.or(existing.weight_g);
    let next_material = input.material.unwrap_or(existing.material);
    let next_deposit_value = input.deposit_value.unwrap_or(existing.deposit_value);
    let next_description = input.description.or(existing.description);
    let next_active = input.is_active.unwrap_or(existing.is_active);

    let (_guard, mut tx) = db.begin_write().await?;
    sqlx::query(
        "UPDATE crate_types
         SET name = ?, capacity = ?, bottle_capacity_ml = ?, compatibility_group_id = ?,
             dimensions = ?, weight_g = ?, material = ?, deposit_value = ?,
             description = ?, is_active = ?
         WHERE id = ?",
    )
    .bind(next_name.trim())
    .bind(next_capacity)
    .bind(next_bottle_capacity_ml)
    .bind(next_compat_id)
    .bind(next_dimensions)
    .bind(next_weight_g)
    .bind(next_material.trim())
    .bind(next_deposit_value)
    .bind(next_description)
    .bind(if next_active { 1 } else { 0 })
    .bind(crate_type_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    get_crate_type(db, crate_type_id).await
}

pub async fn delete_crate_type(db: &DepotDb, crate_type_id: i64) -> CoreResult<()> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;
    sqlx::query("DELETE FROM crate_types WHERE id = ?")
        .bind(crate_type_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(())
}
