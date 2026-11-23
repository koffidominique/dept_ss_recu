import type { PrintableDocumentData } from '../../../components/documents/DocumentPrintModal.tsx';
import { formatFcfa } from '../../../utils/format.ts';
import type { DepositReturnRow } from '../types.ts';

/* ============================================================================
 * Constructeurs de reçus imprimables : retours d'emballages & créances 15j
 * ============================================================================ */

export function buildReturnPrintDocument(row: DepositReturnRow): PrintableDocumentData {
  return {
    docType: 'REÇU RETOUR EMBALLAGES',
    reference: row.reference,
    date: row.created_at,
    partyTitle: 'Client',
    partyName: row.client_name || 'Client Comptoir',
    lines: [
      {
        label: row.packaging_name,
        sublabel: `État : ${
          row.condition_state === 'good'
            ? 'Bon état (réintégré)'
            : 'Endommagé / Cassé'
        }`,
        quantity: `${row.pieces} pcs`,
        unitPrice: null,
        total: row.refund_amount + row.credit_reduction,
      },
    ],
    summaryRows: [
      { label: 'Remboursement client', value: formatFcfa(row.refund_amount) },
      { label: 'Déduction créance', value: formatFcfa(row.credit_reduction) },
      {
        label: 'Total régularisé',
        value: formatFcfa(row.refund_amount + row.credit_reduction),
        bold: true,
      },
    ],
    payments:
      row.refund_amount > 0
        ? [{ label: row.method_label, amount: row.refund_amount }]
        : undefined,
    notes: row.reason,
  };
}

export interface PackagingDebtPaymentReceiptInput {
  reference: string;
  paidAt: string;
  clientName: string;
  methodLabel: string;
  amountPaid: number;
  previousBalance: number;
  remainingBalance: number;
  note?: string;
}

export function buildPackagingDebtPaymentReceiptDoc(
  input: PackagingDebtPaymentReceiptInput,
): PrintableDocumentData {
  return {
    docType: 'REÇU DE PAIEMENT',
    reference: input.reference,
    date: input.paidAt,
    statusLabel: input.remainingBalance <= 0 ? 'CRÉANCE SOLDÉE' : 'RÈGLEMENT PARTIEL',
    partyTitle: 'Client',
    partyName: input.clientName,
    lines: [
      {
        label: "Règlement de créance financière d'emballages (> 15 jours / perte)",
        sublabel: `Moyen de règlement : ${input.methodLabel}`,
        quantity: '1',
        unitPrice: input.amountPaid,
        total: input.amountPaid,
      },
    ],
    payments: [{ label: input.methodLabel, amount: input.amountPaid }],
    summaryRows: [
      {
        label: 'Créance emballages avant règlement',
        value: formatFcfa(input.previousBalance),
      },
      {
        label: 'Montant encaissé',
        value: formatFcfa(input.amountPaid),
        bold: true,
        tone: 'success',
      },
      {
        label: "Reste dû (créance d'emballages)",
        value: formatFcfa(input.remainingBalance),
        bold: true,
        tone: input.remainingBalance > 0 ? 'warning' : 'success',
      },
    ],
    notes:
      [
        "Registre des créances financières d'emballages (distinct du compte commercial marchandises).",
        input.note?.trim() ? `Note : ${input.note.trim()}` : null,
      ]
        .filter(Boolean)
        .join('\n') || null,
  };
}

export interface PackagingLateReturnReceiptInput {
  reference: string;
  returnedAt: string;
  clientName: string;
  saleReference: string;
  pieces: number;
  unitValue: number;
  creditedAmount: number;
}

export function buildPackagingLateReturnReceiptDoc(
  input: PackagingLateReturnReceiptInput,
): PrintableDocumentData {
  return {
    docType: 'REÇU RETOUR EMBALLAGES',
    reference: input.reference,
    linkedDocumentRef: input.saleReference,
    date: input.returnedAt,
    statusLabel: input.creditedAmount > 0 ? 'RETOUR TARDIF CRÉDITÉ' : 'RESTITUTION PHYSIQUE',
    partyTitle: 'Client',
    partyName: input.clientName,
    lines: [
      {
        label: `Restitution d'emballages vides sur vente ${input.saleReference}`,
        sublabel: 'Réintégration physique au stock du sous-dépôt',
        quantity: `${input.pieces} pcs`,
        unitPrice: input.unitValue,
        total: input.creditedAmount,
      },
    ],
    summaryRows: [
      { label: 'Pièces réintégrées au sous-dépôt', value: `${input.pieces} pcs` },
      {
        label: "Contre-écriture créditée sur créance d'emballages",
        value: formatFcfa(input.creditedAmount),
        bold: true,
        tone: input.creditedAmount > 0 ? 'success' : 'default',
      },
    ],
    notes:
      input.creditedAmount > 0
        ? "Retour tardif après échéance de 15 jours : contre-écriture automatique créditée sur le grand livre financier d'emballages du client."
        : "Restitution physique enregistrée dans le délai : aucune dette financière d'emballages générée.",
  };
}
