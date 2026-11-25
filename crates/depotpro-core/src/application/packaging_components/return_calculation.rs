// ============================================================================
// Service centralisé de calcul des emballages retour
// Source unique de vérité pour les règles métier d'emballage
// ============================================================================

use crate::application::auth::{require_current_actor_permission, Permission};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::db::DepotDb;

use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReturnPackagingCalculation {
    pub variant_id: i64,
    pub variant_name: String,
    pub is_returnable: bool,
    pub packaging_profile_id: Option<i64>,
    pub packaging_profile_name: Option<String>,
    pub crate_capacity: Option<i64>,
    pub crate_capacity_verification_status: Option<String>,
    pub units_per_package: i64,
    pub commercial_packaging_type: String,
    pub missing_crates: i64,
    pub returned_crates: i64,
    pub crate_value_xof: i64,
    pub bottle_deposit_xof: i64,
    pub total_crate_debt_xof: i64,
    pub total_bottle_equivalent: i64,
    pub display_composition: String,
    pub warning: Option<String>,
    pub can_mix_in_crate: bool,
    pub compatibility_group_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineReturnPackagingInput {
    pub variant_id: i64,
    pub quantity_sold: i64,
    pub units_per_package: i64,
    pub missing_crates: i64,
    pub returned_crates: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleReturnPackagingResult {
    pub lines: Vec<ReturnPackagingCalculation>,
    pub total_crate_debt_xof: i64,
    pub total_bottle_equivalent: i64,
    pub warnings: Vec<String>,
}

/// Calcule les emballages retour pour une ligne de vente
pub async fn calculate_line_return_packaging(
    db: &DepotDb,
    input: LineReturnPackagingInput,
) -> CoreResult<ReturnPackagingCalculation> {
    require_current_actor_permission(Permission::SalesRead)?;

    // Récupérer les infos de la variante et son conditionnement
    let variant_info = sqlx::query(
        r#"
        SELECT 
            pv.id as variant_id,
            pv.name as variant_name,
            pv.volume_ml,
            p.name as product_name,
            b.name as brand_name,
            vpo.id as vpo_id,
            vpo.commercial_packaging_type_id,
            vpo.packaging_profile_id,
            vpo.units_per_package,
            vpo.is_returnable,
            vpo.verification_status as vpo_verification_status,
            pt.code as packaging_type_code,
            pt.name as packaging_type_name,
            pt.is_returnable as pt_is_returnable,
            pp.id as profile_id,
            pp.name as profile_name,
            pp.capacity_units,
            pp.capacity_unit_label,
            pp.verification_status as profile_verification_status,
            pp.default_value_xof as profile_value,
            pp.compatible_group_id
        FROM product_variants pv
        JOIN products p ON pv.product_id = p.id
        JOIN brands b ON p.brand = b.code
        LEFT JOIN variant_packaging_options vpo ON vpo.variant_id = pv.id AND vpo.commercial_packaging_type_id = (
            SELECT id FROM packaging_types WHERE code = (
                SELECT pt2.code FROM packaging_types pt2 
                JOIN variant_packaging_options vpo2 ON vpo2.commercial_packaging_type_id = pt2.id
                WHERE vpo2.variant_id = pv.id AND vpo2.is_default_sale = 1
                LIMIT 1
            )
        )
        LEFT JOIN packaging_types pt ON vpo.commercial_packaging_type_id = pt.id
        LEFT JOIN packaging_profiles pp ON vpo.packaging_profile_id = pp.id
        WHERE pv.id = ?
        "#,
    )
    .bind(input.variant_id)
    .fetch_optional(&db.pool)
    .await?;

    let row = match variant_info {
        Some(r) => r,
        None => return Err(CoreError::Validation("Variante introuvable".to_string())),
    };

    let variant_id: i64 = row.try_get("variant_id")?;
    let variant_name: String = row.try_get("variant_name")?;
    let is_returnable: i64 = row.try_get("is_returnable").unwrap_or(0);
    let units_per_package: i64 = row.try_get("units_per_package").unwrap_or(1);
    let commercial_packaging_type: String = row.try_get("packaging_type_code").unwrap_or_else(|_| "UNKNOWN".to_string());
    let packaging_profile_id: Option<i64> = row.try_get("packaging_profile_id").ok();
    let packaging_profile_name: Option<String> = row.try_get("profile_name").ok();
    let crate_capacity: Option<i64> = row.try_get("capacity_units").ok();
    let crate_capacity_verification_status: Option<String> = row.try_get("profile_verification_status").ok();
    let crate_value_xof: i64 = row.try_get("profile_value").unwrap_or(0);
    let compatibility_group_id: Option<i64> = row.try_get("compatible_group_id").ok();

    // Calcul des bouteilles équivalentes
    let missing_crates = input.missing_crates.max(0);
    let returned_crates = input.returned_crates.max(0);
    
    let total_crate_debt_xof = missing_crates * crate_value_xof;
    
    let total_bottle_equivalent = if let Some(cap) = crate_capacity {
        missing_crates * cap
    } else {
        0 // Capacité inconnue
    };

    let can_mix_in_crate = compatibility_group_id.is_some();

    // Message d'avertissement
    let mut warning = None;
    if is_returnable == 1 && crate_capacity.is_none() {
        warning = Some("Capacité du casier non configurée (needs_verification). Calcul des bouteilles équivalentes impossible.".to_string());
    }
    if is_returnable == 1 && crate_value_xof == 0 {
        warning = Some(warning.map_or_else(
            || "Valeur du casier non configurée.".to_string(),
            |w| format!("{} Valeur du casier non configurée.", w)
        ));
    }

    // Composition affichée
    let display_composition = if is_returnable == 1 {
        if let Some(cap) = crate_capacity {
            format!("{} casier(s) + {} bouteille(s) rendus", missing_crates, missing_crates * cap)
        } else {
            format!("{} casier(s) + capacité inconnue", missing_crates)
        }
    } else {
        "Non retournable".to_string()
    };

    // Dépôt bouteille (récupéré depuis le conditionnement produit)
    let bottle_deposit: i64 = sqlx::query_scalar(
        "SELECT COALESCE(bottle_deposit_amount, 0) FROM product_packagings 
         WHERE variant_id = ? AND packaging_type_id = (SELECT id FROM packaging_types WHERE code = ?)
         LIMIT 1"
    )
    .bind(variant_id)
    .bind(&commercial_packaging_type)
    .fetch_optional(&db.pool)
    .await?
    .unwrap_or(0);

    Ok(ReturnPackagingCalculation {
        variant_id,
        variant_name,
        is_returnable: is_returnable == 1,
        packaging_profile_id,
        packaging_profile_name,
        crate_capacity,
        crate_capacity_verification_status,
        units_per_package,
        commercial_packaging_type,
        missing_crates,
        returned_crates,
        crate_value_xof,
        bottle_deposit_xof: bottle_deposit,
        total_crate_debt_xof,
        total_bottle_equivalent,
        display_composition,
        warning,
        can_mix_in_crate,
        compatibility_group_id,
    })
}

/// Calcule les emballages retour pour une vente complète (multiples lignes)
pub async fn calculate_sale_return_packaging(
    db: &DepotDb,
    lines: Vec<LineReturnPackagingInput>,
) -> CoreResult<SaleReturnPackagingResult> {
    require_current_actor_permission(Permission::SalesRead)?;

    let mut results = Vec::new();
    let mut total_crate_debt = 0i64;
    let mut total_bottle_equiv = 0i64;
    let mut warnings = Vec::new();

    for line in lines {
        let calc = calculate_line_return_packaging(db, line).await?;
        
        if let Some(w) = &calc.warning {
            warnings.push(format!("{}: {}", calc.variant_name, w));
        }
        
        total_crate_debt += calc.total_crate_debt_xof;
        total_bottle_equiv += calc.total_bottle_equivalent;
        results.push(calc);
    }

    Ok(SaleReturnPackagingResult {
        lines: results,
        total_crate_debt_xof: total_crate_debt,
        total_bottle_equivalent: total_bottle_equiv,
        warnings,
    })
}

/// Vérifie la compatibilité de mélange dans un casier
pub async fn check_crate_mix_compatibility(
    db: &DepotDb,
    variant_ids: Vec<i64>,
) -> CoreResult<CrateMixCompatibilityResult> {
    require_current_actor_permission(Permission::SalesRead)?;

    if variant_ids.len() < 2 {
        return Ok(CrateMixCompatibilityResult {
            compatible: true,
            group_id: None,
            group_name: None,
            incompatible_pairs: Vec::new(),
            message: "Un seul produit, pas de mélange".to_string(),
        });
    }

    // Récupérer les groupes de compatibilité de chaque variante
    let mut group_ids = Vec::new();
    let mut variant_infos = Vec::new();

    for vid in &variant_ids {
        let info = sqlx::query(
            r#"
            SELECT 
                pv.id,
                pv.name,
                vpo.packaging_profile_id,
                pp.compatible_group_id,
                cg.name as group_name,
                vpo.is_returnable
            FROM product_variants pv
            LEFT JOIN variant_packaging_options vpo ON vpo.variant_id = pv.id AND vpo.is_default_sale = 1
            LEFT JOIN packaging_profiles pp ON vpo.packaging_profile_id = pp.id
            LEFT JOIN crate_compatibility_groups cg ON pp.compatible_group_id = cg.id
            WHERE pv.id = ?
            "#,
        )
        .bind(vid)
        .fetch_optional(&db.pool)
        .await?;

        if let Some(row) = info {
            let is_returnable: i64 = row.try_get("is_returnable").unwrap_or(0);
            if is_returnable == 0 {
                return Ok(CrateMixCompatibilityResult {
                    compatible: false,
                    group_id: None,
                    group_name: None,
                    incompatible_pairs: vec![(row.try_get("name").unwrap_or_default(), "Produit non retournable".to_string())],
                    message: format!("{} n'est pas retournable, ne peut pas être mélangé dans un casier", row.try_get::<String, _>("name").unwrap_or_default()),
                });
            }
            
            let group_id: Option<i64> = row.try_get("compatible_group_id").ok();
            let group_name: Option<String> = row.try_get("group_name").ok();
            
            if group_id.is_none() {
                return Ok(CrateMixCompatibilityResult {
                    compatible: false,
                    group_id: None,
                    group_name: None,
                    incompatible_pairs: vec![(row.try_get("name").unwrap_or_default(), "Pas de groupe de compatibilité défini".to_string())],
                    message: format!("{} n'a pas de groupe de compatibilité défini", row.try_get::<String, _>("name").unwrap_or_default()),
                });
            }

            group_ids.push(group_id.unwrap());
            variant_infos.push((row.get::<String, _>("name"), group_id.unwrap(), group_name));
        }
    }

    // Vérifier que tous sont dans le même groupe
    let first_group = group_ids[0];
    let mut incompatible_pairs = Vec::new();
    
    for (name, gid, _) in &variant_infos {
        if *gid != first_group {
            incompatible_pairs.push((name.clone(), format!("Groupe de compatibilité différent (groupe {})", gid)));
        }
    }

    let compatible = incompatible_pairs.is_empty();
    let group_name = variant_infos[0].2.clone();
    let unknown = "inconnu".to_string();

    let message = if compatible {
        format!("Mélange autorisé dans le groupe '{}'", group_name.as_ref().unwrap_or(&unknown))
    } else {
        "Mélange interdit : profils physiques incompatibles".to_string()
    };

    Ok(CrateMixCompatibilityResult {
        compatible,
        group_id: Some(first_group),
        group_name,
        incompatible_pairs,
        message,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrateMixCompatibilityResult {
    pub compatible: bool,
    pub group_id: Option<i64>,
    pub group_name: Option<String>,
    pub incompatible_pairs: Vec<(String, String)>,
    pub message: String,
}

/// Obtient les détails d'emballage pour affichage POS
pub async fn get_pos_packaging_display(
    db: &DepotDb,
    variant_id: i64,
) -> CoreResult<PosPackagingDisplay> {
    require_current_actor_permission(Permission::SalesRead)?;

    let row = sqlx::query(
        r#"
        SELECT 
            pv.id as variant_id,
            pv.name as variant_name,
            pv.volume_ml,
            p.name as product_name,
            b.name as brand_name,
            ct.name as container_name,
            ct.material as container_material,
            vpo.id as vpo_id,
            pt.code as packaging_type_code,
            pt.name as packaging_type_name,
            vpo.units_per_package,
            vpo.is_returnable,
            vpo.is_default_sale,
            vpo.verification_status as vpo_verification_status,
            pp.id as profile_id,
            pp.name as profile_name,
            pp.capacity_units,
            pp.capacity_unit_label,
            pp.verification_status as profile_verification_status,
            pp.default_value_xof as profile_value,
            pp.compatible_group_id
        FROM product_variants pv
        JOIN products p ON pv.product_id = p.id
        JOIN brands b ON p.brand = b.code
        LEFT JOIN container_types ct ON pv.container_type = ct.code
        LEFT JOIN variant_packaging_options vpo ON vpo.variant_id = pv.id AND vpo.is_default_sale = 1
        LEFT JOIN packaging_types pt ON vpo.commercial_packaging_type_id = pt.id
        LEFT JOIN packaging_profiles pp ON vpo.packaging_profile_id = pp.id
        WHERE pv.id = ?
        "#,
    )
    .bind(variant_id)
    .fetch_optional(&db.pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Err(CoreError::Validation("Variante introuvable".to_string())),
    };

    let is_returnable: i64 = row.try_get("is_returnable").unwrap_or(0);
    let crate_capacity: Option<i64> = row.try_get("capacity_units").ok();
    let capacity_unit_label: String = row.try_get("capacity_unit_label").unwrap_or_else(|_| "bouteille".to_string());
    let profile_verification_status: Option<String> = row.try_get("profile_verification_status").ok();
    let crate_value: i64 = row.try_get("profile_value").unwrap_or(0);
    let packaging_type_code: String = row.try_get("packaging_type_code").unwrap_or_else(|_| "".to_string());
    let packaging_type_name: String = row.try_get("packaging_type_name").unwrap_or_else(|_| "".to_string());
    let container_name: String = row.try_get("container_name").unwrap_or_else(|_| "".to_string());
    let container_material: String = row.try_get("container_material").unwrap_or_else(|_| "".to_string());
    let volume_ml: i64 = row.try_get("volume_ml").unwrap_or(0);
    let units_per_package: i64 = row.try_get("units_per_package").unwrap_or(1);

    // Déterminer l'affichage de la capacité
    let capacity_display = if let Some(cap) = crate_capacity {
        format!("{} {}", cap, capacity_unit_label)
    } else {
        match profile_verification_status.as_deref() {
            Some("needs_verification") => "À vérifier".to_string(),
            Some("owner_confirmed") => "Confirmée par l'owner".to_string(),
            Some("inactive") => "Inactive".to_string(),
            _ => "Non définie".to_string(),
        }
    };

    // Indicateur de vérification
    let verification_indicator = match profile_verification_status.as_deref() {
        Some("verified") => "✅",
        Some("needs_verification") => "⚠️",
        Some("owner_confirmed") => "ℹ️",
        Some("inactive") => "❌",
        _ => "❓",
    };

    let verification_status = profile_verification_status.unwrap_or_else(|| "unknown".to_string());

    // Warning message
    let warning = if is_returnable == 1 && crate_capacity.is_none() {
        Some("Capacité du casier non configurée (needs_verification). Calcul des bouteilles équivalentes impossible.".to_string())
    } else if is_returnable == 1 && crate_value == 0 {
        Some("Valeur du casier non configurée.".to_string())
    } else {
        None
    };

    Ok(PosPackagingDisplay {
        variant_id,
        variant_name: row.get("variant_name"),
        packaging_type_code,
        packaging_type_name,
        container_name,
        container_material,
        volume_ml,
        units_per_package,
        is_returnable: is_returnable == 1,
        crate_capacity,
        capacity_display,
        capacity_unit_label,
        verification_status,
        verification_indicator: verification_indicator.to_string(),
        crate_value_xof: crate_value,
        formatted_crate_value: if crate_value > 0 { format!("{} FCFA", crate_value) } else { "—".to_string() },
        warning,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosPackagingDisplay {
    pub variant_id: i64,
    pub variant_name: String,
    pub packaging_type_code: String,
    pub packaging_type_name: String,
    pub container_name: String,
    pub container_material: String,
    pub volume_ml: i64,
    pub units_per_package: i64,
    pub is_returnable: bool,
    pub crate_capacity: Option<i64>,
    pub capacity_display: String,
    pub capacity_unit_label: String,
    pub verification_status: String,
    pub verification_indicator: String,
    pub crate_value_xof: i64,
    pub formatted_crate_value: String,
    pub warning: Option<String>,
}