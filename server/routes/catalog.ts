import { Router } from 'express';
import type {
  PackagingName,
  Product,
  ProductPackaging,
  ProductSalesUnit,
  ProductVariantSummary,
  SalesUnitType,
} from '../../src/types/erp.ts';
import { requirePerm, type AuthedRequest } from '../authMiddleware.ts';
import { addAudit, nextId, nextSeq, store } from '../store.ts';
import { nowIso, parseQtyMilli } from '../types.ts';

function paginate<T>(items: T[], pageRaw: unknown, pageSizeRaw: unknown) {
  const page = Math.max(1, Number(pageRaw || 1));
  const pageSize = Math.max(1, Math.min(500, Number(pageSizeRaw || 20)));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export function createCatalogRouter(): Router {
  const router = Router();

  router.get('/api/categories', requirePerm('catalog:read'), (_req, res) => {
    res.json(store.categories);
  });

  router.post('/api/categories', requirePerm('catalog:write'), (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nom de catégorie requis.' });
      return;
    }
    const cat = {
      id: nextId(),
      parent_id: req.body?.parent_id ?? null,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: req.body?.description ? String(req.body.description) : null,
      is_active: 1,
    };
    store.categories.push(cat);
    res.status(201).json(cat);
  });

  router.put('/api/categories/:id', requirePerm('catalog:write'), (req, res) => {
    const id = Number(req.params.id);
    const cat = store.categories.find((c) => c.id === id);
    if (!cat) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Catégorie introuvable.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      cat.name = req.body.name.trim();
    }
    if (req.body?.description !== undefined) {
      cat.description = req.body.description ? String(req.body.description) : null;
    }
    if (req.body?.is_active !== undefined) {
      cat.is_active = req.body.is_active ? 1 : 0;
    }
    res.json(cat);
  });

  router.get('/api/breweries', requirePerm('catalog:read'), (req, res) => {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const list = search
      ? store.breweries.filter((b) => b.name.toLowerCase().includes(search) || b.code.toLowerCase().includes(search))
      : store.breweries;
    res.json(paginate(list, req.query.page, req.query.pageSize ?? 200));
  });

  router.post('/api/breweries', requirePerm('catalog:write'), (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nom brasserie requis.' });
      return;
    }
    const item = {
      id: nextId(),
      code: String(req.body?.code || name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12)),
      name,
      short_name: req.body?.shortName ? String(req.body.shortName) : name,
      country_code: req.body?.countryCode ? String(req.body.countryCode) : 'CI',
      country: "Côte d'Ivoire",
      contact_info: null,
      is_active: 1,
    };
    store.breweries.push(item);
    res.status(201).json(item);
  });

  router.get('/api/brands', requirePerm('catalog:read'), (req, res) => {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const list = search
      ? store.brands.filter((b) => b.name.toLowerCase().includes(search) || b.code.toLowerCase().includes(search))
      : store.brands;
    res.json(paginate(list, req.query.page, req.query.pageSize ?? 200));
  });

  router.post('/api/brands', requirePerm('catalog:write'), (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const code = String(req.body?.code ?? '').trim() || `BR-${Date.now() % 10000}`;
    if (!name) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nom de marque requis.' });
      return;
    }
    const breweryId = req.body?.breweryId ? Number(req.body.breweryId) : null;
    const brewery = breweryId ? store.breweries.find((b) => b.id === breweryId) : null;
    const item = {
      id: nextId(),
      code,
      name,
      brewery_id: breweryId,
      brewery_name: brewery?.name ?? null,
      manufacturer: brewery?.name ?? null,
      country_of_origin: req.body?.countryOfOrigin ? String(req.body.countryOfOrigin) : 'CI',
      country: "Côte d'Ivoire",
      description: null,
      is_active: 1,
    };
    store.brands.push(item);
    res.status(201).json(item);
  });

  router.get('/api/container-types', requirePerm('catalog:read'), (req, res) => {
    res.json(paginate(store.containerTypes, req.query.page, req.query.pageSize ?? 200));
  });

  router.get('/api/packaging-types', requirePerm('catalog:read'), (_req, res) => {
    res.json(store.packagingTypes);
  });

  router.get('/api/stock-locations', requirePerm('catalog:read'), (_req, res) => {
    res.json(store.stockLocations);
  });

  router.get('/api/products/presets', requirePerm('catalog:read'), (_req, res) => {
    const items = store.catalogPresets.map((preset) => {
      const existing = store.products.find(
        (p) => (preset.barcode && p.barcode === preset.barcode) || p.name.toLowerCase() === preset.name.toLowerCase(),
      );
      return {
        ...preset,
        existing_product_id: existing?.id ?? null,
        existing_reference: existing?.reference ?? null,
        existing_is_active: existing?.is_active ?? null,
      };
    });
    res.json({ items });
  });

  router.post('/api/products/presets/apply', requirePerm('catalog:write'), (req, res) => {
    const keys = Array.isArray(req.body?.keys) ? (req.body.keys as string[]) : [];
    const activate = req.body?.activate !== false;
    let created = 0;
    let reactivated = 0;
    let skipped = 0;
    const affected: Product[] = [];

    for (const key of keys) {
      const preset = store.catalogPresets.find((p) => p.key === key);
      if (!preset) {
        skipped += 1;
        continue;
      }
      const existing = store.products.find(
        (p) => (preset.barcode && p.barcode === preset.barcode) || p.name.toLowerCase() === preset.name.toLowerCase(),
      );
      if (existing) {
        if (activate && existing.is_active === 0) {
          existing.is_active = 1;
          existing.status = 'active';
          reactivated += 1;
          affected.push(existing);
        } else {
          skipped += 1;
        }
        continue;
      }

      const prodId = nextId();
      const ref = nextSeq('PRD');
      let cat = store.categories.find((c) => c.name.toLowerCase() === preset.category.toLowerCase());
      if (!cat) {
        cat = { id: nextId(), parent_id: null, name: preset.category, slug: preset.category.toLowerCase(), description: null, is_active: 1 };
        store.categories.push(cat);
      }
      const breweryObj = store.breweries.find((b) => b.code === preset.brewery) ?? store.breweries[0];
      const supplierObj = store.suppliers.find((s) => s.name.includes(preset.brewery)) ?? store.suppliers[0];
      const variantId = nextId();
      const isCan = preset.base_unit === 'canette' || preset.name.toLowerCase().includes('canette');

      const packagings: ProductPackaging[] = preset.packagings.map((pk, idx) => {
        const pkgId = nextId();
        const coeffMilli = parseQtyMilli(pk.coefficient) || 1000;
        const pkgName = (['casier', 'carton', 'bouteille', 'pack', 'canette'].includes(pk.name) ? pk.name : 'bouteille') as PackagingName;
        const comps = pk.components.map((c) => {
          const ret = store.returnableTypes.find((r) => r.code === c.returnable_code) ?? store.returnableTypes[0];
          return {
            returnable_id: ret.id,
            pieces_per_pack: c.pieces_per_pack,
            code: ret.code,
            name: ret.name,
            deposit_value: ret.deposit_value,
            kind: ret.kind,
          };
        });
        const unitType: SalesUnitType =
          pkgName === 'casier' ? 'crate' : pkgName === 'carton' ? 'carton' : pkgName === 'pack' ? 'pack' : pkgName === 'canette' ? 'can' : 'bottle';

        const su: ProductSalesUnit = {
          id: nextId(),
          product_id: prodId,
          variant_id: variantId,
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
          bottle_deposit_amount: comps.filter((c) => c.kind === 'bottle').reduce((s, c) => s + c.pieces_per_pack * c.deposit_value, 0),
          crate_deposit_amount: comps.filter((c) => c.kind === 'crate').reduce((s, c) => s + c.pieces_per_pack * c.deposit_value, 0),
          barcode: pk.barcode,
          is_default_sale: idx === preset.packagings.length - 1 ? 1 : 0,
          is_default_purchase: idx === preset.packagings.length - 1 ? 1 : 0,
          is_active: 1,
        };
        store.salesUnits.push(su);

        return {
          id: pkgId,
          product_id: prodId,
          variant_id: variantId,
          name: pkgName,
          display_label: pk.name,
          base_unit: preset.base_unit,
          coefficient_milli: coeffMilli,
          purchase_price: pk.purchase_price,
          wholesale_price: pk.wholesale_price,
          semi_wholesale_price: pk.semi_wholesale_price,
          retail_price: pk.retail_price,
          barcode: pk.barcode,
          allow_fraction: pk.allow_fraction ? 1 : 0,
          is_active: 1,
          deposit_mode: pk.deposit_mode,
          components: comps,
        };
      });

      const variant: ProductVariantSummary = {
        id: variantId,
        product_id: prodId,
        name: preset.name,
        sku: preset.barcode || ref,
        barcode: preset.barcode,
        volume_ml: preset.name.includes('65cl') ? 650 : preset.name.includes('50cl') ? 500 : 330,
        container_type: isCan ? 'can' : 'glass_bottle',
        container_type_id: store.containerTypes[0]?.id ?? null,
        compatibility_class: isCan ? 'can_330ml' : preset.name.includes('65cl') ? 'glass_bottle_650ml' : 'glass_bottle_330ml',
        native_crate_capacity: preset.name.includes('65cl') ? 12 : 24,
        container_material: isCan ? 'aluminium' : 'verre',
        container_returnable: isCan ? 0 : 1,
        container_recyclable: 1,
        container_deposit_amount: isCan ? 0 : 100,
        is_active: 1,
      };

      const product: Product = {
        id: prodId,
        reference: ref,
        barcode: preset.barcode,
        name: preset.name,
        brand: preset.brand,
        brewery_id: breweryObj?.id ?? null,
        brewery_name: breweryObj?.name ?? null,
        category_id: cat.id,
        category_name: cat.name,
        supplier_id: supplierObj?.id ?? null,
        supplier_name: supplierObj?.name ?? null,
        description: preset.description,
        base_unit: preset.base_unit,
        stock_milli: parseQtyMilli(preset.initial_stock),
        min_stock_milli: parseQtyMilli(preset.min_stock) || 24000,
        max_stock_milli: 600000,
        average_cost_fcfa: preset.purchase_price,
        purchase_price: preset.purchase_price,
        wholesale_price: preset.wholesale_price,
        semi_wholesale_price: preset.semi_wholesale_price,
        retail_price: preset.retail_price,
        image_path: null,
        is_active: activate ? 1 : 0,
        status: activate ? 'active' : 'draft',
        packagings,
        variants: [variant],
        sales_units: store.salesUnits.filter((su) => su.product_id === prodId),
      };

      store.products.push(product);
      affected.push(product);
      created += 1;
    }

    addAudit('APPLY_PRESETS', 'products', `${created} créé(s), ${reactivated} réactivé(s)`);
    res.json({ created, reactivated, skipped, activate, products: affected });
  });

  router.get('/api/products/export/csv', requirePerm('catalog:read'), (_req, res) => {
    const header = 'reference;name;brand;category;base_unit;stock;min_stock;purchase_price;retail_price';
    const rows = store.products.map((p) =>
      [
        p.reference,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${(p.brand ?? '').replace(/"/g, '""')}"`,
        `"${p.category_name.replace(/"/g, '""')}"`,
        p.base_unit,
        (p.stock_milli / 1000).toFixed(0),
        (p.min_stock_milli / 1000).toFixed(0),
        p.purchase_price ?? 0,
        p.retail_price ?? 0,
      ].join(';'),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send([header, ...rows].join('\n'));
  });

  router.post('/api/products/import/csv', requirePerm('catalog:write'), (req, res) => {
    const csv = String(req.body?.csv ?? '');
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let created = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/[;,]/);
      const name = (cols[1] ?? cols[0] ?? '').replace(/^"|"$/g, '').trim();
      if (!name) continue;
      const prodId = nextId();
      const ref = nextSeq('PRD');
      const cat = store.categories[0];
      const baseUnit = (cols[4] ?? 'bouteille').trim() || 'bouteille';
      const retailPrice = Number(cols[8] ?? 500) || 500;
      const purchasePrice = Number(cols[7] ?? 350) || 350;
      const pkgId = nextId();
      const prod: Product = {
        id: prodId,
        reference: ref,
        barcode: null,
        name,
        brand: cols[2]?.replace(/^"|"$/g, '') || null,
        category_id: cat.id,
        category_name: cat.name,
        supplier_id: store.suppliers[0]?.id ?? null,
        supplier_name: store.suppliers[0]?.name ?? null,
        description: null,
        base_unit: baseUnit,
        stock_milli: parseQtyMilli(cols[5] ?? '0'),
        min_stock_milli: parseQtyMilli(cols[6] ?? '12') || 12000,
        max_stock_milli: 500000,
        average_cost_fcfa: purchasePrice,
        purchase_price: purchasePrice,
        wholesale_price: retailPrice,
        semi_wholesale_price: retailPrice,
        retail_price: retailPrice,
        image_path: null,
        is_active: 1,
        packagings: [
          {
            id: pkgId,
            product_id: prodId,
            name: 'bouteille',
            base_unit: baseUnit,
            coefficient_milli: 1000,
            purchase_price: purchasePrice,
            wholesale_price: retailPrice,
            semi_wholesale_price: retailPrice,
            retail_price: retailPrice,
            barcode: null,
            allow_fraction: 0,
            is_active: 1,
            deposit_mode: 'none',
            components: [],
          },
        ],
      };
      store.products.push(prod);
      created += 1;
    }
    res.status(201).json({ created });
  });

  router.get('/api/products', requirePerm('catalog:read'), (req, res) => {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const lowStockOnly = req.query.lowStockOnly === 'true' || req.query.lowStockOnly === '1';

    const filtered = store.products.filter((p) => {
      if (!includeArchived && p.is_active === 0) return false;
      if (categoryId && p.category_id !== categoryId) return false;
      if (lowStockOnly && p.stock_milli > p.min_stock_milli) return false;
      if (search) {
        return (
          p.name.toLowerCase().includes(search) ||
          p.reference.toLowerCase().includes(search) ||
          (p.brand ?? '').toLowerCase().includes(search) ||
          (p.barcode ?? '').toLowerCase().includes(search)
        );
      }
      return true;
    });

    res.json(paginate(filtered, req.query.page, req.query.pageSize));
  });

  router.get('/api/products/:id', requirePerm('catalog:read'), (req, res) => {
    const id = Number(req.params.id);
    const prod = store.products.find((p) => p.id === id);
    if (!prod) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produit introuvable.' });
      return;
    }
    res.json(prod);
  });

  router.post('/api/products', requirePerm('catalog:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    if (!name) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nom du produit requis.' });
      return;
    }
    const prodId = nextId();
    const ref = nextSeq('PRD');
    const categoryId = Number(body.category_id || store.categories[0]?.id || 1);
    const cat = store.categories.find((c) => c.id === categoryId) ?? store.categories[0];
    const supplierId = body.supplier_id ? Number(body.supplier_id) : null;
    const sup = supplierId ? store.suppliers.find((s) => s.id === supplierId) : null;
    const baseUnit = String(body.base_unit ?? 'bouteille').trim() || 'bouteille';
    const purchasePrice = body.purchase_price != null ? Number(body.purchase_price) : null;
    const retailPrice = body.retail_price != null ? Number(body.retail_price) : 500;
    const wholesalePrice = body.wholesale_price != null ? Number(body.wholesale_price) : retailPrice;
    const semiPrice = body.semi_wholesale_price != null ? Number(body.semi_wholesale_price) : retailPrice;
    const variantId = nextId();

    const rawPackagings = Array.isArray(body.packagings) ? (body.packagings as Array<Record<string, unknown>>) : [];
    const packagings: ProductPackaging[] =
      rawPackagings.length > 0
        ? rawPackagings.map((pk) => ({
            id: nextId(),
            product_id: prodId,
            variant_id: variantId,
            name: (String(pk.name ?? 'bouteille') as PackagingName),
            base_unit: baseUnit,
            coefficient_milli: parseQtyMilli(String(pk.coefficient ?? pk.coefficient_milli ?? 1)) || 1000,
            purchase_price: pk.purchase_price != null ? Number(pk.purchase_price) : purchasePrice,
            wholesale_price: pk.wholesale_price != null ? Number(pk.wholesale_price) : wholesalePrice,
            semi_wholesale_price: pk.semi_wholesale_price != null ? Number(pk.semi_wholesale_price) : semiPrice,
            retail_price: pk.retail_price != null ? Number(pk.retail_price) : retailPrice,
            barcode: pk.barcode ? String(pk.barcode) : null,
            allow_fraction: pk.allow_fraction ? 1 : 0,
            is_active: 1,
            deposit_mode: (pk.deposit_mode === 'deposit' ? 'deposit' : 'none'),
            components: [],
          }))
        : [
            {
              id: nextId(),
              product_id: prodId,
              variant_id: variantId,
              name: 'bouteille',
              base_unit: baseUnit,
              coefficient_milli: 1000,
              purchase_price: purchasePrice,
              wholesale_price: wholesalePrice,
              semi_wholesale_price: semiPrice,
              retail_price: retailPrice,
              barcode: null,
              allow_fraction: 0,
              is_active: 1,
              deposit_mode: 'none',
              components: [],
            },
          ];

    const variant: ProductVariantSummary = {
      id: variantId,
      product_id: prodId,
      name,
      sku: ref,
      barcode: body.barcode ? String(body.barcode) : null,
      volume_ml: 330,
      container_type: 'glass_bottle',
      container_type_id: store.containerTypes[0]?.id ?? null,
      compatibility_class: 'glass_bottle_330ml',
      native_crate_capacity: 24,
      container_material: 'verre',
      container_returnable: 1,
      container_recyclable: 1,
      container_deposit_amount: 100,
      is_active: 1,
    };

    const product: Product = {
      id: prodId,
      reference: ref,
      barcode: body.barcode ? String(body.barcode) : null,
      name,
      brand: body.brand ? String(body.brand) : null,
      brewery_id: body.brewery_id ? Number(body.brewery_id) : null,
      category_id: cat?.id ?? 1,
      category_name: cat?.name ?? 'Boissons',
      supplier_id: supplierId,
      supplier_name: sup?.name ?? null,
      description: body.description ? String(body.description) : null,
      base_unit: baseUnit,
      stock_milli: parseQtyMilli(String(body.initial_stock ?? body.stock ?? '0')),
      min_stock_milli: parseQtyMilli(String(body.min_stock ?? '12')) || 12000,
      max_stock_milli: parseQtyMilli(String(body.max_stock ?? '500')) || 500000,
      average_cost_fcfa: purchasePrice,
      purchase_price: purchasePrice,
      wholesale_price: wholesalePrice,
      semi_wholesale_price: semiPrice,
      retail_price: retailPrice,
      image_path: body.image_path ? String(body.image_path) : null,
      is_active: 1,
      status: 'active',
      packagings,
      variants: [variant],
      sales_units: [],
    };
    store.products.unshift(product);
    addAudit('CREATE_PRODUCT', 'products', `${product.reference} - ${product.name}`);
    res.status(201).json(product);
  });

  const handleUpdateProduct = (req: AuthedRequest, res: import('express').Response) => {
    const id = Number(req.params.id);
    const prod = store.products.find((p) => p.id === id);
    if (!prod) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produit introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.name === 'string' && body.name.trim()) prod.name = body.name.trim();
    if (body.brand !== undefined) prod.brand = body.brand ? String(body.brand) : null;
    if (body.barcode !== undefined) prod.barcode = body.barcode ? String(body.barcode) : null;
    if (body.description !== undefined) prod.description = body.description ? String(body.description) : null;
    if (body.category_id != null) {
      const cat = store.categories.find((c) => c.id === Number(body.category_id));
      if (cat) {
        prod.category_id = cat.id;
        prod.category_name = cat.name;
      }
    }
    if (body.purchase_price !== undefined) prod.purchase_price = body.purchase_price != null ? Number(body.purchase_price) : null;
    if (body.wholesale_price !== undefined) prod.wholesale_price = body.wholesale_price != null ? Number(body.wholesale_price) : null;
    if (body.semi_wholesale_price !== undefined) prod.semi_wholesale_price = body.semi_wholesale_price != null ? Number(body.semi_wholesale_price) : null;
    if (body.retail_price !== undefined) prod.retail_price = body.retail_price != null ? Number(body.retail_price) : null;
    if (body.min_stock !== undefined) prod.min_stock_milli = parseQtyMilli(String(body.min_stock));
    if (body.is_active !== undefined) {
      prod.is_active = body.is_active ? 1 : 0;
      prod.status = prod.is_active ? 'active' : 'inactive';
    }
    addAudit('UPDATE_PRODUCT', 'products', `${prod.reference} - ${prod.name}`);
    res.json(prod);
  };

  router.put('/api/products/:id', requirePerm('catalog:write'), handleUpdateProduct);
  router.patch('/api/products/:id', requirePerm('catalog:write'), handleUpdateProduct);

  router.delete('/api/products/:id', requirePerm('catalog:delete'), (req, res) => {
    const id = Number(req.params.id);
    const idx = store.products.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produit introuvable.' });
      return;
    }
    const [removed] = store.products.splice(idx, 1);
    addAudit('DELETE_PRODUCT', 'products', `${removed.reference} - ${removed.name}`);
    res.json({ deleted: true, id: removed.id, reference: removed.reference, name: removed.name });
  });

  router.post('/api/products/:id/packagings', requirePerm('catalog:write'), (req, res) => {
    const prodId = Number(req.params.id);
    const prod = store.products.find((p) => p.id === prodId);
    if (!prod) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produit introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pkgId = body.id ? Number(body.id) : nextId();
    const existingIdx = prod.packagings.findIndex((p) => p.id === pkgId);
    const pkg: ProductPackaging = {
      id: pkgId,
      product_id: prodId,
      variant_id: prod.variant_id ?? null,
      name: (String(body.name ?? 'casier') as PackagingName),
      base_unit: prod.base_unit,
      coefficient_milli: parseQtyMilli(String(body.coefficient ?? body.coefficient_milli ?? 1)) || 1000,
      purchase_price: body.purchase_price != null ? Number(body.purchase_price) : prod.purchase_price,
      wholesale_price: body.wholesale_price != null ? Number(body.wholesale_price) : prod.wholesale_price,
      semi_wholesale_price: body.semi_wholesale_price != null ? Number(body.semi_wholesale_price) : prod.semi_wholesale_price,
      retail_price: body.retail_price != null ? Number(body.retail_price) : prod.retail_price,
      barcode: body.barcode ? String(body.barcode) : null,
      allow_fraction: body.allow_fraction ? 1 : 0,
      is_active: 1,
      deposit_mode: body.deposit_mode === 'deposit' ? 'deposit' : 'none',
      components: [],
    };
    if (existingIdx >= 0) prod.packagings[existingIdx] = pkg;
    else prod.packagings.push(pkg);
    res.json(pkg);
  });

  router.get('/api/products/:id/variants', requirePerm('catalog:read'), (req, res) => {
    const prod = store.products.find((p) => p.id === Number(req.params.id));
    res.json(prod?.variants ?? []);
  });

  router.get('/api/sales-units', requirePerm('catalog:read'), (req, res) => {
    const productId = Number(req.query.product_id);
    res.json(store.salesUnits.filter((su) => !productId || su.product_id === productId));
  });

  router.post('/api/sales-units', requirePerm('catalog:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const su: ProductSalesUnit = {
      id: nextId(),
      product_id: Number(body.product_id),
      variant_id: body.variant_id ? Number(body.variant_id) : null,
      packaging_id: body.packaging_id ? Number(body.packaging_id) : null,
      label: String(body.label ?? 'Unité'),
      unit_type: (String(body.unit_type ?? 'custom') as SalesUnitType),
      conversion_factor: Number(body.conversion_factor ?? 1),
      is_virtual: body.is_virtual ? 1 : 0,
      allow_fraction: body.allow_fraction ? 1 : 0,
      purchase_price: body.purchase_price != null ? Number(body.purchase_price) : null,
      wholesale_price: body.wholesale_price != null ? Number(body.wholesale_price) : null,
      semi_wholesale_price: body.semi_wholesale_price != null ? Number(body.semi_wholesale_price) : null,
      retail_price: body.retail_price != null ? Number(body.retail_price) : null,
      min_selling_price: body.min_selling_price != null ? Number(body.min_selling_price) : null,
      bottle_deposit_amount: Number(body.bottle_deposit_amount ?? 0),
      crate_deposit_amount: Number(body.crate_deposit_amount ?? 0),
      barcode: body.barcode ? String(body.barcode) : null,
      is_default_sale: body.is_default_sale ? 1 : 0,
      is_default_purchase: body.is_default_purchase ? 1 : 0,
      is_active: 1,
    };
    store.salesUnits.push(su);
    res.status(201).json(su);
  });

  router.put('/api/sales-units/:id', requirePerm('catalog:write'), (req, res) => {
    const id = Number(req.params.id);
    const su = store.salesUnits.find((u) => u.id === id);
    if (!su) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Unité de vente introuvable.' });
      return;
    }
    Object.assign(su, req.body ?? {});
    res.json(su);
  });

  router.delete('/api/sales-units/:id', requirePerm('catalog:write'), (req, res) => {
    const id = Number(req.params.id);
    store.salesUnits = store.salesUnits.filter((u) => u.id !== id);
    res.json({ ok: true });
  });

  router.get('/api/products/:id/suppliers', requirePerm('catalog:read'), (req, res) => {
    const productId = Number(req.params.id);
    res.json(store.productSuppliers.filter((ps) => ps.product_id === productId));
  });

  router.post('/api/products/:id/suppliers', requirePerm('catalog:write'), (req, res) => {
    const productId = Number(req.params.id);
    const supplierId = Number(req.body?.supplier_id);
    const sup = store.suppliers.find((s) => s.id === supplierId);
    const link = {
      id: nextId(),
      product_id: productId,
      supplier_id: supplierId,
      supplier_name: sup?.name ?? 'Fournisseur',
      supplier_product_code: req.body?.supplier_product_code ? String(req.body.supplier_product_code) : null,
      preferred_supplier: req.body?.preferred_supplier ? 1 : 0,
      purchase_unit: String(req.body?.purchase_unit ?? 'casier'),
      units_per_purchase_package: Number(req.body?.units_per_purchase_package ?? 12),
      last_purchase_price: req.body?.last_purchase_price != null ? Number(req.body.last_purchase_price) : null,
      is_active: 1,
    };
    store.productSuppliers.push(link);
    res.json(link);
  });

  router.get('/api/deposit-rules', requirePerm('catalog:read'), (req, res) => {
    const productId = req.query.product_id ? Number(req.query.product_id) : null;
    res.json(
      productId
        ? store.depositRules.filter((r) => r.product_id === productId || r.product_id === null)
        : store.depositRules,
    );
  });

  // Catalogue V3 (owner admin view)
  router.get('/api/catalogue-v3/products', requirePerm('catalog:read'), (_req, res) => {
    const products = store.products.map((p) => ({
      id: p.id,
      code: p.reference,
      name: p.name,
      barcode: p.barcode,
      brand_id: p.brand_id ?? null,
      brand_name: p.brand ?? null,
      family_name: p.category_name,
      crate_type_name: p.packagings[0]?.name ?? null,
      unit_price: p.retail_price ?? 0,
      is_active: p.is_active,
      is_sellable: p.is_active,
    }));
    res.json({
      products,
      brands: store.brands.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    });
  });

  router.put('/api/catalogue-products/:id/active', requirePerm('catalog:write'), (req, res) => {
    const id = Number(req.params.id);
    const prod = store.products.find((p) => p.id === id);
    if (!prod) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produit introuvable.' });
      return;
    }
    prod.is_active = req.body?.is_active ? 1 : 0;
    res.json({ id: prod.id, is_active: prod.is_active });
  });

  router.get('/api/catalogue-products/:id/reference-price', requirePerm('catalog:read'), (req, res) => {
    const id = Number(req.params.id);
    res.json(store.cataloguePriceHistory.get(id) ?? []);
  });

  router.put('/api/catalogue-products/:id/reference-price', requirePerm('catalog:write'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const prod = store.products.find((p) => p.id === id);
    if (!prod) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produit introuvable.' });
      return;
    }
    const price = Number(req.body?.reference_price ?? 0);
    if (!Number.isFinite(price) || price < 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Prix de référence invalide.' });
      return;
    }
    prod.retail_price = price;
    const entries = store.cataloguePriceHistory.get(id) ?? [];
    entries.unshift({
      id: nextId(),
      reference_price: price,
      reason: req.body?.reason ? String(req.body.reason) : null,
      changed_by: req.user?.displayName ?? 'Propriétaire',
      created_at: nowIso(),
    });
    store.cataloguePriceHistory.set(id, entries);
    res.json({ id: prod.id, unit_price: price });
  });

  return router;
}
