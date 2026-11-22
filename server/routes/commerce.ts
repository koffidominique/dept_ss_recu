import { Router } from 'express';
import type {
  Client,
  CommercialApprovalEvent,
  CommercialDocument,
  CommercialDocumentDetail,
  CommercialDocumentsKpis,
  CommercialDocumentSnapshotSummary,
  CommercialDocumentType,
  CreditPolicy,
  PriceTier,
  PurchaseOrder,
  PurchaseReceipt,
  SaleDetail,
  Supplier,
} from '../../src/types/erp.ts';
import { requirePerm, type AuthedRequest } from '../authMiddleware.ts';
import {
  ensurePaymentReceiptSnapshot,
  persistPurchaseDocumentSnapshot,
  persistPurchaseReceiptSnapshot,
  type SnapshotActor,
} from '../documentSnapshots.ts';
import { addAudit, nextId, nextSeq, store } from '../store.ts';
import { nowIso, parseQtyMilli, todayStr, type PaymentRecord } from '../types.ts';

function toActor(req: AuthedRequest): SnapshotActor {
  return {
    userId: req.user?.userId,
    displayName: req.user?.displayName,
    role: req.user?.role,
  };
}

function paginate<T>(items: T[], pageRaw: unknown, pageSizeRaw: unknown) {
  const page = Math.max(1, Number(pageRaw || 1));
  const pageSize = Math.max(1, Math.min(200, Number(pageSizeRaw || 20)));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

function getActiveCashSession() {
  return store.cashSessions.find((s) => s.status === 'open') ?? null;
}

function recordCashMovement(params: {
  kind: string;
  methodCode: string;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  referenceDocument: string | null;
}) {
  const session = getActiveCashSession();
  if (!session || params.amount <= 0) return;
  const pm = store.paymentMethods.find((m) => m.code === params.methodCode);
  store.cashMovements.unshift({
    id: nextId(),
    session_id: session.id,
    kind: params.kind,
    method_code: params.methodCode,
    method_label: pm?.label ?? params.methodCode,
    is_cash: pm?.is_cash ?? (params.methodCode === 'cash' ? 1 : 0),
    direction: params.direction,
    amount: params.amount,
    description: params.description,
    reference_document: params.referenceDocument,
    created_at: nowIso(),
  });
}

export function createCommerceRouter(): Router {
  const router = Router();

  // --- CLIENTS ---
  router.get('/api/clients', requirePerm('sales:read'), (req, res) => {
    const q = String(req.query.search ?? '').trim().toLowerCase();
    const list = q
      ? store.clients.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q) ||
            (c.phone ?? '').toLowerCase().includes(q),
        )
      : store.clients;
    res.json(list);
  });

  router.post('/api/clients', requirePerm('sales:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    if (!name) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nom du client requis.' });
      return;
    }
    const client: Client = {
      id: nextId(),
      code: nextSeq('CLI'),
      name,
      client_type: body.client_type === 'professionnel' ? 'professionnel' : 'particulier',
      establishment_name: body.establishment_name ? String(body.establishment_name) : null,
      category: body.category ? String(body.category) : null,
      phone: body.phone ? String(body.phone) : null,
      address: body.address ? String(body.address) : null,
      city: body.city ? String(body.city) : null,
      commune: body.commune ? String(body.commune) : null,
      quartier: body.quartier ? String(body.quartier) : null,
      landmark: body.landmark ? String(body.landmark) : null,
      email: body.email ? String(body.email) : null,
      contact_person: body.contact_person ? String(body.contact_person) : null,
      is_active: 1,
      credit_policy: (String(body.credit_policy ?? 'forbidden') as CreditPolicy),
      credit_limit: body.credit_limit != null ? Number(body.credit_limit) : null,
      payment_terms_days: Number(body.payment_terms_days ?? 0),
      unpaid_balance: 0,
      returnable_pieces_due: 0,
    };
    store.clients.unshift(client);
    addAudit('CREATE_CLIENT', 'clients', `${client.code} - ${client.name}`);
    res.status(201).json(client);
  });

  router.put('/api/clients/:id', requirePerm('sales:write'), (req, res) => {
    const client = store.clients.find((c) => c.id === Number(req.params.id));
    if (!client) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Client introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.name === 'string' && body.name.trim()) client.name = body.name.trim();
    if (body.client_type === 'particulier' || body.client_type === 'professionnel') client.client_type = body.client_type;
    if (body.establishment_name !== undefined) client.establishment_name = body.establishment_name ? String(body.establishment_name) : null;
    if (body.category !== undefined) client.category = body.category ? String(body.category) : null;
    if (body.phone !== undefined) client.phone = body.phone ? String(body.phone) : null;
    if (body.address !== undefined) client.address = body.address ? String(body.address) : null;
    if (body.city !== undefined) client.city = body.city ? String(body.city) : null;
    if (body.commune !== undefined) client.commune = body.commune ? String(body.commune) : null;
    if (body.quartier !== undefined) client.quartier = body.quartier ? String(body.quartier) : null;
    if (body.landmark !== undefined) client.landmark = body.landmark ? String(body.landmark) : null;
    if (body.email !== undefined) client.email = body.email ? String(body.email) : null;
    if (body.contact_person !== undefined) client.contact_person = body.contact_person ? String(body.contact_person) : null;
    if (body.is_active !== undefined) client.is_active = body.is_active ? 1 : 0;
    res.json(client);
  });

  router.put('/api/clients/:id/credit', requirePerm('sales:write'), (req, res) => {
    const client = store.clients.find((c) => c.id === Number(req.params.id));
    if (!client) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Client introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.credit_policy) client.credit_policy = String(body.credit_policy) as CreditPolicy;
    if (body.credit_limit !== undefined) client.credit_limit = body.credit_limit != null ? Number(body.credit_limit) : null;
    if (body.payment_terms_days !== undefined) client.payment_terms_days = Number(body.payment_terms_days ?? 0);
    res.json(client);
  });

  // --- SALES ---
  router.get('/api/sales', requirePerm('sales:read'), (req, res) => {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const status = String(req.query.status ?? '').trim();
    const filtered = store.sales.filter((s) => {
      if (status && s.status !== status) return false;
      if (search) {
        return (
          s.reference.toLowerCase().includes(search) ||
          s.client_name.toLowerCase().includes(search)
        );
      }
      return true;
    });
    res.json(paginate(filtered, req.query.page, req.query.pageSize));
  });

  router.get('/api/sales/:id', requirePerm('sales:read'), (req, res) => {
    const sale = store.sales.find((s) => s.id === Number(req.params.id));
    if (!sale) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Vente introuvable.' });
      return;
    }
    res.json(sale);
  });

  router.post('/api/sales', requirePerm('sales:write'), (req: AuthedRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    if (rawLines.length === 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Au moins une ligne de vente est requise.' });
      return;
    }
    const saleType = body.sale_type === 'credit' ? 'credit' : 'cash';
    const priceTier = (String(body.price_tier ?? 'retail') as PriceTier);
    const clientId = body.client_id ? Number(body.client_id) : null;
    const client = clientId ? store.clients.find((c) => c.id === clientId) : null;
    const globalDiscount = Math.max(0, Number(body.discount_amount ?? 0));

    let subtotalMerch = 0;
    let totalDeposit = 0;
    const saleId = nextId();
    const saleRef = nextSeq(store.settings.sale_prefix || 'VTE');
    const createdAt = nowIso();

    const saleLines: SaleDetail['lines'] = [];
    const saleDeposits: SaleDetail['deposits'] = [];

    for (const rawLine of rawLines) {
      const prod = store.products.find((p) => p.id === Number(rawLine.product_id));
      if (!prod) {
        res.status(404).json({ code: 'NOT_FOUND', message: `Produit #${rawLine.product_id} introuvable.` });
        return;
      }
      const pkg =
        prod.packagings.find((pk) => pk.id === Number(rawLine.packaging_id)) ?? prod.packagings[0];
      const qtyMilli = parseQtyMilli(String(rawLine.quantity ?? '1'));
      if (qtyMilli <= 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Quantité invalide.' });
        return;
      }
      const coeffMilli = pkg?.coefficient_milli ?? 1000;
      const baseQtyMilli = Math.round((qtyMilli * coeffMilli) / 1000);
      if (!store.settings.allow_negative_stock && prod.stock_milli < baseQtyMilli) {
        res.status(400).json({
          code: 'INSUFFICIENT_STOCK',
          message: `Stock insuffisant pour ${prod.name}.`,
        });
        return;
      }

      const unitPrice =
        priceTier === 'wholesale'
          ? (pkg?.wholesale_price ?? pkg?.retail_price ?? prod.wholesale_price ?? prod.retail_price ?? 0)
          : priceTier === 'semi_wholesale'
            ? (pkg?.semi_wholesale_price ?? pkg?.retail_price ?? prod.semi_wholesale_price ?? prod.retail_price ?? 0)
            : (pkg?.retail_price ?? prod.retail_price ?? 0);
      const lineDiscount = Math.max(0, Number(rawLine.discount_amount ?? 0));
      const lineTotal = Math.max(0, Math.round((qtyMilli / 1000) * unitPrice - lineDiscount));
      subtotalMerch += lineTotal;

      const stockBefore = prod.stock_milli;
      prod.stock_milli -= baseQtyMilli;
      store.stockMovements.unshift({
        id: nextId(),
        product_id: prod.id,
        product_name: prod.name,
        product_reference: prod.reference,
        base_unit: prod.base_unit,
        movement_type: 'sale_out',
        quantity_milli: -baseQtyMilli,
        stock_before_milli: stockBefore,
        stock_after_milli: prod.stock_milli,
        reason: 'Vente POS',
        reference_document: saleRef,
        created_at: createdAt,
      });

      const lineId = nextId();
      saleLines.push({
        id: lineId,
        product_id: prod.id,
        packaging_id: pkg?.id ?? 0,
        variant_id: prod.variant_id ?? null,
        sales_unit_id: rawLine.sales_unit_id ? Number(rawLine.sales_unit_id) : null,
        product_name: prod.name,
        packaging_name: pkg?.name ?? prod.base_unit,
        base_unit: prod.base_unit,
        coefficient_milli: coeffMilli,
        quantity_milli: qtyMilli,
        base_quantity_milli: baseQtyMilli,
        unit_price: unitPrice,
        discount_amount: lineDiscount,
        line_total: lineTotal,
        returned_base_milli: 0,
      });

      // Deposit calculation if packaging is consigned
      if (pkg && pkg.deposit_mode === 'deposit' && pkg.components.length > 0) {
        const packsCount = Math.round(qtyMilli / 1000);
        for (const comp of pkg.components) {
          const pieces = packsCount * comp.pieces_per_pack;
          const amount = pieces * comp.deposit_value;
          if (pieces > 0) {
            totalDeposit += amount;
            saleDeposits.push({
              id: nextId(),
              sale_line_id: lineId,
              returnable_id: comp.returnable_id,
              kind: comp.kind,
              packaging_name: comp.name,
              packaging_code: comp.code,
              pieces,
              returned_pieces: 0,
              unit_value: comp.deposit_value,
              amount,
              expected_products: prod.name,
            });
            store.packagingObligations.push({
              id: nextId(),
              sale_id: saleId,
              sale_reference: saleRef,
              client_id: clientId,
              returnable_id: comp.returnable_id,
              pieces,
              returned_pieces: 0,
              pending_pieces: pieces,
              unit_value: comp.deposit_value,
              total_reference_value: amount,
              due_date: body.due_date ? String(body.due_date) : todayStr(),
              overdue: false,
              status: 'open',
            });
          }
        }
      }
    }

    const totalMerch = Math.max(0, subtotalMerch - globalDiscount);
    const totalAmount = totalMerch + totalDeposit;
    const rawPayments = Array.isArray(body.payments) ? (body.payments as Array<Record<string, unknown>>) : [];
    const positivePayments = rawPayments.filter((p) => Number(p.amount ?? 0) > 0);
    const topExternalRef = body.external_reference ? String(body.external_reference).trim() : null;
    const recordedByUserId = req.user?.userId ?? '1';
    const recordedByName = req.user?.displayName ?? 'Propriétaire';
    const recordedByRole = req.user?.role ?? 'owner';

    const payments = positivePayments.map((p) => {
      const methodCode = String(p.method_code ?? 'cash');
      const pm = store.paymentMethods.find((m) => m.code === methodCode);
      const amt = Number(p.amount ?? 0);
      const extRef = p.external_reference ? String(p.external_reference).trim() : topExternalRef;
      recordCashMovement({
        kind: 'sale_in',
        methodCode,
        direction: 'in',
        amount: amt,
        description: `Encaissement vente ${saleRef}`,
        referenceDocument: saleRef,
      });
      return {
        id: nextId(),
        reference: nextSeq('PAY'),
        method_code: methodCode,
        method_label: pm?.label ?? methodCode,
        part_amount: amt,
        external_reference: extRef,
        recorded_by_user_id: recordedByUserId,
        recorded_by_name: recordedByName,
        created_at: createdAt,
      };
    });

    const paidAmount = payments.reduce((sum, p) => sum + p.part_amount, 0);
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    let receivableId: number | null = null;
    if (remainingAmount > 0 && client) {
      receivableId = nextId();
      store.receivables.unshift({
        id: receivableId,
        sale_id: saleId,
        sale_reference: saleRef,
        sale_date: createdAt,
        sale_total: totalAmount,
        client_id: client.id,
        client_name: client.name,
        client_code: client.code,
        client_phone: client.phone,
        initial_amount: remainingAmount,
        remaining_amount: remainingAmount,
        due_date: body.due_date ? String(body.due_date) : todayStr(),
        status: paidAmount > 0 ? 'partial' : 'open',
        created_at: createdAt,
      });
      client.unpaid_balance += remainingAmount;
    }

    if (client && saleDeposits.length > 0) {
      client.returnable_pieces_due += saleDeposits.reduce((s, d) => s + d.pieces, 0);
    }

    const sale: SaleDetail = {
      id: saleId,
      reference: saleRef,
      client_id: clientId,
      client_name: client?.name ?? 'Client comptoir',
      client_code: client?.code ?? null,
      client_phone: client?.phone ?? null,
      sale_type: saleType,
      price_tier: priceTier,
      subtotal_merchandise: subtotalMerch,
      discount_amount: globalDiscount,
      total_merchandise: totalMerch,
      total_deposit: totalDeposit,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_labels: payments.map((p) => p.method_label).join(', ') || null,
      status: 'validated',
      receivable_id: receivableId,
      due_date: body.due_date ? String(body.due_date) : null,
      notes: body.notes ? String(body.notes) : null,
      created_at: createdAt,
      lines: saleLines,
      payments,
      deposits: saleDeposits,
      cancellation: null,
      returns: [],
    };

    store.sales.unshift(sale);

    // Record PaymentRecord + PaymentReceiptSnapshot per sale payment
    let runningBalance = totalAmount;
    for (const sp of payments) {
      const before = runningBalance;
      runningBalance = Math.max(0, runningBalance - sp.part_amount);
      const payRec: PaymentRecord = {
        id: sp.id,
        reference: sp.reference,
        payment_kind: 'sale',
        client_id: clientId,
        order_id: null,
        sale_id: saleId,
        receivable_id: receivableId,
        total_amount: sp.part_amount,
        external_reference: sp.external_reference ?? null,
        note: body.notes ? String(body.notes) : null,
        recorded_by_user_id: recordedByUserId,
        recorded_by_name: recordedByName,
        recorded_by_role: recordedByRole,
        balance_before_xof: before,
        balance_after_xof: runningBalance,
        parts: [{ method_code: sp.method_code, method_label: sp.method_label, amount: sp.part_amount }],
        created_at: createdAt,
      };
      store.payments.unshift(payRec);
      ensurePaymentReceiptSnapshot(payRec.id);
    }

    addAudit('CREATE_SALE', 'sales', `${sale.reference} (${totalAmount} FCFA)`);
    res.status(201).json(sale);
  });

  router.post('/api/sales/:id/cancel', requirePerm('sales:cancel_return'), (req, res) => {
    const sale = store.sales.find((s) => s.id === Number(req.params.id));
    if (!sale) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Vente introuvable.' });
      return;
    }
    if (sale.status === 'cancelled') {
      res.status(400).json({ code: 'ALREADY_CANCELLED', message: 'Cette vente est déjà annulée.' });
      return;
    }
    const reason = String(req.body?.reason ?? 'Annulation').trim();
    const refundMethod = String(req.body?.refund_method_code ?? 'cash');

    for (const line of sale.lines) {
      const prod = store.products.find((p) => p.id === line.product_id);
      if (prod) {
        const before = prod.stock_milli;
        prod.stock_milli += line.base_quantity_milli;
        store.stockMovements.unshift({
          id: nextId(),
          product_id: prod.id,
          product_name: prod.name,
          product_reference: prod.reference,
          base_unit: prod.base_unit,
          movement_type: 'sale_cancel_in',
          quantity_milli: line.base_quantity_milli,
          stock_before_milli: before,
          stock_after_milli: prod.stock_milli,
          reason,
          reference_document: sale.reference,
          created_at: nowIso(),
        });
      }
    }

    if (sale.paid_amount > 0) {
      recordCashMovement({
        kind: 'sale_cancel_refund',
        methodCode: refundMethod,
        direction: 'out',
        amount: sale.paid_amount,
        description: `Remboursement annulation ${sale.reference}`,
        referenceDocument: sale.reference,
      });
    }

    if (sale.receivable_id) {
      const rec = store.receivables.find((r) => r.id === sale.receivable_id);
      if (rec && rec.remaining_amount > 0) {
        const client = store.clients.find((c) => c.id === rec.client_id);
        if (client) client.unpaid_balance = Math.max(0, client.unpaid_balance - rec.remaining_amount);
        rec.remaining_amount = 0;
        rec.status = 'cancelled';
      }
    }

    sale.status = 'cancelled';
    sale.cancellation = {
      id: nextId(),
      reason,
      refunded_amount: sale.paid_amount,
      created_at: nowIso(),
    };
    addAudit('CANCEL_SALE', 'sales', `${sale.reference} : ${reason}`);
    res.json(sale);
  });

  router.post('/api/sales/:id/returns', requirePerm('sales:cancel_return'), (req, res) => {
    const sale = store.sales.find((s) => s.id === Number(req.params.id));
    if (!sale) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Vente introuvable.' });
      return;
    }
    const reason = String(req.body?.reason ?? 'Retour client').trim();
    const retLines = Array.isArray(req.body?.lines) ? (req.body.lines as Array<Record<string, unknown>>) : [];
    let totalReturn = 0;

    for (const rl of retLines) {
      const sLine = sale.lines.find((l) => l.id === Number(rl.sale_line_id));
      if (!sLine) continue;
      const qtyMilli = parseQtyMilli(String(rl.quantity ?? '0'));
      const baseMilli = Math.round((qtyMilli * sLine.coefficient_milli) / 1000);
      const amount = Math.round((qtyMilli / 1000) * sLine.unit_price);
      totalReturn += amount;
      sLine.returned_base_milli += baseMilli;
      const prod = store.products.find((p) => p.id === sLine.product_id);
      if (prod) {
        const before = prod.stock_milli;
        prod.stock_milli += baseMilli;
        store.stockMovements.unshift({
          id: nextId(),
          product_id: prod.id,
          product_name: prod.name,
          product_reference: prod.reference,
          base_unit: prod.base_unit,
          movement_type: 'return_in',
          quantity_milli: baseMilli,
          stock_before_milli: before,
          stock_after_milli: prod.stock_milli,
          reason,
          reference_document: sale.reference,
          created_at: nowIso(),
        });
      }
    }

    const creditReduction = Math.min(sale.remaining_amount, totalReturn);
    const refundAmount = Math.max(0, totalReturn - creditReduction);
    sale.remaining_amount = Math.max(0, sale.remaining_amount - creditReduction);
    if (sale.receivable_id && creditReduction > 0) {
      const rec = store.receivables.find((r) => r.id === sale.receivable_id);
      if (rec) {
        rec.remaining_amount = Math.max(0, rec.remaining_amount - creditReduction);
        rec.status = rec.remaining_amount === 0 ? 'paid' : 'partial';
      }
      const client = sale.client_id ? store.clients.find((c) => c.id === sale.client_id) : null;
      if (client) client.unpaid_balance = Math.max(0, client.unpaid_balance - creditReduction);
    }
    if (refundAmount > 0) {
      recordCashMovement({
        kind: 'sale_return_refund',
        methodCode: String(req.body?.refund_method_code ?? 'cash'),
        direction: 'out',
        amount: refundAmount,
        description: `Remboursement retour ${sale.reference}`,
        referenceDocument: sale.reference,
      });
    }

    sale.status = 'partially_returned';
    sale.returns.unshift({
      id: nextId(),
      reference: nextSeq('RET'),
      credit_note_ref: nextSeq(store.settings.credit_note_prefix || 'AV'),
      total_amount: totalReturn,
      credit_reduction: creditReduction,
      refund_amount: refundAmount,
      reason,
      created_at: nowIso(),
    });
    res.json(sale);
  });

  // --- RECEIVABLES ---
  router.get('/api/receivables', requirePerm('receivables:read'), (_req, res) => {
    res.json(store.receivables);
  });

  router.post('/api/receivables/:id/pay', requirePerm('receivables:pay'), (req: AuthedRequest, res) => {
    const rec = store.receivables.find((r) => r.id === Number(req.params.id));
    if (!rec) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Créance introuvable.' });
      return;
    }
    const parts = Array.isArray(req.body?.parts) ? (req.body.parts as Array<{ method_code: string; amount: number }>) : [];
    const totalPay = parts.reduce((s, p) => s + Math.max(0, Number(p.amount ?? 0)), 0);
    if (totalPay <= 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Montant du règlement requis.' });
      return;
    }
    const beforeBalance = rec.remaining_amount;
    const applied = Math.min(rec.remaining_amount, totalPay);
    rec.remaining_amount -= applied;
    rec.status = rec.remaining_amount === 0 ? 'paid' : 'partial';

    const client = store.clients.find((c) => c.id === rec.client_id);
    if (client) client.unpaid_balance = Math.max(0, client.unpaid_balance - applied);

    const externalReference = req.body?.external_reference ? String(req.body.external_reference).trim() : null;
    const note = req.body?.note ? String(req.body.note).trim() : null;
    const createdAt = nowIso();
    const payId = nextId();
    const payRef = nextSeq('PAY');
    const recordedByUserId = req.user?.userId ?? '1';
    const recordedByName = req.user?.displayName ?? 'Propriétaire';
    const recordedByRole = req.user?.role ?? 'owner';

    const payParts = parts
      .filter((p) => Number(p.amount ?? 0) > 0)
      .map((p) => {
        const pm = store.paymentMethods.find((m) => m.code === p.method_code);
        recordCashMovement({
          kind: 'receivable_payment',
          methodCode: p.method_code,
          direction: 'in',
          amount: p.amount,
          description: `Règlement créance ${rec.sale_reference}`,
          referenceDocument: rec.sale_reference,
        });
        return {
          method_code: p.method_code,
          method_label: pm?.label ?? p.method_code,
          amount: Number(p.amount),
        };
      });

    const sale = store.sales.find((s) => s.id === rec.sale_id);
    if (sale) {
      sale.paid_amount += applied;
      sale.remaining_amount = Math.max(0, sale.remaining_amount - applied);
      for (const pp of payParts) {
        sale.payments.push({
          id: payId,
          reference: payRef,
          method_code: pp.method_code,
          method_label: pp.method_label,
          part_amount: pp.amount,
          external_reference: externalReference,
          recorded_by_user_id: recordedByUserId,
          recorded_by_name: recordedByName,
          created_at: createdAt,
        });
      }
      sale.payment_labels = sale.payments.map((p) => p.method_label).join(', ') || sale.payment_labels;
    }

    const payRecord: PaymentRecord = {
      id: payId,
      reference: payRef,
      payment_kind: 'receivable',
      client_id: rec.client_id,
      order_id: null,
      sale_id: rec.sale_id,
      receivable_id: rec.id,
      total_amount: applied,
      external_reference: externalReference,
      note,
      recorded_by_user_id: recordedByUserId,
      recorded_by_name: recordedByName,
      recorded_by_role: recordedByRole,
      balance_before_xof: beforeBalance,
      balance_after_xof: rec.remaining_amount,
      parts: payParts,
      created_at: createdAt,
    };
    store.payments.unshift(payRecord);
    ensurePaymentReceiptSnapshot(payRecord.id);

    addAudit('PAY_RECEIVABLE', 'receivables', `${rec.sale_reference} : ${applied} FCFA (${payRef})`);
    res.json({ ...rec, last_payment_id: payId, last_payment_reference: payRef });
  });

  // --- PAYMENT RECEIPTS ---
  router.get('/api/payments/:id/receipt', requirePerm('sales:read'), (req, res) => {
    try {
      const snap = ensurePaymentReceiptSnapshot(Number(req.params.id));
      res.json(snap);
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      res.status(e.status ?? 404).json({
        code: e.code ?? 'NOT_FOUND',
        message: e.message ?? 'Reçu de paiement introuvable.',
      });
    }
  });

  // --- SUPPLIERS & PURCHASES ---
  router.get('/api/suppliers', requirePerm('purchases:read'), (req, res) => {
    const q = String(req.query.search ?? '').trim().toLowerCase();
    const list = q
      ? store.suppliers.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      : store.suppliers;
    res.json(list);
  });

  router.post('/api/suppliers', requirePerm('purchases:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    if (!name) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nom du fournisseur requis.' });
      return;
    }
    const sup: Supplier = {
      id: nextId(),
      code: nextSeq('FRN'),
      name,
      company_name: body.company_name ? String(body.company_name) : null,
      phone: String(body.phone ?? '').trim() || '+225 00 00 00 00',
      address: body.address ? String(body.address) : null,
      email: body.email ? String(body.email) : null,
      contact_person: body.contact_person ? String(body.contact_person) : null,
      payment_terms_days: Number(body.payment_terms_days ?? 30),
      total_purchases: 0,
      balance_due: 0,
      is_active: 1,
    };
    store.suppliers.unshift(sup);
    res.status(201).json(sup);
  });

  router.put('/api/suppliers/:id', requirePerm('purchases:write'), (req, res) => {
    const sup = store.suppliers.find((s) => s.id === Number(req.params.id));
    if (!sup) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Fournisseur introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.name === 'string' && body.name.trim()) sup.name = body.name.trim();
    if (body.company_name !== undefined) sup.company_name = body.company_name ? String(body.company_name) : null;
    if (body.phone !== undefined) sup.phone = String(body.phone ?? sup.phone);
    if (body.address !== undefined) sup.address = body.address ? String(body.address) : null;
    if (body.email !== undefined) sup.email = body.email ? String(body.email) : null;
    if (body.contact_person !== undefined) sup.contact_person = body.contact_person ? String(body.contact_person) : null;
    if (body.payment_terms_days !== undefined) sup.payment_terms_days = Number(body.payment_terms_days ?? 30);
    if (body.is_active !== undefined) sup.is_active = body.is_active ? 1 : 0;
    res.json(sup);
  });

  router.get('/api/purchases', requirePerm('purchases:read'), (_req, res) => {
    res.json(store.purchases);
  });

  router.post('/api/purchases', requirePerm('purchases:write'), (req: AuthedRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const supplierId = Number(body.supplier_id);
    const sup = store.suppliers.find((s) => s.id === supplierId);
    if (!sup) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Fournisseur introuvable.' });
      return;
    }
    const rawLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    const orderId = nextId();
    const orderRef = nextSeq(store.settings.purchase_prefix || 'ACH');
    let linesSubtotal = 0;
    const reqMap = new Map<number, {
      returnable_id: number;
      code: string;
      name: string;
      kind: string;
      pieces_per_pack: number;
      required_pieces: number;
    }>();

    const lines: PurchaseOrder['lines'] = rawLines.map((rl) => {
      const prod = store.products.find((p) => p.id === Number(rl.product_id));
      const pkg = prod?.packagings.find((pk) => pk.id === Number(rl.packaging_id)) ?? prod?.packagings[0];
      const qtyMilli = parseQtyMilli(String(rl.quantity ?? '1'));
      const unitPrice = Number(rl.unit_price ?? pkg?.purchase_price ?? prod?.purchase_price ?? 0);
      const lineTotal = Math.round((qtyMilli / 1000) * unitPrice);
      linesSubtotal += lineTotal;

      if (pkg && pkg.deposit_mode === 'deposit' && pkg.components.length > 0) {
        const packsCount = Math.round(qtyMilli / 1000);
        for (const c of pkg.components) {
          const prev = reqMap.get(c.returnable_id);
          const addPieces = packsCount * c.pieces_per_pack;
          if (prev) {
            prev.required_pieces += addPieces;
          } else {
            reqMap.set(c.returnable_id, {
              returnable_id: c.returnable_id,
              code: c.code,
              name: c.name,
              kind: c.kind,
              pieces_per_pack: c.pieces_per_pack,
              required_pieces: addPieces,
            });
          }
        }
      }

      return {
        id: nextId(),
        product_id: prod?.id ?? 0,
        packaging_id: pkg?.id ?? 0,
        product_name: prod?.name ?? 'Produit',
        packaging_name: pkg?.name ?? prod?.base_unit ?? 'casier',
        base_unit: prod?.base_unit ?? 'bouteille',
        coefficient_milli: pkg?.coefficient_milli ?? 1000,
        ordered_quantity_milli: qtyMilli,
        received_quantity_milli: 0,
        unit_price: unitPrice,
        line_total: lineTotal,
        product_snapshot_json: '{}',
        packaging_snapshot_json: '{}',
      };
    });

    const discountXof = Math.max(0, Number(body.discount_xof ?? 0));
    const taxXof = Math.max(0, Number(body.tax_xof ?? 0));
    const extraFeesXof = Math.max(0, Number(body.extra_fees_xof ?? 0));
    const paidDepositXof = Math.max(0, Number(body.paid_deposit_xof ?? 0));
    const totalAmount = Math.max(0, linesSubtotal - discountXof + taxXof + extraFeesXof);
    const createdByName = body.created_by_name
      ? String(body.created_by_name)
      : req.user?.displayName ?? 'Responsable Achats';

    const po: PurchaseOrder = {
      id: orderId,
      reference: orderRef,
      supplier_id: sup.id,
      supplier_name: sup.name,
      supplier_code: sup.code,
      supplier_phone: sup.phone,
      supplier_address: sup.address,
      supplier_email: sup.email,
      status: 'confirmed',
      approval_status: 'approved',
      total_amount: totalAmount,
      received_amount: 0,
      expected_date: body.expected_date ? String(body.expected_date) : null,
      notes: body.notes ? String(body.notes) : null,
      payment_terms_label: body.payment_terms_label ? String(body.payment_terms_label) : null,
      delivery_address: body.delivery_address ? String(body.delivery_address) : store.settings.address ?? null,
      commercial_conditions: body.commercial_conditions ? String(body.commercial_conditions) : null,
      discount_xof: discountXof,
      tax_xof: taxXof,
      extra_fees_xof: extraFeesXof,
      paid_deposit_xof: paidDepositXof,
      created_by_name: createdByName,
      created_at: nowIso(),
      lines,
      packaging_requirements: Array.from(reqMap.values()),
      receipts: [],
    };
    store.purchases.unshift(po);
    persistPurchaseDocumentSnapshot(po, 1, toActor(req));
    addAudit('CREATE_PURCHASE', 'purchases', `${po.reference} (${sup.name})`);
    res.status(201).json(po);
  });

  router.put('/api/purchases/:id', requirePerm('purchases:write'), (req: AuthedRequest, res) => {
    const po = store.purchases.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande fournisseur introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.expected_date !== undefined) po.expected_date = body.expected_date ? String(body.expected_date) : null;
    if (body.notes !== undefined) po.notes = body.notes ? String(body.notes) : null;
    if (body.payment_terms_label !== undefined) {
      po.payment_terms_label = body.payment_terms_label ? String(body.payment_terms_label) : null;
    }
    if (body.delivery_address !== undefined) {
      po.delivery_address = body.delivery_address ? String(body.delivery_address) : null;
    }
    if (body.commercial_conditions !== undefined) {
      po.commercial_conditions = body.commercial_conditions ? String(body.commercial_conditions) : null;
    }
    if (body.discount_xof !== undefined) po.discount_xof = Math.max(0, Number(body.discount_xof));
    if (body.tax_xof !== undefined) po.tax_xof = Math.max(0, Number(body.tax_xof));
    if (body.extra_fees_xof !== undefined) po.extra_fees_xof = Math.max(0, Number(body.extra_fees_xof));
    if (body.paid_deposit_xof !== undefined) po.paid_deposit_xof = Math.max(0, Number(body.paid_deposit_xof));

    const linesSubtotal = po.lines.reduce((s, l) => s + l.line_total, 0);
    po.total_amount = Math.max(
      0,
      linesSubtotal - (po.discount_xof ?? 0) + (po.tax_xof ?? 0) + (po.extra_fees_xof ?? 0),
    );
    const existingSnaps = store.purchaseDocumentSnapshots.get(po.id) ?? [];
    persistPurchaseDocumentSnapshot(po, existingSnaps.length + 1, toActor(req), 'Mise à jour bon de commande');
    res.json(po);
  });

  router.post('/api/purchases/:id/receive', requirePerm('purchases:write'), (req: AuthedRequest, res) => {
    const po = store.purchases.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande fournisseur introuvable.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];

    // Validate discrepancies first before mutating state
    let hasDiscrepancy = false;
    for (const rl of rawLines) {
      const missingMilli = rl.missing_quantity ? parseQtyMilli(String(rl.missing_quantity)) : 0;
      const damagedMilli = rl.damaged_quantity ? parseQtyMilli(String(rl.damaged_quantity)) : 0;
      const refusedMilli = rl.refused_quantity ? parseQtyMilli(String(rl.refused_quantity)) : 0;
      const reason = rl.discrepancy_reason ? String(rl.discrepancy_reason).trim() : '';
      if (missingMilli + damagedMilli + refusedMilli > 0) {
        hasDiscrepancy = true;
        if (!reason) {
          res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Un motif d’écart est obligatoire lorsque des quantités manquantes, endommagées ou refusées sont déclarées.',
          });
          return;
        }
      }
    }

    const recRef = nextSeq(store.settings.receipt_prefix || 'REC');
    const recId = nextId();
    const createdAt = nowIso();
    const receivedByName = body.received_by_name
      ? String(body.received_by_name)
      : req.user?.displayName ?? 'Réceptionnaire Dépôt';
    let recTotal = 0;

    const receiptLines: PurchaseReceipt['lines'] = [];
    for (const rl of rawLines) {
      const poLine = po.lines.find((l) => l.id === Number(rl.purchase_order_line_id));
      if (!poLine) continue;
      const qtyMilli = parseQtyMilli(String(rl.received_quantity ?? '0'));
      const missingMilli = rl.missing_quantity ? parseQtyMilli(String(rl.missing_quantity)) : 0;
      const damagedMilli = rl.damaged_quantity ? parseQtyMilli(String(rl.damaged_quantity)) : 0;
      const refusedMilli = rl.refused_quantity ? parseQtyMilli(String(rl.refused_quantity)) : 0;
      if (qtyMilli <= 0 && missingMilli <= 0 && damagedMilli <= 0 && refusedMilli <= 0) continue;

      poLine.received_quantity_milli += qtyMilli;
      const baseMilli = Math.round((qtyMilli * poLine.coefficient_milli) / 1000);
      const amount = Math.round((qtyMilli / 1000) * poLine.unit_price);
      recTotal += amount;

      const prod = store.products.find((p) => p.id === poLine.product_id);
      if (prod && baseMilli > 0) {
        const before = prod.stock_milli;
        prod.stock_milli += baseMilli;
        store.stockMovements.unshift({
          id: nextId(),
          product_id: prod.id,
          product_name: prod.name,
          product_reference: prod.reference,
          base_unit: prod.base_unit,
          movement_type: 'purchase_in',
          quantity_milli: baseMilli,
          stock_before_milli: before,
          stock_after_milli: prod.stock_milli,
          reason: `Réception ${recRef}`,
          reference_document: recRef,
          created_at: createdAt,
        });
      }

      receiptLines.push({
        purchase_order_line_id: poLine.id,
        product_name: poLine.product_name,
        packaging_name: poLine.packaging_name,
        base_unit: poLine.base_unit,
        coefficient_milli: poLine.coefficient_milli,
        received_quantity_milli: qtyMilli,
        missing_quantity_milli: missingMilli,
        damaged_quantity_milli: damagedMilli,
        refused_quantity_milli: refusedMilli,
        base_quantity_milli: baseMilli,
        unit_price: poLine.unit_price,
        amount,
        discrepancy_reason: rl.discrepancy_reason ? String(rl.discrepancy_reason).trim() : null,
      });
    }

    const rawExchanges = Array.isArray(body.packaging_exchanges)
      ? (body.packaging_exchanges as Array<Record<string, unknown>>)
      : [];
    const packagingExchanges = rawExchanges
      .filter((ex) => Number(ex.pieces_issued ?? 0) > 0)
      .map((ex) => {
        const retType = store.returnableTypes.find((r) => r.id === Number(ex.returnable_id));
        const piecesIssued = Math.max(0, Number(ex.pieces_issued ?? 0));
        if (retType) {
          retType.stock_quantity = Math.max(0, retType.stock_quantity - piecesIssued);
        }
        return {
          returnable_id: Number(ex.returnable_id ?? 0),
          packaging_asset_id: ex.packaging_asset_id ? Number(ex.packaging_asset_id) : undefined,
          code_snapshot: retType?.code ?? String(ex.code_snapshot ?? 'EMB'),
          name_snapshot: retType?.name ?? String(ex.name_snapshot ?? 'Emballage'),
          kind_snapshot: retType?.kind ?? String(ex.kind_snapshot ?? 'crate'),
          pieces_issued: piecesIssued,
        };
      });

    po.received_amount += recTotal;
    const allReceived = po.lines.every((l) => l.received_quantity_milli >= l.ordered_quantity_milli);
    const receiptStatus: 'complete' | 'partial' | 'discrepancy' = hasDiscrepancy
      ? 'discrepancy'
      : allReceived
        ? 'complete'
        : 'partial';
    po.status = allReceived ? 'received' : 'partial';
    po.receipts.unshift({
      id: recId,
      reference: recRef,
      total_amount: recTotal,
      status: receiptStatus,
      received_by_name: receivedByName,
      created_at: createdAt,
    });

    const sup = store.suppliers.find((s) => s.id === po.supplier_id);
    if (sup && recTotal > 0) {
      sup.total_purchases += recTotal;
      sup.balance_due += recTotal;
      store.supplierDebts.unshift({
        id: nextId(),
        receipt_id: recId,
        receipt_reference: recRef,
        order_reference: po.reference,
        supplier_id: sup.id,
        supplier_name: sup.name,
        supplier_code: sup.code,
        initial_amount: recTotal,
        remaining_amount: recTotal,
        due_date: todayStr(),
        status: 'open',
        created_at: createdAt,
      });
    }

    const receipt: PurchaseReceipt = {
      id: recId,
      reference: recRef,
      purchase_order_id: po.id,
      order_reference: po.reference,
      supplier_name: po.supplier_name,
      total_amount: recTotal,
      status: receiptStatus,
      received_by_name: receivedByName,
      notes: body.notes ? String(body.notes) : null,
      created_at: createdAt,
      lines: receiptLines,
      packaging_exchanges: packagingExchanges,
    };

    const snap = persistPurchaseReceiptSnapshot(po, receipt, toActor(req));
    receipt.snapshot = snap;
    store.purchaseReceipts.unshift(receipt);

    addAudit('RECEIVE_PURCHASE', 'purchases', `${recRef} (${recTotal} FCFA)`);
    res.json({ order: po, receipt });
  });

  router.get('/api/purchases/:id/receipts', requirePerm('purchases:read'), (req, res) => {
    const orderId = Number(req.params.id);
    res.json(store.purchaseReceipts.filter((r) => r.purchase_order_id === orderId));
  });

  router.get('/api/purchase-receipts/:id', requirePerm('purchases:read'), (req, res) => {
    const receiptId = Number(req.params.id);
    const receipt = store.purchaseReceipts.find((r) => r.id === receiptId);
    if (!receipt) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Bon de réception introuvable.' });
      return;
    }
    const snap = store.purchaseReceiptSnapshots.get(receiptId)?.[0] ?? null;
    res.json({ ...receipt, snapshot: snap });
  });

  router.get('/api/purchases/:id/snapshots', requirePerm('purchases:read'), (req, res) => {
    const orderId = Number(req.params.id);
    res.json(store.purchaseDocumentSnapshots.get(orderId) ?? []);
  });

  router.post('/api/purchases/:id/cancel', requirePerm('purchases:write'), (req, res) => {
    const po = store.purchases.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Commande fournisseur introuvable.' });
      return;
    }
    po.status = 'cancelled';
    res.json(po);
  });

  router.get('/api/supplier-debts', requirePerm('purchases:read'), (_req, res) => {
    res.json(store.supplierDebts);
  });

  router.post('/api/supplier-debts/:id/pay', requirePerm('supplier_debts:pay'), (req: AuthedRequest, res) => {
    const debt = store.supplierDebts.find((d) => d.id === Number(req.params.id));
    if (!debt) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Dette fournisseur introuvable.' });
      return;
    }
    const amount = Math.max(0, Number(req.body?.amount ?? 0));
    const methodCode = String(req.body?.method_code ?? 'cash');
    const beforeBalance = debt.remaining_amount;
    const applied = Math.min(debt.remaining_amount, amount);
    debt.remaining_amount -= applied;
    debt.status = debt.remaining_amount === 0 ? 'paid' : 'partial';

    const sup = store.suppliers.find((s) => s.id === debt.supplier_id);
    if (sup) sup.balance_due = Math.max(0, sup.balance_due - applied);

    if (applied > 0) {
      const pm = store.paymentMethods.find((m) => m.code === methodCode);
      recordCashMovement({
        kind: 'supplier_debt_payment',
        methodCode,
        direction: 'out',
        amount: applied,
        description: `Règlement fournisseur ${debt.supplier_name} (${debt.receipt_reference})`,
        referenceDocument: debt.receipt_reference,
      });
      const payId = nextId();
      const payRef = nextSeq('PAY');
      const payRecord: PaymentRecord = {
        id: payId,
        reference: payRef,
        payment_kind: 'supplier_debt',
        client_id: null,
        order_id: null,
        sale_id: null,
        receivable_id: null,
        total_amount: applied,
        external_reference: req.body?.external_reference ? String(req.body.external_reference).trim() : null,
        note: req.body?.note ? String(req.body.note).trim() : null,
        recorded_by_user_id: req.user?.userId ?? '1',
        recorded_by_name: req.user?.displayName ?? 'Propriétaire',
        recorded_by_role: req.user?.role ?? 'owner',
        balance_before_xof: beforeBalance,
        balance_after_xof: debt.remaining_amount,
        parts: [{ method_code: methodCode, method_label: pm?.label ?? methodCode, amount: applied }],
        created_at: nowIso(),
      };
      store.payments.unshift(payRecord);
      ensurePaymentReceiptSnapshot(payId);
    }
    res.json(debt);
  });

  // --- STOCK & INVENTORIES ---
  router.get('/api/stock', requirePerm('stock:read'), (_req, res) => {
    const products = store.products
      .filter((p) => p.is_active === 1)
      .map((p) => {
        const avgCost = p.average_cost_fcfa ?? p.purchase_price ?? null;
        return {
          id: p.id,
          reference: p.reference,
          name: p.name,
          brand: p.brand,
          category_name: p.category_name,
          base_unit: p.base_unit,
          stock_milli: p.stock_milli,
          min_stock_milli: p.min_stock_milli,
          max_stock_milli: p.max_stock_milli,
          average_cost_fcfa: avgCost,
          valuation_fcfa: avgCost !== null ? Math.round((p.stock_milli / 1000) * avgCost) : null,
        };
      });
    res.json({ products, movements: store.stockMovements });
  });

  router.post('/api/stock/adjust', requirePerm('stock:adjust'), (req, res) => {
    const prod = store.products.find((p) => p.id === Number(req.body?.product_id));
    if (!prod) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Produit introuvable.' });
      return;
    }
    const direction = req.body?.direction === 'out' ? 'out' : 'in';
    const qtyMilli = parseQtyMilli(String(req.body?.quantity ?? '0'));
    if (qtyMilli <= 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Quantité invalide.' });
      return;
    }
    const delta = direction === 'in' ? qtyMilli : -qtyMilli;
    if (!store.settings.allow_negative_stock && prod.stock_milli + delta < 0) {
      res.status(400).json({ code: 'INSUFFICIENT_STOCK', message: 'Stock insuffisant pour cette sortie.' });
      return;
    }
    const before = prod.stock_milli;
    prod.stock_milli += delta;
    const mv = {
      id: nextId(),
      product_id: prod.id,
      product_name: prod.name,
      product_reference: prod.reference,
      base_unit: prod.base_unit,
      movement_type: 'manual_adjust',
      quantity_milli: delta,
      stock_before_milli: before,
      stock_after_milli: prod.stock_milli,
      reason: String(req.body?.reason ?? 'Ajustement manuel'),
      reference_document: null,
      created_at: nowIso(),
    };
    store.stockMovements.unshift(mv);
    addAudit('ADJUST_STOCK', 'stock', `${prod.name} (${delta / 1000})`);
    res.json(mv);
  });

  router.get('/api/inventories', requirePerm('stock:read'), (_req, res) => {
    res.json(store.inventories);
  });

  router.post('/api/inventories', requirePerm('inventory:validate'), (req, res) => {
    const inv = {
      id: nextId(),
      reference: nextSeq('INV'),
      status: 'draft' as const,
      notes: req.body?.notes ? String(req.body.notes) : null,
      created_at: nowIso(),
      validated_at: null,
      lines: store.products
        .filter((p) => p.is_active === 1)
        .map((p) => ({
          id: nextId(),
          product_id: p.id,
          product_name: p.name,
          product_reference: p.reference,
          base_unit: p.base_unit,
          theoretical_milli: p.stock_milli,
          counted_milli: p.stock_milli,
          reason: null,
        })),
    };
    store.inventories.unshift(inv);
    res.status(201).json(inv);
  });

  router.post('/api/inventories/:id/validate', requirePerm('inventory:validate'), (req, res) => {
    const inv = store.inventories.find((i) => i.id === Number(req.params.id));
    if (!inv) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Inventaire introuvable.' });
      return;
    }
    const lines = Array.isArray(req.body?.lines) ? (req.body.lines as Array<Record<string, unknown>>) : [];
    for (const l of lines) {
      const invLine = inv.lines.find((il) => il.product_id === Number(l.product_id));
      const prod = store.products.find((p) => p.id === Number(l.product_id));
      if (!invLine || !prod) continue;
      const countedMilli = parseQtyMilli(String(l.counted_quantity ?? '0'));
      invLine.counted_milli = countedMilli;
      invLine.reason = l.reason ? String(l.reason) : null;
      const diff = countedMilli - prod.stock_milli;
      if (diff !== 0) {
        const before = prod.stock_milli;
        prod.stock_milli = countedMilli;
        store.stockMovements.unshift({
          id: nextId(),
          product_id: prod.id,
          product_name: prod.name,
          product_reference: prod.reference,
          base_unit: prod.base_unit,
          movement_type: 'inventory_adjust',
          quantity_milli: diff,
          stock_before_milli: before,
          stock_after_milli: countedMilli,
          reason: invLine.reason ?? `Validation ${inv.reference}`,
          reference_document: inv.reference,
          created_at: nowIso(),
        });
      }
    }
    inv.status = 'validated';
    inv.validated_at = nowIso();
    res.json(inv);
  });

  // --- CONSIGNMENTS & PACKAGING OBLIGATIONS ---
  router.get('/api/consignments', requirePerm('consignments:read'), (_req, res) => {
    const openIssues = store.packagingObligations
      .filter((o) => o.pending_pieces > 0)
      .map((o) => {
        const client = o.client_id ? store.clients.find((c) => c.id === o.client_id) : null;
        const ret = store.returnableTypes.find((r) => r.id === o.returnable_id);
        return {
          id: o.id,
          sale_id: o.sale_id,
          sale_reference: o.sale_reference ?? '',
          client_id: o.client_id,
          client_name: client?.name ?? null,
          returnable_id: o.returnable_id,
          packaging_name: ret?.name ?? 'Emballage',
          packaging_code: ret?.code ?? '',
          pieces: o.pieces,
          returned_pieces: o.returned_pieces,
          unit_value: o.unit_value,
          amount: o.total_reference_value,
          expected_products: null,
        };
      });

    const clientBalanceMap = new Map<string, {
      id: number;
      client_id: number;
      client_name: string;
      client_code: string;
      packaging_name: string;
      packaging_code: string;
      balance_pieces: number;
      deposit_held_amount: number;
    }>();

    for (const issue of openIssues) {
      if (!issue.client_id) continue;
      const client = store.clients.find((c) => c.id === issue.client_id);
      const key = `${issue.client_id}:${issue.returnable_id}`;
      const pending = Math.max(0, issue.pieces - issue.returned_pieces);
      const cur = clientBalanceMap.get(key) ?? {
        id: issue.id,
        client_id: issue.client_id,
        client_name: client?.name ?? 'Client',
        client_code: client?.code ?? '',
        packaging_name: issue.packaging_name,
        packaging_code: issue.packaging_code,
        balance_pieces: 0,
        deposit_held_amount: 0,
      };
      cur.balance_pieces += pending;
      cur.deposit_held_amount += pending * issue.unit_value;
      clientBalanceMap.set(key, cur);
    }

    res.json({
      types: store.returnableTypes,
      clientBalances: Array.from(clientBalanceMap.values()),
      recentMovements: store.returnableMovements,
      openIssues,
      returns: store.depositReturns,
    });
  });

  router.post('/api/consignments/types', requirePerm('consignments:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = {
      id: nextId(),
      code: String(body.code ?? `EMB-${Date.now() % 10000}`),
      name: String(body.name ?? 'Emballage consigné'),
      producer: String(body.producer ?? 'SOLIBRA'),
      kind: (body.kind === 'bottle' ? 'bottle' : 'crate') as 'bottle' | 'crate',
      deposit_value: Number(body.deposit_value ?? 2000),
      stock_quantity: Number(body.stock_quantity ?? 0),
    };
    store.returnableTypes.push(item);
    res.status(201).json(item);
  });

  router.post('/api/consignments/stock-movements', requirePerm('consignments:write'), (req, res) => {
    const pkgId = Number(req.body?.packaging_id);
    const item = store.returnableTypes.find((r) => r.id === pkgId);
    if (!item) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Type d’emballage introuvable.' });
      return;
    }
    const mType = String(req.body?.movement_type ?? 'entry') as
      | 'initial'
      | 'entry'
      | 'exit'
      | 'breakage'
      | 'loss'
      | 'correction_in'
      | 'correction_out';
    const qty = Math.abs(Number(req.body?.quantity ?? 0));
    const isOut = ['exit', 'breakage', 'loss', 'correction_out'].includes(mType);
    const before = item.stock_quantity;
    item.stock_quantity = Math.max(0, before + (isOut ? -qty : qty));
    const mv = {
      id: nextId(),
      packaging_id: item.id,
      packaging_name: item.name,
      packaging_code: item.code,
      movement_type: mType,
      quantity: qty,
      stock_before: before,
      stock_after: item.stock_quantity,
      reason: String(req.body?.reason ?? 'Ajustement emballage'),
      reference_document: null,
      created_at: nowIso(),
    };
    store.returnableMovements.unshift(mv);
    res.json(mv);
  });

  router.post('/api/consignments/returns', requirePerm('consignments:write'), (req, res) => {
    const issueId = Number(req.body?.issue_id ?? req.body?.obligation_id ?? 0);
    const pieces = Math.max(1, Number(req.body?.pieces ?? 1));
    const obligation = store.packagingObligations.find((o) => o.id === issueId);
    const retType = obligation
      ? store.returnableTypes.find((r) => r.id === obligation.returnable_id)
      : store.returnableTypes.find((r) => r.id === Number(req.body?.returnable_id));

    if (obligation) {
      const applied = Math.min(obligation.pending_pieces, pieces);
      obligation.returned_pieces += applied;
      obligation.pending_pieces = Math.max(0, obligation.pieces - obligation.returned_pieces);
      obligation.status = obligation.pending_pieces === 0 ? 'settled' : 'partial';
      if (obligation.client_id) {
        const client = store.clients.find((c) => c.id === obligation.client_id);
        if (client) client.returnable_pieces_due = Math.max(0, client.returnable_pieces_due - applied);
      }
    }
    if (retType && req.body?.condition_state !== 'damaged') {
      retType.stock_quantity += pieces;
    }
    const retRecord = {
      id: nextId(),
      reference: nextSeq('RET'),
      packaging_name: retType?.name ?? 'Emballage',
      client_name: obligation?.client_id
        ? store.clients.find((c) => c.id === obligation.client_id)?.name ?? null
        : null,
      pieces,
      condition_state: (req.body?.condition_state === 'damaged' ? 'damaged' : 'good') as 'good' | 'damaged',
      refund_amount: Number(req.body?.refund_amount ?? 0),
      credit_reduction: Number(req.body?.credit_reduction ?? 0),
      method_label: 'Espèces',
      reason: String(req.body?.reason ?? 'Retour emballages'),
      created_at: nowIso(),
    };
    store.depositReturns.unshift(retRecord);
    res.json(retRecord);
  });

  router.get('/api/packaging-obligations', requirePerm('consignments:read'), (req, res) => {
    const clientId = req.query.client_id ? Number(req.query.client_id) : null;
    res.json(
      clientId
        ? store.packagingObligations.filter((o) => o.client_id === clientId)
        : store.packagingObligations,
    );
  });

  router.get('/api/packaging-obligations/dashboard/:clientId', requirePerm('consignments:read'), (req, res) => {
    const clientId = Number(req.params.clientId);
    const client = store.clients.find((c) => c.id === clientId);
    const obligations = store.packagingObligations.filter((o) => o.client_id === clientId);
    const pendingPieces = obligations.reduce((s, o) => s + o.pending_pieces, 0);
    const pendingVal = obligations.reduce((s, o) => s + o.pending_pieces * o.unit_value, 0);
    const packDebt = store.clientPackagingFinancialDebt.get(clientId) ?? 0;
    const commDebt = client?.unpaid_balance ?? 0;
    res.json({
      client_id: clientId,
      commercial_debt: commDebt,
      packaging_financial_debt: packDebt,
      pending_pieces: pendingPieces,
      pending_reference_value: pendingVal,
      total_financial_due: commDebt + packDebt,
    });
  });

  router.post('/api/packaging-obligations/pay', requirePerm('consignments:write'), (req, res) => {
    const clientId = Number(req.body?.client_id);
    const parts = Array.isArray(req.body?.parts) ? (req.body.parts as Array<{ method_code: string; amount: number }>) : [];
    const total = parts.reduce((s, p) => s + Math.max(0, Number(p.amount ?? 0)), 0);
    const prev = store.clientPackagingFinancialDebt.get(clientId) ?? 0;
    const next = Math.max(0, prev - total);
    store.clientPackagingFinancialDebt.set(clientId, next);
    for (const p of parts) {
      if (p.amount > 0) {
        recordCashMovement({
          kind: 'packaging_debt_payment',
          methodCode: p.method_code,
          direction: 'in',
          amount: p.amount,
          description: `Règlement dette emballage client #${clientId}`,
          referenceDocument: null,
        });
      }
    }
    res.json({ client_id: clientId, packaging_financial_balance: next });
  });

  // --- CASH, EXPENSES & REPORTS ---
  router.get('/api/cash', requirePerm('cash:read'), (_req, res) => {
    const activeSession = getActiveCashSession();
    let summary = null;
    if (activeSession) {
      const mvs = store.cashMovements.filter((m) => m.session_id === activeSession.id);
      const byMethodMap = new Map<string, { method_code: string; label: string; is_cash: number; total_in: number; total_out: number }>();
      for (const pm of store.paymentMethods) {
        byMethodMap.set(pm.code, {
          method_code: pm.code,
          label: pm.label,
          is_cash: pm.is_cash,
          total_in: 0,
          total_out: 0,
        });
      }
      for (const m of mvs) {
        const entry = byMethodMap.get(m.method_code) ?? {
          method_code: m.method_code,
          label: m.method_label,
          is_cash: m.is_cash,
          total_in: 0,
          total_out: 0,
        };
        if (m.direction === 'in') entry.total_in += m.amount;
        else entry.total_out += m.amount;
        byMethodMap.set(m.method_code, entry);
      }
      const cashDelta = mvs
        .filter((m) => m.is_cash === 1)
        .reduce((acc, m) => acc + (m.direction === 'in' ? m.amount : -m.amount), 0);
      summary = {
        theoreticalCash: activeSession.opening_cash + cashDelta,
        byMethod: Array.from(byMethodMap.values()),
        movements: mvs,
      };
    }
    res.json({
      activeSession,
      summary,
      history: store.cashSessions,
    });
  });

  router.post('/api/cash/open', requirePerm('cash:operate'), (req, res) => {
    if (getActiveCashSession()) {
      res.status(400).json({ code: 'SESSION_OPEN', message: 'Une session de caisse est déjà ouverte.' });
      return;
    }
    const openingCash = Math.max(0, Number(req.body?.opening_cash ?? 0));
    const session = {
      id: nextId(),
      reference: nextSeq('CAI'),
      opened_at: nowIso(),
      closed_at: null,
      status: 'open' as const,
      opening_cash: openingCash,
      theoretical_cash: openingCash,
      physical_cash: null,
      difference: null,
      closing_notes: null,
    };
    store.cashSessions.unshift(session);
    addAudit('OPEN_CASH', 'cash', `${session.reference} (${openingCash} FCFA)`);
    res.status(201).json(session);
  });

  router.post('/api/cash/close', requirePerm('cash:operate'), (req, res) => {
    const session = getActiveCashSession();
    if (!session) {
      res.status(400).json({ code: 'NO_OPEN_SESSION', message: 'Aucune session de caisse ouverte.' });
      return;
    }
    const mvs = store.cashMovements.filter((m) => m.session_id === session.id && m.is_cash === 1);
    const delta = mvs.reduce((acc, m) => acc + (m.direction === 'in' ? m.amount : -m.amount), 0);
    const theoretical = session.opening_cash + delta;
    const physical = Number(req.body?.physical_cash ?? theoretical);
    session.status = 'closed';
    session.closed_at = nowIso();
    session.theoretical_cash = theoretical;
    session.physical_cash = physical;
    session.difference = physical - theoretical;
    session.closing_notes = req.body?.closing_notes ? String(req.body.closing_notes) : null;
    addAudit('CLOSE_CASH', 'cash', `${session.reference} (écart: ${session.difference} FCFA)`);
    res.json(session);
  });

  router.get('/api/expenses', requirePerm('cash:read'), (_req, res) => {
    res.json({
      categories: store.expenseCategories,
      items: store.expenses,
    });
  });

  router.post('/api/expenses', requirePerm('expenses:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Math.max(0, Number(body.amount ?? 0));
    const category = String(body.category ?? 'Divers').trim() || 'Divers';
    const methodCode = String(body.method_code ?? 'cash');
    const pm = store.paymentMethods.find((m) => m.code === methodCode);
    const session = getActiveCashSession();
    if (!session) {
      res.status(400).json({ code: 'NO_OPEN_SESSION', message: 'Ouvrez une session de caisse pour enregistrer une dépense.' });
      return;
    }
    const ref = nextSeq('DEP');
    const exp = {
      id: nextId(),
      reference: ref,
      category,
      amount,
      method_code: methodCode,
      method_label: pm?.label ?? methodCode,
      session_id: session.id,
      beneficiary: body.beneficiary ? String(body.beneficiary) : null,
      notes: body.notes ? String(body.notes) : null,
      receipt_path: body.receipt_path ? String(body.receipt_path) : null,
      expense_date: body.expense_date ? String(body.expense_date) : todayStr(),
      created_at: nowIso(),
    };
    store.expenses.unshift(exp);
    recordCashMovement({
      kind: 'expense_out',
      methodCode,
      direction: 'out',
      amount,
      description: `Dépense : ${category}`,
      referenceDocument: ref,
    });
    res.status(201).json(exp);
  });

  router.get('/api/reports', requirePerm('reports:read'), (_req, res) => {
    const activeSales = store.sales.filter((s) => s.status !== 'cancelled');
    const merchRevenue = activeSales.reduce((s, x) => s + x.total_merchandise, 0);
    const depositBilled = activeSales.reduce((s, x) => s + x.total_deposit, 0);
    const paidAmount = activeSales.reduce((s, x) => s + x.paid_amount, 0);

    let knownCostTotal = 0;
    let knownCostRevenue = 0;
    let unknownCostLines = 0;
    for (const s of activeSales) {
      for (const l of s.lines) {
        const prod = store.products.find((p) => p.id === l.product_id);
        const unitCost = prod?.average_cost_fcfa ?? prod?.purchase_price ?? null;
        if (unitCost != null) {
          knownCostTotal += Math.round((l.base_quantity_milli / 1000) * unitCost);
          knownCostRevenue += l.line_total;
        } else {
          unknownCostLines += 1;
        }
      }
    }
    const expensesTotal = store.expenses.reduce((s, e) => s + e.amount, 0);
    const knownGrossMargin = knownCostRevenue - knownCostTotal;

    const paymentBreakdown = store.paymentMethods.map((pm) => {
      const mvs = store.cashMovements.filter((m) => m.method_code === pm.code);
      return {
        code: pm.code,
        label: pm.label,
        is_cash: pm.is_cash,
        total_in: mvs.filter((m) => m.direction === 'in').reduce((s, m) => s + m.amount, 0),
        total_out: mvs.filter((m) => m.direction === 'out').reduce((s, m) => s + m.amount, 0),
      };
    });

    const activeProducts = store.products.filter((p) => p.is_active === 1);
    const unknownCostProducts = activeProducts.filter((p) => p.average_cost_fcfa == null).length;
    const knownValuationFcfa = activeProducts.reduce((s, p) => {
      const c = p.average_cost_fcfa ?? p.purchase_price;
      return c != null ? s + Math.round((p.stock_milli / 1000) * c) : s;
    }, 0);

    res.json({
      commercial: {
        count: activeSales.length,
        merchandise_revenue: merchRevenue,
        deposit_billed: depositBilled,
        paid_amount: paidAmount,
      },
      profitability: {
        knownCostTotal,
        knownCostRevenue,
        knownGrossMargin,
        unknownCostLines,
        expensesTotal,
        netKnownResult: knownGrossMargin - expensesTotal,
      },
      paymentBreakdown,
      stock: {
        product_count: activeProducts.length,
        unknown_cost_products: unknownCostProducts,
        knownValuationFcfa,
      },
      dailySales: [
        {
          day: todayStr(),
          count: activeSales.length,
          revenue: merchRevenue,
          deposit: depositBilled,
          collected: paidAmount,
        },
      ],
    });
  });

  // --- COMMERCIAL DOCUMENTS ---
  router.get('/api/commercial-documents', requirePerm('sales:read'), (req, res) => {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const docTypeFilter = String(req.query.documentType ?? '').trim();
    const statusFilter = String(req.query.status ?? '').trim().toLowerCase();
    const phoneFilter = String(req.query.phone ?? '').trim().toLowerCase();
    const orderRefFilter = String(req.query.orderRef ?? '').trim().toLowerCase();
    const externalRefFilter = String(req.query.externalRef ?? '').trim().toLowerCase();
    const paymentMethodFilter = String(req.query.paymentMethod ?? '').trim().toLowerCase();
    const paymentStatusFilter = String(req.query.paymentStatus ?? '').trim().toLowerCase();
    const receptionStatusFilter = String(req.query.receptionStatus ?? '').trim().toLowerCase();
    const fromFilter = String(req.query.from ?? '').trim();
    const toFilter = String(req.query.to ?? '').trim();
    const minAmount = req.query.minAmount !== undefined && req.query.minAmount !== '' ? Number(req.query.minAmount) : null;
    const maxAmount = req.query.maxAmount !== undefined && req.query.maxAmount !== '' ? Number(req.query.maxAmount) : null;
    const approvalsOnly = String(req.query.approvalsOnly ?? '') === 'true';
    const sort = String(req.query.sort ?? 'newest');

    const rows: CommercialDocument[] = [];

    for (const s of store.sales) {
      const extRefs = s.payments
        .map((p) => p.external_reference)
        .filter((v): v is string => Boolean(v))
        .join(', ');
      rows.push({
        documentType: s.status === 'cancelled' ? 'cancellation' : 'sales_receipt',
        documentId: s.id,
        documentNumber: s.reference,
        counterparty: s.client_name,
        status: s.status,
        approvalStatus: null,
        amountXof: s.total_amount,
        createdAt: s.created_at,
        phone: s.client_phone ?? null,
        orderReference: s.reference,
        paymentMethod: s.payments[0]?.method_code ?? null,
        paymentStatus: s.remaining_amount === 0 ? 'paid' : s.paid_amount > 0 ? 'partial' : 'unpaid',
        externalReference: extRefs || null,
        issuerName: s.payments[0]?.recorded_by_name ?? 'Caissier POS',
        snapshotCount: 1,
      });

      for (const ret of s.returns) {
        rows.push({
          documentType: 'credit_note',
          documentId: ret.id,
          documentNumber: ret.credit_note_ref,
          counterparty: s.client_name,
          status: 'validated',
          approvalStatus: null,
          amountXof: ret.total_amount,
          createdAt: ret.created_at,
          phone: s.client_phone ?? null,
          orderReference: s.reference,
          paymentMethod: null,
          paymentStatus: 'paid',
          externalReference: null,
          issuerName: 'Responsable Dépôt',
          snapshotCount: 1,
        });
      }
    }

    for (const o of store.orders) {
      const client = store.clients.find((c) => c.id === o.order.customer_id);
      const orderPays = store.payments.filter((p) => p.order_id === o.order.id);
      const extRef = orderPays
        .map((p) => p.external_reference)
        .filter((v): v is string => Boolean(v))
        .join(', ');
      const snaps = store.orderReceipts.get(o.order.id) ?? [];
      rows.push({
        documentType: 'customer_order',
        documentId: o.order.id,
        documentNumber: o.order.order_number,
        counterparty: o.order.customer_name,
        status: o.order.status,
        approvalStatus: (o.order.approval_status as CommercialDocument['approvalStatus']) ?? 'draft',
        amountXof: o.order.total_to_collect_xof,
        createdAt: o.order.created_at,
        phone: client?.phone ?? null,
        orderReference: o.order.order_number,
        paymentMethod: o.order.planned_payment_channel ?? o.order.payment_method,
        paymentStatus: o.order.payment_status,
        externalReference: extRef || null,
        issuerName: snaps[0]?.issued_by_name ?? 'Propriétaire',
        snapshotCount: snaps.length,
      });
    }

    for (const po of store.purchases) {
      const snaps = store.purchaseDocumentSnapshots.get(po.id) ?? [];
      rows.push({
        documentType: 'purchase_order',
        documentId: po.id,
        documentNumber: po.reference,
        counterparty: po.supplier_name,
        status: po.status,
        approvalStatus: (po.approval_status as CommercialDocument['approvalStatus']) ?? 'draft',
        amountXof: po.total_amount,
        createdAt: po.created_at,
        phone: po.supplier_phone ?? null,
        orderReference: po.reference,
        paymentMethod: null,
        paymentStatus: null,
        externalReference: null,
        issuerName: po.created_by_name ?? snaps[0]?.issued_by_name ?? 'Responsable Achats',
        snapshotCount: snaps.length,
      });
    }

    for (const rec of store.purchaseReceipts) {
      const po = store.purchases.find((p) => p.id === rec.purchase_order_id);
      const snaps = store.purchaseReceiptSnapshots.get(rec.id) ?? [];
      rows.push({
        documentType: 'supplier_reception',
        documentId: rec.id,
        documentNumber: rec.reference,
        counterparty: rec.supplier_name,
        status: rec.status ?? 'complete',
        approvalStatus: null,
        amountXof: rec.total_amount,
        createdAt: rec.created_at,
        phone: po?.supplier_phone ?? null,
        orderReference: rec.order_reference,
        paymentMethod: null,
        paymentStatus: null,
        externalReference: null,
        issuerName: rec.received_by_name ?? 'Réceptionnaire Dépôt',
        snapshotCount: snaps.length,
      });
    }

    for (const pay of store.payments) {
      const client = pay.client_id ? store.clients.find((c) => c.id === pay.client_id) : null;
      const order = pay.order_id ? store.orders.find((o) => o.order.id === pay.order_id) : null;
      const sale = pay.sale_id ? store.sales.find((s) => s.id === pay.sale_id) : null;
      const linkedRef = order?.order.order_number ?? sale?.reference ?? pay.reference;
      const hasSnap = store.paymentReceipts.has(pay.id);
      rows.push({
        documentType: 'payment_receipt',
        documentId: pay.id,
        documentNumber: pay.reference,
        counterparty: client?.name ?? sale?.client_name ?? 'Client comptoir',
        status: (pay.balance_after_xof ?? 0) === 0 ? 'paid' : 'partial',
        approvalStatus: null,
        amountXof: pay.total_amount,
        createdAt: pay.created_at,
        phone: client?.phone ?? sale?.client_phone ?? null,
        orderReference: linkedRef,
        paymentMethod: pay.parts[0]?.method_code ?? null,
        paymentStatus: (pay.balance_after_xof ?? 0) === 0 ? 'paid' : 'partial',
        externalReference: pay.external_reference ?? null,
        issuerName: pay.recorded_by_name ?? 'Caissier',
        snapshotCount: hasSnap ? 1 : 0,
      });
    }

    const filtered = rows.filter((r) => {
      if (docTypeFilter && r.documentType !== docTypeFilter) return false;
      if (approvalsOnly && r.approvalStatus !== 'pending_owner_approval') return false;
      if (statusFilter && r.status.toLowerCase() !== statusFilter) return false;
      if (phoneFilter && !(r.phone ?? '').toLowerCase().includes(phoneFilter)) return false;
      if (orderRefFilter && !(r.orderReference ?? '').toLowerCase().includes(orderRefFilter)) return false;
      if (externalRefFilter && !(r.externalReference ?? '').toLowerCase().includes(externalRefFilter)) return false;
      if (paymentMethodFilter && (r.paymentMethod ?? '').toLowerCase() !== paymentMethodFilter) return false;
      if (paymentStatusFilter && (r.paymentStatus ?? '').toLowerCase() !== paymentStatusFilter) return false;
      if (receptionStatusFilter && (r.documentType !== 'supplier_reception' || r.status.toLowerCase() !== receptionStatusFilter)) return false;
      if (fromFilter && r.createdAt.slice(0, 10) < fromFilter) return false;
      if (toFilter && r.createdAt.slice(0, 10) > toFilter) return false;
      if (minAmount !== null && Number.isFinite(minAmount) && r.amountXof < minAmount) return false;
      if (maxAmount !== null && Number.isFinite(maxAmount) && r.amountXof > maxAmount) return false;
      if (search) {
        const hay = [
          r.documentNumber,
          r.counterparty,
          r.phone ?? '',
          r.orderReference ?? '',
          r.externalReference ?? '',
          r.issuerName ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      if (sort === 'amount') return b.amountXof - a.amountXof;
      if (sort === 'amount_asc') return a.amountXof - b.amountXof;
      return b.createdAt.localeCompare(a.createdAt);
    });

    const orderRows = rows.filter((r) => r.documentType === 'customer_order');
    const poRows = rows.filter((r) => r.documentType === 'purchase_order');
    const recRows = rows.filter((r) => r.documentType === 'supplier_reception');
    const payRows = rows.filter((r) => r.documentType === 'payment_receipt');
    const openRecAmount = store.receivables
      .filter((r) => r.status !== 'paid' && r.status !== 'cancelled')
      .reduce((sum, r) => sum + r.remaining_amount, 0);
    const unpaidOrdersAmount = store.orders
      .filter((o) => o.order.status !== 'cancelled' && o.order.payment_status !== 'paid')
      .reduce((sum, o) => sum + Math.max(0, o.order.total_to_collect_xof - o.order.paid_xof), 0);

    const kpis: CommercialDocumentsKpis = {
      totalDocuments: rows.length,
      customerOrdersCount: orderRows.length,
      customerOrdersAmountXof: orderRows.reduce((s, r) => s + r.amountXof, 0),
      purchaseOrdersCount: poRows.length,
      purchaseOrdersAmountXof: poRows.reduce((s, r) => s + r.amountXof, 0),
      receptionsCount: recRows.length,
      paymentReceiptsCount: payRows.length,
      unpaidOrPartialAmountXof: openRecAmount + unpaidOrdersAmount,
    };

    const pendingCount = rows.filter((r) => r.approvalStatus === 'pending_owner_approval').length;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.max(1, Number(req.query.pageSize ?? 20));
    const start = (page - 1) * pageSize;
    res.json({
      rows: filtered.slice(start, start + pageSize),
      total: filtered.length,
      pendingCount,
      kpis,
      page,
      pageSize,
    });
  });

  router.get('/api/commercial-documents/:type/:id', requirePerm('sales:read'), (req, res) => {
    const docType = req.params.type as CommercialDocumentType;
    const id = Number(req.params.id);

    if (docType === 'sales_receipt' || docType === 'cancellation') {
      const s = store.sales.find((x) => x.id === id);
      if (!s) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Document introuvable.' });
        return;
      }
      const extRefs = s.payments
        .map((p) => p.external_reference)
        .filter((v): v is string => Boolean(v))
        .join(', ');
      const detail: CommercialDocumentDetail = {
        documentType: docType,
        documentId: s.id,
        documentNumber: s.reference,
        counterparty: s.client_name,
        status: s.status,
        amountXof: s.total_amount,
        createdAt: s.created_at,
        phone: s.client_phone ?? null,
        orderReference: s.reference,
        paymentMethod: s.payments[0]?.method_code ?? null,
        paymentStatus: s.remaining_amount === 0 ? 'paid' : s.paid_amount > 0 ? 'partial' : 'unpaid',
        externalReference: extRefs || null,
        issuerName: s.payments[0]?.recorded_by_name ?? 'Caissier POS',
        notes: s.notes,
        lines: s.lines.map((l) => ({
          label: l.product_name,
          detail: l.packaging_name,
          quantityMilli: l.quantity_milli,
          unit: l.packaging_name,
          unitPriceXof: l.unit_price,
          amountXof: l.line_total,
        })),
        packagingLines: s.deposits.map((d) => ({
          label: d.packaging_name,
          kind: d.kind,
          expectedQuantity: d.pieces,
          issuedQuantity: d.pieces,
          returnedQuantity: d.returned_pieces,
          statusLabel: d.returned_pieces >= d.pieces ? 'Soldé' : 'En cours',
          detail: d.packaging_code,
          amount: d.amount,
        })),
        payments: s.payments.map((p) => ({
          label: `${p.method_label}${p.external_reference ? ` · Réf ${p.external_reference}` : ''}`,
          amountXof: p.part_amount,
        })),
      };
      res.json(detail);
      return;
    }

    if (docType === 'credit_note') {
      for (const s of store.sales) {
        const ret = s.returns.find((r) => r.id === id);
        if (ret) {
          const detail: CommercialDocumentDetail = {
            documentType: 'credit_note',
            documentId: ret.id,
            documentNumber: ret.credit_note_ref,
            counterparty: s.client_name,
            status: 'validated',
            amountXof: ret.total_amount,
            createdAt: ret.created_at,
            phone: s.client_phone ?? null,
            orderReference: s.reference,
            notes: ret.reason,
            lines: [
              {
                label: `Avoir / Retour sur ${s.reference}`,
                detail: ret.reason,
                quantityMilli: 1000,
                unit: 'avoir',
                unitPriceXof: ret.total_amount,
                amountXof: ret.total_amount,
              },
            ],
            packagingLines: [],
            payments: ret.refund_amount > 0 ? [{ label: 'Remboursement', amountXof: ret.refund_amount }] : [],
          };
          res.json(detail);
          return;
        }
      }
      res.status(404).json({ code: 'NOT_FOUND', message: 'Avoir introuvable.' });
      return;
    }

    if (docType === 'customer_order') {
      const o = store.orders.find((x) => x.order.id === id);
      if (!o) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Commande introuvable.' });
        return;
      }
      const client = store.clients.find((c) => c.id === o.order.customer_id);
      const orderPays = store.payments.filter((p) => p.order_id === o.order.id);
      const snaps: CommercialDocumentSnapshotSummary[] = (store.orderReceipts.get(o.order.id) ?? []).map((s) => ({
        version: s.version,
        documentNumber: s.receipt_number,
        issuedAt: s.issued_at,
        issuedByName: s.issued_by_name,
        issuedByRole: s.issued_by_role,
        revisionReason: s.revision_reason ?? null,
        snapshotJson: s.snapshot_json,
      }));
      const detail: CommercialDocumentDetail = {
        documentType: docType,
        documentId: o.order.id,
        documentNumber: o.order.order_number,
        counterparty: o.order.customer_name,
        status: o.order.status,
        amountXof: o.order.total_to_collect_xof,
        createdAt: o.order.created_at,
        phone: client?.phone ?? null,
        orderReference: o.order.order_number,
        paymentMethod: o.order.planned_payment_channel ?? o.order.payment_method,
        paymentStatus: o.order.payment_status,
        externalReference:
          orderPays
            .map((p) => p.external_reference)
            .filter((v): v is string => Boolean(v))
            .join(', ') || null,
        issuerName: snaps[0]?.issuedByName ?? 'Propriétaire',
        notes: o.order.notes,
        lines: o.lines.map((l) => ({
          label: l.product_name,
          detail: l.variant_name,
          quantityMilli: l.requested_quantity * 1000,
          unit: l.requested_unit,
          unitPriceXof: l.unit_price_xof,
          amountXof: l.line_total_xof,
        })),
        packagingLines: o.allocations.map((a) => ({
          label: a.packaging_name,
          kind: 'crate',
          expectedQuantity: a.quantity,
          issuedQuantity: ['delivered', 'invoiced', 'paid'].includes(o.order.status) ? a.quantity : null,
          returnedQuantity: a.returned_quantity,
          statusLabel: a.returned_quantity >= a.quantity ? 'Retourné' : 'Consigné',
          detail: a.compatibility_class,
          amount: a.quantity * a.deposit_amount_xof,
        })),
        payments:
          orderPays.length > 0
            ? orderPays.map((p) => ({
                label: `${p.parts[0]?.method_label ?? 'Paiement'} · ${p.reference}${p.external_reference ? ` · Réf ${p.external_reference}` : ''}`,
                amountXof: p.total_amount,
              }))
            : o.order.paid_xof > 0
              ? [{ label: o.order.payment_method ?? 'Espèces', amountXof: o.order.paid_xof }]
              : [],
        snapshots: snaps,
      };
      res.json(detail);
      return;
    }

    if (docType === 'purchase_order') {
      const po = store.purchases.find((x) => x.id === id);
      if (!po) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Bon de commande introuvable.' });
        return;
      }
      const snaps: CommercialDocumentSnapshotSummary[] = (store.purchaseDocumentSnapshots.get(po.id) ?? []).map((s) => ({
        version: s.version,
        documentNumber: s.document_number,
        issuedAt: s.issued_at,
        issuedByName: s.issued_by_name,
        issuedByRole: s.issued_by_role,
        revisionReason: s.revision_reason ?? null,
        snapshotJson: s.snapshot_json,
      }));
      const detail: CommercialDocumentDetail = {
        documentType: docType,
        documentId: po.id,
        documentNumber: po.reference,
        counterparty: po.supplier_name,
        status: po.status,
        amountXof: po.total_amount,
        createdAt: po.created_at,
        phone: po.supplier_phone ?? null,
        orderReference: po.reference,
        issuerName: po.created_by_name ?? snaps[0]?.issuedByName ?? 'Responsable Achats',
        notes: [po.payment_terms_label, po.commercial_conditions, po.notes].filter(Boolean).join(' · ') || null,
        lines: po.lines.map((l) => ({
          label: l.product_name,
          detail: l.packaging_name,
          quantityMilli: l.ordered_quantity_milli,
          unit: l.packaging_name,
          unitPriceXof: l.unit_price,
          amountXof: l.line_total,
        })),
        packagingLines: po.packaging_requirements.map((r) => ({
          label: `${r.name} (${r.code})`,
          kind: r.kind,
          expectedQuantity: r.required_pieces,
          issuedQuantity: null,
          returnedQuantity: null,
          statusLabel: 'Emballages vides à remettre au fournisseur',
          detail: `${r.pieces_per_pack} pcs / unité`,
          amount: null,
        })),
        payments: [],
        snapshots: snaps,
      };
      res.json(detail);
      return;
    }

    if (docType === 'supplier_reception') {
      const rec = store.purchaseReceipts.find((x) => x.id === id);
      if (!rec) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Bon de réception introuvable.' });
        return;
      }
      const po = store.purchases.find((p) => p.id === rec.purchase_order_id);
      const snaps: CommercialDocumentSnapshotSummary[] = (store.purchaseReceiptSnapshots.get(rec.id) ?? []).map((s) => ({
        version: s.version,
        documentNumber: s.document_number,
        issuedAt: s.issued_at,
        issuedByName: s.issued_by_name,
        issuedByRole: s.issued_by_role,
        revisionReason: null,
        snapshotJson: s.snapshot_json,
      }));
      const detail: CommercialDocumentDetail = {
        documentType: 'supplier_reception',
        documentId: rec.id,
        documentNumber: rec.reference,
        counterparty: rec.supplier_name,
        status: rec.status ?? 'complete',
        amountXof: rec.total_amount,
        createdAt: rec.created_at,
        phone: po?.supplier_phone ?? null,
        orderReference: rec.order_reference,
        issuerName: rec.received_by_name ?? 'Réceptionnaire Dépôt',
        notes: rec.notes,
        lines: rec.lines.map((l) => ({
          label: l.product_name,
          detail: [
            l.packaging_name,
            l.discrepancy_reason ? `Écart: ${l.discrepancy_reason}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          quantityMilli: l.received_quantity_milli,
          unit: l.packaging_name,
          unitPriceXof: l.unit_price,
          amountXof: l.amount,
        })),
        packagingLines: rec.packaging_exchanges.map((ex) => ({
          label: `${ex.name_snapshot} (${ex.code_snapshot})`,
          kind: ex.kind_snapshot,
          expectedQuantity: ex.pieces_issued,
          issuedQuantity: ex.pieces_issued,
          returnedQuantity: null,
          statusLabel: 'Remis au fournisseur',
          detail: 'Échange emballages vides',
          amount: null,
        })),
        payments: [],
        snapshots: snaps,
      };
      res.json(detail);
      return;
    }

    if (docType === 'payment_receipt') {
      const pay = store.payments.find((p) => p.id === id);
      if (!pay) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Reçu de paiement introuvable.' });
        return;
      }
      const snap = ensurePaymentReceiptSnapshot(pay.id);
      const client = pay.client_id ? store.clients.find((c) => c.id === pay.client_id) : null;
      const order = pay.order_id ? store.orders.find((o) => o.order.id === pay.order_id) : null;
      const sale = pay.sale_id ? store.sales.find((s) => s.id === pay.sale_id) : null;
      const linkedRef = order?.order.order_number ?? sale?.reference ?? pay.reference;
      const detail: CommercialDocumentDetail = {
        documentType: 'payment_receipt',
        documentId: pay.id,
        documentNumber: pay.reference,
        counterparty: client?.name ?? sale?.client_name ?? 'Client comptoir',
        status: (pay.balance_after_xof ?? 0) === 0 ? 'paid' : 'partial',
        amountXof: pay.total_amount,
        createdAt: pay.created_at,
        phone: client?.phone ?? sale?.client_phone ?? null,
        orderReference: linkedRef,
        paymentMethod: pay.parts[0]?.method_code ?? null,
        paymentStatus: (pay.balance_after_xof ?? 0) === 0 ? 'paid' : 'partial',
        externalReference: pay.external_reference ?? null,
        issuerName: pay.recorded_by_name ?? 'Caissier',
        notes: pay.note,
        lines: [],
        packagingLines: [],
        payments: pay.parts.map((pt) => ({
          label: `${pt.method_label}${pay.external_reference ? ` · Réf ${pay.external_reference}` : ''}`,
          amountXof: pt.amount,
        })),
        snapshots: [
          {
            version: snap.version,
            documentNumber: snap.receipt_number,
            issuedAt: snap.issued_at,
            issuedByName: snap.issued_by_name,
            issuedByRole: snap.issued_by_role,
            revisionReason: null,
            snapshotJson: snap.snapshot_json,
          },
        ],
      };
      res.json(detail);
      return;
    }

    res.status(404).json({ code: 'NOT_FOUND', message: 'Document introuvable.' });
  });

  router.post('/api/commercial-documents/:type/:id/submit', requirePerm('sales:write'), (req: AuthedRequest, res) => {
    const docType = req.params.type as 'customer_order' | 'purchase_order';
    const id = Number(req.params.id);
    if (docType === 'customer_order') {
      const o = store.orders.find((x) => x.order.id === id);
      if (o) o.order.approval_status = 'pending_owner_approval';
    } else if (docType === 'purchase_order') {
      const po = store.purchases.find((x) => x.id === id);
      if (po) po.approval_status = 'pending_owner_approval';
    }
    const ev: CommercialApprovalEvent = {
      id: nextId(),
      documentType: docType,
      documentId: id,
      action: 'submitted',
      actorUserId: Number(req.user?.userId ?? 1),
      actorRole: req.user?.role ?? 'owner',
      reason: null,
      snapshotJson: '{}',
      createdAt: nowIso(),
    };
    store.commercialApprovalEvents.unshift(ev);
    res.json({ ok: true });
  });

  router.post('/api/commercial-documents/:type/:id/review', requirePerm('sales:write'), (req: AuthedRequest, res) => {
    const docType = req.params.type as 'customer_order' | 'purchase_order';
    const id = Number(req.params.id);
    const action = String(req.body?.action ?? 'approved') as 'approved' | 'rejected' | 'changes_requested';
    if (docType === 'customer_order') {
      const o = store.orders.find((x) => x.order.id === id);
      if (o) o.order.approval_status = action;
    } else if (docType === 'purchase_order') {
      const po = store.purchases.find((x) => x.id === id);
      if (po) po.approval_status = action;
    }
    const ev: CommercialApprovalEvent = {
      id: nextId(),
      documentType: docType,
      documentId: id,
      action,
      actorUserId: Number(req.user?.userId ?? 1),
      actorRole: req.user?.role ?? 'owner',
      reason: req.body?.reason ? String(req.body.reason) : null,
      snapshotJson: '{}',
      createdAt: nowIso(),
    };
    store.commercialApprovalEvents.unshift(ev);
    res.json({ ok: true });
  });

  router.get('/api/commercial-documents/:type/:id/events', requirePerm('sales:read'), (req, res) => {
    const docType = req.params.type;
    const id = Number(req.params.id);
    res.json(
      store.commercialApprovalEvents.filter((e) => e.documentType === docType && e.documentId === id),
    );
  });

  return router;
}
