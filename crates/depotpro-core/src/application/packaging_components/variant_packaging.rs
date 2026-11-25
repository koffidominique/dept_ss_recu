// ============================================================================
// CRUD pour profils d'emballages physiques (packaging_profiles) et options de conditionnement par variante
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use super::{
    CatalogueVerificationLogDto, CreateCatalogueVerificationLogInput, CreatePackagingProfileInput,
    CreateVariantPackagingOptionInput, PackagingProfileDto,
    UpdatePackagingProfileInput, UpdateVariantPackagingOptionInput,
    VariantPackagingOptionDto,
};

/// Liste paginée des profils d'emballage physiques
pub async fn list_packaging_profiles(
    db: &DepotDb,
    include_archived: bool,
    verification_status: Option<String>,
) -> CoreResult<Vec<PackagingProfileDto>> {
    require_current_actor_permission(Permission::CatalogRead)?;
    let mut query = String::from(
        "SELECT * FROM packaging_profiles WHERE (? = 1 OR is_active = 1)",
    );
    let mut args: Vec<Box<dyn sqlx::Encode<'_, sqlx::Sqlite> + Send + Sync>> = vec![Box::new(if include_archived { 1_i64 } else { 0_i64 })];

    if let Some(status) = verification_status {
        query.push_str(" AND verification_status = ?");
        args.push(Box::new(status));
    }

    query.push_str(" ORDER BY code ASC");

    let rows = sqlx::query_as_with::<_, PackagingProfileDto, _>(&query, sqlx::sqlite::SqliteArguments::default())
        .fetch_all(&db.pool)
        .await?;
    Ok(rows)
}

/// Obtient un profil d'emballage par ID
pub async fn get_packaging_profile(db: &DepotDb, id: i64) -> CoreResult<PackagingProfileDto> {
    require_current_actor_permission(Permission::CatalogRead)?;
    let row = sqlx::query_as::<_, PackagingProfileDto>(
        "SELECT * FROM packaging_profiles WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

/// Crée un nouveau profil d'emballage physique
pub async fn create_packaging_profile(
    db: &DepotDb,
    input: CreatePackagingProfileInput,
) -> CoreResult<PackagingProfileDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;
    let clean_code = input.code.trim().to_uppercase();
    let clean_name = input.name.trim();
    if clean_code.is_empty() || clean_name.is_empty() {
        return Err(CoreError::Validation(
            "Le code et le nom sont obligatoires.".to_string(),
        ));
    }

    let material = input.packaging_material.as_deref().unwrap_or("plastic");
    let is_returnable = input.is_returnable.unwrap_or(true);
    let is_physically_tracked = input.is_physically_tracked.unwrap_or(true);
    let tracking_mode = input.tracking_mode.as_deref().unwrap_or("crate_physical");
    let capacity_unit_label = input.capacity_unit_label.as_deref().unwrap_or("bouteille");
    let default_value = input.default_value_xof.unwrap_or(0);
    let verification_status = input.verification_status.as_deref().unwrap_or("needs_verification");
    let is_active = input.is_active.unwrap_or(true);

    let (_guard, mut tx) = db.begin_write().await?;
    // Check duplicate code
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM packaging_profiles WHERE code = ?")
        .bind(&clean_code)
        .fetch_one(&mut *tx)
        .await?;
    if exists > 0 {
        return Err(CoreError::Validation(
            "Un profil d'emballage avec ce code existe déjà.".to_string(),
        ));
    }

    let id = sqlx::query(
        r#"
        INSERT INTO packaging_profiles (code, name, description, packaging_material, is_returnable, is_physically_tracked, tracking_mode, capacity_units, capacity_unit_label, compatible_group_id, default_value_xof, verification_status, verification_source, verification_comment, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&clean_code)
    .bind(clean_name)
    .bind(input.description.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(material)
    .bind(is_returnable as i64)
    .bind(is_physically_tracked as i64)
    .bind(tracking_mode)
    .bind(input.capacity_units)
    .bind(capacity_unit_label)
    .bind(input.compatible_group_id)
    .bind(default_value)
    .bind(verification_status)
    .bind(input.verification_source.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(input.verification_comment.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(is_active as i64)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    tx.commit().await?;

    get_packaging_profile(db, id).await
}

/// Met à jour un profil d'emballage
pub async fn update_packaging_profile(
    db: &DepotDb,
    id: i64,
    input: UpdatePackagingProfileInput,
) -> CoreResult<PackagingProfileDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;

    // Build dynamic update using individual queries for each field
    if let Some(name) = input.name {
        sqlx::query("UPDATE packaging_profiles SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(name.trim())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(description) = input.description {
        sqlx::query("UPDATE packaging_profiles SET description = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(description.trim())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(material) = input.packaging_material {
        sqlx::query("UPDATE packaging_profiles SET packaging_material = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(material)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = input.is_returnable {
        sqlx::query("UPDATE packaging_profiles SET is_returnable = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(v as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = input.is_physically_tracked {
        sqlx::query("UPDATE packaging_profiles SET is_physically_tracked = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(v as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(tracking_mode) = input.tracking_mode {
        sqlx::query("UPDATE packaging_profiles SET tracking_mode = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(tracking_mode)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(capacity) = input.capacity_units {
        sqlx::query("UPDATE packaging_profiles SET capacity_units = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(capacity)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(label) = input.capacity_unit_label {
        sqlx::query("UPDATE packaging_profiles SET capacity_unit_label = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(label)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(group_id) = input.compatible_group_id {
        sqlx::query("UPDATE packaging_profiles SET compatible_group_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(group_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(value) = input.default_value_xof {
        sqlx::query("UPDATE packaging_profiles SET default_value_xof = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(value)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(status) = input.verification_status {
        sqlx::query("UPDATE packaging_profiles SET verification_status = ?, verification_date = datetime('now'), updated_at = datetime('now') WHERE id = ?")
            .bind(status)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(source) = input.verification_source {
        sqlx::query("UPDATE packaging_profiles SET verification_source = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(source)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(comment) = input.verification_comment {
        sqlx::query("UPDATE packaging_profiles SET verification_comment = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(comment)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(active) = input.is_active {
        sqlx::query("UPDATE packaging_profiles SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(active as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    get_packaging_profile(db, id).await
}

/// Supprime (désactive) un profil d'emballage
pub async fn delete_packaging_profile(db: &DepotDb, id: i64) -> CoreResult<()> {
    require_current_actor_permission(Permission::CatalogWrite)?;
    let (_guard, mut tx) = db.begin_write().await?;
    sqlx::query("UPDATE packaging_profiles SET is_active = 0, updated_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

// ============================================================================
// Variant Packaging Options CRUD
// ============================================================================

/// Liste les options de conditionnement pour une variante
pub async fn list_variant_packaging_options(
    db: &DepotDb,
    variant_id: i64,
) -> CoreResult<Vec<VariantPackagingOptionDto>> {
    require_current_actor_permission(Permission::CatalogRead)?;
    let rows = sqlx::query_as::<_, VariantPackagingOptionDto>(
        "SELECT * FROM variant_packaging_options WHERE variant_id = ? ORDER BY is_default_sale DESC, commercial_packaging_type_id ASC",
    )
    .bind(variant_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

/// Obtient une option de conditionnement par ID
pub async fn get_variant_packaging_option(
    db: &DepotDb,
    id: i64,
) -> CoreResult<VariantPackagingOptionDto> {
    require_current_actor_permission(Permission::CatalogRead)?;
    let row = sqlx::query_as::<_, VariantPackagingOptionDto>(
        "SELECT * FROM variant_packaging_options WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

/// Crée une option de conditionnement pour une variante
pub async fn create_variant_packaging_option(
    db: &DepotDb,
    input: CreateVariantPackagingOptionInput,
) -> CoreResult<VariantPackagingOptionDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;
    if input.units_per_package <= 0 {
        return Err(CoreError::Validation(
            "Le nombre d'unités par conditionnement doit être positif.".to_string(),
        ));
    }

    let is_returnable = input.is_returnable.unwrap_or(false);
    let is_default_sale = input.is_default_sale.unwrap_or(false);
    let is_default_purchase = input.is_default_purchase.unwrap_or(false);
    let verification_status = input.verification_status.as_deref().unwrap_or("needs_verification");

    let (_guard, mut tx) = db.begin_write().await?;

    // Check unique constraint
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM variant_packaging_options WHERE variant_id = ? AND commercial_packaging_type_id = ?",
    )
    .bind(input.variant_id)
    .bind(input.commercial_packaging_type_id)
    .fetch_one(&mut *tx)
    .await?;
    if exists > 0 {
        return Err(CoreError::Validation(
            "Cette variante a déjà une option pour ce type de conditionnement.".to_string(),
        ));
    }

    // If setting as default sale/purchase, unset others
    if is_default_sale {
        sqlx::query(
            "UPDATE variant_packaging_options SET is_default_sale = 0 WHERE variant_id = ?",
        )
        .bind(input.variant_id)
        .execute(&mut *tx)
        .await?;
    }
    if is_default_purchase {
        sqlx::query(
            "UPDATE variant_packaging_options SET is_default_purchase = 0 WHERE variant_id = ?",
        )
        .bind(input.variant_id)
        .execute(&mut *tx)
        .await?;
    }

    let id = sqlx::query(
        r#"
        INSERT INTO variant_packaging_options (variant_id, commercial_packaging_type_id, packaging_profile_id, units_per_package, is_returnable, is_default_sale, is_default_purchase, verification_status, verification_source, verification_comment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(input.variant_id)
    .bind(input.commercial_packaging_type_id)
    .bind(input.packaging_profile_id)
    .bind(input.units_per_package)
    .bind(is_returnable as i64)
    .bind(is_default_sale as i64)
    .bind(is_default_purchase as i64)
    .bind(verification_status)
    .bind(input.verification_source.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(input.verification_comment.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    tx.commit().await?;

    get_variant_packaging_option(db, id).await
}

/// Met à jour une option de conditionnement
pub async fn update_variant_packaging_option(
    db: &DepotDb,
    id: i64,
    input: UpdateVariantPackagingOptionInput,
) -> CoreResult<VariantPackagingOptionDto> {
    require_current_actor_permission(Permission::CatalogWrite)?;

    let (_guard, mut tx) = db.begin_write().await?;

    if let Some(profile_id) = input.packaging_profile_id {
        sqlx::query("UPDATE variant_packaging_options SET packaging_profile_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(profile_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(units) = input.units_per_package {
        if units <= 0 {
            return Err(CoreError::Validation(
                "Le nombre d'unités par conditionnement doit être positif.".to_string(),
            ));
        }
        sqlx::query("UPDATE variant_packaging_options SET units_per_package = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(units)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = input.is_returnable {
        sqlx::query("UPDATE variant_packaging_options SET is_returnable = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(v as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = input.is_default_sale {
        sqlx::query("UPDATE variant_packaging_options SET is_default_sale = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(v as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if v {
            // Need variant_id to unset others - fetch it first
            let variant_id: i64 = sqlx::query_scalar("SELECT variant_id FROM variant_packaging_options WHERE id = ?")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query("UPDATE variant_packaging_options SET is_default_sale = 0 WHERE variant_id = ? AND id != ?")
                .bind(variant_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
    }
    if let Some(v) = input.is_default_purchase {
        sqlx::query("UPDATE variant_packaging_options SET is_default_purchase = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(v as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if v {
            let variant_id: i64 = sqlx::query_scalar("SELECT variant_id FROM variant_packaging_options WHERE id = ?")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query("UPDATE variant_packaging_options SET is_default_purchase = 0 WHERE variant_id = ? AND id != ?")
                .bind(variant_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
    }
    if let Some(status) = input.verification_status {
        sqlx::query("UPDATE variant_packaging_options SET verification_status = ?, verification_date = datetime('now'), updated_at = datetime('now') WHERE id = ?")
            .bind(status)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(source) = input.verification_source {
        sqlx::query("UPDATE variant_packaging_options SET verification_source = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(source)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(comment) = input.verification_comment {
        sqlx::query("UPDATE variant_packaging_options SET verification_comment = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(comment)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    get_variant_packaging_option(db, id).await
}

/// Supprime une option de conditionnement
pub async fn delete_variant_packaging_option(db: &DepotDb, id: i64) -> CoreResult<()> {
    require_current_actor_permission(Permission::CatalogWrite)?;
    let (_guard, mut tx) = db.begin_write().await?;
    sqlx::query("DELETE FROM variant_packaging_options WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

// ============================================================================
// Catalogue Verification Log
// ============================================================================

/// Enregistre une vérification dans le journal
pub async fn create_catalogue_verification_log(
    db: &DepotDb,
    input: CreateCatalogueVerificationLogInput,
) -> CoreResult<i64> {
    require_current_actor_permission(Permission::CatalogWrite)?;
    let (_guard, mut tx) = db.begin_write().await?;
    let id = sqlx::query(
        r#"
        INSERT INTO catalogue_verification_log (entity_type, entity_id, field_name, old_value, new_value, verification_status, verification_source, verified_by, comment)
        VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT id FROM users WHERE 1=1 LIMIT 1), ?)
        "#,
    )
    .bind(input.entity_type)
    .bind(input.entity_id)
    .bind(input.field_name.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(input.old_value.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(input.new_value.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(input.verification_status)
    .bind(input.verification_source.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(input.comment.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    tx.commit().await?;
    Ok(id)
}

/// Liste les logs de vérification pour une entité
pub async fn list_catalogue_verification_logs(
    db: &DepotDb,
    entity_type: String,
    entity_id: i64,
) -> CoreResult<Vec<CatalogueVerificationLogDto>> {
    require_current_actor_permission(Permission::CatalogRead)?;
    let rows = sqlx::query_as::<_, CatalogueVerificationLogDto>(
        "SELECT * FROM catalogue_verification_log WHERE entity_type = ? AND entity_id = ? ORDER BY verified_at DESC",
    )
    .bind(entity_type)
    .bind(entity_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}