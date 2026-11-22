import crypto from 'node:crypto';
import { Router } from 'express';
import type {
  BackupEntityCounts,
  DashboardData,
  SessionUser,
  UserRole,
} from '../../src/types/erp.ts';
import {
  extractToken,
  issueSession,
  requireAuth,
  requirePerm,
  validateSession,
  type AuthedRequest,
} from '../authMiddleware.ts';
import { buildDocumentPdfBytes } from '../pdf.ts';
import { addAudit, nextId, store } from '../store.ts';
import {
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  hashPin,
  nowIso,
  todayStr,
} from '../types.ts';

function buildSessionUser(u: {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
}): SessionUser {
  return {
    userId: String(u.id),
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role] ?? u.role,
    permissions: ROLE_PERMISSIONS[u.role] ?? [],
  };
}

function setSessionCookie(res: { cookie: (name: string, val: string, opts: Record<string, unknown>) => void }, token: string) {
  res.cookie('depotpro_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function getBackupCounts(): BackupEntityCounts {
  return {
    products: store.products.length,
    stockMovements: store.stockMovements.length,
    clients: store.clients.length,
    suppliers: store.suppliers.length,
    sales: store.sales.length,
    salesReturns: store.sales.reduce((acc, s) => acc + s.returns.length, 0),
    customerReceivables: store.receivables.length,
    purchaseOrders: store.purchases.length,
    purchaseReceipts: store.purchases.reduce((acc, p) => acc + p.receipts.length, 0),
    supplierDebts: store.supplierDebts.length,
    returnableStockMovements: store.returnableMovements.length,
    cashMovements: store.cashMovements.length,
    expenses: store.expenses.length,
    auditLogs: store.auditLogs.length,
  };
}

export function createAuthAndSystemRouter(): Router {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({ ok: true, runtime: 'node-express', timestamp: nowIso() });
  });

  router.get('/api/auth/status', (req, res) => {
    const token = extractToken(req);
    const user = validateSession(token);
    res.json({
      needsSetup: !store.ownerPinHash,
      lockedUntil: store.lockedUntil,
      failedAttempts: store.failedAttempts,
      authenticated: Boolean(user),
      user: user ?? undefined,
    });
  });

  router.post('/api/auth/setup', (req, res) => {
    const pin = String(req.body?.pin ?? '').trim();
    if (!/^\d{6}$/.test(pin)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Le PIN doit comporter 6 chiffres.' });
      return;
    }
    if (store.ownerPinHash) {
      res.status(400).json({ code: 'ALREADY_CONFIGURED', message: 'Le PIN propriétaire est déjà configuré.' });
      return;
    }
    const h = hashPin(pin);
    store.ownerPinHash = h;
    const owner = store.users.find((u) => u.role === 'owner');
    if (owner) {
      owner.pinHash = h;
    }
    const identity = buildSessionUser(owner ?? { id: 1, username: 'owner', displayName: 'Propriétaire', role: 'owner' });
    const token = issueSession(identity);
    setSessionCookie(res, token);
    addAudit('AUTH_SETUP', 'auth', 'PIN propriétaire configuré');
    res.json({ token, user: identity });
  });

  router.post('/api/auth/login', (req, res) => {
    if (!store.ownerPinHash) {
      res.status(400).json({ code: 'PIN_NOT_CONFIGURED', message: 'Aucun PIN configuré.' });
      return;
    }
    if (store.lockedUntil && new Date(store.lockedUntil).getTime() > Date.now()) {
      res.status(429).json({
        code: 'PIN_LOCKED',
        message: 'Accès temporairement verrouillé suite à plusieurs tentatives.',
      });
      return;
    }
    const pin = String(req.body?.pin ?? '').trim();
    const username = req.body?.username ? String(req.body.username).trim().toLowerCase() : 'owner';
    const user = store.users.find((u) => u.username.toLowerCase() === username);
    if (!user || !user.active) {
      res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Utilisateur inconnu ou inactif.' });
      return;
    }
    const effectiveHash = user.pinHash || (user.role === 'owner' ? store.ownerPinHash : '');
    if (!effectiveHash || hashPin(pin) !== effectiveHash) {
      store.failedAttempts += 1;
      if (store.failedAttempts >= 5) {
        store.lockedUntil = new Date(Date.now() + 30_000).toISOString();
        store.failedAttempts = 0;
        res.status(429).json({ code: 'PIN_LOCKED', message: 'Trop de tentatives. Verrouillage 30 secondes.' });
        return;
      }
      res.status(401).json({ code: 'INVALID_PIN', message: 'Code PIN incorrect.' });
      return;
    }

    store.failedAttempts = 0;
    store.lockedUntil = null;
    const identity = buildSessionUser(user);
    const token = issueSession(identity);
    setSessionCookie(res, token);
    addAudit('AUTH_LOGIN', 'auth', `Connexion ${user.username}`);
    res.json({ token, user: identity });
  });

  router.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  router.post('/api/auth/lock', (req, res) => {
    const token = extractToken(req);
    if (token) store.sessions.delete(token);
    res.clearCookie('depotpro_session', { path: '/' });
    res.json({ locked: true });
  });

  router.post('/api/auth/change-pin', requirePerm('security:change_owner_pin'), (req, res) => {
    const currentPin = String(req.body?.currentPin ?? '').trim();
    const newPin = String(req.body?.newPin ?? '').trim();
    if (!store.ownerPinHash || hashPin(currentPin) !== store.ownerPinHash) {
      res.status(400).json({ code: 'INVALID_PIN', message: 'Code PIN actuel incorrect.' });
      return;
    }
    if (!/^\d{6}$/.test(newPin)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Le nouveau PIN doit comporter 6 chiffres.' });
      return;
    }
    const h = hashPin(newPin);
    store.ownerPinHash = h;
    const owner = store.users.find((u) => u.role === 'owner');
    if (owner) owner.pinHash = h;
    addAudit('CHANGE_PIN', 'auth', 'Modification du PIN propriétaire');
    res.json({ ok: true });
  });

  router.get('/api/auth/users', requirePerm('security:manage_users'), (_req, res) => {
    res.json(
      store.users.map(({ pinHash: _pinHash, ...safe }) => safe),
    );
  });

  router.post('/api/auth/users', requirePerm('security:manage_users'), (req, res) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const displayName = String(req.body?.displayName ?? '').trim();
    const role = String(req.body?.role ?? 'cashier') as UserRole;
    const pin = String(req.body?.pin ?? '').trim();
    if (!username || !displayName || !/^\d{6}$/.test(pin)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Identifiant, nom complet et PIN 6 chiffres requis.' });
      return;
    }
    if (store.users.some((u) => u.username.toLowerCase() === username)) {
      res.status(409).json({ code: 'DUPLICATE_USER', message: 'Cet identifiant existe déjà.' });
      return;
    }
    const newUser = {
      id: nextId(),
      username,
      displayName,
      role,
      roleLabel: ROLE_LABELS[role] ?? role,
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: nowIso(),
      pinHash: hashPin(pin),
    };
    store.users.push(newUser);
    addAudit('CREATE_USER', 'user', `Création compte ${username} (${role})`);
    const { pinHash: _pinHash, ...safe } = newUser;
    res.status(201).json(safe);
  });

  router.put('/api/auth/users/:id/status', requirePerm('security:manage_users'), (req, res) => {
    const id = Number(req.params.id);
    const active = Boolean(req.body?.active);
    const user = store.users.find((u) => u.id === id);
    if (!user) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable.' });
      return;
    }
    if (user.role === 'owner' && !active) {
      res.status(400).json({ code: 'FORBIDDEN', message: 'Le compte propriétaire reste toujours actif.' });
      return;
    }
    user.active = active;
    const { pinHash: _pinHash, ...safe } = user;
    res.json(safe);
  });

  router.get('/api/dashboard', requirePerm('catalog:read'), (_req, res) => {
    const activeSales = store.sales.filter((s) => s.status !== 'cancelled');
    const revenueMerchandise = activeSales.reduce((sum, s) => sum + s.total_merchandise, 0);
    const depositsTotal = activeSales.reduce((sum, s) => sum + s.total_deposit, 0);
    const collectionsTotal = activeSales.reduce((sum, s) => sum + s.paid_amount, 0);

    const openReceivables = store.receivables.filter((r) => r.status !== 'paid' && r.status !== 'cancelled');
    const receivablesTotal = openReceivables.reduce((sum, r) => sum + r.remaining_amount, 0);
    const openDebts = store.supplierDebts.filter((d) => d.status !== 'paid');
    const supplierDebtsTotal = openDebts.reduce((sum, d) => sum + d.remaining_amount, 0);
    const expensesTotal = store.expenses.reduce((sum, e) => sum + e.amount, 0);

    const activeCashSession = store.cashSessions.find((s) => s.status === 'open') ?? null;
    const sessionMovements = activeCashSession
      ? store.cashMovements.filter((m) => m.session_id === activeCashSession.id)
      : [];
    const cashDelta = sessionMovements
      .filter((m) => m.is_cash === 1)
      .reduce((acc, m) => acc + (m.direction === 'in' ? m.amount : -m.amount), 0);
    const digitalSessionTotal = sessionMovements
      .filter((m) => m.is_cash === 0)
      .reduce((acc, m) => acc + (m.direction === 'in' ? m.amount : -m.amount), 0);

    const activeProducts = store.products.filter((p) => p.is_active === 1);
    const lowStockProducts = activeProducts
      .filter((p) => p.stock_milli <= p.min_stock_milli)
      .map((p) => ({
        id: p.id,
        reference: p.reference,
        name: p.name,
        base_unit: p.base_unit,
        stock_milli: p.stock_milli,
        min_stock_milli: p.min_stock_milli,
      }));
    const outOfStockCount = activeProducts.filter((p) => p.stock_milli <= 0).length;

    const topMap = new Map<number, { product_id: number; product_name: string; base_unit: string; total_base_milli: number; total_revenue: number }>();
    for (const s of activeSales) {
      for (const l of s.lines) {
        const cur = topMap.get(l.product_id) ?? {
          product_id: l.product_id,
          product_name: l.product_name,
          base_unit: l.base_unit,
          total_base_milli: 0,
          total_revenue: 0,
        };
        cur.total_base_milli += l.base_quantity_milli;
        cur.total_revenue += l.line_total;
        topMap.set(l.product_id, cur);
      }
    }

    const day = todayStr();
    const payload: DashboardData = {
      kpis: {
        revenueMerchandise,
        depositsTotal,
        salesCount: activeSales.length,
        collectionsTotal,
        receivablesTotal,
        receivablesCount: openReceivables.length,
        overdueReceivablesTotal: 0,
        overdueReceivablesCount: 0,
        supplierDebtsTotal,
        supplierDebtsCount: openDebts.length,
        overdueSupplierDebtsTotal: 0,
        overdueSupplierDebtsCount: 0,
        expensesTotal,
        cashSessionOpen: Boolean(activeCashSession),
        cashSessionReference: activeCashSession?.reference ?? null,
        cashPhysicalTheoretical: activeCashSession ? activeCashSession.opening_cash + cashDelta : 0,
        digitalSessionTotal,
        lowStockCount: lowStockProducts.length,
        outOfStockCount,
      },
      lowStockProducts,
      topProducts: Array.from(topMap.values()).sort((a, b) => b.total_revenue - a.total_revenue).slice(0, 8),
      salesSeries: [
        {
          day,
          count: activeSales.length,
          revenue: revenueMerchandise,
          collected: collectionsTotal,
        },
      ],
      recentAudit: store.auditLogs.slice(0, 12),
    };
    res.json(payload);
  });

  router.get('/api/settings', requirePerm('settings:read'), (_req, res) => {
    res.json({
      settings: store.settings,
      paymentMethods: store.paymentMethods,
    });
  });

  router.put('/api/settings', requirePerm('settings:write'), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cur = store.settings;
    store.settings = {
      ...cur,
      company_name: typeof body.company_name === 'string' && body.company_name.trim() ? body.company_name.trim() : cur.company_name,
      company_legal_name: body.company_legal_name !== undefined ? (body.company_legal_name ? String(body.company_legal_name) : null) : cur.company_legal_name,
      business_activity: body.business_activity !== undefined ? (body.business_activity ? String(body.business_activity) : null) : cur.business_activity,
      address: body.address !== undefined ? (body.address ? String(body.address) : null) : cur.address,
      phone: body.phone !== undefined ? (body.phone ? String(body.phone) : null) : cur.phone,
      whatsapp: body.whatsapp !== undefined ? (body.whatsapp ? String(body.whatsapp) : null) : cur.whatsapp,
      email: body.email !== undefined ? (body.email ? String(body.email) : null) : cur.email,
      city: body.city !== undefined ? (body.city ? String(body.city) : null) : cur.city,
      commune: body.commune !== undefined ? (body.commune ? String(body.commune) : null) : cur.commune,
      quartier: body.quartier !== undefined ? (body.quartier ? String(body.quartier) : null) : cur.quartier,
      country: body.country !== undefined ? (body.country ? String(body.country) : null) : cur.country,
      rccm: body.rccm !== undefined ? (body.rccm ? String(body.rccm) : null) : cur.rccm,
      ncc: body.ncc !== undefined ? (body.ncc ? String(body.ncc) : null) : cur.ncc,
      allow_negative_stock: body.allow_negative_stock !== undefined ? (body.allow_negative_stock ? 1 : 0) : cur.allow_negative_stock,
      invoice_prefix: typeof body.invoice_prefix === 'string' && body.invoice_prefix.trim() ? body.invoice_prefix.trim().toUpperCase() : cur.invoice_prefix,
      sale_prefix: typeof body.sale_prefix === 'string' && body.sale_prefix.trim() ? body.sale_prefix.trim().toUpperCase() : cur.sale_prefix,
      purchase_prefix: typeof body.purchase_prefix === 'string' && body.purchase_prefix.trim() ? body.purchase_prefix.trim().toUpperCase() : cur.purchase_prefix,
      order_prefix: typeof body.order_prefix === 'string' && body.order_prefix.trim() ? body.order_prefix.trim().toUpperCase() : cur.order_prefix,
      receipt_prefix: typeof body.receipt_prefix === 'string' && body.receipt_prefix.trim() ? body.receipt_prefix.trim().toUpperCase() : cur.receipt_prefix,
      credit_note_prefix: typeof body.credit_note_prefix === 'string' && body.credit_note_prefix.trim() ? body.credit_note_prefix.trim().toUpperCase() : cur.credit_note_prefix,
      theme: body.theme === 'dark' || body.theme === 'light' ? body.theme : cur.theme,
      logo_path: body.logo_path !== undefined ? (body.logo_path ? String(body.logo_path) : null) : cur.logo_path,
      setup_completed: body.setup_completed !== undefined ? (body.setup_completed ? 1 : 0) : cur.setup_completed,
      inactivity_timeout_minutes: typeof body.inactivity_timeout_minutes === 'number' ? body.inactivity_timeout_minutes : cur.inactivity_timeout_minutes,
    };
    addAudit('UPDATE_SETTINGS', 'app_settings', 'Paramètres mis à jour');
    res.json({
      settings: store.settings,
      paymentMethods: store.paymentMethods,
    });
  });

  router.post('/api/payment-methods', requirePerm('settings:write'), (req, res) => {
    const label = String(req.body?.label ?? '').trim();
    if (!label) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Libellé requis.' });
      return;
    }
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 18);
    const code = `${slug || 'method'}_${Date.now() % 10000}`;
    const item = { code, label, is_cash: 0, active: 1 };
    store.paymentMethods.push(item);
    addAudit('ADD_PAYMENT_METHOD', 'payment_methods', label);
    res.status(201).json(item);
  });

  router.put('/api/payment-methods/:code', requirePerm('settings:write'), (req, res) => {
    const code = req.params.code;
    const active = Boolean(req.body?.active);
    if (code === 'cash' && !active) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Le moyen Espèces ne peut jamais être désactivé.' });
      return;
    }
    const pm = store.paymentMethods.find((m) => m.code === code);
    if (!pm) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Moyen de paiement introuvable.' });
      return;
    }
    pm.active = active ? 1 : 0;
    res.json(pm);
  });

  router.get('/api/backups', requirePerm('backups:read'), (_req, res) => {
    res.json(store.backups.map((b) => b.meta));
  });

  router.get('/api/backups/db-status', requirePerm('backups:read'), (_req, res) => {
    const last = store.backups[0]?.meta.createdAt ?? null;
    res.json({
      dbPath: 'in-memory://depotpro.sqlite',
      backupDir: 'in-memory://backups',
      dbSizeBytes: Buffer.byteLength(JSON.stringify({ products: store.products, sales: store.sales }), 'utf8'),
      walSizeBytes: 0,
      schemaVersion: 24,
      journalMode: 'MEMORY',
      integrity: 'ok',
      foreignKeyErrors: 0,
      backupCount: store.backups.length,
      lastBackupAt: last,
    });
  });

  router.post('/api/backups', requirePerm('backups:create'), (_req, res) => {
    const createdAt = nowIso();
    const name = `depotpro_backup_${createdAt.replace(/[: ]/g, '-')}.json`;
    const snapshotJson = JSON.stringify({
      version: 24,
      createdAt,
      counts: getBackupCounts(),
      settings: store.settings,
      productsCount: store.products.length,
    });
    const sha256 = crypto.createHash('sha256').update(snapshotJson).digest('hex');
    const meta = {
      name,
      size: Buffer.byteLength(snapshotJson, 'utf8'),
      createdAt,
      integrity: 'ok',
      sha256,
      encrypted: false,
    };
    store.backups.unshift({ meta, encrypted: false, snapshotJson });
    addAudit('CREATE_BACKUP', 'backup', name);
    res.status(201).json(meta);
  });

  router.post('/api/backups/encrypted', requirePerm('backups:create'), (req, res) => {
    const passphrase = String(req.body?.passphrase ?? '').trim();
    if (passphrase.length < 6) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Phrase secrète de 6 caractères minimum requise.' });
      return;
    }
    const createdAt = nowIso();
    const name = `depotpro_backup_${createdAt.replace(/[: ]/g, '-')}.dpbak`;
    const snapshotJson = JSON.stringify({
      version: 24,
      createdAt,
      counts: getBackupCounts(),
      settings: store.settings,
    });
    const sha256 = crypto.createHash('sha256').update(snapshotJson).digest('hex');
    const meta = {
      name,
      size: Buffer.byteLength(snapshotJson, 'utf8'),
      createdAt,
      integrity: 'ok',
      sha256,
      encrypted: true,
    };
    store.backups.unshift({
      meta,
      encrypted: true,
      passphraseHash: hashPin(passphrase),
      snapshotJson,
    });
    addAudit('CREATE_ENCRYPTED_BACKUP', 'backup', name);
    res.status(201).json(meta);
  });

  router.post('/api/backups/import', requirePerm('backups:create'), (req, res) => {
    const filename = String(req.body?.filename ?? `import_${Date.now()}.json`);
    const bytes = Array.isArray(req.body?.bytes) ? (req.body.bytes as number[]) : [];
    const buf = Buffer.from(bytes);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const meta = {
      name: filename,
      size: buf.length,
      createdAt: nowIso(),
      integrity: 'ok',
      sha256,
      encrypted: filename.endsWith('.dpbak'),
    };
    store.backups.unshift({
      meta,
      encrypted: meta.encrypted,
      snapshotJson: buf.toString('utf8'),
    });
    res.status(201).json(meta);
  });

  router.get('/api/backups/:name/verify', requirePerm('backups:read'), (req, res) => {
    const found = store.backups.find((b) => b.meta.name === req.params.name);
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Sauvegarde introuvable.' });
      return;
    }
    res.json({
      name: found.meta.name,
      integrity: 'ok',
      foreignKeyErrors: 0,
      schemaVersion: 24,
      compatible: true,
      sha256: found.meta.sha256,
      counts: getBackupCounts(),
    });
  });

  router.post('/api/backups/:name/verify-encrypted', requirePerm('backups:read'), (req, res) => {
    const found = store.backups.find((b) => b.meta.name === req.params.name);
    const passphrase = String(req.body?.passphrase ?? '').trim();
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Sauvegarde introuvable.' });
      return;
    }
    if (found.passphraseHash && hashPin(passphrase) !== found.passphraseHash) {
      res.status(400).json({ code: 'INVALID_PASSPHRASE', message: 'Phrase secrète incorrecte.' });
      return;
    }
    res.json({
      name: found.meta.name,
      integrity: 'ok',
      foreignKeyErrors: 0,
      schemaVersion: 24,
      compatible: true,
      sha256: found.meta.sha256,
      counts: getBackupCounts(),
    });
  });

  router.post('/api/backups/:name/restore', requirePerm('backups:restore'), (req, res) => {
    const found = store.backups.find((b) => b.meta.name === req.params.name);
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Sauvegarde introuvable.' });
      return;
    }
    addAudit('RESTORE_BACKUP', 'backup', found.meta.name);
    res.json({
      restored: found.meta.name,
      restoredSha256: found.meta.sha256,
      integrity: 'ok',
      foreignKeyErrors: 0,
      schemaVersion: 24,
      counts: getBackupCounts(),
    });
  });

  router.post('/api/backups/:name/restore-encrypted', requirePerm('backups:restore'), (req, res) => {
    const found = store.backups.find((b) => b.meta.name === req.params.name);
    const passphrase = String(req.body?.passphrase ?? '').trim();
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Sauvegarde introuvable.' });
      return;
    }
    if (found.passphraseHash && hashPin(passphrase) !== found.passphraseHash) {
      res.status(400).json({ code: 'INVALID_PASSPHRASE', message: 'Phrase secrète incorrecte.' });
      return;
    }
    addAudit('RESTORE_ENCRYPTED_BACKUP', 'backup', found.meta.name);
    res.json({
      restored: found.meta.name,
      restoredSha256: found.meta.sha256,
      integrity: 'ok',
      foreignKeyErrors: 0,
      schemaVersion: 24,
      counts: getBackupCounts(),
    });
  });

  router.get('/api/backups/:name/download', requirePerm('backups:read'), (req, res) => {
    const found = store.backups.find((b) => b.meta.name === req.params.name);
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Sauvegarde introuvable.' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(found.snapshotJson, 'utf8'));
  });

  router.post('/api/documents/pdf', requireAuth, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const docType = String(body.docType ?? '');
    const reference = String(body.reference ?? '').trim();
    const orderRef = String(body.orderReference ?? body.linkedDocumentRef ?? '').trim();

    let resolvedDoc: Record<string, unknown> = body;
    let resolvedCompany = store.settings;

    if (
      docType === 'REÇU DE COMMANDE' ||
      docType === 'RECU DE COMMANDE' ||
      docType === 'BON DE COMMANDE CLIENT – ACCUSÉ DE RÉCEPTION'
    ) {
      let foundSnapJson: string | null = null;
      for (const list of store.orderReceipts.values()) {
        const matchByReceipt = list.find((s) => s.receipt_number === reference);
        if (matchByReceipt) {
          foundSnapJson = matchByReceipt.snapshot_json;
          break;
        }
      }
      if (!foundSnapJson) {
        const orderMatch = store.orders.find(
          (o) =>
            o.order.order_number === orderRef ||
            o.order.order_number === reference ||
            `REC-${o.order.order_number}` === reference,
        );
        if (orderMatch) {
          const list = store.orderReceipts.get(orderMatch.order.id) ?? [];
          if (list.length > 0) {
            foundSnapJson = list[0].snapshot_json;
          }
        }
      }
      if (!foundSnapJson) {
        res.status(404).json({
          code: 'RECEIPT_NOT_ISSUED',
          message: "Aucun reçu officiel émis pour cette commande. Confirmez d'abord la commande.",
        });
        return;
      }
      try {
        const parsed = JSON.parse(foundSnapJson) as Record<string, unknown>;
        if (parsed.pdfDocument && typeof parsed.pdfDocument === 'object') {
          resolvedDoc = parsed.pdfDocument as Record<string, unknown>;
        }
        if (parsed.company && typeof parsed.company === 'object') {
          resolvedCompany = { ...store.settings, ...(parsed.company as Record<string, unknown>) };
        }
      } catch {
        // fallback to body
      }
    } else if (docType === 'BON DE COMMANDE FOURNISSEUR' && reference) {
      for (const list of store.purchaseDocumentSnapshots.values()) {
        const match = list.find((s) => s.document_number === reference);
        if (match) {
          try {
            const parsed = JSON.parse(match.snapshot_json) as Record<string, unknown>;
            if (parsed.pdfDocument && typeof parsed.pdfDocument === 'object') {
              resolvedDoc = parsed.pdfDocument as Record<string, unknown>;
            }
            if (parsed.company && typeof parsed.company === 'object') {
              resolvedCompany = { ...store.settings, ...(parsed.company as Record<string, unknown>) };
            }
          } catch {
            // keep body
          }
          break;
        }
      }
    } else if (docType === 'BON DE RÉCEPTION FOURNISSEUR' && reference) {
      for (const list of store.purchaseReceiptSnapshots.values()) {
        const match = list.find((s) => s.document_number === reference);
        if (match) {
          try {
            const parsed = JSON.parse(match.snapshot_json) as Record<string, unknown>;
            if (parsed.pdfDocument && typeof parsed.pdfDocument === 'object') {
              resolvedDoc = parsed.pdfDocument as Record<string, unknown>;
            }
            if (parsed.company && typeof parsed.company === 'object') {
              resolvedCompany = { ...store.settings, ...(parsed.company as Record<string, unknown>) };
            }
          } catch {
            // keep body
          }
          break;
        }
      }
    } else if (docType === 'REÇU DE PAIEMENT' && reference) {
      for (const snap of store.paymentReceipts.values()) {
        if (snap.receipt_number === reference) {
          try {
            const parsed = JSON.parse(snap.snapshot_json) as Record<string, unknown>;
            if (parsed.pdfDocument && typeof parsed.pdfDocument === 'object') {
              resolvedDoc = parsed.pdfDocument as Record<string, unknown>;
            }
            if (parsed.company && typeof parsed.company === 'object') {
              resolvedCompany = { ...store.settings, ...(parsed.company as Record<string, unknown>) };
            }
          } catch {
            // keep body
          }
          break;
        }
      }
    }

    const pdfBytes = buildDocumentPdfBytes(resolvedDoc, resolvedCompany);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBytes);
  });

  return router;
}
