import crypto from 'node:crypto';
import type {
  AppSettings,
  BackupFile,
  BrandRef,
  Brewery,
  CatalogPresetItem,
  Category,
  Client,
  CommercialApprovalEvent,
  CommercialDocumentDetail,
  CommercialDocumentType,
  ContainerTypeRef,
  CustomerDepositBalance,
  CustomerOrderDetail,
  CustomerOrderReceiptSnapshot,
  DepositRuleRef,
  ExpenseItem,
  PackagingAsset,
  PackagingMovementRecord,
  PackagingTypeRef,
  PaymentMethodConfig,
  PaymentReceiptSnapshot,
  Product,
  ProductSalesUnit,
  ProductSupplierLink,
  PurchaseDocumentSnapshot,
  PurchaseOrder,
  PurchaseReceipt,
  PurchaseReceiptSnapshot,
  Receivable,
  SaleDetail,
  SessionUser,
  StockLocationRef,
  Supplier,
  SupplierDebt,
  UserAccount,
  UserRole,
} from '../src/types/erp.ts';

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  manager: 'Responsable',
  cashier: 'Caissier',
  stock_manager: 'Gestionnaire de stock',
  accountant: 'Comptable',
};

export const ALL_PERMISSIONS = [
  'catalog:read',
  'catalog:write',
  'catalog:delete',
  'sales:read',
  'sales:write',
  'sales:cancel_return',
  'receivables:read',
  'receivables:pay',
  'purchases:read',
  'purchases:write',
  'supplier_debts:pay',
  'stock:read',
  'stock:adjust',
  'inventory:validate',
  'consignments:read',
  'consignments:write',
  'cash:read',
  'cash:operate',
  'expenses:write',
  'reports:read',
  'settings:read',
  'settings:write',
  'backups:read',
  'backups:create',
  'backups:restore',
  'security:manage_users',
  'security:change_owner_pin',
];

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter(
    (p) => p !== 'catalog:delete' && p !== 'security:change_owner_pin',
  ),
  manager: [
    'catalog:read',
    'catalog:write',
    'sales:read',
    'sales:write',
    'sales:cancel_return',
    'receivables:read',
    'receivables:pay',
    'purchases:read',
    'purchases:write',
    'supplier_debts:pay',
    'stock:read',
    'stock:adjust',
    'inventory:validate',
    'consignments:read',
    'consignments:write',
    'cash:read',
    'cash:operate',
    'expenses:write',
    'reports:read',
    'settings:read',
    'backups:read',
    'backups:create',
  ],
  cashier: [
    'catalog:read',
    'sales:read',
    'sales:write',
    'sales:cancel_return',
    'receivables:read',
    'receivables:pay',
    'consignments:read',
    'consignments:write',
    'cash:read',
    'cash:operate',
    'expenses:write',
    'settings:read',
  ],
  stock_manager: [
    'catalog:read',
    'catalog:write',
    'purchases:read',
    'purchases:write',
    'stock:read',
    'stock:adjust',
    'inventory:validate',
    'consignments:read',
    'consignments:write',
    'settings:read',
  ],
  accountant: [
    'catalog:read',
    'sales:read',
    'receivables:read',
    'purchases:read',
    'stock:read',
    'consignments:read',
    'cash:read',
    'reports:read',
    'settings:read',
    'backups:read',
  ],
};

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function parseQtyMilli(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const cleaned = String(raw).trim().replace(',', '.');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000);
}

export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`depotpro-pin:${pin}`).digest('hex');
}

export interface InternalUser extends UserAccount {
  pinHash: string;
}

export interface ReturnableTypeRecord {
  id: number;
  code: string;
  name: string;
  producer: string;
  kind: 'bottle' | 'crate';
  deposit_value: number;
  stock_quantity: number;
}

export interface ReturnableMovementRecord {
  id: number;
  packaging_id: number;
  packaging_name: string;
  packaging_code: string;
  movement_type:
    | 'initial'
    | 'entry'
    | 'exit'
    | 'breakage'
    | 'loss'
    | 'correction_in'
    | 'correction_out';
  quantity: number;
  stock_before: number | null;
  stock_after: number;
  reason: string;
  reference_document: string | null;
  created_at: string;
}

export interface DepositReturnRecord {
  id: number;
  reference: string;
  packaging_name: string;
  client_name: string | null;
  pieces: number;
  condition_state: 'good' | 'damaged';
  refund_amount: number;
  credit_reduction: number;
  method_label: string;
  reason: string;
  created_at: string;
}

export interface PackagingObligationRecord {
  id: number;
  sale_id: number;
  sale_reference: string | null;
  client_id: number | null;
  returnable_id: number;
  pieces: number;
  returned_pieces: number;
  pending_pieces: number;
  unit_value: number;
  total_reference_value: number;
  due_date: string | null;
  overdue: boolean;
  status: string;
}

export interface StockMovementRecord {
  id: number;
  product_id: number;
  product_name: string;
  product_reference: string;
  base_unit: string;
  movement_type: string;
  quantity_milli: number;
  stock_before_milli: number;
  stock_after_milli: number;
  reason: string | null;
  reference_document: string | null;
  created_at: string;
}

export interface InventoryRecord {
  id: number;
  reference: string;
  status: 'draft' | 'validated' | 'cancelled';
  notes: string | null;
  created_at: string;
  validated_at: string | null;
  lines: Array<{
    id: number;
    product_id: number;
    product_name: string;
    product_reference: string;
    base_unit: string;
    theoretical_milli: number;
    counted_milli: number | null;
    reason: string | null;
  }>;
}

export interface CashMovementRecord {
  id: number;
  session_id: number;
  kind: string;
  method_code: string;
  method_label: string;
  is_cash: number;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  reference_document: string | null;
  created_at: string;
}

export interface CashSessionRecord {
  id: number;
  reference: string;
  opened_at: string;
  closed_at: string | null;
  status: 'open' | 'closed';
  opening_cash: number;
  theoretical_cash: number | null;
  physical_cash: number | null;
  difference: number | null;
  closing_notes: string | null;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  entity_type: string;
  details: string;
  created_at: string;
}

export interface CataloguePriceHistoryEntry {
  id: number;
  reference_price: number;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface PaymentRecord {
  id: number;
  reference: string;
  sale_id: number | null;
  order_id: number | null;
  client_id: number | null;
  payment_kind: 'sale' | 'order' | 'receivable' | 'supplier_debt';
  total_amount: number;
  note: string | null;
  external_reference: string | null;
  recorded_by_user_id: string | null;
  recorded_by_name: string | null;
  recorded_by_role: string;
  balance_before_xof?: number;
  balance_after_xof?: number;
  created_at: string;
  parts: Array<{
    method_code: string;
    method_label: string;
    amount: number;
  }>;
}

export interface StoreState {
  nextId: number;
  sequences: Record<string, number>;
  sessions: Map<string, { user: SessionUser; expiresAt: number }>;
  users: InternalUser[];
  ownerPinHash: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  settings: AppSettings;
  paymentMethods: PaymentMethodConfig[];
  categories: Category[];
  breweries: Brewery[];
  brands: BrandRef[];
  containerTypes: ContainerTypeRef[];
  packagingTypes: PackagingTypeRef[];
  stockLocations: StockLocationRef[];
  products: Product[];
  salesUnits: ProductSalesUnit[];
  productSuppliers: ProductSupplierLink[];
  depositRules: DepositRuleRef[];
  catalogPresets: CatalogPresetItem[];
  cataloguePriceHistory: Map<number, CataloguePriceHistoryEntry[]>;
  returnableTypes: ReturnableTypeRecord[];
  returnableMovements: ReturnableMovementRecord[];
  depositReturns: DepositReturnRecord[];
  packagingObligations: PackagingObligationRecord[];
  packagingAssets: PackagingAsset[];
  packagingMovements: PackagingMovementRecord[];
  customerDeposits: CustomerDepositBalance[];
  clients: Client[];
  clientPackagingFinancialDebt: Map<number, number>;
  suppliers: Supplier[];
  sales: SaleDetail[];
  receivables: Receivable[];
  payments: PaymentRecord[];
  paymentReceipts: Map<number, PaymentReceiptSnapshot>;
  purchases: PurchaseOrder[];
  purchaseReceipts: PurchaseReceipt[];
  purchaseDocumentSnapshots: Map<number, PurchaseDocumentSnapshot[]>;
  purchaseReceiptSnapshots: Map<number, PurchaseReceiptSnapshot[]>;
  supplierDebts: SupplierDebt[];
  orders: CustomerOrderDetail[];
  orderReceipts: Map<number, CustomerOrderReceiptSnapshot[]>;
  stockMovements: StockMovementRecord[];
  inventories: InventoryRecord[];
  cashSessions: CashSessionRecord[];
  cashMovements: CashMovementRecord[];
  expenseCategories: Array<{ id: number; name: string }>;
  expenses: ExpenseItem[];
  auditLogs: AuditLogEntry[];
  commercialApprovalEvents: CommercialApprovalEvent[];
  commercialDocumentDetails: Map<string, CommercialDocumentDetail>;
  backups: Array<{ meta: BackupFile; encrypted: boolean; passphraseHash?: string; snapshotJson: string }>;
  idempotencyKeys: Set<string>;
}

export type CommercialDocKey = `${CommercialDocumentType}:${number}`;
