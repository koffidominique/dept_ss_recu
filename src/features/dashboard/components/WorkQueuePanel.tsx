import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ClipboardList,
  Landmark,
  Package,
  PackageX,
  RefreshCw,
  ShoppingCart,
  Truck,
  Users,
  WifiOff,
  HardDriveDownload,
  type LucideIcon,
} from 'lucide-react';
import { DP_EASE, DP_SPRING_SNAPPY } from '../../../components/motion/MotionPrimitives.tsx';
import { cn, formatFcfa } from '../../../utils/format.ts';
import type {
  WorkQueueCategory,
  WorkQueueItem,
  WorkQueueSeverity,
} from '../utils/workQueue.ts';
import type { summarizeWorkQueue } from '../utils/workQueue.ts';
import {
  describeLocalServerState,
  type LocalServerState,
} from '../../quality/utils/operationalSafety.ts';

const CATEGORY_ICON: Record<WorkQueueCategory, LucideIcon> = {
  cash: Landmark,
  receivables: Users,
  supplier_debts: Truck,
  stock: PackageX,
  orders: ShoppingCart,
  inventory: ClipboardList,
  consignments: Package,
  backups: HardDriveDownload,
};

const SEVERITY_STYLE: Record<
  WorkQueueSeverity,
  { card: string; icon: string; badge: string; label: string }
> = {
  critical: {
    card: 'border-rose-300 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/25',
    icon: 'bg-rose-100 dark:bg-rose-950/60 text-[#BE123C] dark:text-rose-400',
    badge: 'bg-rose-100 dark:bg-rose-950/60 text-[#BE123C] dark:text-rose-300',
    label: 'Bloquant',
  },
  warning: {
    card: 'border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20',
    icon: 'bg-amber-100 dark:bg-amber-950/50 text-[#8A5A0B] dark:text-amber-300',
    badge: 'bg-amber-100 dark:bg-amber-950/50 text-[#8A5A0B] dark:text-amber-300',
    label: 'À traiter',
  },
  info: {
    card: 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E]',
    icon: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
    badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
    label: 'Suivi',
  },
};

export function WorkQueuePanel({
  items,
  summary,
  degradedSources,
  isLoading,
  isFetching,
  onRefresh,
}: {
  items: WorkQueueItem[];
  summary: ReturnType<typeof summarizeWorkQueue>;
  degradedSources: string[];
  isLoading: boolean;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: DP_EASE }}
      aria-labelledby="work-queue-heading"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-5 dp-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2
              id="work-queue-heading"
              className="font-display text-sm font-semibold text-[#182230] dark:text-slate-100"
            >
              File de travail du jour
            </h2>
            {summary.critical > 0 && (
              <span className="rounded-full bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 text-[11px] font-semibold text-[#BE123C] dark:text-rose-300">
                {summary.critical} bloquante(s)
              </span>
            )}
            {summary.critical === 0 && summary.warning > 0 && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 text-[11px] font-semibold text-[#8A5A0B] dark:text-amber-300">
                {summary.warning} à traiter
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[#667085] dark:text-slate-400">{summary.headline}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-[#182230] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Actualiser
        </button>
      </div>

      {degradedSources.length > 0 && (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2 text-[11px] text-[#8A5A0B] dark:text-amber-300"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            File partielle : {degradedSources.join(', ')} indisponible(s). Les alertes
            correspondantes ne sont pas affichées — ne considérez pas cette liste comme complète.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A36A] dark:text-emerald-400 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-[#182230] dark:text-slate-100">
              Rien à traiter pour le moment
            </div>
            <p className="mt-0.5 text-[11px] text-[#667085] dark:text-slate-400">
              Caisse, stocks, créances, commandes, consignes et sauvegardes sont à jour.
            </p>
          </div>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => {
            const Icon = CATEGORY_ICON[item.category];
            const style = SEVERITY_STYLE[item.severity];
            return (
              <motion.li
                key={item.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={DP_SPRING_SNAPPY}
                className={cn(
                  'flex flex-col justify-between gap-3 rounded-xl border p-3.5 dp-surface-interactive',
                  style.card
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span className={cn('rounded-lg p-2 shrink-0', style.icon)}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-[#182230] dark:text-slate-100">
                        {item.title}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          style.badge
                        )}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-[#667085] dark:text-slate-400">
                      {item.detail}
                    </p>
                    {(item.count !== undefined || item.amountXof !== undefined) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-num text-[#182230] dark:text-slate-300">
                        {item.count !== undefined && (
                          <span>
                            {item.count} élément{item.count > 1 ? 's' : ''}
                          </span>
                        )}
                        {item.amountXof !== undefined && item.amountXof > 0 && (
                          <span className="font-semibold">{formatFcfa(item.amountXof)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <Link
                  to={item.to}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#182230] dark:bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors self-start"
                >
                  {item.actionLabel}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

/**
 * Bandeau hors ligne des écrans de travail. N'annonce jamais une réussite :
 * il prévient que les écritures ne seront pas validées tant que le serveur
 * local n'aura pas répondu.
 */
export function OfflineWorkBanner({
  isOnline,
  offlineSince,
  serverState,
}: {
  isOnline: boolean;
  offlineSince: Date | null;
  /** Lot 4 : distingue « poste hors réseau » et « serveur local arrêté ». */
  serverState?: LocalServerState;
}) {
  if (isOnline) return null;

  // Repli compatible Lot 3 quand l'état détaillé n'est pas fourni.
  const state: LocalServerState = serverState ?? 'server-unreachable';
  const info =
    describeLocalServerState(state, offlineSince) ?? {
      title: 'Serveur local injoignable',
      detail:
        'Vos saisies restent affichées, mais aucune écriture n’est validée tant que la connexion au serveur local n’est pas rétablie.',
      severity: 'warning' as const,
    };

  const isCritical = info.severity === 'critical';

  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: DP_EASE }}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs',
        isCritical
          ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/30 text-[#BE123C] dark:text-rose-200'
          : 'border-amber-300 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/30 text-[#8A5A0B] dark:text-amber-200'
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <div className="font-semibold">{info.title}</div>
        <p className="mt-0.5 text-[11px] opacity-90">{info.detail}</p>
      </div>
    </motion.div>
  );
}

/** Petit encart expliquant la nature des montants affichés (cumul vs période). */
export function KpiScopeNote() {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 px-3 py-2 text-[11px] text-[#667085] dark:text-slate-400">
      <Banknote className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
      <span>
        <strong className="text-[#182230] dark:text-slate-200">Portée des montants :</strong> les
        cartes ci-dessous sont des <strong>cumuls depuis l’origine</strong> (CA marchandises,
        encaissements, dépenses) ou des <strong>encours à date</strong> (créances, dettes, stock).
        Le graphique mensuel, lui, porte uniquement sur le mois en cours.
      </span>
    </p>
  );
}
