import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type { CustomerOrderSummary } from '../../../types/erp.ts';
import type { InventoryRecord } from '../../inventory/types.ts';
import type { OpenIssue } from '../../consignments/types.ts';
import {
  buildWorkQueue,
  summarizeWorkQueue,
  type WorkQueueItem,
} from '../utils/workQueue.ts';

/**
 * Charge les sources nécessaires à la file de travail du tableau de bord.
 *
 * Choix assumé : chaque source est une requête indépendante avec sa propre
 * erreur. Une seule source indisponible (ex. `/backups` refusé) ne doit pas
 * faire disparaître la file entière — on dégrade par élément manquant et on
 * l'annonce explicitement dans l'interface.
 */
export function useWorkQueue() {
  const now = new Date();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.getDashboard(),
  });

  const cashQuery = useQuery({
    queryKey: ['cash'],
    queryFn: () => apiClient.getCashStatus(),
  });

  const ordersQuery = useQuery({
    queryKey: ['customer-orders'],
    queryFn: () => apiClient.listCustomerOrders(),
  });

  const inventoriesQuery = useQuery({
    queryKey: ['inventories'],
    queryFn: () => apiClient.listInventories(),
  });

  const consignmentsQuery = useQuery({
    queryKey: ['consignments'],
    queryFn: () => apiClient.getConsignmentsOverview(),
  });

  const localDbQuery = useQuery({
    queryKey: ['local-db-status'],
    queryFn: () => apiClient.getLocalDbStatus(),
  });

  const items = useMemo<WorkQueueItem[]>(() => {
    const kpis = dashboardQuery.data?.kpis;
    if (!kpis) return [];
    return buildWorkQueue({
      now,
      kpis: {
        cashSessionOpen: kpis.cashSessionOpen,
        overdueReceivablesCount: kpis.overdueReceivablesCount,
        overdueReceivablesTotal: kpis.overdueReceivablesTotal,
        overdueSupplierDebtsCount: kpis.overdueSupplierDebtsCount,
        overdueSupplierDebtsTotal: kpis.overdueSupplierDebtsTotal,
        lowStockCount: kpis.lowStockCount,
        outOfStockCount: kpis.outOfStockCount,
      },
      activeCashSession: cashQuery.data?.activeSession ?? null,
      orders: (ordersQuery.data ?? []) as CustomerOrderSummary[],
      inventories: (inventoriesQuery.data ?? []) as unknown as InventoryRecord[],
      packagingOpenIssues: ((consignmentsQuery.data as { openIssues?: OpenIssue[] } | undefined)
        ?.openIssues ?? []) as OpenIssue[],
      lastBackupAt: localDbQuery.data?.lastBackupAt ?? null,
      backupCount: localDbQuery.data?.backupCount ?? null,
    });
    // `now` est volontairement exclu : les anciennetés sont recalculées à chaque
    // rendu, mais refetcher à chaque seconde n'apporterait aucune information.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dashboardQuery.data,
    cashQuery.data,
    ordersQuery.data,
    inventoriesQuery.data,
    consignmentsQuery.data,
    localDbQuery.data,
  ]);

  const summary = useMemo(() => summarizeWorkQueue(items), [items]);

  /** Sources qui ont échoué : la file est partielle et doit le dire. */
  const degradedSources = useMemo(() => {
    const list: string[] = [];
    if (dashboardQuery.isError) list.push('indicateurs');
    if (cashQuery.isError) list.push('caisse');
    if (ordersQuery.isError) list.push('commandes');
    if (inventoriesQuery.isError) list.push('inventaires');
    if (consignmentsQuery.isError) list.push('consignations');
    if (localDbQuery.isError) list.push('sauvegardes');
    return list;
  }, [
    dashboardQuery.isError,
    cashQuery.isError,
    ordersQuery.isError,
    inventoriesQuery.isError,
    consignmentsQuery.isError,
    localDbQuery.isError,
  ]);

  const isLoading =
    dashboardQuery.isLoading || cashQuery.isLoading || ordersQuery.isLoading;

  const refetchAll = () =>
    Promise.all([
      dashboardQuery.refetch(),
      cashQuery.refetch(),
      ordersQuery.refetch(),
      inventoriesQuery.refetch(),
      consignmentsQuery.refetch(),
      localDbQuery.refetch(),
    ]);

  return {
    items,
    summary,
    degradedSources,
    isLoading,
    isFetching:
      dashboardQuery.isFetching ||
      cashQuery.isFetching ||
      ordersQuery.isFetching ||
      inventoriesQuery.isFetching ||
      consignmentsQuery.isFetching ||
      localDbQuery.isFetching,
    refetchAll,
    dashboardQuery,
  };
}
