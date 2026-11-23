import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';
import { DataTable } from '../../../components/tables/DataTable.tsx';
import type { CashStatus } from '../../../types/erp.ts';
import { exportCashMovementsCsv, formatCashMovementKind } from '../../../utils/csv.ts';
import { formatDateTime, formatFcfa } from '../../../utils/format.ts';

type CashMovementRow = NonNullable<CashStatus['summary']>['movements'][number];

interface CashMovementsTableProps {
  sessionReference: string;
  movements: CashMovementRow[];
}

export function CashMovementsTable({ sessionReference, movements }: CashMovementsTableProps) {
  const columns = useMemo<ColumnDef<CashMovementRow>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Heure',
        cell: ({ row }) => (
          <span className="font-mono-num text-xs">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      {
        accessorKey: 'kind',
        header: 'Nature',
        cell: ({ row }) => {
          const isPkgPay = row.original.reference_document?.startsWith('pkg-debt-pay:');
          return (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isPkgPay
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                  : row.original.direction === 'in'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {formatCashMovementKind(row.original.kind, row.original.reference_document)}
            </span>
          );
        },
      },
      { accessorKey: 'description', header: 'Opération' },
      {
        accessorKey: 'method_label',
        header: 'Moyen',
        cell: ({ row }) => (
          <span className="text-xs font-medium">
            {row.original.method_label}{' '}
            {row.original.is_cash === 1 ? '(Espèces)' : '(Digital)'}
          </span>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Montant',
        cell: ({ row }) => (
          <span
            className={`font-mono-num font-semibold ${
              row.original.direction === 'in' ? 'text-[#16A36A]' : 'text-[#BE123C]'
            }`}
          >
            {row.original.direction === 'in' ? '+' : '-'}
            {formatFcfa(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: 'reference_document',
        header: 'Document',
        cell: ({ row }) => (
          <span className="font-mono-num text-xs text-[#667085] dark:text-[#94A3B8]">
            {row.original.reference_document || '—'}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold">Mouvements de la session en cours</h3>
        <button
          type="button"
          disabled={movements.length === 0}
          onClick={() => exportCashMovementsCsv(sessionReference, movements)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
        >
          <Download className="h-3.5 w-3.5" />
          CSV Mouvements
        </button>
      </div>
      <DataTable
        data={movements}
        columns={columns as ColumnDef<CashMovementRow, unknown>[]}
        emptyMessage="Aucun mouvement enregistré sur cette session."
      />
    </div>
  );
}
