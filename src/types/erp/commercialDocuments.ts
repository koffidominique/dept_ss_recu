export type CommercialDocumentType =
  | 'customer_order'
  | 'sales_receipt'
  | 'purchase_order'
  | 'supplier_reception'
  | 'payment_receipt'
  | 'credit_note'
  | 'cancellation';

export type CommercialApprovalStatus =
  | 'draft'
  | 'pending_owner_approval'
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | null;

export interface CommercialDocument {
  documentType: CommercialDocumentType;
  documentId: number;
  documentNumber: string;
  counterparty: string;
  status: string;
  approvalStatus: CommercialApprovalStatus;
  amountXof: number;
  createdAt: string;
  phone?: string | null;
  orderReference?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  externalReference?: string | null;
  issuerName?: string | null;
  snapshotCount?: number;
}

export interface CommercialDocumentsQuery {
  search?: string;
  documentType?: string;
  status?: string;
  from?: string;
  to?: string;
  phone?: string;
  orderRef?: string;
  externalRef?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  receptionStatus?: string;
  minAmount?: number;
  maxAmount?: number;
  sort?: 'newest' | 'oldest' | 'amount' | 'amount_asc';
  page?: number;
  pageSize?: number;
  approvalsOnly?: boolean;
}

export interface CommercialDocumentsKpis {
  totalDocuments: number;
  customerOrdersCount: number;
  customerOrdersAmountXof: number;
  purchaseOrdersCount: number;
  purchaseOrdersAmountXof: number;
  receptionsCount: number;
  paymentReceiptsCount: number;
  unpaidOrPartialAmountXof: number;
}

export interface CommercialDocumentsPage {
  rows: CommercialDocument[];
  total: number;
  pendingCount: number;
  kpis?: CommercialDocumentsKpis;
  page: number;
  pageSize: number;
}

export interface CommercialDocumentSnapshotSummary {
  version: number;
  documentNumber: string;
  issuedAt: string;
  issuedByName: string;
  issuedByRole: string;
  revisionReason: string | null;
  snapshotJson: string;
}

export interface CommercialDocumentDetail {
  documentType: CommercialDocumentType;
  documentId: number;
  documentNumber: string;
  counterparty: string;
  status: string;
  amountXof: number;
  createdAt: string;
  phone?: string | null;
  orderReference?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  externalReference?: string | null;
  issuerName?: string | null;
  notes: string | null;
  lines: Array<{
    label: string;
    detail: string | null;
    quantityMilli: number;
    unit: string;
    unitPriceXof: number;
    amountXof: number;
  }>;
  packagingLines: Array<{
    label: string;
    kind: string;
    expectedQuantity: number;
    issuedQuantity: number | null;
    returnedQuantity: number | null;
    statusLabel: string;
    detail: string | null;
    amount: number | null;
  }>;
  payments: Array<{ label: string; amountXof: number }>;
  snapshots?: CommercialDocumentSnapshotSummary[];
}

export interface CommercialApprovalEvent {
  id: number;
  documentType: 'customer_order' | 'purchase_order';
  documentId: number;
  action: 'submitted' | 'approved' | 'rejected' | 'changes_requested';
  actorUserId: number | null;
  actorRole: string | null;
  reason: string | null;
  snapshotJson: string;
  createdAt: string;
}
