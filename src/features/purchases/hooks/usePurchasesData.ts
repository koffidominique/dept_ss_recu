import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type { PurchaseOrder, PurchaseReceiptResult } from '../../../types/erp.ts';
import { newRequestKey } from '../../../utils/format.ts';
import {
  computeExactLineGrossFcfa,
  parseQtyInputToMilliBigInt,
  toNonNegativeIntFcfaBigInt,
} from '../../sales/utils/saleCalculations.ts';
import type { PurchaseOrderSubmitValues } from '../components/PurchaseOrderModal.tsx';
import type { PurchaseReceiveSubmitValues } from '../components/PurchaseReceiveModal.tsx';

export function parseQtyMilliInput(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const [intPart, fracPart = ''] = cleaned.split('.');
  return Number(intPart) * 1000 + Number(fracPart.padEnd(3, '0'));
}

export function usePurchasesQueries(detailOpen: boolean) {
  const ordersQuery = useQuery({
    queryKey: ['purchases'],
    queryFn: () => apiClient.listPurchases(),
  });

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiClient.listSuppliers(),
  });

  const productsQuery = useQuery({
    queryKey: ['products-all'],
    queryFn: () => apiClient.listProducts({ page: 1, pageSize: 100 }),
  });

  const supplierDebtsQuery = useQuery({
    queryKey: ['supplier-debts'],
    queryFn: () => apiClient.listSupplierDebts(),
    enabled: detailOpen,
  });

  return { ordersQuery, suppliersQuery, productsQuery, supplierDebtsQuery };
}

interface UsePurchasesMutationsOptions {
  onCreatedPo: (created: PurchaseOrder) => void;
  onUpdatedPo: (updated: PurchaseOrder) => void;
  onReceivedPo: (result: PurchaseReceiptResult) => void;
  onCancelledPo: () => void;
  onError: (msg: string) => void;
}

export function usePurchasesMutations({
  onCreatedPo,
  onUpdatedPo,
  onReceivedPo,
  onCancelledPo,
  onError,
}: UsePurchasesMutationsOptions) {
  const qc = useQueryClient();

  const createPoMutation = useMutation({
    mutationFn: (input: PurchaseOrderSubmitValues) => {
      for (const line of input.lines) {
        const parsedQty = parseQtyInputToMilliBigInt(line.quantity, 'Quantité commandée');
        if (!parsedQty.ok) throw new Error(parsedQty.error);
        const parsedPrice = toNonNegativeIntFcfaBigInt(line.unit_price, 'Prix unitaire achat');
        if (!parsedPrice.ok) throw new Error(parsedPrice.error);
        const lineExact = computeExactLineGrossFcfa(
          parsedQty.milli,
          parsedPrice.fcfa,
          'Ligne commande'
        );
        if (!lineExact.ok) throw new Error(lineExact.error);
      }
      return apiClient.createPurchaseOrder({
        request_key: newRequestKey('po'),
        supplier_id: input.supplierId,
        expected_date: input.expected_date ?? null,
        payment_terms_label: input.payment_terms_label ?? null,
        delivery_address: input.delivery_address ?? null,
        commercial_conditions: input.commercial_conditions ?? null,
        discount_xof: input.discount_xof ?? 0,
        tax_xof: input.tax_xof ?? 0,
        extra_fees_xof: input.extra_fees_xof ?? 0,
        paid_deposit_xof: input.paid_deposit_xof ?? 0,
        notes: input.notes ?? null,
        lines: input.lines,
      });
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['commercial-documents'] });
      onCreatedPo(created);
    },
    onError: (err) => onError(err instanceof Error ? err.message : 'Erreur commande.'),
  });

  const updatePoMutation = useMutation({
    mutationFn: (input: PurchaseOrderSubmitValues & { purchaseOrderId: number }) => {
      for (const line of input.lines) {
        const parsedQty = parseQtyInputToMilliBigInt(line.quantity, 'Quantité commandée');
        if (!parsedQty.ok) throw new Error(parsedQty.error);
        const parsedPrice = toNonNegativeIntFcfaBigInt(line.unit_price, 'Prix unitaire achat');
        if (!parsedPrice.ok) throw new Error(parsedPrice.error);
        const lineExact = computeExactLineGrossFcfa(parsedQty.milli, parsedPrice.fcfa, 'Ligne commande');
        if (!lineExact.ok) throw new Error(lineExact.error);
      }
      return apiClient.updatePurchaseOrder(input.purchaseOrderId, {
        supplier_id: input.supplierId,
        expected_date: input.expected_date ?? null,
        payment_terms_label: input.payment_terms_label ?? null,
        delivery_address: input.delivery_address ?? null,
        commercial_conditions: input.commercial_conditions ?? null,
        discount_xof: input.discount_xof ?? 0,
        tax_xof: input.tax_xof ?? 0,
        extra_fees_xof: input.extra_fees_xof ?? 0,
        paid_deposit_xof: input.paid_deposit_xof ?? 0,
        notes: input.notes ?? null,
        lines: input.lines.map(({ product_id, packaging_id, quantity, unit_price }) => ({
          product_id, packaging_id, quantity, unit_price,
        })),
      });
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['commercial-documents'] });
      onUpdatedPo(updated);
    },
    onError: (err) => onError(err instanceof Error ? err.message : 'Erreur correction bon fournisseur.'),
  });

  const receiveMutation = useMutation({
    mutationFn: (input: PurchaseReceiveSubmitValues) => {
      const lines: Array<{
        purchase_order_line_id: number;
        received_quantity: string;
        missing_quantity?: string;
        damaged_quantity?: string;
        refused_quantity?: string;
        discrepancy_reason?: string;
      }> = [];
      for (const l of input.target.lines) {
        const raw = (input.receiveQty[l.id] || '').trim().replace(',', '.');
        const missRaw = (input.missingQty[l.id] || '').trim().replace(',', '.');
        const dmgRaw = (input.damagedQty[l.id] || '').trim().replace(',', '.');
        const refRaw = (input.refusedQty[l.id] || '').trim().replace(',', '.');

        const qtyMilli = parseQtyMilliInput(raw || '0');
        const missMilli = parseQtyMilliInput(missRaw || '0') ?? 0;
        const dmgMilli = parseQtyMilliInput(dmgRaw || '0') ?? 0;
        const refMilli = parseQtyMilliInput(refRaw || '0') ?? 0;

        if (qtyMilli === null) {
          throw new Error(`Quantité réceptionnée invalide pour ${l.product_name}.`);
        }
        if (qtyMilli <= 0 && missMilli <= 0 && dmgMilli <= 0 && refMilli <= 0) continue;
        const remMilli = Math.max(0, l.ordered_quantity_milli - l.received_quantity_milli);
        if (qtyMilli > remMilli) {
          throw new Error(
            `La quantité reçue dépasse le reliquat commandé pour ${l.product_name}.`
          );
        }
        const reason = input.receiveReason[l.id]?.trim();
        const hasDiscrepancy = missMilli > 0 || dmgMilli > 0 || refMilli > 0 || qtyMilli < remMilli;
        if (hasDiscrepancy && !reason) {
          throw new Error(`Motif d'écart obligatoire pour ${l.product_name}.`);
        }
        lines.push({
          purchase_order_line_id: l.id,
          received_quantity: raw || '0',
          ...(missMilli > 0 ? { missing_quantity: missRaw } : {}),
          ...(dmgMilli > 0 ? { damaged_quantity: dmgRaw } : {}),
          ...(refMilli > 0 ? { refused_quantity: refRaw } : {}),
          discrepancy_reason: reason || undefined,
        });
      }
      if (lines.length === 0) {
        throw new Error('Saisissez au moins une ligne reçue.');
      }
      return apiClient.receivePurchaseOrder(input.target.id, {
        request_key: newRequestKey('rec'),
        notes: input.notes.trim() || undefined,
        lines,
      });
    },
    onSuccess: (received) => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['commercial-documents'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products-all'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['supplier-debts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onReceivedPo(received);
    },
    onError: (err) => onError(err instanceof Error ? err.message : 'Erreur réception.'),
  });

  const cancelPoMutation = useMutation({
    mutationFn: (input: { target: PurchaseOrder; reason: string }) =>
      apiClient.cancelPurchaseOrder(input.target.id, { reason: input.reason.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['commercial-documents'] });
      onCancelledPo();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : 'Erreur annulation commande.'),
  });

  return { createPoMutation, updatePoMutation, receiveMutation, cancelPoMutation };
}
