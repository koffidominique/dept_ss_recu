// ============================================================================
// Composants d'emballages, assemblage de casiers, profils bouteilles & casiers
// ============================================================================

mod bottle_profiles;
mod components;
mod crate_assembly;
mod crate_types;
mod dtos;
mod inputs;
mod return_calculation;
mod variant_packaging;

pub use bottle_profiles::{
    create_bottle_profile, delete_bottle_profile, get_bottle_profile,
    get_bottle_profiles_by_material, update_bottle_profile,
};
pub use components::{create_crate_component, get_components_overview, update_component_stock};
pub use crate_assembly::{assemble_crates, disassemble_crates};
pub use crate_types::{
    create_crate_type, delete_crate_type, get_crate_type, get_crate_types, update_crate_type,
};
pub use dtos::{
    BottleProfileDto, CatalogueVerificationLogDto, ComponentType, ContainerTypeDto,
    CrateAssemblyRecordDto, CrateComponentDto, CrateDisassemblyRecordDto, CrateTypeDto,
    CustomerPackagingComponentBalanceDto, DisposablePackagingTypeDto,
    MovementType, PackagingComponentMovementDto, PackagingComponentStockDto,
    PackagingComponentsOverviewDto, PackagingProfileDto, ProductVariantDto,
    VariantPackagingOptionDto,
};
pub use inputs::{
    AssembleCratesInput, CreateBottleProfileInput, CreateCatalogueVerificationLogInput,
    CreateCrateComponentInput, CreateCrateTypeInput, CreatePackagingProfileInput,
    CreateVariantPackagingOptionInput, DisassembleCratesInput, UpdateBottleProfileInput,
    UpdateComponentStockInput, UpdateCrateTypeInput, UpdatePackagingProfileInput,
    UpdateVariantPackagingOptionInput,
};
pub use return_calculation::{
    calculate_line_return_packaging, calculate_sale_return_packaging,
    check_crate_mix_compatibility, get_pos_packaging_display,
    CrateMixCompatibilityResult, LineReturnPackagingInput, PosPackagingDisplay,
    ReturnPackagingCalculation, SaleReturnPackagingResult,
};
pub use variant_packaging::{
    create_catalogue_verification_log, create_packaging_profile,
    create_variant_packaging_option, delete_packaging_profile,
    delete_variant_packaging_option, get_packaging_profile, get_variant_packaging_option,
    list_catalogue_verification_logs, list_packaging_profiles,
    list_variant_packaging_options, update_packaging_profile,
    update_variant_packaging_option,
};
