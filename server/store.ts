import fs from 'node:fs';
import path from 'node:path';
import type {
  CatalogPresetItem,
  PackagingName,
  Product,
  ProductPackaging,
  ProductSalesUnit,
  ProductVariantSummary,
  SalesUnitType,
  SessionUser,
} from '../src/types/erp.ts';
import {
  ALL_PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  nowIso,
  parseQtyMilli,
  todayStr,
  type StoreState,
} from './types.ts';

interface RawBreweryCatalog {
  breweries: Array<{
    brewery: string;
    name: string;
    company_name: string;
    phone: string;
    address: string;
    payment_terms_days: number;
  }>;
  returnables: Array<{
    code: string;
    name: string;
    producer: string;
    kind: 'bottle' | 'crate';
    description?: string;
    deposit_value: number;
  }>;
  products: Array<{
    key: string;
    brewery: 'SOLIBRA' | 'BRASSIVOIRE' | string;
    name: string;
    brand: string;
    barcode: string;
    category: string;
    base_unit: string;
    initial_stock: string;
    min_stock: string;
    purchase_price: number;
    wholesale_price: number;
    semi_wholesale_price: number;
    retail_price: number;
    description: string;
    packagings: Array<{
      name: string;
      coefficient: string;
      purchase_price: number;
      wholesale_price: number;
      semi_wholesale_price: number;
      retail_price: number;
      barcode: string | null;
      allow_fraction: boolean;
      deposit_mode: 'none' | 'deposit';
      components: Array<{
        returnable_code: string;
        pieces_per_pack: number;
      }>;
    }>;
  }>;
}

function loadBreweryCatalog(): RawBreweryCatalog {
  const filePath = path.resolve(process.cwd(), 'catalog', 'brewery_catalog.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as RawBreweryCatalog;
  } catch {
    return { breweries: [], returnables: [], products: [] };
  }
}

export function createStore(): StoreState {
  const catalog = loadBreweryCatalog();
  const now = nowIso();
  const today = todayStr();

  let seqCounter = 1;
  const allocId = () => seqCounter++;

  const categories = [
    { id: allocId(), parent_id: null, name: 'Bières', slug: 'bieres', description: 'Bières blondes, brunes et panachées', is_active: 1 },
    { id: allocId(), parent_id: null, name: 'Sucreries & Sodas', slug: 'sucreries', description: 'Boissons gazeuses et sucreries', is_active: 1 },
    { id: allocId(), parent_id: null, name: 'Boissons Énergisantes', slug: 'energisantes', description: 'Boissons énergisantes et maltées', is_active: 1 },
    { id: allocId(), parent_id: null, name: 'Eaux & Jus', slug: 'eaux-jus', description: 'Eaux minérales et jus de fruits', is_active: 1 },
  ];

  const breweries = [
    { id: allocId(), code: 'SOLIBRA', name: 'SOLIBRA SA', short_name: 'SOLIBRA', country_code: 'CI', country: "Côte d'Ivoire", contact_info: '+225 27 21 21 00 00', is_active: 1 },
    { id: allocId(), code: 'BRASSIVOIRE', name: 'BRASSIVOIRE SA', short_name: 'BRASSIVOIRE', country_code: 'CI', country: "Côte d'Ivoire", contact_info: '+225 27 23 50 00 00', is_active: 1 },
  ];

  const brands = [
    { id: allocId(), code: 'BR-BOCK', name: 'Bock Solibra', brewery_id: breweries[0].id, brewery_name: 'SOLIBRA SA', manufacturer: 'SOLIBRA SA', country_of_origin: 'CI', country: "Côte d'Ivoire", description: null, is_active: 1 },
    { id: allocId(), code: 'BR-BEAUFORT', name: 'Beaufort Lager', brewery_id: breweries[0].id, brewery_name: 'SOLIBRA SA', manufacturer: 'SOLIBRA SA', country_of_origin: 'CI', country: "Côte d'Ivoire", description: null, is_active: 1 },
    { id: allocId(), code: 'BR-CASTEL', name: 'Castel Beer', brewery_id: breweries[0].id, brewery_name: 'SOLIBRA SA', manufacturer: 'SOLIBRA SA', country_of_origin: 'CI', country: "Côte d'Ivoire", description: null, is_active: 1 },
    { id: allocId(), code: 'BR-GUINNESS', name: 'Guinness', brewery_id: breweries[0].id, brewery_name: 'SOLIBRA SA', manufacturer: 'SOLIBRA SA', country_of_origin: 'CI', country: "Côte d'Ivoire", description: null, is_active: 1 },
    { id: allocId(), code: 'BR-IVOIRE', name: 'Ivoire', brewery_id: breweries[1].id, brewery_name: 'BRASSIVOIRE SA', manufacturer: 'BRASSIVOIRE SA', country_of_origin: 'CI', country: "Côte d'Ivoire", description: null, is_active: 1 },
    { id: allocId(), code: 'BR-HEINEKEN', name: 'Heineken', brewery_id: breweries[1].id, brewery_name: 'BRASSIVOIRE SA', manufacturer: 'BRASSIVOIRE SA', country_of_origin: 'NL', country: 'Pays-Bas', description: null, is_active: 1 },
    { id: allocId(), code: 'BR-XXL', name: 'XXL Energy', brewery_id: breweries[0].id, brewery_name: 'SOLIBRA SA', manufacturer: 'SOLIBRA SA', country_of_origin: 'CI', country: "Côte d'Ivoire", description: null, is_active: 1 },
    { id: allocId(), code: 'BR-AWA', name: 'Awa', brewery_id: breweries[0].id, brewery_name: 'SOLIBRA SA', manufacturer: 'SOLIBRA SA', country_of_origin: 'CI', country: "Côte d'Ivoire", description: null, is_active: 1 },
  ];

  const containerTypes = [
    { id: allocId(), code: 'BTL-VERRE-65', name: 'Bouteille verre 65cl', material: 'verre', default_volume_ml: 650, volume_ml: 650, is_returnable: 1, is_recyclable: 1, default_deposit_value: 150, default_deposit_amount: 150, is_active: 1 },
    { id: allocId(), code: 'BTL-VERRE-50', name: 'Bouteille verre 50cl', material: 'verre', default_volume_ml: 500, volume_ml: 500, is_returnable: 1, is_recyclable: 1, default_deposit_value: 125, default_deposit_amount: 125, is_active: 1 },
    { id: allocId(), code: 'BTL-VERRE-33', name: 'Bouteille verre 33cl', material: 'verre', default_volume_ml: 330, volume_ml: 330, is_returnable: 1, is_recyclable: 1, default_deposit_value: 100, default_deposit_amount: 100, is_active: 1 },
    { id: allocId(), code: 'BTL-VERRE-30', name: 'Bouteille verre 30cl', material: 'verre', default_volume_ml: 300, volume_ml: 300, is_returnable: 1, is_recyclable: 1, default_deposit_value: 100, default_deposit_amount: 100, is_active: 1 },
    { id: allocId(), code: 'CAN-33', name: 'Canette aluminium 33cl', material: 'aluminium', default_volume_ml: 330, volume_ml: 330, is_returnable: 0, is_recyclable: 1, default_deposit_value: 0, default_deposit_amount: 0, is_active: 1 },
    { id: allocId(), code: 'PET-50', name: 'Bouteille PET 50cl', material: 'plastique', default_volume_ml: 500, volume_ml: 500, is_returnable: 0, is_recyclable: 1, default_deposit_value: 0, default_deposit_amount: 0, is_active: 1 },
    { id: allocId(), code: 'PET-150', name: 'Bouteille PET 1.5L', material: 'plastique', default_volume_ml: 1500, volume_ml: 1500, is_returnable: 0, is_recyclable: 1, default_deposit_value: 0, default_deposit_amount: 0, is_active: 1 },
  ];

  const packagingTypes = [
    { id: allocId(), code: 'CASIER', name: 'Casier plastique', default_name: 'casier' as PackagingName, default_capacity: 12, material: 'plastique', is_reusable: 1, is_returnable: 1, default_deposit_amount: 2000, is_active: 1 },
    { id: allocId(), code: 'CARTON', name: 'Carton standard', default_name: 'carton' as PackagingName, default_capacity: 24, material: 'carton', is_reusable: 0, is_returnable: 0, default_deposit_amount: 0, is_active: 1 },
    { id: allocId(), code: 'PACK', name: 'Pack filmé', default_name: 'pack' as PackagingName, default_capacity: 6, material: 'film', is_reusable: 0, is_returnable: 0, default_deposit_amount: 0, is_active: 1 },
    { id: allocId(), code: 'BOUTEILLE', name: 'Bouteille unitaire', default_name: 'bouteille' as PackagingName, default_capacity: 1, material: 'verre', is_reusable: 1, is_returnable: 1, default_deposit_amount: 100, is_active: 1 },
    { id: allocId(), code: 'CANETTE', name: 'Canette unitaire', default_name: 'canette' as PackagingName, default_capacity: 1, material: 'aluminium', is_reusable: 0, is_returnable: 0, default_deposit_amount: 0, is_active: 1 },
  ];

  const stockLocations = [
    { id: allocId(), code: 'DEPOT-MAIN', name: 'Magasin Principal', location_type: 'warehouse', is_default: 1, is_active: 1 },
    { id: allocId(), code: 'ZONE-FRAIS', name: 'Chambre Froide / Bar', location_type: 'cold_room', is_default: 0, is_active: 1 },
  ];

  const returnableTypes = (catalog.returnables.length > 0
    ? catalog.returnables
    : [
        { code: 'EMB-SOL-CAS12-65', name: 'Casier 12 alvéoles 65cl SOLIBRA', producer: 'SOLIBRA', kind: 'crate' as const, deposit_value: 2000 },
        { code: 'EMB-SOL-BTL65', name: 'Bouteille verre 65cl SOLIBRA', producer: 'SOLIBRA', kind: 'bottle' as const, deposit_value: 150 },
        { code: 'EMB-SOL-CAS24-33', name: 'Casier 24 alvéoles 33cl SOLIBRA', producer: 'SOLIBRA', kind: 'crate' as const, deposit_value: 2500 },
        { code: 'EMB-SOL-BTL33', name: 'Bouteille verre 33cl SOLIBRA', producer: 'SOLIBRA', kind: 'bottle' as const, deposit_value: 100 },
      ]
  ).map((r) => ({
    id: allocId(),
    code: r.code,
    name: r.name,
    producer: r.producer,
    kind: r.kind,
    deposit_value: r.deposit_value,
    stock_quantity: r.kind === 'crate' ? 85 : 420,
  }));

  const returnableByCode = new Map(returnableTypes.map((r) => [r.code, r]));

  const packagingAssets = returnableTypes
    .filter((r) => r.kind === 'crate')
    .map((r) => {
      const cap = r.code.includes('12') ? 12 : 24;
      const compat = r.code.includes('65') || r.code.includes('60')
        ? 'glass_bottle_650ml'
        : r.code.includes('50')
          ? 'glass_bottle_500ml'
          : r.code.includes('30')
            ? 'glass_bottle_300ml'
            : 'glass_bottle_330ml';
      return {
        id: allocId(),
        code: r.code,
        name: r.name,
        packaging_type_id: packagingTypes[0].id,
        returnable_id: r.id,
        capacity: cap,
        deposit_value: r.deposit_value,
        currency: 'FCFA',
        returnable: 1,
        compatibility_class: compat,
        stock_empty: r.stock_quantity,
        stock_full: 42,
        is_active: 1,
      };
    });

  const suppliers = [
    {
      id: allocId(),
      code: 'FRN-0001',
      name: 'SOLIBRA SA',
      company_name: "Société de Limonaderies et Brasseries d'Afrique (SOLIBRA)",
      phone: '+225 27 21 21 00 00',
      address: 'Treichville Zone 3, Rue des Brasseurs, Abidjan',
      email: 'commandes@solibra.ci',
      contact_person: 'Service Commercial Grands Dépôts',
      payment_terms_days: 30,
      total_purchases: 4850000,
      balance_due: 0,
      is_active: 1,
    },
    {
      id: allocId(),
      code: 'FRN-0002',
      name: 'BRASSIVOIRE SA',
      company_name: 'BRASSIVOIRE SA (Heineken / CFAO)',
      phone: '+225 27 23 50 00 00',
      address: 'Zone Industrielle PK24, Yopougon, Abidjan',
      email: 'distribution@brassivoire.ci',
      contact_person: 'Direction Distribution Abidjan',
      payment_terms_days: 30,
      total_purchases: 2450000,
      balance_due: 320000,
      is_active: 1,
    },
  ];

  const clients = [
    {
      id: allocId(),
      code: 'CLI-0001',
      name: 'Maquis Le Palmier d’Or',
      client_type: 'professionnel' as const,
      establishment_name: 'Maquis Le Palmier d’Or',
      category: 'Maquis',
      phone: '+225 07 08 45 12 30',
      address: 'Rue des Jardins, Cocody Deux-Plateaux',
      city: 'Abidjan',
      commune: 'Cocody',
      quartier: 'Deux-Plateaux',
      landmark: 'Face Pharmacie des Jardins',
      email: 'lepalmier@maquis.ci',
      contact_person: 'M. Kouassi Yao',
      is_active: 1,
      credit_policy: 'limited' as const,
      credit_limit: 500000,
      payment_terms_days: 15,
      unpaid_balance: 125000,
      returnable_pieces_due: 26,
    },
    {
      id: allocId(),
      code: 'CLI-0002',
      name: 'Cave & Lounge Les Flamboyants',
      client_type: 'professionnel' as const,
      establishment_name: 'Les Flamboyants Lounge',
      category: 'Cave / Lounge',
      phone: '+225 05 44 21 89 00',
      address: 'Boulevard de Marseille, Zone 4',
      city: 'Abidjan',
      commune: 'Marcory',
      quartier: 'Zone 4',
      landmark: 'Près Carrefour Prima',
      email: 'contact@lesflamboyants.ci',
      contact_person: 'Mme Aminata Koné',
      is_active: 1,
      credit_policy: 'limited' as const,
      credit_limit: 1000000,
      payment_terms_days: 30,
      unpaid_balance: 0,
      returnable_pieces_due: 0,
    },
    {
      id: allocId(),
      code: 'CLI-0003',
      name: 'Client Comptoir Divers',
      client_type: 'particulier' as const,
      establishment_name: null,
      category: 'Particulier',
      phone: '+225 01 02 03 04 05',
      address: 'Yopougon Selmer',
      city: 'Abidjan',
      commune: 'Yopougon',
      quartier: 'Selmer',
      landmark: null,
      email: null,
      contact_person: null,
      is_active: 1,
      credit_policy: 'forbidden' as const,
      credit_limit: null,
      payment_terms_days: 0,
      unpaid_balance: 0,
      returnable_pieces_due: 0,
    },
  ];

  // Build catalog presets from catalog/brewery_catalog.json
  const catalogPresets: CatalogPresetItem[] = catalog.products.map((p) => ({
    key: p.key,
    brewery: p.brewery,
    name: p.name,
    brand: p.brand,
    barcode: p.barcode,
    category: p.category,
    base_unit: p.base_unit,
    initial_stock: p.initial_stock,
    min_stock: p.min_stock,
    purchase_price: p.purchase_price,
    wholesale_price: p.wholesale_price,
    semi_wholesale_price: p.semi_wholesale_price,
    retail_price: p.retail_price,
    description: p.description,
    packagings: p.packagings.map((pk) => ({
      name: pk.name,
      coefficient: pk.coefficient,
      purchase_price: pk.purchase_price,
      wholesale_price: pk.wholesale_price,
      semi_wholesale_price: pk.semi_wholesale_price,
      retail_price: pk.retail_price,
      barcode: pk.barcode,
      allow_fraction: pk.allow_fraction,
      deposit_mode: pk.deposit_mode,
      components: pk.components.map((c) => ({
        returnable_code: c.returnable_code,
        returnable_name: returnableByCode.get(c.returnable_code)?.name ?? c.returnable_code,
        pieces_per_pack: c.pieces_per_pack,
      })),
    })),
    existing_product_id: null,
    existing_reference: null,
    existing_is_active: null,
  }));

  // Seed initial 12 flagship products from catalogPresets so the depot is immediately usable
  const products: Product[] = [];
  const salesUnits: ProductSalesUnit[] = [];
  const seedLimit = Math.min(12, catalogPresets.length);

  for (let i = 0; i < seedLimit; i++) {
    const preset = catalogPresets[i];
    const prodId = allocId();
    const ref = `PRD-${String(i + 1).padStart(4, '0')}`;
    const cat =
      categories.find((c) => c.name.toLowerCase() === preset.category.toLowerCase()) ??
      categories[0];
    const breweryObj =
      breweries.find((b) => b.code === preset.brewery) ?? breweries[0];
    const supplierObj =
      suppliers.find((s) => s.name.includes(preset.brewery)) ?? suppliers[0];
    const brandObj =
      brands.find((b) => preset.brand.toLowerCase().includes(b.name.toLowerCase().split(' ')[0])) ??
      brands[0];

    const is65 = preset.name.includes('65cl') || preset.name.includes('60cl');
    const is50 = preset.name.includes('50cl');
    const is30 = preset.name.includes('30cl');
    const volumeMl = is65 ? 650 : is50 ? 500 : is30 ? 300 : 330;
    const isCan = preset.base_unit === 'canette' || preset.name.toLowerCase().includes('canette');
    const compatClass = isCan
      ? 'can_330ml'
      : is65
        ? 'glass_bottle_650ml'
        : is50
          ? 'glass_bottle_500ml'
          : is30
            ? 'glass_bottle_300ml'
            : 'glass_bottle_330ml';

    const packagings: ProductPackaging[] = preset.packagings.map((pk, pkIdx) => {
      const pkgId = allocId();
      const coeffMilli = parseQtyMilli(pk.coefficient) || 1000;
      const pkgName = (['casier', 'carton', 'bouteille', 'pack', 'canette'].includes(pk.name)
        ? pk.name
        : 'bouteille') as PackagingName;
      const comps = pk.components.map((c) => {
        const ret = returnableByCode.get(c.returnable_code);
        return {
          returnable_id: ret?.id ?? returnableTypes[0].id,
          pieces_per_pack: c.pieces_per_pack,
          code: c.returnable_code,
          name: ret?.name ?? c.returnable_name,
          deposit_value: ret?.deposit_value ?? 100,
          kind: ret?.kind ?? ('bottle' as const),
          brand_name: brandObj.name,
          brand_id: brandObj.id,
        };
      });
      const pkgDeposit = comps
        .filter((c) => c.kind === 'crate')
        .reduce((sum, c) => sum + c.pieces_per_pack * c.deposit_value, 0);
      const btlDeposit = comps
        .filter((c) => c.kind === 'bottle')
        .reduce((sum, c) => sum + c.pieces_per_pack * c.deposit_value, 0);

      const unitType: SalesUnitType =
        pkgName === 'casier'
          ? 'crate'
          : pkgName === 'carton'
            ? 'carton'
            : pkgName === 'pack'
              ? 'pack'
              : pkgName === 'canette'
                ? 'can'
                : 'bottle';

      const su: ProductSalesUnit = {
        id: allocId(),
        product_id: prodId,
        variant_id: null,
        packaging_id: pkgId,
        label: pkgName === 'casier' ? `Casier ${Math.round(coeffMilli / 1000)}` : pk.name,
        unit_type: unitType,
        conversion_factor: Math.max(1, Math.round(coeffMilli / 1000)),
        is_virtual: 0,
        allow_fraction: pk.allow_fraction ? 1 : 0,
        purchase_price: pk.purchase_price,
        wholesale_price: pk.wholesale_price,
        semi_wholesale_price: pk.semi_wholesale_price,
        retail_price: pk.retail_price,
        min_selling_price: pk.wholesale_price,
        bottle_deposit_amount: btlDeposit,
        crate_deposit_amount: pkgDeposit,
        barcode: pk.barcode,
        is_default_sale: pkIdx === preset.packagings.length - 1 ? 1 : 0,
        is_default_purchase: pkIdx === preset.packagings.length - 1 ? 1 : 0,
        is_active: 1,
      };
      salesUnits.push(su);

      return {
        id: pkgId,
        product_id: prodId,
        variant_id: null,
        packaging_type_id: packagingTypes[0].id,
        name: pkgName,
        display_label: pkgName === 'casier' ? `Casier (${Math.round(coeffMilli / 1000)})` : pkgName,
        package_sku: `${ref}-${pkIdx + 1}`,
        base_unit: preset.base_unit,
        coefficient_milli: coeffMilli,
        purchase_price: pk.purchase_price,
        wholesale_price: pk.wholesale_price,
        semi_wholesale_price: pk.semi_wholesale_price,
        retail_price: pk.retail_price,
        min_selling_price: pk.wholesale_price,
        barcode: pk.barcode,
        allow_fraction: pk.allow_fraction ? 1 : 0,
        is_reusable: pk.deposit_mode === 'deposit' ? 1 : 0,
        is_returnable: pk.deposit_mode === 'deposit' ? 1 : 0,
        package_deposit_amount: pkgDeposit,
        bottle_deposit_amount: btlDeposit,
        package_cost: pk.purchase_price,
        is_default_sale: pkIdx === preset.packagings.length - 1 ? 1 : 0,
        is_default_purchase: pkIdx === preset.packagings.length - 1 ? 1 : 0,
        is_active: 1,
        deposit_mode: pk.deposit_mode,
        components: comps,
      };
    });

    const variantId = allocId();
    const variant: ProductVariantSummary = {
      id: variantId,
      product_id: prodId,
      name: `${preset.name} (${volumeMl}ml)`,
      sku: preset.barcode || ref,
      barcode: preset.barcode,
      volume_ml: volumeMl,
      container_type: isCan ? 'can' : 'glass_bottle',
      container_type_id: isCan ? containerTypes[4].id : containerTypes[0].id,
      compatibility_class: compatClass,
      native_crate_capacity: is65 ? 12 : 24,
      container_material: isCan ? 'aluminium' : 'verre',
      container_returnable: isCan ? 0 : 1,
      container_recyclable: 1,
      container_deposit_amount: isCan ? 0 : is65 ? 150 : 100,
      is_active: 1,
    };

    for (const pk of packagings) pk.variant_id = variantId;
    for (const su of salesUnits) {
      if (su.product_id === prodId) su.variant_id = variantId;
    }

    const initialStockUnits = i % 5 === 4 ? 12 : 144 + i * 24;
    const minStockUnits = Math.max(24, Number(preset.min_stock || '24'));

    const product: Product = {
      id: prodId,
      reference: ref,
      barcode: preset.barcode,
      name: preset.name,
      brand: preset.brand,
      brewery_id: breweryObj.id,
      brewery_name: breweryObj.name,
      brand_id: brandObj.id,
      variant_id: variantId,
      variant_label: variant.name,
      category_id: cat.id,
      category_name: cat.name,
      subcategory_id: null,
      subcategory_name: null,
      supplier_id: supplierObj.id,
      supplier_name: supplierObj.name,
      description: preset.description,
      is_alcoholic: preset.category.toLowerCase().includes('bière') ? 1 : 0,
      allow_credit_sale: 1,
      allow_unit_sale: 1,
      allow_mixed_sale: 1,
      default_location_id: stockLocations[0].id,
      status: 'active',
      base_unit: preset.base_unit,
      stock_milli: initialStockUnits * 1000,
      min_stock_milli: minStockUnits * 1000,
      max_stock_milli: 600 * 1000,
      average_cost_fcfa: preset.purchase_price,
      purchase_price: preset.purchase_price,
      wholesale_price: preset.wholesale_price,
      semi_wholesale_price: preset.semi_wholesale_price,
      retail_price: preset.retail_price,
      image_path: null,
      is_active: 1,
      packagings,
      variants: [variant],
      sales_units: salesUnits.filter((su) => su.product_id === prodId),
    };

    products.push(product);
    preset.existing_product_id = prodId;
    preset.existing_reference = ref;
    preset.existing_is_active = 1;
  }

  const cashSessionId = allocId();
  const cashSession = {
    id: cashSessionId,
    reference: `CAI-${today.replace(/-/g, '')}-01`,
    opened_at: now,
    closed_at: null,
    status: 'open' as const,
    opening_cash: 150000,
    theoretical_cash: 294000,
    physical_cash: null,
    difference: null,
    closing_notes: null,
  };

  // Sample sale 1 (cash) & sample sale 2 (credit) so Dashboard / Sales / Receivables / Consignments look realistic
  const p0 = products[0];
  const p1 = products[1] ?? products[0];
  const p0Crate = p0?.packagings.find((pk) => pk.name === 'casier') ?? p0?.packagings[0];
  const p1Crate = p1?.packagings.find((pk) => pk.name === 'casier') ?? p1?.packagings[0];

  const sale1Id = allocId();
  const sale1TotalMerch = (p0Crate?.retail_price ?? 6000) * 4;
  const sale1Deposit = 0;

  const sale2Id = allocId();
  const sale2Merch = (p1Crate?.wholesale_price ?? 6500) * 20;
  const sale2Deposit = 35000;
  const sale2Total = sale2Merch + sale2Deposit;

  const sales = p0 && p0Crate
    ? [
        {
          id: sale1Id,
          reference: 'VTE-2026-0001',
          client_id: clients[1].id,
          client_name: clients[1].name,
          client_code: clients[1].code,
          client_phone: clients[1].phone,
          sale_type: 'cash' as const,
          price_tier: 'retail' as const,
          subtotal_merchandise: sale1TotalMerch,
          discount_amount: 0,
          total_merchandise: sale1TotalMerch,
          total_deposit: sale1Deposit,
          total_amount: sale1TotalMerch,
          paid_amount: sale1TotalMerch,
          remaining_amount: 0,
          payment_labels: 'Espèces',
          status: 'validated' as const,
          receivable_id: null,
          due_date: null,
          notes: 'Vente comptoir réglée',
          created_at: now,
          lines: [
            {
              id: allocId(),
              product_id: p0.id,
              packaging_id: p0Crate.id,
              variant_id: p0.variant_id,
              product_name: p0.name,
              packaging_name: p0Crate.name,
              base_unit: p0.base_unit,
              coefficient_milli: p0Crate.coefficient_milli,
              quantity_milli: 4000,
              base_quantity_milli: 4 * p0Crate.coefficient_milli,
              unit_price: p0Crate.retail_price ?? 6000,
              discount_amount: 0,
              line_total: sale1TotalMerch,
              returned_base_milli: 0,
            },
          ],
          payments: [
            {
              id: allocId(),
              reference: 'PAY-0001',
              method_code: 'cash',
              method_label: 'Espèces',
              part_amount: sale1TotalMerch,
              created_at: now,
            },
          ],
          deposits: [],
          cancellation: null,
          returns: [],
        },
        {
          id: sale2Id,
          reference: 'VTE-2026-0002',
          client_id: clients[0].id,
          client_name: clients[0].name,
          client_code: clients[0].code,
          client_phone: clients[0].phone,
          sale_type: 'credit' as const,
          price_tier: 'wholesale' as const,
          subtotal_merchandise: sale2Merch,
          discount_amount: 0,
          total_merchandise: sale2Merch,
          total_deposit: sale2Deposit,
          total_amount: sale2Total,
          paid_amount: sale2Total - 125000,
          remaining_amount: 125000,
          payment_labels: 'Espèces',
          status: 'validated' as const,
          receivable_id: 1,
          due_date: today,
          notes: 'Livraison partielle à crédit 15 jours',
          created_at: now,
          lines: [
            {
              id: allocId(),
              product_id: p1.id,
              packaging_id: p1Crate.id,
              variant_id: p1.variant_id,
              product_name: p1.name,
              packaging_name: p1Crate.name,
              base_unit: p1.base_unit,
              coefficient_milli: p1Crate.coefficient_milli,
              quantity_milli: 20000,
              base_quantity_milli: 20 * p1Crate.coefficient_milli,
              unit_price: p1Crate.wholesale_price ?? 6500,
              discount_amount: 0,
              line_total: sale2Merch,
              returned_base_milli: 0,
            },
          ],
          payments: [
            {
              id: allocId(),
              reference: 'PAY-0002',
              method_code: 'cash',
              method_label: 'Espèces',
              part_amount: sale2Total - 125000,
              created_at: now,
            },
          ],
          deposits: [
            {
              id: allocId(),
              sale_line_id: null,
              returnable_id: returnableTypes[0].id,
              kind: 'crate' as const,
              packaging_name: returnableTypes[0].name,
              packaging_code: returnableTypes[0].code,
              pieces: 26,
              returned_pieces: 0,
              unit_value: returnableTypes[0].deposit_value,
              amount: sale2Deposit,
              expected_products: p1.name,
            },
          ],
          cancellation: null,
          returns: [],
        },
      ]
    : [];

  const receivables = sales.length > 1
    ? [
        {
          id: allocId(),
          sale_id: sale2Id,
          sale_reference: 'VTE-2026-0002',
          sale_date: now,
          sale_total: sale2Total,
          client_id: clients[0].id,
          client_name: clients[0].name,
          client_code: clients[0].code,
          client_phone: clients[0].phone,
          initial_amount: 125000,
          remaining_amount: 125000,
          due_date: today,
          status: 'open' as const,
          created_at: now,
        },
      ]
    : [];
  if (sales[1] && receivables[0]) {
    sales[1].receivable_id = receivables[0].id;
  }

  const packagingObligations = sales.length > 1
    ? [
        {
          id: allocId(),
          sale_id: sale2Id,
          sale_reference: 'VTE-2026-0002',
          client_id: clients[0].id,
          returnable_id: returnableTypes[0].id,
          pieces: 26,
          returned_pieces: 0,
          pending_pieces: 26,
          unit_value: returnableTypes[0].deposit_value,
          total_reference_value: 26 * returnableTypes[0].deposit_value,
          due_date: today,
          overdue: false,
          status: 'open',
        },
      ]
    : [];

  const supplierDebts = [
    {
      id: allocId(),
      receipt_id: allocId(),
      receipt_reference: 'REC-2026-0001',
      order_reference: 'ACH-2026-0001',
      supplier_id: suppliers[1].id,
      supplier_name: suppliers[1].name,
      supplier_code: suppliers[1].code,
      initial_amount: 320000,
      remaining_amount: 320000,
      due_date: today,
      status: 'open' as const,
      created_at: now,
    },
  ];

  const cashMovements = [
    {
      id: allocId(),
      session_id: cashSessionId,
      kind: 'sale_in',
      method_code: 'cash',
      method_label: 'Espèces',
      is_cash: 1,
      direction: 'in' as const,
      amount: sale1TotalMerch,
      description: 'Vente comptoir VTE-2026-0001',
      reference_document: 'VTE-2026-0001',
      created_at: now,
    },
    {
      id: allocId(),
      session_id: cashSessionId,
      kind: 'sale_in',
      method_code: 'cash',
      method_label: 'Espèces',
      is_cash: 1,
      direction: 'in' as const,
      amount: 120000,
      description: 'Acompte livraison VTE-2026-0002',
      reference_document: 'VTE-2026-0002',
      created_at: now,
    },
  ];

  const ownerUser: SessionUser = {
    userId: '1',
    username: 'owner',
    displayName: 'Propriétaire',
    role: 'owner',
    roleLabel: ROLE_LABELS.owner,
    permissions: ALL_PERMISSIONS,
  };

  return {
    nextId: seqCounter + 100,
    sequences: {
      VTE: 3,
      ACH: 2,
      REC: 2,
      CMD: 1,
      CLI: 4,
      FRN: 3,
      PRD: products.length + 1,
      PAY: 3,
      RET: 1,
      INV: 1,
      DEP: 1,
      CAI: 2,
    },
    sessions: new Map(),
    users: [
      {
        id: 1,
        username: 'owner',
        displayName: 'Propriétaire',
        role: 'owner',
        roleLabel: ROLE_LABELS.owner,
        active: true,
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: now,
        pinHash: '',
      },
      {
        id: 2,
        username: 'caissier',
        displayName: 'Caissier Comptoir',
        role: 'cashier',
        roleLabel: ROLE_LABELS.cashier,
        active: true,
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: now,
        pinHash: '',
      },
    ],
    ownerPinHash: null,
    failedAttempts: 0,
    lockedUntil: null,
    settings: {
      company_name: 'Mon Dépôt Boissons',
      company_legal_name: 'DEPOTPRO Distribution SARL',
      business_activity: 'Distribution & Vente de Boissons (Gros / Demi-Gros / Détail)',
      address: 'Zone Industrielle, Rue des Brasseurs',
      phone: '+225 07 00 00 00 00',
      whatsapp: '+225 07 00 00 00 00',
      email: 'contact@depotpro.local',
      city: 'Abidjan',
      commune: 'Marcory',
      quartier: 'Zone 4',
      country: "Côte d'Ivoire",
      rccm: 'CI-ABJ-2026-B-0001',
      ncc: '2600001-A',
      currency: 'FCFA',
      allow_negative_stock: 0,
      invoice_prefix: 'FAC',
      sale_prefix: 'VTE',
      purchase_prefix: 'ACH',
      order_prefix: 'CMD',
      receipt_prefix: 'REC',
      credit_note_prefix: 'AV',
      theme: 'light',
      logo_path: null,
      setup_completed: 1,
      inactivity_timeout_minutes: 30,
    },
    paymentMethods: [
      { code: 'cash', label: 'Espèces', is_cash: 1, active: 1 },
      { code: 'wave', label: 'Wave', is_cash: 0, active: 1 },
      { code: 'orange_money', label: 'Orange Money', is_cash: 0, active: 1 },
      { code: 'mtn_money', label: 'MTN MoMo', is_cash: 0, active: 1 },
      { code: 'moov_money', label: 'Moov Money', is_cash: 0, active: 1 },
      { code: 'bank_transfer', label: 'Virement Bancaire', is_cash: 0, active: 1 },
    ],
    categories,
    breweries,
    brands,
    containerTypes,
    packagingTypes,
    stockLocations,
    products,
    salesUnits,
    productSuppliers: products.map((p) => ({
      id: allocId(),
      product_id: p.id,
      supplier_id: p.supplier_id ?? suppliers[0].id,
      supplier_name: p.supplier_name ?? suppliers[0].name,
      supplier_product_code: p.reference,
      preferred_supplier: 1,
      purchase_unit: 'casier',
      units_per_purchase_package: 12,
      last_purchase_price: p.purchase_price ?? 0,
      is_active: 1,
    })),
    depositRules: [],
    catalogPresets,
    cataloguePriceHistory: new Map(),
    returnableTypes,
    returnableMovements: returnableTypes.map((r) => ({
      id: allocId(),
      packaging_id: r.id,
      packaging_name: r.name,
      packaging_code: r.code,
      movement_type: 'initial' as const,
      quantity: r.stock_quantity,
      stock_before: 0,
      stock_after: r.stock_quantity,
      reason: 'Stock initial dépôt',
      reference_document: null,
      created_at: now,
    })),
    depositReturns: [],
    packagingObligations,
    packagingAssets,
    packagingMovements: [],
    customerDeposits: [],
    clients,
    clientPackagingFinancialDebt: new Map(),
    suppliers,
    sales,
    receivables,
    payments: sales.map((s, idx) => ({
      id: s.payments[0]?.id ?? allocId(),
      reference: s.payments[0]?.reference ?? `PAY-000${idx + 1}`,
      sale_id: s.id,
      order_id: null,
      client_id: s.client_id,
      payment_kind: 'sale' as const,
      total_amount: s.paid_amount,
      note: s.notes,
      external_reference: null,
      recorded_by_user_id: '1',
      recorded_by_name: 'Propriétaire',
      recorded_by_role: 'owner',
      balance_before_xof: s.total_amount,
      balance_after_xof: s.remaining_amount,
      created_at: s.created_at,
      parts: s.payments.map((p) => ({
        method_code: p.method_code,
        method_label: p.method_label,
        amount: p.part_amount,
      })),
    })),
    paymentReceipts: new Map(),
    purchases: [],
    purchaseReceipts: [],
    purchaseDocumentSnapshots: new Map(),
    purchaseReceiptSnapshots: new Map(),
    supplierDebts,
    orders: [],
    orderReceipts: new Map(),
    stockMovements: products.slice(0, 4).map((p) => ({
      id: allocId(),
      product_id: p.id,
      product_name: p.name,
      product_reference: p.reference,
      base_unit: p.base_unit,
      movement_type: 'purchase_in',
      quantity_milli: p.stock_milli,
      stock_before_milli: 0,
      stock_after_milli: p.stock_milli,
      reason: 'Stock initial de démarrage',
      reference_document: 'INIT-001',
      created_at: now,
    })),
    inventories: [],
    cashSessions: [cashSession],
    cashMovements,
    expenseCategories: [
      { id: 1, name: 'Carburant & Livraison' },
      { id: 2, name: 'Manutention & Personnel' },
      { id: 3, name: 'Électricité & Eau' },
      { id: 4, name: 'Fournitures & Divers' },
    ],
    expenses: [
      {
        id: allocId(),
        reference: 'DEP-2026-0001',
        category: 'Carburant & Livraison',
        amount: 15000,
        method_code: 'cash',
        method_label: 'Espèces',
        session_id: cashSessionId,
        beneficiary: 'Livreur Zone 4',
        notes: 'Tournée matin',
        receipt_path: null,
        expense_date: today,
        created_at: now,
      },
    ],
    auditLogs: [
      {
        id: allocId(),
        action: 'SYSTEM_BOOT',
        entity_type: 'system',
        details: `Initialisation catalogue (${products.length} références actives, ${catalogPresets.length} préréglages brasseries)`,
        created_at: now,
      },
    ],
    commercialApprovalEvents: [],
    commercialDocumentDetails: new Map(),
    backups: [],
    idempotencyKeys: new Set(),
  };

  void ownerUser;
  void ROLE_PERMISSIONS;
}

export const store = createStore();

export function nextId(): number {
  const id = store.nextId;
  store.nextId += 1;
  return id;
}

export function nextSeq(prefix: string): string {
  const n = store.sequences[prefix] ?? 1;
  store.sequences[prefix] = n + 1;
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

export function addAudit(action: string, entityType: string, details: string): void {
  store.auditLogs.unshift({
    id: nextId(),
    action,
    entity_type: entityType,
    details,
    created_at: nowIso(),
  });
  if (store.auditLogs.length > 200) {
    store.auditLogs.length = 200;
  }
}
