// ============================================================================
// Structures d'entrée pour composants d'emballage, casiers et profils
// ============================================================================

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateCrateTypeInput {
    pub code: String,
    pub name: String,
    pub producer: String,
    pub capacity: Option<i64>,
    pub bottle_capacity_ml: i64,
    pub bottle_profile_id: i64,
    pub compatibility_group_id: Option<i64>,
    pub dimensions: Option<String>,
    pub weight_g: Option<i64>,
    pub material: String,
    pub deposit_value: i64,
    pub description: Option<String>,
    pub capacity_verification_status: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCrateTypeInput {
    pub name: Option<String>,
    pub capacity: Option<i64>,
    pub bottle_capacity_ml: Option<i64>,
    pub compatibility_group_id: Option<i64>,
    pub dimensions: Option<String>,
    pub weight_g: Option<i64>,
    pub material: Option<String>,
    pub deposit_value: Option<i64>,
    pub description: Option<String>,
    pub capacity_verification_status: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBottleProfileInput {
    pub code: String,
    pub name: String,
    pub producer: String,
    pub material: String,
    pub capacity_ml: i64,
    pub diameter_mm: Option<i64>,
    pub height_mm: Option<i64>,
    pub weight_g: Option<i64>,
    pub base_type: Option<String>,
    pub neck_type: Option<String>,
    pub compatibility_group_id: Option<i64>,
    pub deposit_value: i64,
    pub description: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBottleProfileInput {
    pub name: Option<String>,
    pub material: Option<String>,
    pub capacity_ml: Option<i64>,
    pub diameter_mm: Option<i64>,
    pub height_mm: Option<i64>,
    pub weight_g: Option<i64>,
    pub base_type: Option<String>,
    pub neck_type: Option<String>,
    pub deposit_value: Option<i64>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCrateComponentInput {
    pub crate_type_id: i64,
    pub component_type: String,
    pub component_profile_id: Option<i64>,
    pub quantity_per_crate: i64,
    pub deposit_value: i64,
    pub is_required: bool,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateComponentStockInput {
    pub component_type: String,
    pub component_profile_id: Option<i64>,
    pub crate_type_id: Option<i64>,
    pub movement_type: String,
    pub quantity: i64,
    pub reason: String,
    pub reference_document: Option<String>,
    pub request_key: String,
}

#[derive(Debug, Deserialize)]
pub struct AssembleCratesInput {
    pub crate_type_id: i64,
    pub quantity: i64,
    pub reason: Option<String>,
    pub request_key: String,
}

#[derive(Debug, Deserialize)]
pub struct DisassembleCratesInput {
    pub crate_type_id: i64,
    pub quantity: i64,
    pub reason: Option<String>,
    pub request_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePackagingProfileInput {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub packaging_material: Option<String>,
    pub is_returnable: Option<bool>,
    pub is_physically_tracked: Option<bool>,
    pub tracking_mode: Option<String>,
    pub capacity_units: Option<i64>,
    pub capacity_unit_label: Option<String>,
    pub compatible_group_id: Option<i64>,
    pub default_value_xof: Option<i64>,
    pub verification_status: Option<String>,
    pub verification_source: Option<String>,
    pub verification_comment: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePackagingProfileInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub packaging_material: Option<String>,
    pub is_returnable: Option<bool>,
    pub is_physically_tracked: Option<bool>,
    pub tracking_mode: Option<String>,
    pub capacity_units: Option<i64>,
    pub capacity_unit_label: Option<String>,
    pub compatible_group_id: Option<Option<i64>>,
    pub default_value_xof: Option<i64>,
    pub verification_status: Option<String>,
    pub verification_source: Option<String>,
    pub verification_comment: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVariantPackagingOptionInput {
    pub variant_id: i64,
    pub commercial_packaging_type_id: i64,
    pub packaging_profile_id: Option<i64>,
    pub units_per_package: i64,
    pub is_returnable: Option<bool>,
    pub is_default_sale: Option<bool>,
    pub is_default_purchase: Option<bool>,
    pub verification_status: Option<String>,
    pub verification_source: Option<String>,
    pub verification_comment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVariantPackagingOptionInput {
    pub packaging_profile_id: Option<Option<i64>>,
    pub units_per_package: Option<i64>,
    pub is_returnable: Option<bool>,
    pub is_default_sale: Option<bool>,
    pub is_default_purchase: Option<bool>,
    pub verification_status: Option<String>,
    pub verification_source: Option<String>,
    pub verification_comment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCatalogueVerificationLogInput {
    pub entity_type: String,
    pub entity_id: i64,
    pub field_name: Option<String>,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub verification_status: String,
    pub verification_source: Option<String>,
    pub comment: Option<String>,
}
