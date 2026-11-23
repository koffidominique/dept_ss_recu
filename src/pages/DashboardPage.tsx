import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PackagePlus, Plus } from 'lucide-react';
import { FormTipsButton } from '../components/common/FormTipsButton.tsx';
import { ErrorState, LoadingState } from '../components/common/States.tsx';
import { useDashboardData } from '../features/reports/hooks/useDashboardData.ts';
import { useWorkQueue } from '../features/dashboard/hooks/useWorkQueue.ts';
import { useConnectionState } from '../features/dashboard/hooks/useConnectionState.ts';
import {
  KpiScopeNote,
  OfflineWorkBanner,
  WorkQueuePanel,
} from '../features/dashboard/components/WorkQueuePanel.tsx';
import {
  OnboardingBanner,
  OnboardingModal,
} from '../features/reports/components/DashboardOnboarding.tsx';
import { MonthlySalesChart } from '../features/reports/components/MonthlySalesChart.tsx';
import {
  DashboardBottomPanels,
  DashboardKpiGrid,
  DashboardOverdueAlerts,
  DashboardTopProductsCard,
} from '../features/reports/components/DashboardPanels.tsx';

export function DashboardPage() {
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [obError, setObError] = useState<string | null>(null);

  const {
    monthLabel,
    daysInMonth,
    dashboardQuery,
    settingsQuery,
    monthlyReportQuery,
    monthlyDailyRows,
    onboardingMutation,
  } = useDashboardData();

  const { items, summary, degradedSources, isLoading, isFetching, refetchAll } = useWorkQueue();
  const { isOnline, offlineSince, serverState } = useConnectionState();

  if (dashboardQuery.isLoading) return <LoadingState rows={6} />;
  if (dashboardQuery.error || !dashboardQuery.data) {
    return (
      <ErrorState
        message={
          dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : 'Erreur de chargement du tableau de bord.'
        }
        onRetry={() => dashboardQuery.refetch()}
      />
    );
  }

  const { kpis, lowStockProducts, topProducts, recentAudit } = dashboardQuery.data;
  const monthlyReport = monthlyReportQuery.data;
  const activeDaysCount = (monthlyReport?.dailySales ?? []).filter((d) => d.count > 0).length;
  const monthlyRevenue = monthlyReport?.commercial?.merchandise_revenue ?? 0;
  const monthlyCollected = monthlyReport?.commercial?.paid_amount ?? 0;
  const monthlySalesCount = monthlyReport?.commercial?.count ?? 0;
  const avgPerActiveDay = activeDaysCount > 0 ? Math.round(monthlyRevenue / activeDaysCount) : 0;
  const needsOnboarding = settingsQuery.data?.settings?.setup_completed === 0;

  return (
    <div className="space-y-6">
      {needsOnboarding && (
        <OnboardingBanner
          onOpenSetup={() => {
            setObError(null);
            setOnboardingOpen(true);
          }}
          onSkip={() => onboardingMutation.mutate({ setup_completed: true })}
          isSkipping={onboardingMutation.isPending}
        />
      )}

      <OnboardingModal
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        settings={settingsQuery.data?.settings}
        isPending={onboardingMutation.isPending}
        serverError={obError}
        onSave={(payload) =>
          onboardingMutation.mutate(payload, {
            onSuccess: () => {
              setOnboardingOpen(false);
              setObError(null);
            },
            onError: (err) => {
              setObError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
            },
          })
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#182230] dark:text-slate-100">
            Situation commerciale et financière
          </h2>
          <p className="text-xs text-[#667085] dark:text-slate-400">
            Indicateurs calculés en temps réel depuis les écritures validées en FCFA.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FormTipsButton topicId="dashboard" label="Comprendre les KPI" />
          <Link
            to="/purchases"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] dp-surface-interactive px-4 py-2 text-xs font-semibold text-[#182230] dark:text-slate-100 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap shrink-0"
          >
            <PackagePlus className="h-4 w-4 text-[#1D4ED8] dark:text-[#60A5FA]" />
            Nouvel approvisionnement
          </Link>
          <Link
            to="/sales/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] dp-btn-elevated px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 hover:scale-[1.025] active:scale-[0.975] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nouvelle vente
          </Link>
        </div>
      </div>

      <OfflineWorkBanner
        isOnline={isOnline}
        offlineSince={offlineSince}
        serverState={serverState}
      />

      <WorkQueuePanel
        items={items}
        summary={summary}
        degradedSources={degradedSources}
        isLoading={isLoading}
        isFetching={isFetching}
        onRefresh={() => {
          void refetchAll();
        }}
      />

      <DashboardOverdueAlerts kpis={kpis} />

      <KpiScopeNote />

      <DashboardKpiGrid kpis={kpis} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <MonthlySalesChart
          monthLabel={monthLabel}
          daysInMonth={daysInMonth}
          monthlyDailyRows={monthlyDailyRows}
          monthlyRevenue={monthlyRevenue}
          monthlyCollected={monthlyCollected}
          monthlySalesCount={monthlySalesCount}
          activeDaysCount={activeDaysCount}
          avgPerActiveDay={avgPerActiveDay}
          isLoading={monthlyReportQuery.isLoading}
          error={monthlyReportQuery.error}
          onRetry={() => monthlyReportQuery.refetch()}
        />
        <DashboardTopProductsCard topProducts={topProducts} />
      </div>

      <DashboardBottomPanels lowStockProducts={lowStockProducts} recentAudit={recentAudit} />
    </div>
  );
}
