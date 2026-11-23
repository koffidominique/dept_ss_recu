import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, Package, Printer } from 'lucide-react';
import {
  DocumentPrintModal,
  type PrintableDocumentData,
} from '../components/documents/DocumentPrintModal.tsx';
import { ErrorState, LoadingState } from '../components/common/States.tsx';
import { OfflineWorkBanner } from '../features/dashboard/components/WorkQueuePanel.tsx';
import { useConnectionState } from '../features/dashboard/hooks/useConnectionState.ts';
import type { Receivable } from '../types/erp.ts';
import { exportReceivablesCsv } from '../utils/csv.ts';
import { formatDate, formatFcfa } from '../utils/format.ts';
import {
  useDebtsQueries,
  usePayReceivableMutation,
} from '../features/clients/hooks/useDebtsData.ts';
import { DebtsTable } from '../features/clients/components/DebtsTable.tsx';
import { SearchInput } from '../components/forms/SearchInput.tsx';
import {
  filterReceivables,
  type ReceivableListFilter,
} from '../features/dashboard/utils/workQueue.ts';
import {
  DebtHistoryModal,
  DebtPayModal,
} from '../features/clients/components/DebtModals.tsx';

export function DebtsPage() {
  const [target, setTarget] = useState<Receivable | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Receivable | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const { isOnline, offlineSince, serverState } = useConnectionState();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtres conservés dans l'URL : le lien « Relancer et encaisser » de la file
  // de travail ouvre directement la liste filtrée sur les échéances dépassées.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatut = searchParams.get('statut');
  const statut: ReceivableListFilter['statut'] =
    rawStatut === 'en_retard' || rawStatut === 'ouvertes' ? rawStatut : 'tous';
  const search = searchParams.get('q') ?? '';

  const updateListFilter = (next: { statut?: ReceivableListFilter['statut']; q?: string }) => {
    const params: Record<string, string> = {};
    const nextStatut = next.statut ?? statut;
    const nextSearch = next.q ?? search;
    if (nextStatut !== 'tous') params.statut = nextStatut;
    if (nextSearch.trim()) params.q = nextSearch;
    setSearchParams(params, { replace: true });
  };

  const { receivablesQuery, historySaleQuery, activeMethods } = useDebtsQueries(
    historyTarget?.sale_id ?? null
  );

  const payMutation = usePayReceivableMutation({
    onSuccess: () => {
      setTarget(null);
      setErrorMsg(null);
    },
    onError: (msg) => setErrorMsg(msg),
  });

  const { data, isLoading, error, refetch } = receivablesQuery;
  const totalOpen = (data || []).reduce((acc, r) => acc + r.remaining_amount, 0);
  const filteredRows = useMemo(
    () => filterReceivables(data || [], { statut, search }, new Date()),
    [data, statut, search]
  );
  const filteredTotal = filteredRows.reduce((acc, r) => acc + r.remaining_amount, 0);

  return (
    <div className="space-y-5">
      <OfflineWorkBanner
        isOnline={isOnline}
        offlineSince={offlineSince}
        serverState={serverState}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
          <Package className="h-4 w-4 text-[#8A5A0B] dark:text-[#FBBF24] shrink-0" />
          <span>
            Les <strong>créances financières d&apos;emballages</strong> (non restitués après 15 jours
            max ou pertes validées) sont suivies dans un registre comptable séparé.
          </span>
        </div>
        <Link
          to="/consignments?tab=financial"
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-[#111A2E] px-3 py-1.5 font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 shrink-0"
        >
          Voir les créances d&apos;emballages
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-[#667085] dark:text-slate-400">
            Total des créances clients en cours :{' '}
            <span className="font-mono-num font-bold text-[#8A5A0B] dark:text-[#FBBF24]">
              {formatFcfa(totalOpen)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!data || data.length === 0}
            onClick={() => exportReceivablesCsv(data || [])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter CSV
          </button>
          <button
            type="button"
            onClick={() => {
              const openRecs = (data || []).filter(
                (r) => r.remaining_amount > 0 && r.status !== 'cancelled'
              );
              const today = new Date().toISOString().slice(0, 10);
              const overdueCount = openRecs.filter(
                (r) => r.due_date && r.due_date < today
              ).length;
              setPrintDoc({
                docType: 'ÉTAT DES CRÉANCES CLIENTS',
                reference: `CRE-${today}`,
                date: new Date().toISOString(),
                statusLabel: `${openRecs.length} dossier(s) ouvert(s)`,
                lines: openRecs.map((r) => ({
                  label: r.client_name,
                  sublabel: `Facture ${r.sale_reference}${r.due_date ? ` · Échéance ${formatDate(r.due_date)}` : ''}`,
                  quantity: `Initial ${formatFcfa(r.initial_amount)}`,
                  unitPrice: null,
                  total: r.remaining_amount,
                })),
                summaryRows: [
                  { label: 'Dossiers ouverts', value: String(openRecs.length) },
                  {
                    label: 'Dossiers en retard',
                    value: String(overdueCount),
                    tone: overdueCount > 0 ? 'danger' : 'success',
                  },
                  {
                    label: 'Total restant à recouvrer',
                    value: formatFcfa(totalOpen),
                    bold: true,
                    tone: 'warning',
                  },
                ],
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimer état des créances
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={(q) => updateListFilter({ q })}
            placeholder="Client, code ou facture..."
            ariaLabel="Rechercher une créance par client, code ou facture"
            clearable
            className="w-60"
            inputClassName="py-1.5 text-xs"
          />
          <label className="sr-only" htmlFor="debts-status-filter">
            Filtrer les créances
          </label>
          <select
            id="debts-status-filter"
            value={statut}
            onChange={(e) =>
              updateListFilter({ statut: e.target.value as ReceivableListFilter['statut'] })
            }
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-2.5 py-1.5 text-xs text-[#182230] dark:text-slate-100"
          >
            <option value="tous">Toutes les créances</option>
            <option value="ouvertes">Encours ouvert</option>
            <option value="en_retard">Échéance dépassée</option>
          </select>
          {(statut !== 'tous' || search.trim()) && (
            <button
              type="button"
              onClick={() => updateListFilter({ statut: 'tous', q: '' })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-[#667085] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Réinitialiser
            </button>
          )}
        </div>
        <p className="text-xs text-[#667085] dark:text-slate-400">
          Vue filtrée :{' '}
          <span className="font-mono-num font-semibold text-[#182230] dark:text-slate-200">
            {filteredRows.length} dossier(s) · {formatFcfa(filteredTotal)}
          </span>
        </p>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error || !data ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Erreur chargement créances.'}
          onRetry={() => refetch()}
        />
      ) : filteredRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/10 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-[#182230] dark:text-slate-100">
            {statut === 'en_retard'
              ? 'Aucune créance en retard'
              : 'Aucune créance ne correspond aux filtres'}
          </p>
          <p className="mt-1 text-xs text-[#667085] dark:text-slate-400">
            {statut === 'en_retard'
              ? 'Toutes les échéances clients sont respectées à ce jour.'
              : 'Modifiez la recherche ou réinitialisez les filtres.'}
          </p>
        </div>
      ) : (
        <DebtsTable
          receivables={filteredRows}
          onViewHistory={(rec) => setHistoryTarget(rec)}
          onOpenPay={(rec) => {
            setErrorMsg(null);
            setTarget(rec);
          }}
        />
      )}

      <DebtPayModal
        receivable={target}
        activeMethods={activeMethods}
        errorMsg={errorMsg}
        isPending={payMutation.isPending}
        onClose={() => setTarget(null)}
        onSubmit={(args) => payMutation.mutate(args)}
      />

      <DebtHistoryModal
        receivable={historyTarget}
        historySale={historySaleQuery.data}
        onClose={() => setHistoryTarget(null)}
      />

      <DocumentPrintModal doc={printDoc} onClose={() => setPrintDoc(null)} />
    </div>
  );
}
