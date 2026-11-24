import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type {
  CustomerOrderDetail,
  OrderRequestedUnit,
} from '../../../types/erp.ts';
import {
  clearOrderDraft,
  computeLocalComposition,
  extractVariantOptions,
  loadOrderDraft,
  saveOrderDraft,
  type OrderDraftState,
} from '../utils/orderComposition.ts';

export const EMPTY_ORDER_DRAFT: OrderDraftState = {
  customer_id: null,
  payment_method: 'cash',
  planned_payment_channel: 'cash',
  discount_xof: 0,
  delivery_mode: 'pickup',
  courier_name: '',
  planned_delivery_time: '',
  delivery_fee_xof: 0,
  delivery_address: '',
  delivery_landmark: '',
  notes: '',
  lines: [],
  custom_allocations: null,
  returned_empties: [],
};

export function useOrdersWizard() {
  const qc = useQueryClient();
  const [step, setStep] = useState<number>(1);
  const [draft, setDraft] = useState<OrderDraftState>(() => loadOrderDraft() ?? EMPTY_ORDER_DRAFT);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [activeOrder, setActiveOrder] = useState<CustomerOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightLockRef = useRef(false);

  useEffect(() => {
    saveOrderDraft(draft);
  }, [draft]);

  const clientsQuery = useQuery({ queryKey: ['clients'], queryFn: () => apiClient.listClients() });
  const cashQuery = useQuery({ queryKey: ['cash'], queryFn: () => apiClient.getCashStatus() });
  const productsQuery = useQuery({
    queryKey: ['products-orders'],
    queryFn: () => apiClient.listProducts({ page: 1, pageSize: 200 }),
  });
  const assetsQuery = useQuery({
    queryKey: ['packaging-assets'],
    queryFn: () => apiClient.listPackagingAssets(),
  });
  const ordersQuery = useQuery({
    queryKey: ['customer-orders'],
    queryFn: () => apiClient.listCustomerOrders(),
  });
  const depositsQuery = useQuery({
    queryKey: ['customer-deposits', draft.customer_id],
    enabled: Boolean(draft.customer_id),
    queryFn: () => apiClient.getCustomerDeposits(draft.customer_id!),
  });
  const obligationsQuery = useQuery({
    queryKey: ['packaging-obligations', draft.customer_id],
    enabled: Boolean(draft.customer_id),
    queryFn: () => apiClient.listPackagingObligations(draft.customer_id!),
  });
  const depositHistoryQuery = useQuery({
    queryKey: ['customer-deposit-history', draft.customer_id],
    enabled: Boolean(draft.customer_id),
    queryFn: () => apiClient.getCustomerDepositHistory(draft.customer_id!),
  });

  const validLineInputs = useMemo(
    () =>
      draft.lines
        .filter((l) => l.variant_id && l.requested_quantity > 0)
        .map((l) => ({
          variant_id: l.variant_id!,
          requested_unit: l.requested_unit,
          requested_quantity: l.requested_quantity,
          unit_price_xof: l.unit_price_xof,
        })),
    [draft.lines],
  );

  const serverPreviewQuery = useQuery({
    queryKey: ['order-compose-preview', validLineInputs, draft.discount_xof, draft.delivery_fee_xof],
    enabled: validLineInputs.length > 0,
    retry: false,
    queryFn: () =>
      apiClient.composeOrderPreview({
        lines: validLineInputs,
        discount_xof: draft.discount_xof,
        delivery_fee_xof: draft.delivery_fee_xof,
      }),
  });

  const variantOptions = useMemo(
    () => extractVariantOptions(productsQuery.data?.items),
    [productsQuery.data?.items],
  );

  const localPreview = useMemo(
    () =>
      computeLocalComposition(
        draft.lines,
        variantOptions,
        assetsQuery.data ?? [],
        draft.discount_xof,
        draft.delivery_fee_xof,
      ),
    [draft.lines, draft.discount_xof, draft.delivery_fee_xof, variantOptions, assetsQuery.data],
  );

  const basePreview =
    validLineInputs.length > 0 && serverPreviewQuery.data
      ? serverPreviewQuery.data
      : localPreview;

  const effectivePreview = useMemo(() => {
    const deliveryFee = basePreview.totals.delivery_fee_xof ?? Math.max(0, draft.delivery_fee_xof);
    if (!draft.custom_allocations) {
      return {
        ...basePreview,
        totals: {
          ...basePreview.totals,
          delivery_fee_xof: deliveryFee,
        },
      };
    }
    const depositTotal = draft.custom_allocations
      .filter((a) => a.is_consigned)
      .reduce((acc, a) => acc + a.quantity * a.deposit_amount_xof, 0);
    return {
      ...basePreview,
      allocations: draft.custom_allocations,
      totals: {
        ...basePreview.totals,
        delivery_fee_xof: deliveryFee,
        deposit_total_xof: depositTotal,
        deposit_due_xof: depositTotal,
        total_to_collect_xof: basePreview.totals.total_xof + depositTotal + deliveryFee,
      },
    };
  }, [basePreview, draft.custom_allocations, draft.delivery_fee_xof]);

  const refreshAll = (detail: CustomerOrderDetail) => {
    setActiveOrder(detail);
    qc.invalidateQueries({ queryKey: ['customer-orders'] });
    qc.invalidateQueries({ queryKey: ['customer-deposits'] });
    qc.invalidateQueries({ queryKey: ['customer-deposit-history'] });
    qc.invalidateQueries({ queryKey: ['packaging-assets'] });
    qc.invalidateQueries({ queryKey: ['consignments'] });
    qc.invalidateQueries({ queryKey: ['packaging-obligations'] });
    qc.invalidateQueries({ queryKey: ['packaging-dashboard'] });
    qc.invalidateQueries({ queryKey: ['client-packaging-balances'] });
    qc.invalidateQueries({ queryKey: ['clients'] });
    qc.invalidateQueries({ queryKey: ['sales'] });
    qc.invalidateQueries({ queryKey: ['receivables'] });
    qc.invalidateQueries({ queryKey: ['products-orders'] });
    qc.invalidateQueries({ queryKey: ['products-pos'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['commercial-documents'] });
    qc.invalidateQueries({ queryKey: ['cash'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (inFlightLockRef.current) {
        throw new Error('Une opération est déjà en cours de traitement.');
      }
      if (!draft.customer_id) throw new Error('Veuillez sélectionner un client.');
      if (validLineInputs.length === 0) throw new Error('Ajoutez au moins une ligne produit.');
      inFlightLockRef.current = true;
      try {
        const payload = {
          customer_id: draft.customer_id,
          order_type: (validLineInputs.length > 1 ? 'mixte' : 'vente') as 'mixte' | 'vente',
          payment_method: draft.payment_method,
          planned_payment_channel: draft.planned_payment_channel || draft.payment_method,
          discount_xof: Math.max(0, draft.discount_xof),
          delivery_mode: draft.delivery_mode,
          courier_name: draft.courier_name.trim() || null,
          planned_delivery_time: draft.planned_delivery_time.trim() || null,
          delivery_fee_xof: draft.delivery_mode === 'delivery' ? Math.max(0, draft.delivery_fee_xof) : 0,
          delivery_address: draft.delivery_address.trim() || null,
          delivery_landmark: draft.delivery_landmark.trim() || null,
          notes: draft.notes.trim() || null,
          lines: validLineInputs,
          allocations: draft.custom_allocations
            ? draft.custom_allocations.map((a) => ({
                packaging_asset_id: a.packaging_asset_id,
                quantity: a.quantity,
                is_consigned: a.is_consigned,
                deposit_amount_xof: a.deposit_amount_xof,
              }))
            : null,
          returned_empties: draft.returned_empties.length
            ? draft.returned_empties.map((r) => ({
                packaging_asset_id: r.packaging_asset_id,
                quantity: r.pieces,
              }))
            : null,
        };
        return await (editingOrderId
          ? apiClient.updateCustomerOrder(editingOrderId, payload)
          : apiClient.createCustomerOrder(payload));
      } finally {
        inFlightLockRef.current = false;
      }
    },
    onSuccess: (detail) => {
      setError(null);
      setEditingOrderId(null);
      clearOrderDraft();
      setDraft(EMPTY_ORDER_DRAFT);
      refreshAll(detail);
      setStep(5);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Erreur création commande.'),
  });

  const actionMutation = useMutation({
    mutationFn: async (fn: () => Promise<CustomerOrderDetail>) => {
      if (inFlightLockRef.current) {
        throw new Error('Une opération est déjà en cours de traitement.');
      }
      inFlightLockRef.current = true;
      try {
        return await fn();
      } finally {
        inFlightLockRef.current = false;
      }
    },
    onSuccess: (detail) => {
      setError(null);
      refreshAll(detail);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Erreur opération commande.'),
  });

  const startEditingDraft = (detail: CustomerOrderDetail) => {
    if (detail.order.status !== 'draft') return;
    setEditingOrderId(detail.order.id);
    setDraft({
      customer_id: detail.order.customer_id,
      payment_method: (detail.order.payment_method as OrderDraftState['payment_method']) ?? 'cash',
      planned_payment_channel: detail.order.planned_payment_channel ?? detail.order.payment_method ?? 'cash',
      discount_xof: detail.order.discount_xof,
      delivery_mode: (detail.order.delivery_mode === 'delivery' ? 'delivery' : 'pickup'),
      courier_name: detail.order.courier_name ?? '',
      planned_delivery_time: detail.order.planned_delivery_time ?? '',
      delivery_fee_xof: detail.order.delivery_fee_xof ?? 0,
      delivery_address: detail.order.delivery_address ?? '',
      delivery_landmark: detail.order.delivery_landmark ?? '',
      notes: detail.order.notes ?? '',
      lines: detail.lines.map((l, idx) => ({
        key: `edit-${l.id}-${idx}`,
        product_id: l.product_id,
        variant_id: l.variant_id,
        requested_unit: l.requested_unit as OrderRequestedUnit,
        requested_quantity: l.requested_quantity,
        unit_price_xof: l.unit_price_xof,
      })),
      custom_allocations: null,
      // On repart d'un brouillon propre : un retour saisi sur une commande
      // precedente ne doit pas etre reapplique silencieusement a celle-ci.
      returned_empties: [],
    });
    setStep(2);
  };

  return {
    step,
    setStep,
    draft,
    setDraft,
    editingOrderId,
    setEditingOrderId,
    activeOrder,
    setActiveOrder,
    error,
    setError,
    clients: clientsQuery.data ?? [],
    deposits: depositsQuery.data ?? [],
    customerObligations: obligationsQuery.data ?? [],
    depositHistory: depositHistoryQuery.data ?? [],
    orders: ordersQuery.data ?? [],
    variantOptions,
    effectivePreview,
    isServerPreview: Boolean(validLineInputs.length > 0 && serverPreviewQuery.data),
    createMutation,
    actionMutation,
    startEditingDraft,
    hasOpenCashSession: Boolean(cashQuery.data?.activeSession),
  };
}
