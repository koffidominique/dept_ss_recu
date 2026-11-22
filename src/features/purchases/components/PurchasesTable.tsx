import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Eye, PackageCheck, Pencil, Printer } from 'lucide-react';
import { DataTable } from '../../../components/tables/DataTable.tsx';
import { StatusBadge } from '../../../components/common/StatusBadge.tsx';
import type { PrintableDocumentData } from '../../../components/documents/DocumentPrintModal.tsx';
import { buildPurchaseOrderDoc } from '../../../pages/PurchasesPage.tsx';
import type { PurchaseOrder } from '../../../types/erp.ts';
import { formatDateTime, formatFcfa } from '../../../utils/format.ts';

interface PurchasesTableProps {
  orders: PurchaseOrder[];
  onInspect: (order: PurchaseOrder) => void;
  onCorrect: (order: PurchaseOrder) => void;
  onPrint: (doc: PrintableDocumentData) => void;
  onReceive: (order: PurchaseOrder) => void;
  onCancel: (order: PurchaseOrder) => void;
}

export function PurchasesTable({
  orders,
  onInspect,
  onCorrect,
  onPrint,
  onReceive,
  onCancel,
}: PurchasesTableProps) {
  const columns = useMemo<ColumnDef<PurchaseOrder>[]>(
    () => [
      {
        accessorKey: 'reference',
        header: 'Commande',
        cell: ({ row }) => (
          <div>
            <div className="font-mono-num text-xs font-semibold">{row.original.reference}</div>
            <div className="font-mono-num text-[11px] text-[#667085]">
              {formatDateTime(row.original.created_at)}
            </div>
          </div>
        ),
      },
      { accessorKey: 'supplier_name', header: 'Fournisseur' },
      {
        accessorKey: 'total_amount',
        header: 'Montant commandé',
        cell: ({ row }) => (
          <span className="font-mono-num">{formatFcfa(row.original.total_amount)}</span>
        ),
      },
      {
        accessorKey: 'received_amount',
        header: 'Montant réceptionné',
        cell: ({ row }) => (
          <span className="font-mono-num font-semibold text-[#16A36A]">
            {formatFcfa(row.original.received_amount)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Statut',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            {row.original.approval_status === 'changes_requested' && row.original.status === 'confirmed' && row.original.received_amount === 0 && row.original.receipts.length === 0 && (
              <button type="button" onClick={() => onCorrect(row.original)} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:text-amber-300 whitespace-nowrap shrink-0">
                <Pencil className="h-3.5 w-3.5" /> Corriger
              </button>
            )}
            <button
              type="button"
              onClick={() => onInspect(row.original)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Eye className="h-3.5 w-3.5" />
              Détails &amp; REC
            </button>
            <button
              type="button"
              onClick={() => onPrint(buildPurchaseOrderDoc(row.original))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Bon CMD
            </button>
            {row.original.status !== 'received' && row.original.status !== 'cancelled' && (
              <button
                type="button"
                onClick={() => onReceive(row.original)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <PackageCheck className="h-3.5 w-3.5" />
                Réceptionner
              </button>
            )}
            {row.original.status !== 'received' &&
              row.original.status !== 'partial' &&
              row.original.status !== 'cancelled' &&
              row.original.receipts.length === 0 && (
                <button
                  type="button"
                  onClick={() => onCancel(row.original)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-900/50 px-2.5 py-1.5 text-xs font-medium text-[#DC4545] hover:bg-rose-50 dark:hover:bg-rose-950/30 whitespace-nowrap shrink-0"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Annuler
                </button>
              )}
          </div>
        ),
      },
    ],
    [onInspect, onCorrect, onPrint, onReceive, onCancel]
  );

  return (
    <DataTable
      data={orders}
      columns={columns as ColumnDef<PurchaseOrder, unknown>[]}
      emptyMessage="Aucun bon de commande créé."
    />
  );
}
