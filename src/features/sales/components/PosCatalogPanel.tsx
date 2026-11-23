import type { RefObject } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Keyboard, Loader2, Package, Plus, RefreshCw, SearchX, X } from 'lucide-react';
import { SearchInput } from '../../../components/forms/SearchInput.tsx';
import {
  DP_BUTTON_HOVER,
  DP_BUTTON_TAP,
  DP_SPRING_SNAPPY,
  MotionStaggerGrid,
  MotionStaggerItem,
} from '../../../components/motion/MotionPrimitives.tsx';
import { formatFcfa, formatQty } from '../../../utils/format.ts';
import type {
  PriceTier,
  Product,
  ProductPackaging,
  ProductSalesUnit,
} from '../../../types/erp.ts';
import { getSalesUnitTierPrice, getTierPrice } from '../hooks/usePosData.ts';

export interface BarcodeScanFeedback {
  tone: 'success' | 'error';
  message: string;
}

interface PosCatalogPanelProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  search: string;
  onSearchChange: (value: string) => void;
  onScanEnter: (rawCode: string) => Promise<void>;
  scanFeedback?: BarcodeScanFeedback | null;
  onDismissScanFeedback?: () => void;
  priceTier: PriceTier;
  onPriceTierChange: (tier: PriceTier) => void;
  products: Product[];
  isLoadingProducts?: boolean;
  isFetchingProducts?: boolean;
  productsError?: string | null;
  onRetryProducts?: () => void;
  onAddPackaging: (product: Product, pkg: ProductPackaging) => void;
  onAddSalesUnit?: (product: Product, unit: ProductSalesUnit) => void;
}

const TIERS: Array<{ id: PriceTier; label: string }> = [
  { id: 'retail', label: 'Détail' },
  { id: 'semi_wholesale', label: 'Demi-gros' },
  { id: 'wholesale', label: 'Gros' },
];

export function PosCatalogPanel({
  searchInputRef,
  search,
  onSearchChange,
  onScanEnter,
  scanFeedback = null,
  onDismissScanFeedback,
  priceTier,
  onPriceTierChange,
  products,
  isLoadingProducts = false,
  isFetchingProducts = false,
  productsError = null,
  onRetryProducts,
  onAddPackaging,
  onAddSalesUnit,
}: PosCatalogPanelProps) {
  return (
    <div className="space-y-3 lg:col-span-7">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <SearchInput
            ref={searchInputRef}
            value={search}
            onChange={onSearchChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onScanEnter(search);
              }
            }}
            clearable
            placeholder="Scanner code-barres + Entrée ou chercher (F2)..."
            className="w-full"
            inputClassName="py-2.5"
          />
          {isFetchingProducts && (
            <span
              aria-live="polite"
              className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-slate-400"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </span>
          )}
        </div>
        <div
          role="group"
          aria-label="Grille tarifaire POS"
          className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-0.5 text-xs"
        >
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={priceTier === t.id}
              onClick={() => onPriceTierChange(t.id)}
              className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                priceTier === t.id
                  ? 'bg-[#2563EB] text-white shadow-xs'
                  : 'text-[#667085] dark:text-slate-300 hover:text-[#182230]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#667085] dark:text-slate-400">
        <div className="inline-flex flex-wrap items-center gap-2">
          <Keyboard className="h-3.5 w-3.5 shrink-0" />
          <span>
            <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono-num text-[10px]">
              F2
            </kbd>{' '}
            Recherche / Scan
          </span>
          <span>·</span>
          <span>
            <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono-num text-[10px]">
              F4
            </kbd>{' '}
            Attente
          </span>
          <span>·</span>
          <span>
            <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono-num text-[10px]">
              F8
            </kbd>{' '}
            Solder comptant
          </span>
          <span>·</span>
          <span>
            <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono-num text-[10px]">
              F9
            </kbd>{' '}
            Valider
          </span>
        </div>
        <span className="font-mono-num">
          Tarif actif :{' '}
          <strong className="text-[#182230] dark:text-slate-200">
            {TIERS.find((t) => t.id === priceTier)?.label}
          </strong>
        </span>
      </div>

      {scanFeedback && (
        <div
          role={scanFeedback.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
            scanFeedback.tone === 'success'
              ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
              : 'border-rose-200 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 text-[#BE123C] dark:text-rose-300'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            {scanFeedback.tone === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{scanFeedback.message}</span>
          </span>
          {onDismissScanFeedback && (
            <button
              type="button"
              onClick={onDismissScanFeedback}
              aria-label="Masquer le message de scan"
              className="rounded p-0.5 opacity-70 hover:opacity-100 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {productsError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 p-4 text-xs text-[#BE123C] dark:text-rose-300"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Impossible de charger le catalogue : {productsError}</span>
          </div>
          {onRetryProducts && (
            <button
              type="button"
              onClick={onRetryProducts}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 px-3 py-1.5 font-semibold"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Réessayer
            </button>
          )}
        </div>
      ) : isLoadingProducts && products.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-8 text-center text-xs text-[#667085] dark:text-slate-400"
        >
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#1D4ED8] dark:text-[#60A5FA]" />
          Chargement des produits disponibles…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-8 text-center space-y-2">
          <SearchX className="mx-auto h-6 w-6 text-slate-400" />
          <p className="text-xs font-medium text-[#182230] dark:text-slate-200">
            {search.trim()
              ? `Aucun produit actif ne correspond à « ${search.trim()} ».`
              : 'Aucun produit actif dans le catalogue.'}
          </p>
          {search.trim() && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-[#1D4ED8] dark:text-[#60A5FA] hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Afficher tout le catalogue
            </button>
          )}
        </div>
      ) : (
        <MotionStaggerGrid className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((prod) => {
          const activePkgs = prod.packagings.filter(
            (pk) =>
              pk.is_active &&
              !(
                prod.allow_unit_sale === 0 &&
                (pk.name === 'bouteille' || pk.name === 'canette')
              )
          );
          const activeUnits = (prod.sales_units ?? []).filter(
            (u) =>
              u.is_active === 1 &&
              !(
                prod.allow_unit_sale === 0 &&
                (u.unit_type === 'bottle' || u.unit_type === 'can')
              )
          );

          return (
            <MotionStaggerItem
              key={prod.id}
              interactive
              className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] dp-surface-interactive p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {prod.image_path ? (
                      <img
                        src={prod.image_path}
                        alt={prod.name}
                        loading="lazy"
                        className="h-10 w-10 rounded-lg border border-slate-200 dark:border-slate-700 object-cover shrink-0 bg-slate-50 shadow-xs"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-400 shrink-0">
                        <Package className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-sm font-semibold text-[#182230] dark:text-slate-100">
                        {prod.name}
                      </h3>
                      <p className="text-xs text-[#667085] dark:text-slate-400 truncate">
                        {prod.reference} · {prod.category_name}
                        {prod.brewery_name ? ` · ${prod.brewery_name}` : ''}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`font-mono-num text-xs font-semibold shrink-0 ${
                      prod.stock_milli <= 0
                        ? 'text-[#BE123C]'
                        : prod.stock_milli <= prod.min_stock_milli
                          ? 'text-[#8A5A0B] dark:text-[#FBBF24]'
                          : 'text-[#16A36A] dark:text-emerald-400'
                    }`}
                  >
                    {formatQty(prod.stock_milli, prod.base_unit)}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {activePkgs.map((pk) => {
                  const compDep =
                    pk.deposit_mode === 'deposit'
                      ? pk.components.reduce(
                          (acc, c) => acc + c.pieces_per_pack * c.deposit_value,
                          0
                        )
                      : 0;
                  const depAmt =
                    compDep > 0
                      ? compDep
                      : (pk.bottle_deposit_amount ?? 0) + (pk.package_deposit_amount ?? 0);
                  return (
                    <motion.button
                      key={pk.id}
                      type="button"
                      whileHover={DP_BUTTON_HOVER}
                      whileTap={DP_BUTTON_TAP}
                      transition={DP_SPRING_SNAPPY}
                      onClick={() => onAddPackaging(prod, pk)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-[#182230] dark:text-slate-200 hover:border-[#2563EB] hover:text-[#1D4ED8] dark:text-[#60A5FA] hover:shadow-sm transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      <span className="capitalize">{pk.display_label || pk.name}</span>
                      <span className="font-mono-num text-[#667085] dark:text-slate-400">
                        {formatFcfa(getTierPrice(pk, priceTier))}
                      </span>
                      {depAmt > 0 && (
                        <span className="text-[10px] text-[#8A5A0B] dark:text-[#FBBF24] font-mono-num">
                          +{formatFcfa(depAmt)}
                        </span>
                      )}
                    </motion.button>
                  );
                })}
                {onAddSalesUnit &&
                  activeUnits.map((unit) => {
                    const depAmt = unit.bottle_deposit_amount + unit.crate_deposit_amount;
                    return (
                      <motion.button
                        key={`su-${unit.id}`}
                        type="button"
                        whileHover={DP_BUTTON_HOVER}
                        whileTap={DP_BUTTON_TAP}
                        transition={DP_SPRING_SNAPPY}
                        onClick={() => onAddSalesUnit(prod, unit)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 px-2.5 py-1.5 text-xs font-medium text-[#1D4ED8] dark:text-[#60A5FA] hover:bg-blue-100 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        <span>{unit.label}</span>
                        <span className="font-mono-num">
                          {formatFcfa(getSalesUnitTierPrice(unit, priceTier))}
                        </span>
                        {depAmt > 0 && (
                          <span className="text-[10px] text-[#8A5A0B] dark:text-[#FBBF24] font-mono-num">
                            +{formatFcfa(depAmt)}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
              </div>
            </MotionStaggerItem>
          );
        })}
        </MotionStaggerGrid>
      )}
    </div>
  );
}
