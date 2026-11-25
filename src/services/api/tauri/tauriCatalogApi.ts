import type { ApiClient } from "../ApiClient.ts";
import { getStoredTauriToken, tauriInvoke } from "./tauriTransport.ts";

/* ============================================================================
 * Commandes Tauri : Catalogue V3 / V4 (catégories, produits, brasseries, unités)
 * ============================================================================ */

export const tauriCatalogApi = {
  listCategories: () =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listCategories"]>>>(
      "list_categories",
      { token: getStoredTauriToken() },
    ),
  createCategory: (name: string, description?: string, parentId?: number | null) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createCategory"]>>>(
      "create_category",
      { token: getStoredTauriToken(), name, parentId: parentId ?? null, description },
    ),
  updateCategory: (id: number, input: Parameters<ApiClient["updateCategory"]>[1]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["updateCategory"]>>>(
      "update_category",
      {
        token: getStoredTauriToken(),
        id,
        name: input.name,
        parentId: input.parent_id ?? null,
        description: input.description,
        isActive: input.is_active,
      },
    ),
  listProducts: (
    params: Parameters<ApiClient["listProducts"]>[0] = {},
  ) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listProducts"]>>>(
      "list_products",
      {
        token: getStoredTauriToken(),
        search: params.search,
        categoryId: params.categoryId,
        includeArchived: params.includeArchived,
        lowStockOnly: params.lowStockOnly,
        page: params.page,
        pageSize: params.pageSize,
      },
    ),
  createProduct: (input: Record<string, unknown>) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createProduct"]>>>(
      "create_product",
      { token: getStoredTauriToken(), payload: input },
    ),
  updateProduct: (id: number, input: Record<string, unknown>) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["updateProduct"]>>>(
      "update_product",
      { token: getStoredTauriToken(), id, payload: input },
    ),
  deleteProduct: (id: number) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["deleteProduct"]>>>(
      "delete_product",
      { token: getStoredTauriToken(), id },
    ),
  upsertPackaging: (productId: number, pkg: Record<string, unknown>) =>
    tauriInvoke("upsert_packaging", {
      token: getStoredTauriToken(),
      productId,
      pkg,
    }),
  listBreweries: (search?: string) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listBreweries"]>>>(
      "list_breweries",
      { token: getStoredTauriToken(), search },
    ),
  createBrewery: (input: Parameters<ApiClient["createBrewery"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createBrewery"]>>>(
      "create_brewery",
      { token: getStoredTauriToken(), payload: input },
    ),
  listBrandsV4: (search?: string) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listBrandsV4"]>>>(
      "list_brands_v4",
      { token: getStoredTauriToken(), search },
    ),
  createBrandV4: (input: Parameters<ApiClient["createBrandV4"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createBrandV4"]>>>(
      "create_brand_v4",
      { token: getStoredTauriToken(), payload: input },
    ),
  listCrateTypes: (search?: string) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listCrateTypes"]>>>(
      "list_crate_types_pc",
      { token: getStoredTauriToken(), search, active_only: true },
    ),
  createCrateType: (input: Parameters<ApiClient["createCrateType"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createCrateType"]>>>(
      "create_crate_type_pc",
      { token: getStoredTauriToken(), payload: input },
    ),
  updateCrateType: (id: number, input: Parameters<ApiClient["updateCrateType"]>[1]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["updateCrateType"]>>>(
      "update_crate_type_pc",
      { token: getStoredTauriToken(), id, payload: input },
    ),
  deleteCrateType: (id: number) =>
    tauriInvoke<void>("delete_crate_type_pc", {
      token: getStoredTauriToken(),
      id,
    }),
  // Packaging Profiles
  listPackagingProfiles: (params?: { include_archived?: boolean; verification_status?: string }) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listPackagingProfiles"]>>>(
      "list_packaging_profiles_pc",
      { token: getStoredTauriToken(), include_archived: params?.include_archived ?? false, verification_status: params?.verification_status },
    ),
  createPackagingProfile: (input: Parameters<ApiClient["createPackagingProfile"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createPackagingProfile"]>>>(
      "create_packaging_profile_pc",
      { token: getStoredTauriToken(), payload: input },
    ),
  updatePackagingProfile: (id: number, input: Parameters<ApiClient["updatePackagingProfile"]>[1]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["updatePackagingProfile"]>>>(
      "update_packaging_profile_pc",
      { token: getStoredTauriToken(), id, payload: input },
    ),
  deletePackagingProfile: (id: number) =>
    tauriInvoke<void>("delete_packaging_profile_pc", {
      token: getStoredTauriToken(),
      id,
    }),
  // Variant Packaging Options
  listVariantPackagingOptions: (variantId: number) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listVariantPackagingOptions"]>>>(
      "list_variant_packaging_options_pc",
      { token: getStoredTauriToken(), variant_id: variantId },
    ),
  createVariantPackagingOption: (input: Parameters<ApiClient["createVariantPackagingOption"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createVariantPackagingOption"]>>>(
      "create_variant_packaging_option_pc",
      { token: getStoredTauriToken(), payload: input },
    ),
  updateVariantPackagingOption: (id: number, input: Parameters<ApiClient["updateVariantPackagingOption"]>[1]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["updateVariantPackagingOption"]>>>(
      "update_variant_packaging_option_pc",
      { token: getStoredTauriToken(), id, payload: input },
    ),
  deleteVariantPackagingOption: (id: number) =>
    tauriInvoke<void>("delete_variant_packaging_option_pc", {
      token: getStoredTauriToken(),
      id,
    }),
  // Catalogue Verification Logs
  listCatalogueVerificationLogs: (entityType: string, entityId: number) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listCatalogueVerificationLogs"]>>>(
      "list_catalogue_verification_logs_pc",
      { token: getStoredTauriToken(), entity_type: entityType, entity_id: entityId },
    ),
  // Return Packaging Calculation
  calculateLineReturnPackaging: (input: Parameters<ApiClient["calculateLineReturnPackaging"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["calculateLineReturnPackaging"]>>>(
      "calculate_line_return_packaging_pc",
      { token: getStoredTauriToken(), payload: input },
    ),
  calculateSaleReturnPackaging: (lines: Parameters<ApiClient["calculateSaleReturnPackaging"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["calculateSaleReturnPackaging"]>>>(
      "calculate_sale_return_packaging_pc",
      { token: getStoredTauriToken(), lines },
    ),
  checkCrateMixCompatibility: (variantIds: Parameters<ApiClient["checkCrateMixCompatibility"]>[0]) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["checkCrateMixCompatibility"]>>>(
      "check_crate_mix_compatibility_pc",
      { token: getStoredTauriToken(), variant_ids: variantIds },
    ),
  getPosPackagingDisplay: (variantId: number) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["getPosPackagingDisplay"]>>>(
      "get_pos_packaging_display_pc",
      { token: getStoredTauriToken(), variant_id: variantId },
    ),
  listContainerTypesV4: () =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listContainerTypesV4"]>>>(
      "list_container_types_v4",
      { token: getStoredTauriToken() },
    ),
  listPackagingTypesV4: () =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listPackagingTypesV4"]>>>(
      "list_packaging_types_v4",
      { token: getStoredTauriToken() },
    ),
  listStockLocationsV4: () =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listStockLocationsV4"]>>>(
      "list_stock_locations_v4",
      { token: getStoredTauriToken() },
    ),
  listSalesUnits: (productId: number) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listSalesUnits"]>>>(
      "list_sales_units_v4",
      { token: getStoredTauriToken(), productId },
    ),
  createSalesUnit: (input: Record<string, unknown>) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["createSalesUnit"]>>>(
      "create_sales_unit_v4",
      { token: getStoredTauriToken(), payload: input },
    ),
  updateSalesUnit: (id: number, input: Record<string, unknown>) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["updateSalesUnit"]>>>(
      "update_sales_unit_v4",
      { token: getStoredTauriToken(), id, payload: input },
    ),
  deleteSalesUnit: (id: number) =>
    tauriInvoke<void>("delete_sales_unit_v4", {
      token: getStoredTauriToken(),
      id,
    }),
  listProductSuppliers: (productId: number) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listProductSuppliers"]>>>(
      "list_product_suppliers_v4",
      { token: getStoredTauriToken(), productId },
    ),
  upsertProductSupplier: (productId: number, input: Record<string, unknown>) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["upsertProductSupplier"]>>>(
      "upsert_product_supplier_v4",
      { token: getStoredTauriToken(), payload: { ...input, product_id: productId } },
    ),
  listDepositRules: (productId?: number) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listDepositRules"]>>>(
      "list_deposit_rules_v4",
      { token: getStoredTauriToken(), productId: productId ?? null },
    ),
  exportProductsCsv: () =>
    tauriInvoke<string>("export_products_csv", {
      token: getStoredTauriToken(),
    }),
  importProductsCsv: (csv: string) =>
    tauriInvoke<{ created: number }>("import_products_csv", {
      token: getStoredTauriToken(),
      csv,
    }),
  listCatalogPresets: () =>
    tauriInvoke<Awaited<ReturnType<ApiClient["listCatalogPresets"]>>>(
      "list_catalog_presets",
      { token: getStoredTauriToken() },
    ),
  applyCatalogPresets: (keys: string[], activate: boolean) =>
    tauriInvoke<Awaited<ReturnType<ApiClient["applyCatalogPresets"]>>>(
      "apply_catalog_presets",
      { token: getStoredTauriToken(), keys, activate },
    ),
};
