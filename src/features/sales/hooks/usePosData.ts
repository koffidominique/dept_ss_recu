import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type { CartItem } from '../../../stores/uiStore.ts';
import type {
  ClientPackagingBalance,
  PriceTier,
  ProductPackaging,
  ProductSalesUnit,
  SaleDetail,
} from '../../../types/erp.ts';
import type { SaleCalculationResult } from '../utils/saleCalculations.ts';

export function getTierPrice(
  pkg: ProductPackaging,
  tier: PriceTier = 'retail'
): number {
  if (tier === 'wholesale') {
    return pkg.wholesale_price ?? pkg.retail_price ?? 0;
  }
  if (tier === 'semi_wholesale') {
    return pkg.semi_wholesale_price ?? pkg.retail_price ?? 0;
  }
  return pkg.retail_price ?? 0;
}

export function getSalesUnitTierPrice(
  unit: ProductSalesUnit,
  tier: PriceTier = 'retail'
): number {
  if (tier === 'wholesale') {
    return unit.wholesale_price ?? unit.retail_price ?? 0;
  }
  if (tier === 'semi_wholesale') {
    return unit.semi_wholesale_price ?? unit.retail_price ?? 0;
  }
  return unit.retail_price ?? 0;
}

export function usePosQueries(search: string, posClientId: number | null = null) {
  const productsQuery = useQuery({
    queryKey: ['products-pos', search],
    queryFn: () => apiClient.listProducts({ search, page: 1, pageSize: 50 }),
    placeholderData: (prev) => prev,
  });

  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiClient.listClients(),
  });

  const clientReturnablesQuery = useQuery<ClientPackagingBalance[]>({
    queryKey: ['client-packaging-balances', posClientId],
    queryFn: () => apiClient.getClientPackagingBalances(posClientId as number),
    enabled: posClientId !== null,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.getSettings(),
  });

  const cashQuery = useQuery({
    queryKey: ['cash'],
    queryFn: () => apiClient.getCashStatus(),
  });

  const activeMethods = useMemo(
    () => (settingsQuery.data?.paymentMethods || []).filter((m) => m.active === 1),
    [settingsQuery.data]
  );

  const clientReturnables = useMemo(
    () => (posClientId !== null ? (clientReturnablesQuery.data ?? []) : []),
    [posClientId, clientReturnablesQuery.data]
  );

  return {
    productsRes: productsQuery.data,
    isLoadingProducts: productsQuery.isLoading,
    isFetchingProducts: productsQuery.isFetching,
    productsError:
      productsQuery.error instanceof Error ? productsQuery.error.message : null,
    refetchProducts: productsQuery.refetch,
    clients: clientsQuery.data,
    clientReturnables,
    isLoadingClientReturnables: posClientId !== null && clientReturnablesQuery.isLoading,
    cashStatus: cashQuery.data,
    isCashLoading: cashQuery.isLoading,
    activeMethods,
  };
}

interface UsePosMutationsOptions {
  requestKey: string;
  posClientId: number | null;
  posPriceTier: PriceTier;
  posSaleType: 'cash' | 'credit';
  globalDiscount: number;
  dueDate: string;
  posCart: CartItem[];
  paymentRows: Array<{ method_code: string; amount: number }>;
  totals: SaleCalculationResult;
  receivedReturnables: Array<{ returnable_id: number; pieces: number }>;
  onSaleSuccess: (sale: SaleDetail) => void;
  onSaleError: (message: string) => void;
  onQuickClientSuccess: (clientId: number) => void;
  onQuickClientError: (message: string) => void;
}

export function usePosMutations({
  requestKey,
  posClientId,
  posPriceTier,
  posSaleType,
  globalDiscount,
  dueDate,
  posCart,
  paymentRows,
  totals,
  receivedReturnables,
  onSaleSuccess,
  onSaleError,
  onQuickClientSuccess,
  onQuickClientError,
}: UsePosMutationsOptions) {
  const qc = useQueryClient();

  const createSaleMutation = useMutation({
    mutationFn: () => {
      if (!totals.isValid) {
        throw new Error(totals.errors[0] || 'Panier invalide : corrigez les quantités ou montants.');
      }
      const filteredPayments = paymentRows.filter((p) => p.amount > 0);
      const validReturnables =
        posClientId !== null
          ? receivedReturnables
              .filter((r) => Number.isFinite(r.pieces) && Math.trunc(r.pieces) > 0)
              .map((r) => ({
                returnable_id: r.returnable_id,
                pieces: Math.trunc(r.pieces),
              }))
          : [];
      return apiClient.createSale({
        request_key: requestKey,
        client_id: posClientId,
        sale_type: posSaleType,
        price_tier: posPriceTier,
        discount_amount: globalDiscount,
        due_date: posSaleType === 'credit' && dueDate ? dueDate : undefined,
        lines: posCart.map((c) => ({
          product_id: c.productId,
          packaging_id: c.packagingId,
          sales_unit_id: c.salesUnitId ?? undefined,
          quantity: c.quantity,
          support_quantity: c.supportQuantity,
          discount_amount: c.discountAmount,
        })),
        payments: filteredPayments,
        received_returnables: validReturnables.length > 0 ? validReturnables : undefined,
      });
    },
    onSuccess: (sale) => {
      onSaleSuccess(sale);
      qc.invalidateQueries({ queryKey: ['products-pos'] });
      qc.invalidateQueries({ queryKey: ['products-orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client-packaging-balances'] });
      qc.invalidateQueries({ queryKey: ['consignments'] });
      qc.invalidateQueries({ queryKey: ['packaging-obligations'] });
      qc.invalidateQueries({ queryKey: ['packaging-dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer-deposits'] });
      qc.invalidateQueries({ queryKey: ['customer-deposit-history'] });
      qc.invalidateQueries({ queryKey: ['packaging-assets'] });
      qc.invalidateQueries({ queryKey: ['commercial-documents'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err) =>
      onSaleError(err instanceof Error ? err.message : 'Erreur lors de la validation.'),
  });

  const quickClientMutation = useMutation({
    mutationFn: (input: {
      name: string;
      client_type: 'particulier' | 'professionnel';
      phone: string;
    }) =>
      apiClient.createClient({
        name: input.name.trim(),
        client_type: input.client_type,
        phone: input.phone.trim() || undefined,
        credit_policy: 'forbidden',
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      onQuickClientSuccess(created.id);
    },
    onError: (err) =>
      onQuickClientError(err instanceof Error ? err.message : 'Erreur création client.'),
  });

  return { createSaleMutation, quickClientMutation };
}
