import { ShieldCheck } from 'lucide-react';
import { CatalogueAdminPanel } from '../features/catalogue/components/CatalogueAdminPanel.tsx';

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

      <CatalogueAdminPanel />
    </div>
  );
}
