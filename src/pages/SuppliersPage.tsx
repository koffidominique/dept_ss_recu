import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { SearchInput } from '../components/forms/SearchInput.tsx';
import { ErrorState, LoadingState } from '../components/common/States.tsx';
import { isPastDueDate } from '../features/dashboard/utils/workQueue.ts';
import { formatFcfa } from '../utils/format.ts';
import type { Supplier, SupplierDebt } from '../types/erp.ts';
import {
  useSuppliersMutations,
  useSuppliersQueries,
} from '../features/purchases/hooks/useSuppliersData.ts';
import {
  SupplierDebtsTable,
  SuppliersTable,
} from '../features/purchases/components/SuppliersTables.tsx';
import {
  SupplierCreateModal,
  SupplierEditModal,
} from '../features/purchases/components/SupplierFormModals.tsx';
import {
  SupplierDebtPayModal,
  SupplierDetailModal,
} from '../features/purchases/components/SupplierDebtAndDetailModals.tsx';

export function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Supplier | null>(null);
  const [detailTarget, setDetailTarget] = useState<Supplier | null>(null);
  const [payDebtTarget, setPayDebtTarget] = useState<SupplierDebt | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // `?dettes=en_retard` : lien direct depuis la file de travail du tableau de bord.
  const [searchParams, setSearchParams] = useSearchParams();
  const onlyOverdue = searchParams.get('dettes') === 'en_retard';
  const setOnlyOverdue = (next: boolean) => {
    setSearchParams(next ? { dettes: 'en_retard' } : {}, { replace: true });
  };

  const { suppliersQuery, debtsQuery, purchasesQuery, activeMethods } = useSuppliersQueries(
    search,
    Boolean(detailTarget)
  );

  const { createMutation, updateSupplierMutation, payMutation } = useSuppliersMutations({
    onCreated: () => {
      setCreateOpen(false);
      setErrorMsg(null);
    },
    onUpdated: (updated) => {
      if (detailTarget && detailTarget.id === updated.id) {
        setDetailTarget(updated);
      }
      setEditTarget(null);
      setErrorMsg(null);
    },
    onDebtPaid: () => {
      setPayDebtTarget(null);
      setErrorMsg(null);
    },
    onError: (msg) => setErrorMsg(msg),
  });

  const { data: suppliers, isLoading, error, refetch } = suppliersQuery;

  const now = new Date();
  const allDebts = debtsQuery.data || [];
  const openDebts = allDebts.filter((d) => d.remaining_amount > 0 && d.status !== 'paid');
  const overdueDebts = openDebts.filter((d) => isPastDueDate(d.due_date, now));
  const visibleDebts = onlyOverdue ? overdueDebts : allDebts;
  const overdueTotal = overdueDebts.reduce((sum, d) => sum + d.remaining_amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Rechercher un fournisseur..."
          ariaLabel="Rechercher un fournisseur"
          className="w-72"
        />
        <button
          type="button"
          onClick={() => {
            setErrorMsg(null);
            setCreateOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nouveau fournisseur
        </button>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error || !suppliers ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Erreur chargement fournisseurs.'}
          onRetry={() => refetch()}
        />
      ) : (
        <SuppliersTable
          suppliers={suppliers}
          onEdit={(s) => {
            setErrorMsg(null);
            setEditTarget(s);
          }}
          onDetail={(s) => setDetailTarget(s)}
        />
      )}

      <div className="space-y-3" id="dettes-fournisseurs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-sm font-semibold text-[#182230] dark:text-slate-100">
            Dettes fournisseurs issues des réceptions
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={onlyOverdue}
              onClick={() => setOnlyOverdue(!onlyOverdue)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                onlyOverdue
                  ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-[#BE123C] dark:text-rose-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] text-[#667085] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Échéance dépassée ({overdueDebts.length})
            </button>
            {onlyOverdue && (
              <span className="font-mono-num text-xs font-semibold text-[#BE123C] dark:text-rose-300">
                {formatFcfa(overdueTotal)}
              </span>
            )}
          </div>
        </div>
        <SupplierDebtsTable
          debts={visibleDebts}
          emptyMessage={
            onlyOverdue
              ? 'Aucune dette fournisseur échue : toutes les échéances sont respectées.'
              : 'Aucune dette fournisseur enregistrée.'
          }
          onPayDebt={(debt) => {
            setErrorMsg(null);
            setPayDebtTarget(debt);
          }}
        />
      </div>

      <SupplierCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        errorMsg={errorMsg}
        isPending={createMutation.isPending}
        onSubmit={(values) => createMutation.mutate(values)}
      />

      <SupplierEditModal
        supplier={editTarget}
        onClose={() => setEditTarget(null)}
        errorMsg={errorMsg}
        isPending={updateSupplierMutation.isPending}
        onSubmit={(id, values) => updateSupplierMutation.mutate({ id, values })}
      />

      <SupplierDebtPayModal
        debt={payDebtTarget}
        activeMethods={activeMethods}
        errorMsg={errorMsg}
        isPending={payMutation.isPending}
        onClose={() => setPayDebtTarget(null)}
        onConfirm={(args) => payMutation.mutate(args)}
      />

      <SupplierDetailModal
        supplier={detailTarget}
        purchases={purchasesQuery.data || []}
        debts={debtsQuery.data || []}
        onClose={() => setDetailTarget(null)}
        onEdit={(s) => {
          setErrorMsg(null);
          setEditTarget(s);
        }}
      />
    </div>
  );
}
