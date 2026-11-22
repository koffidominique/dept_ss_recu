import { Router } from 'express';
import type {
  AppSettings,
  ComposePreviewResult,
  CustomerOrderDetail,
  OrderLineInput,
  PreviewAllocation,
  PreviewLine,
} from '../../src/types/erp.ts';
import { requirePerm, type AuthedRequest } from '../authMiddleware.ts';
import {
  buildOrderReceiptSnapshotPayload,
  ensureOrderReceiptV1,
  ensurePaymentReceiptSnapshot,
  type SnapshotActor,
} from '../documentSnapshots.ts';
import { addAudit, nextId, nextSeq, store } from '../store.ts';
import { nowIso, type PaymentRecord } from '../types.ts';

function toActor(req: AuthedRequest): SnapshotActor {
  return {
    userId: req.user?.userId,
    displayName: req.user?.displayName,
    role: req.user?.role,
  };
}

function enrichOrderDetail(detail: CustomerOrderDetail): CustomerOrderDetail {
  const orderPayments = store.payments
    .filter((p) => p.order_id === detail.order.id)
    .map((p) => ({
      id: p.id,
      reference: p.reference,
      amount_xof: p.total_amount,
      method_code: p.parts[0]?.method_code ?? 'cash',
      method_label: p.parts.map((pt) => pt.method_label).join(', ') || 'Espèces',
      external_reference: p.external_reference,
      recorded_by_name: p.recorded_by_name,
      created_at: p.created_at,
    }));
  return {
    ...detail,
    payments: orderPayments,
  };
}

function computeCompose(
  rawLines: OrderLineInput[],
  discountXof = 0,
  taxXof = 0,
  deliveryFeeXof = 0,
): ComposePreviewResult {
  const lines: PreviewLine[] = [];
  const qtyByCompat = new Map<string, number>();

  for (const input of rawLines) {
    const prod =
      store.products.find((p) => p.variants?.some((v) => v.id === input.variant_id)) ??
      store.products[0];
    const variant =
      prod?.variants?.find((v) => v.id === input.variant_id) ?? prod?.variants?.[0];
    if (!prod || !variant) continue;

    const compat = variant.compatibility_class ?? 'glass_bottle_330ml';
    const nativeCap = variant.native_crate_capacity ?? 24;
    const unit = input.requested_unit.toLowerCase();
    const factor =
      unit === 'crate'
        ? nativeCap
        : unit === 'half_crate'
          ? Math.max(1, Math.floor(nativeCap / 2))
          : unit === 'carton'
            ? 24
            : unit === 'pack'
              ? 6
              : unit === 'pallet'
                ? nativeCap * 40
                : 1;
    const baseQty = input.requested_quantity * factor;
    const unitPrice = input.unit_price_xof ?? prod.retail_price ?? 500;
    const disc = Math.max(0, input.discount_xof ?? 0);
    const lineTotal = Math.max(0, baseQty * unitPrice - disc);

    if (variant.container_returnable === 1) {
      qtyByCompat.set(compat, (qtyByCompat.get(compat) ?? 0) + baseQty);
    }

    lines.push({
      variant_id: variant.id,
      product_id: prod.id,
      product_name: prod.name,
      variant_name: variant.name,
      compatibility_class: compat,
      base_unit: prod.base_unit,
      requested_unit: unit,
      requested_quantity: input.requested_quantity,
      units_per_requested_unit: factor,
      base_quantity: baseQty,
      unit_price_xof: unitPrice,
      discount_xof: disc,
      line_total_xof: lineTotal,
    });
  }

  const allocations: PreviewAllocation[] = [];
  const warnings: string[] = [];
  for (const [compat, totalUnits] of qtyByCompat.entries()) {
    const asset =
      store.packagingAssets.find((a) => a.compatibility_class === compat) ??
      store.packagingAssets[0];
    if (!asset) continue;
    const cratesNeeded = Math.ceil(totalUnits / Math.max(1, asset.capacity));
    if (cratesNeeded > 0) {
      allocations.push({
        packaging_asset_id: asset.id,
        packaging_name: asset.name,
        compatibility_class: compat,
        capacity: asset.capacity,
        quantity: cratesNeeded,
        is_consigned: true,
        deposit_amount_xof: asset.deposit_value,
        total_deposit_xof: cratesNeeded * asset.deposit_value,
      });
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.line_total_xof, 0);
  const depositTotal = allocations
    .filter((a) => a.is_consigned)
    .reduce((s, a) => s + a.total_deposit_xof, 0);
  const cleanDeliveryFee = Math.max(0, Math.round(deliveryFeeXof));
  const totalXof = Math.max(0, subtotal - discountXof + taxXof);
  const totalToCollect = totalXof + depositTotal + cleanDeliveryFee;

  return {
    lines,
    allocations,
    warnings,
    totals: {
      subtotal_xof: subtotal,
      deposit_total_xof: depositTotal,
      discount_xof: discountXof,
      tax_xof: taxXof,
      delivery_fee_xof: cleanDeliveryFee,
      total_xof: totalXof,
      deposit_due_xof: depositTotal,
      total_to_collect_xof: totalToCollect,
    },
  };
}

export function createOrdersRouter(): Router {
  const router = Router();

  router.post('/api/orders/compose-preview', requirePerm('sales:read'), (req, res) => {
    const lines = Array.isArray(req.body?.lines) ? (req.body.lines as OrderLineInput[]) : [];
    const discountXof = Number(req.body?.discount_xof ?? 0);
    const taxXof = Number(req.body?.tax_xof ?? 0);
    const deliveryFeeXof = Number(req.body?.delivery_fee_xof ?? 0);
    res.json(computeCompose(lines, discountXof, taxXof, deliveryFeeXof));
  });

  router.get('/api/orders', requirePerm('sales:read'), (req, res) => {
    const status = String(req.query.status ?? '').trim();
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;
    const filtered = store.orders
      .filter((o) => {
        if (status && o.order.status !== status) return false;
        if (customerId && o.order.customer_id !== customerId) return false;
        return true;
      })
      .map((o) => o.order);
    res.json(filtered);
  });

  router.get('/api/orders/:id', requirePerm('sales:read'), (req, res) => {
    const order = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    res.json(enrichOrderDetail(order));
  });

  router.post('/api/orders', requirePerm('sales:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const customerId = Number(body.customer_id);
    const client = store.clients.find((c) => c.id === customerId);
    if (!client) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Client introuvable.' });
      return;
    }
    const rawLines = Array.isArray(body.lines) ? (body.lines as OrderLineInput[]) : [];
    const discountXof = Math.max(0, Number(body.discount_xof ?? 0));
    const taxXof = Math.max(0, Number(body.tax_xof ?? 0));
    const deliveryFeeXof = Math.max(0, Number(body.delivery_fee_xof ?? 0));
    const preview = computeCompose(rawLines, discountXof, taxXof, deliveryFeeXof);

    const orderId = nextId();
    const orderNumber = nextSeq(store.settings.order_prefix || 'CMD');
    const createdAt = nowIso();
    const paymentMethod = body.payment_method ? String(body.payment_method) : 'cash';

    const detail: CustomerOrderDetail = {
      order: {
        id: orderId,
        order_number: orderNumber,
        customer_id: client.id,
        customer_name: client.name,
        order_type: String(body.order_type ?? 'vente'),
        status: 'draft',
        approval_status: 'draft',
        subtotal_xof: preview.totals.subtotal_xof,
        deposit_total_xof: preview.totals.deposit_total_xof,
        discount_xof: discountXof,
        tax_xof: taxXof,
        delivery_fee_xof: deliveryFeeXof,
        total_xof: preview.totals.total_xof,
        deposit_due_xof: preview.totals.deposit_due_xof,
        total_to_collect_xof: preview.totals.total_to_collect_xof,
        paid_xof: 0,
        payment_status: 'unpaid',
        payment_method: paymentMethod,
        planned_payment_channel: body.planned_payment_channel
          ? String(body.planned_payment_channel)
          : paymentMethod,
        delivery_mode: body.delivery_mode ? String(body.delivery_mode) : 'pickup',
        courier_name: body.courier_name ? String(body.courier_name) : null,
        planned_delivery_time: body.planned_delivery_time ? String(body.planned_delivery_time) : null,
        delivery_date: body.delivery_date ? String(body.delivery_date) : null,
        delivery_address: body.delivery_address ? String(body.delivery_address) : null,
        delivery_landmark: body.delivery_landmark
          ? String(body.delivery_landmark)
          : client.landmark ?? null,
        notes: body.notes ? String(body.notes) : null,
        created_at: createdAt,
        updated_at: createdAt,
      },
      lines: preview.lines.map((l) => ({
        id: nextId(),
        order_id: orderId,
        product_id: l.product_id,
        product_name: l.product_name,
        base_unit: l.base_unit,
        variant_id: l.variant_id,
        variant_name: l.variant_name,
        compatibility_class: l.compatibility_class,
        requested_unit: l.requested_unit,
        requested_quantity: l.requested_quantity,
        base_quantity: l.base_quantity,
        unit_price_xof: l.unit_price_xof,
        line_total_xof: l.line_total_xof,
        discount_xof: l.discount_xof,
        notes: null,
      })),
      allocations: preview.allocations.map((a) => ({
        id: nextId(),
        order_id: orderId,
        packaging_asset_id: a.packaging_asset_id,
        packaging_name: a.packaging_name,
        compatibility_class: a.compatibility_class,
        capacity: a.capacity,
        quantity: a.quantity,
        is_consigned: a.is_consigned ? 1 : 0,
        deposit_amount_xof: a.deposit_amount_xof,
        provided_by: 'depot',
        returned_quantity: 0,
        notes: null,
      })),
      links: [],
      customer_deposits: store.customerDeposits.filter((d) => d.customer_id === client.id),
    };

    store.orders.unshift(detail);
    addAudit('CREATE_ORDER', 'orders', `${orderNumber} (${client.name})`);
    res.status(201).json(enrichOrderDetail(detail));
  });

  router.patch('/api/orders/:id', requirePerm('sales:write'), (req, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.notes !== undefined) detail.order.notes = body.notes ? String(body.notes) : null;
    if (body.delivery_address !== undefined) {
      detail.order.delivery_address = body.delivery_address ? String(body.delivery_address) : null;
    }
    if (body.delivery_landmark !== undefined) {
      detail.order.delivery_landmark = body.delivery_landmark ? String(body.delivery_landmark) : null;
    }
    if (body.delivery_mode !== undefined) {
      detail.order.delivery_mode = String(body.delivery_mode || 'pickup');
    }
    if (body.courier_name !== undefined) {
      detail.order.courier_name = body.courier_name ? String(body.courier_name) : null;
    }
    if (body.planned_delivery_time !== undefined) {
      detail.order.planned_delivery_time = body.planned_delivery_time
        ? String(body.planned_delivery_time)
        : null;
    }
    if (body.delivery_date !== undefined) {
      detail.order.delivery_date = body.delivery_date ? String(body.delivery_date) : null;
    }
    if (body.planned_payment_channel !== undefined) {
      detail.order.planned_payment_channel = body.planned_payment_channel
        ? String(body.planned_payment_channel)
        : null;
    }
    if (body.payment_method !== undefined) {
      detail.order.payment_method = body.payment_method ? String(body.payment_method) : 'cash';
    }

    const discountXof =
      body.discount_xof !== undefined ? Math.max(0, Number(body.discount_xof)) : detail.order.discount_xof;
    const taxXof = body.tax_xof !== undefined ? Math.max(0, Number(body.tax_xof)) : detail.order.tax_xof;
    const deliveryFeeXof =
      body.delivery_fee_xof !== undefined
        ? Math.max(0, Number(body.delivery_fee_xof))
        : detail.order.delivery_fee_xof ?? 0;

    if (detail.order.status === 'draft' && Array.isArray(body.lines)) {
      const preview = computeCompose(body.lines as OrderLineInput[], discountXof, taxXof, deliveryFeeXof);
      detail.lines = preview.lines.map((l) => ({
        id: nextId(),
        order_id: detail.order.id,
        product_id: l.product_id,
        product_name: l.product_name,
        base_unit: l.base_unit,
        variant_id: l.variant_id,
        variant_name: l.variant_name,
        compatibility_class: l.compatibility_class,
        requested_unit: l.requested_unit,
        requested_quantity: l.requested_quantity,
        base_quantity: l.base_quantity,
        unit_price_xof: l.unit_price_xof,
        line_total_xof: l.line_total_xof,
        discount_xof: l.discount_xof,
        notes: null,
      }));
      detail.allocations = preview.allocations.map((a) => ({
        id: nextId(),
        order_id: detail.order.id,
        packaging_asset_id: a.packaging_asset_id,
        packaging_name: a.packaging_name,
        compatibility_class: a.compatibility_class,
        capacity: a.capacity,
        quantity: a.quantity,
        is_consigned: a.is_consigned ? 1 : 0,
        deposit_amount_xof: a.deposit_amount_xof,
        provided_by: 'depot',
        returned_quantity: 0,
        notes: null,
      }));
      detail.order.subtotal_xof = preview.totals.subtotal_xof;
      detail.order.deposit_total_xof = preview.totals.deposit_total_xof;
      detail.order.deposit_due_xof = preview.totals.deposit_due_xof;
      detail.order.total_xof = preview.totals.total_xof;
      detail.order.total_to_collect_xof = preview.totals.total_to_collect_xof;
    } else if (
      body.discount_xof !== undefined ||
      body.tax_xof !== undefined ||
      body.delivery_fee_xof !== undefined
    ) {
      detail.order.discount_xof = discountXof;
      detail.order.tax_xof = taxXof;
      detail.order.delivery_fee_xof = deliveryFeeXof;
      detail.order.total_xof = Math.max(0, detail.order.subtotal_xof - discountXof + taxXof);
      detail.order.total_to_collect_xof =
        detail.order.total_xof + detail.order.deposit_due_xof + deliveryFeeXof;
    }

    detail.order.updated_at = nowIso();
    res.json(enrichOrderDetail(detail));
  });

  router.post('/api/orders/:id/confirm', requirePerm('sales:write'), (req: AuthedRequest, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    if (detail.order.status === 'cancelled') {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Commande annulée impossible à confirmer.' });
      return;
    }
    detail.order.status = 'confirmed';
    detail.order.approval_status = 'approved';
    detail.order.updated_at = nowIso();

    // Auto-issue immutable v1 Customer Order Receipt
    ensureOrderReceiptV1(detail, toActor(req));
    addAudit('CONFIRM_ORDER', 'orders', `${detail.order.order_number} confirmée (reçu v1 émis)`);
    res.json(enrichOrderDetail(detail));
  });

  router.post('/api/orders/:id/deliver', requirePerm('sales:write'), (req, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    detail.order.status = 'delivered';
    detail.order.updated_at = nowIso();
    for (const alloc of detail.allocations) {
      if (alloc.is_consigned) {
        const existing = store.customerDeposits.find(
          (d) => d.customer_id === detail.order.customer_id && d.packaging_asset_id === alloc.packaging_asset_id,
        );
        if (existing) {
          existing.quantity_held += alloc.quantity;
          existing.amount_held_xof += alloc.quantity * alloc.deposit_amount_xof;
          existing.last_movement_at = nowIso();
        } else {
          store.customerDeposits.push({
            id: nextId(),
            customer_id: detail.order.customer_id,
            packaging_asset_id: alloc.packaging_asset_id,
            packaging_name: alloc.packaging_name,
            compatibility_class: alloc.compatibility_class,
            deposit_value: alloc.deposit_amount_xof,
            quantity_held: alloc.quantity,
            amount_held_xof: alloc.quantity * alloc.deposit_amount_xof,
            last_movement_at: nowIso(),
          });
        }
      }
    }
    detail.customer_deposits = store.customerDeposits.filter((d) => d.customer_id === detail.order.customer_id);
    res.json(enrichOrderDetail(detail));
  });

  router.post('/api/orders/:id/invoice', requirePerm('sales:write'), (req, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    detail.order.status = 'invoiced';
    detail.order.updated_at = nowIso();
    res.json(enrichOrderDetail(detail));
  });

  router.post('/api/orders/:id/pay', requirePerm('sales:write'), (req: AuthedRequest, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    const amount = Math.max(0, Number(req.body?.amount_xof ?? 0));
    if (amount <= 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Le montant du paiement doit être positif.' });
      return;
    }
    const method = String(req.body?.method ?? 'cash');
    const externalReference = req.body?.external_reference ? String(req.body.external_reference).trim() : null;
    const note = req.body?.note ? String(req.body.note).trim() : null;

    const beforeBalance = Math.max(0, detail.order.total_to_collect_xof - detail.order.paid_xof);
    detail.order.paid_xof += amount;
    const afterBalance = Math.max(0, detail.order.total_to_collect_xof - detail.order.paid_xof);
    detail.order.payment_status =
      detail.order.paid_xof >= detail.order.total_to_collect_xof ? 'paid' : 'partial';
    detail.order.payment_method = method;
    if (detail.order.payment_status === 'paid' && detail.order.status === 'invoiced') {
      detail.order.status = 'paid';
    }
    detail.order.updated_at = nowIso();

    const pm = store.paymentMethods.find((m) => m.code === method);
    const activeSession = store.cashSessions.find((s) => s.status === 'open');
    const createdAt = nowIso();
    if (activeSession) {
      store.cashMovements.unshift({
        id: nextId(),
        session_id: activeSession.id,
        kind: 'order_payment',
        method_code: method,
        method_label: pm?.label ?? method,
        is_cash: pm?.is_cash ?? (method === 'cash' ? 1 : 0),
        direction: 'in',
        amount,
        description: `Paiement commande ${detail.order.order_number}`,
        reference_document: detail.order.order_number,
        created_at: createdAt,
      });
    }

    const payRec: PaymentRecord = {
      id: nextId(),
      reference: nextSeq('PAY'),
      payment_kind: 'order',
      client_id: detail.order.customer_id,
      order_id: detail.order.id,
      sale_id: null,
      receivable_id: null,
      total_amount: amount,
      external_reference: externalReference,
      note,
      recorded_by_user_id: req.user?.userId ?? '1',
      recorded_by_name: req.user?.displayName ?? 'Propriétaire',
      recorded_by_role: req.user?.role ?? 'owner',
      balance_before_xof: beforeBalance,
      balance_after_xof: afterBalance,
      parts: [
        {
          method_code: method,
          method_label: pm?.label ?? method,
          amount,
        },
      ],
      created_at: createdAt,
    };
    store.payments.unshift(payRec);
    ensurePaymentReceiptSnapshot(payRec.id);
    addAudit('PAY_ORDER', 'orders', `${detail.order.order_number} : ${amount} FCFA (${payRec.reference})`);

    res.json(enrichOrderDetail(detail));
  });

  router.post('/api/orders/:id/cancel', requirePerm('sales:write'), (req, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    detail.order.status = 'cancelled';
    detail.order.updated_at = nowIso();
    res.json(enrichOrderDetail(detail));
  });

  router.post('/api/orders/:id/returns', requirePerm('consignments:write'), (req, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    const assetId = Number(req.body?.packaging_asset_id);
    const qty = Math.max(1, Number(req.body?.quantity ?? 1));
    const alloc = detail.allocations.find((a) => a.packaging_asset_id === assetId);
    if (alloc) {
      alloc.returned_quantity = Math.min(alloc.quantity, alloc.returned_quantity + qty);
      const deposit = store.customerDeposits.find(
        (d) => d.customer_id === detail.order.customer_id && d.packaging_asset_id === assetId,
      );
      if (deposit) {
        deposit.quantity_held = Math.max(0, deposit.quantity_held - qty);
        deposit.amount_held_xof = deposit.quantity_held * deposit.deposit_value;
        deposit.last_movement_at = nowIso();
      }
    }
    detail.customer_deposits = store.customerDeposits.filter((d) => d.customer_id === detail.order.customer_id);
    res.json(enrichOrderDetail(detail));
  });

  router.post('/api/orders/:id/receipt', requirePerm('sales:read'), (req: AuthedRequest, res) => {
    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }
    try {
      const snap = ensureOrderReceiptV1(detail, toActor(req));
      res.json(snap);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 400).json({
        code: e.code ?? 'VALIDATION_ERROR',
        message: e.message ?? 'Impossible d’émettre le reçu.',
      });
    }
  });

  router.get('/api/orders/:id/receipts', requirePerm('sales:read'), (req, res) => {
    const list = store.orderReceipts.get(Number(req.params.id)) ?? [];
    res.json(list);
  });

  router.post('/api/orders/:id/receipts', requirePerm('sales:write'), (req: AuthedRequest, res) => {
    if (req.user?.role !== 'owner') {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Seul le propriétaire peut émettre une version révisée d’un reçu de commande.',
      });
      return;
    }

    const detail = store.orders.find((o) => o.order.id === Number(req.params.id));
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
      return;
    }

    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 8 || reason.length > 500) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Le motif de révision est obligatoire (entre 8 et 500 caractères).',
      });
      return;
    }

    let v1;
    try {
      v1 = ensureOrderReceiptV1(detail, toActor(req));
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 400).json({
        code: e.code ?? 'VALIDATION_ERROR',
        message: e.message ?? 'Commande non éligible pour une révision de reçu.',
      });
      return;
    }

    let originalCompany: AppSettings | undefined;
    try {
      const parsed = JSON.parse(v1.snapshot_json) as { company?: AppSettings };
      originalCompany = parsed.company;
    } catch {
      originalCompany = undefined;
    }

    const list = store.orderReceipts.get(detail.order.id) ?? [];
    const latestPrev = list[0];
    const version = (latestPrev?.version ?? list.length) + 1;
    const receiptNumber = `REC-${detail.order.order_number}-V${version}`;
    const issuedAt = nowIso();

    const payload = buildOrderReceiptSnapshotPayload({
      detail,
      actor: toActor(req),
      version,
      receiptNumber,
      issuedAt,
      revisionReason: reason,
      companyOverride: originalCompany,
      supersedesReceiptNumber: latestPrev?.receipt_number ?? v1.receipt_number,
    });

    const snap = {
      id: nextId(),
      order_id: detail.order.id,
      version,
      receipt_number: receiptNumber,
      snapshot_json: JSON.stringify(payload),
      issued_at: issuedAt,
      issued_by_user_id: req.user.userId,
      issued_by_name: req.user.displayName,
      issued_by_role: req.user.role,
      revision_reason: reason,
    };
    list.unshift(snap);
    store.orderReceipts.set(detail.order.id, list);
    addAudit('ISSUE_ORDER_RECEIPT_REVISION', 'orders', `${receiptNumber} (${reason})`);
    res.status(201).json(snap);
  });

  router.get('/api/packaging/assets', requirePerm('catalog:read'), (_req, res) => {
    res.json(store.packagingAssets);
  });

  router.get('/api/packaging/stock', requirePerm('stock:read'), (_req, res) => {
    res.json(store.packagingAssets);
  });

  router.get('/api/customers/:id/deposits', requirePerm('consignments:read'), (req, res) => {
    const customerId = Number(req.params.id);
    res.json(store.customerDeposits.filter((d) => d.customer_id === customerId));
  });

  router.get('/api/customers/:id/deposits/history', requirePerm('consignments:read'), (req, res) => {
    const customerId = Number(req.params.id);
    res.json(store.packagingMovements.filter((m) => m.customer_id === customerId));
  });

  router.post('/api/customers/:id/deposits/returns', requirePerm('consignments:write'), (req, res) => {
    const customerId = Number(req.params.id);
    const assetId = Number(req.body?.packaging_asset_id);
    const qty = Math.max(1, Number(req.body?.quantity ?? 1));
    const bal = store.customerDeposits.find(
      (d) => d.customer_id === customerId && d.packaging_asset_id === assetId,
    );
    if (bal) {
      const dec = Math.min(bal.quantity_held, qty);
      bal.quantity_held -= dec;
      bal.amount_held_xof = bal.quantity_held * bal.deposit_value;
      bal.last_movement_at = nowIso();
      store.packagingMovements.unshift({
        id: nextId(),
        packaging_asset_id: assetId,
        packaging_name: bal.packaging_name,
        customer_id: customerId,
        order_id: null,
        order_packaging_allocation_id: null,
        movement_type: 'return',
        quantity: dec,
        unit_deposit_xof: bal.deposit_value,
        total_deposit_xof: dec * bal.deposit_value,
        notes: req.body?.notes ? String(req.body.notes) : null,
        created_at: nowIso(),
      });
    }
    res.json(store.customerDeposits.filter((d) => d.customer_id === customerId));
  });

  return router;
}
