import { ShieldCheck, Layers, Box, Package, ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { CatalogueAdminPanel } from '../features/catalogue/components/CatalogueAdminPanel.tsx';
import { CrateTypesAdminPanel } from '../features/catalogue/components/CrateTypesAdminPanel.tsx';
import { PackagingProfilesAdminPanel } from '../features/catalogue/components/PackagingProfilesAdminPanel.tsx';
import { VariantPackagingOptionsAdminPanel } from '../features/catalogue/components/VariantPackagingOptionsAdminPanel.tsx';
import { CatalogueVerificationLogsAdminPanel } from '../features/catalogue/components/CatalogueVerificationLogsAdminPanel.tsx';

/**
 * Écran d'administration du catalogue (LOT 8).
 *
 * `CatalogueAdminPanel` existait mais n'était monté par aucune route : ses
 * quatre endpoints (`getProductCatalogueOverview`, `setCatalogueProductActive`,
 * `setCatalogueReferencePrice`, `getCatalogueReferencePriceHistory`) étaient
 * donc du code mort côté interface. Cet écran les rend atteignables.
 *
 * L'accès est restreint aux rôles disposant de `catalogwrite`
 * (owner, admin, manager, stock_manager) par `RequirePermission` dans `App.tsx`;
 * le serveur applique de toute façon `require_perm(Permission::CatalogWrite)`
 * sur chaque écriture.
 */
export function CatalogueAdminPage() {
  const [activeTab, setActiveTab] = useState<'products' | 'crate-types' | 'packaging-profiles' | 'variant-packaging' | 'verification-logs'>('products');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-5">
        <div>
          <h2 className="font-display text-sm font-semibold">
            Administration du catalogue
          </h2>
          <p className="mt-1 text-xs text-[#667085] dark:text-[#94A3B8]">
            Activation des produits, prix de référence et historique des révisions. Toute
            modification engage la traçabilité du catalogue et est journalisée côté serveur.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-[11px] font-medium text-[#0A3F28] dark:text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Réservé aux rôles habilités
        </span>
      </div>

      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex gap-1" aria-label="Onglets administration catalogue">
          <button
            type="button"
            onClick={() => setActiveTab('products')}
            className={`rounded-t-lg px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'products'
                ? 'border-[#2563EB] text-[#2563EB] bg-slate-50 dark:bg-slate-900'
                : 'border-transparent text-[#667085] dark:text-slate-400 hover:text-[#182230] dark:hover:text-slate-100'
            }`}
          >
            Produits & Tarifs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('crate-types')}
            className={`rounded-t-lg px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'crate-types'
                ? 'border-[#2563EB] text-[#2563EB] bg-slate-50 dark:bg-slate-900'
                : 'border-transparent text-[#667085] dark:text-slate-400 hover:text-[#182230] dark:hover:text-slate-100'
            }`}
          >
            <Layers className="inline h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Types de casiers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('packaging-profiles')}
            className={`rounded-t-lg px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'packaging-profiles'
                ? 'border-[#2563EB] text-[#2563EB] bg-slate-50 dark:bg-slate-900'
                : 'border-transparent text-[#667085] dark:text-slate-400 hover:text-[#182230] dark:hover:text-slate-100'
            }`}
          >
            <Box className="inline h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Profils d'emballage
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('variant-packaging')}
            className={`rounded-t-lg px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'variant-packaging'
                ? 'border-[#2563EB] text-[#2563EB] bg-slate-50 dark:bg-slate-900'
                : 'border-transparent text-[#667085] dark:text-slate-400 hover:text-[#182230] dark:hover:text-slate-100'
            }`}
          >
            <Package className="inline h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Conditionnement variantes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('verification-logs')}
            className={`rounded-t-lg px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'verification-logs'
                ? 'border-[#2563EB] text-[#2563EB] bg-slate-50 dark:bg-slate-900'
                : 'border-transparent text-[#667085] dark:text-slate-400 hover:text-[#182230] dark:hover:text-slate-100'
            }`}
          >
            <ClipboardList className="inline h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Journaux vérification
          </button>
        </nav>
      </div>

      {activeTab === 'products' && <CatalogueAdminPanel />}
      {activeTab === 'crate-types' && <CrateTypesAdminPanel />}
      {activeTab === 'packaging-profiles' && <PackagingProfilesAdminPanel />}
      {activeTab === 'variant-packaging' && <VariantPackagingOptionsAdminPanel />}
      {activeTab === 'verification-logs' && <CatalogueVerificationLogsAdminPanel />}
    </div>
  );
}
