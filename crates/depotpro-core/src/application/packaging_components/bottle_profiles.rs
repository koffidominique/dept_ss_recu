// ============================================================================
// CRUD des profils de bouteilles consignées
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{BottleProfileDto, CreateBottleProfileInput, UpdateBottleProfileInput};

const SELECT_BOTTLE_PROFILE_SQL: &str =
    "SELECT id, code, name, producer, material, capacity_ml, diameter_mm, height_mm, weight_g,
            base_type, neck_type, compatibility_group_id, deposit_value, description, is_active,
            created_at, created_at AS updated_at
     FROM bottle_profiles";

pub async fn create_bottle_profile(
    db: &DepotDb,
    input: CreateBottleProfileInput,
) -> CoreResult<BottleProfileDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO bottle_profiles (code, name, producer, material, capacity_ml, diameter_mm, height_mm, weight_g, base_type, neck_type, compatibility_group_id, deposit_value, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(input.code.trim())
    .bind(input.name.trim())
    .bind(input.producer.trim())
    .bind(input.material.trim())
    .bind(input.capacity_ml)
    .bind(input.diameter_mm)
    .bind(input.height_mm)
    .bind(input.weight_g)
    .bind(input.base_type)
    .bind(input.neck_type)
    .bind(input.compatibility_group_id)
    .bind(input.deposit_value)
    .bind(input.description)
    .bind(if input.is_active { 1 } else { 0 })
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    get_bottle_profile(db, id).await
}

pub async fn get_bottle_profile(db: &DepotDb, profile_id: i64) -> CoreResult<BottleProfileDto> {
    require_current_actor_permission(Permission::CatalogRead)?;

    let profile = sqlx::query_as::<_, BottleProfileDto>(&format!(
        "{SELECT_BOTTLE_PROFILE_SQL} WHERE id = ?"
    ))
    .bind(profile_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| CoreError::NotFound("Profil de bouteille introuvable.".to_string()))?;

    Ok(profile)
}

pub async fn get_bottle_profiles_by_material(
    db: &DepotDb,
    material: String,
) -> CoreResult<Vec<BottleProfileDto>> {
    require_current_actor_permission(Permission::CatalogRead)?;

    let profiles = sqlx::query_as::<_, BottleProfileDto>(&format!(
        "{SELECT_BOTTLE_PROFILE_SQL} WHERE material = ? ORDER BY name ASC"
    ))
    .bind(material)
    .fetch_all(&db.pool)
    .await?;

    Ok(profiles)
}

pub async fn update_bottle_profile(
    db: &DepotDb,
    profile_id: i64,
    input: UpdateBottleProfileInput,
) -> CoreResult<BottleProfileDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let existing = get_bottle_profile(db, profile_id).await?;
    let next_name = input.name.unwrap_or(existing.name);
    let next_material = input.material.unwrap_or(existing.material);
    let next_capacity_ml = input.capacity_ml.unwrap_or(existing.capacity_ml);
    let next_diameter_mm = input.diameter_mm.or(existing.diameter_mm);
    let next_height_mm = input.height_mm.or(existing.height_mm);
    let next_weight_g = input.weight_g.or(existing.weight_g);
    let next_base_type = input.base_type.or(existing.base_type);
    let next_neck_type = input.neck_type.or(existing.neck_type);
    let next_deposit_value = input.deposit_value.unwrap_or(existing.deposit_value);
    let next_description = input.description.or(existing.description);
    let next_active = input.is_active.unwrap_or(existing.is_active);

    let (_guard, mut tx) = db.begin_write().await?;
    sqlx::query(
        "UPDATE bottle_profiles
         SET name = ?, material = ?, capacity_ml = ?, diameter_mm = ?, height_mm = ?,
             weight_g = ?, base_type = ?, neck_type = ?, deposit_value = ?,
             description = ?, is_active = ?
         WHERE id = ?",
    )
    .bind(next_name.trim())
    .bind(next_material.trim())
    .bind(next_capacity_ml)
    .bind(next_diameter_mm)
    .bind(next_height_mm)
    .bind(next_weight_g)
    .bind(next_base_type)
    .bind(next_neck_type)
    .bind(next_deposit_value)
    .bind(next_description)
    .bind(if next_active { 1 } else { 0 })
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    get_bottle_profile(db, profile_id).await
}

pub async fn delete_bottle_profile(db: &DepotDb, profile_id: i64) -> CoreResult<()> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;
    sqlx::query("DELETE FROM bottle_profiles WHERE id = ?")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(())
}
