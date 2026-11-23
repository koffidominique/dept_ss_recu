import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  Download,
  Printer,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import {
  DocumentPrintModal,
  type PrintableDocumentData,
} from '../../../components/documents/DocumentPrintModal.tsx';
import { DataTable } from '../../../components/tables/DataTable.tsx';
import { exportPackagingObligationsCsv } from '../../../utils/csvInventoryExports.ts';
import { formatDateTime, formatFcfa, formatNumber } from '../../../utils/format.ts';
import { apiClient } from '../../../services/api/createApiClient.ts';
import {
  buildPackagingDebtPaymentReceiptDoc,
  buildPackagingLateReturnReceiptDoc,
} from './consignmentPrintHelpers.ts';

interface PackagingObligation {
  id: number;
  sale_id: number;
  sale_reference: string | null;
  client_id: number | null;
  returnable_id: number;
  pieces: number;
  returned_pieces: number;
  lost_pieces?: number;
  destroyed_pieces?: number;
  converted_pieces?: number;
  pending_pieces: number;
  unit_value: number;
  total_reference_value: number;
  due_date: string | null;
  overdue: boolean;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente (≤ 15 j)',
  partially_returned: 'Retour partiel',
  settled: 'Soldée',
  converted: 'Convertie en créance',
  cancelled: 'Annulée',
};

function createPaymentRequestKey(clientId: number): string {
  const uid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}`;
  return `pkg-pay-${clientId}-${uid}`;
}

export function PackagingFinancialPanel() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [processingDue, setProcessingDue] = useState(false);

  const [lateReturnTarget, setLateReturnTarget] = useState<PackagingObligation | null>(null);
  const [lateReturnPieces, setLateReturnPieces] = useState(1);
  const [submittingLateReturn, setSubmittingLateReturn] = useState(false);

  const [lossTarget, setLossTarget] = useState<PackagingObligation | null>(null);
  const [lossPieces, setLossPieces] = useState(1);
  const [lossReason, setLossReason] = useState('');
  const [submittingLoss, setSubmittingLoss] = useState(false);
  const [validatingLossId, setValidatingLossId] = useState<number | null>(null);
  const [lastReceiptDoc, setLastReceiptDoc] = useState<PrintableDocumentData | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);

  const obligationsQuery = useQuery({
    queryKey: ['packaging-obligations', clientId],
    queryFn: () => apiClient.listPackagingObligations(clientId ?? undefined),
  });

  const lossesQuery = useQuery({
    queryKey: ['packaging-losses', clientId],
    queryFn: () => apiClient.listPackagingLossDeclarations(clientId ?? undefined),
  });

  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const res = await apiClient.listClients();
      return (res ?? []) as Array<{ id: number; name: string }>;
    },
    staleTime: 60_000,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.getSettings(),
    staleTime: 60_000,
  });

  const dashboardQuery = useQuery({
    queryKey: ['packaging-dashboard', clientId],
    queryFn: () => apiClient.getPackagingDashboard(clientId as number),
    enabled: clientId != null,
  });

  const activeMethods = (settingsQuery.data?.paymentMethods ?? []).filter(
    (m) => m.active === 1
  );
  const obligations = obligationsQuery.data ?? [];
  const losses = lossesQuery.data ?? [];
  const dashboard = clientId != null ? dashboardQuery.data : undefined;

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['packaging-obligations'] }),
      queryClient.invalidateQueries({ queryKey: ['packaging-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['packaging-losses'] }),
      queryClient.invalidateQueries({ queryKey: ['consignments'] }),
      queryClient.invalidateQueries({ queryKey: ['client-packaging-balances'] }),
      queryClient.invalidateQueries({ queryKey: ['packaging-assets'] }),
      queryClient.invalidateQueries({ queryKey: ['customer-deposits'] }),
      queryClient.invalidateQueries({ queryKey: ['customer-deposit-history'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['cash'] }),
      queryClient.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  }

  async function handleProcessDue() {
    setProcessingDue(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setLastReceiptDoc(null);
    try {
      const res = await apiClient.processDuePackagingObligations();
      if (res.conversions > 0) {
        setInfoMsg(
          `${res.conversions} obligation(s) échue(s) (> 15 jours) convertie(s) pour un total de ${formatFcfa(res.total_amount)}.`
        );
      } else {
        setInfoMsg('Aucune nouvelle obligation échue (> 15 jours) à convertir.');
      }
      await refreshAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erreur lors du traitement des échéances.');
    } finally {
      setProcessingDue(false);
    }
  }

  async function handlePay() {
    if (clientId == null || !payAmount) return;
    const amount = Math.trunc(Number(payAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMsg('Saisissez un montant strictement positif.');
      return;
    }
    setPaying(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setLastReceiptDoc(null);
    try {
      const method =
        activeMethods.some((m) => m.code === payMethod)
          ? payMethod
          : activeMethods[0]?.code || 'cash';
      const methodLabel =
        activeMethods.find((m) => m.code === method)?.label ||
        (method === 'cash' ? 'Espèces' : method);
      const prevDebt = dashboard?.packaging_financial_debt ?? amount;
      const noteValue = payNote.trim() || undefined;
      const reqKey = createPaymentRequestKey(clientId);
      const res = await apiClient.payPackagingDebt({
        client_id: clientId,
        parts: [{ method_code: method, amount }],
        request_key: reqKey,
        note: noteValue,
      });
      const selectedClientName =
        clientsQuery.data?.find((c) => c.id === clientId)?.name || `Client #${clientId}`;
      const receiptDoc = buildPackagingDebtPaymentReceiptDoc({
        reference: `REG-EMB-${reqKey.slice(-8).toUpperCase()}`,
        paidAt: new Date().toISOString(),
        clientName: selectedClientName,
        methodLabel,
        amountPaid: amount,
        previousBalance: prevDebt,
        remainingBalance: res.packaging_financial_balance,
        note: noteValue,
      });
      setLastReceiptDoc(receiptDoc);
      setPayAmount('');
      setPayNote('');
      setInfoMsg(
        `Règlement enregistré (${formatFcfa(amount)}). Solde créance d'emballages restant : ${formatFcfa(res.packaging_financial_balance)}.`
      );
      await refreshAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erreur lors du règlement.');
    } finally {
      setPaying(false);
    }
  }

  async function handleLateReturnSubmit() {
    if (!lateReturnTarget) return;
    setSubmittingLateReturn(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setLastReceiptDoc(null);
    try {
      const targetSnapshot = lateReturnTarget;
      const piecesSnapshot = lateReturnPieces;
      const res = await apiClient.registerPackagingLateReturn(
        targetSnapshot.id,
        piecesSnapshot
      );
      const targetClientName =
        (targetSnapshot.client_id != null
          ? clientsQuery.data?.find((c) => c.id === targetSnapshot.client_id)?.name
          : undefined) || 'Client Comptoir';
      const receiptDoc = buildPackagingLateReturnReceiptDoc({
        reference: `RTD-EMB-${targetSnapshot.id}-${Date.now().toString().slice(-5)}`,
        returnedAt: new Date().toISOString(),
        clientName: targetClientName,
        saleReference: targetSnapshot.sale_reference ?? `#${targetSnapshot.sale_id}`,
        pieces: piecesSnapshot,
        unitValue: targetSnapshot.unit_value,
        creditedAmount: res.credited_amount,
      });
      setLastReceiptDoc(receiptDoc);
      setLateReturnTarget(null);
      setInfoMsg(
        res.credited_amount > 0
          ? `Retour tardif enregistré (${piecesSnapshot} pcs) : stock sous-dépôt réintégré et contre-écriture de ${formatFcfa(res.credited_amount)} créditée.`
          : `Restitution enregistrée (${piecesSnapshot} pcs) : stock sous-dépôt réintégré sans dette financière.`
      );
      await refreshAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erreur lors de la restitution.');
    } finally {
      setSubmittingLateReturn(false);
    }
  }

  async function handleDeclareLossSubmit() {
    if (!lossTarget) return;
    if (!lossReason.trim()) {
      setErrorMsg('Veuillez saisir le motif de la perte ou casse.');
      return;
    }
    setSubmittingLoss(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await apiClient.declarePackagingLoss({
        deposit_issue_id: lossTarget.id,
        pieces: lossPieces,
        reason: lossReason.trim(),
      });
      setLossTarget(null);
      setLossReason('');
      setInfoMsg(
        `Déclaration de perte enregistrée (${lossPieces} pcs). Validez-la ci-dessous pour générer la créance au tarif consigne.`
      );
      await refreshAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erreur lors de la déclaration de perte.');
    } finally {
      setSubmittingLoss(false);
    }
  }

  async function handleValidateLoss(declarationId: number) {
    setValidatingLossId(declarationId);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await apiClient.validatePackagingLoss(declarationId);
      setInfoMsg(
        `Perte validée : créance financière de ${formatFcfa(res.converted_amount)} imputée au client.`
      );
      await refreshAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erreur lors de la validation de la perte.');
    } finally {
      setValidatingLossId(null);
    }
  }

  const columns = [
    {
      header: 'Vente',
      accessorKey: 'sale_reference',
      cell: ({ row }: { row: { original: PackagingObligation } }) => (
        <span className="font-mono-num font-semibold">
          {row.original.sale_reference ?? `#${row.original.sale_id}`}
        </span>
      ),
    },
    {
      header: 'Sorties / Rendues',
      accessorKey: 'pieces',
      cell: ({ row }: { row: { original: PackagingObligation } }) =>
        `${formatNumber(row.original.returned_pieces)} / ${formatNumber(row.original.pieces)} pcs`,
    },
    {
      header: 'Reste physique',
      accessorKey: 'pending_pieces',
      cell: ({ row }: { row: { original: PackagingObligation } }) =>
        `${formatNumber(row.original.pending_pieces)} pcs`,
    },
    {
      header: 'Valeur consigne',
      accessorKey: 'total_reference_value',
      cell: ({ row }: { row: { original: PackagingObligation } }) =>
        formatFcfa(row.original.total_reference_value),
    },
    {
      header: 'Converti (> 15 j / perte)',
      accessorKey: 'converted_pieces',
      cell: ({ row }: { row: { original: PackagingObligation } }) =>
        (row.original.converted_pieces ?? 0) > 0
          ? `${formatNumber(row.original.converted_pieces ?? 0)} pcs`
          : '—',
    },
    {
      header: 'Échéance (15 j)',
      accessorKey: 'due_date',
      cell: ({ row }: { row: { original: PackagingObligation } }) => (
        <span className="font-mono-num">{row.original.due_date ?? '—'}</span>
      ),
    },
    {
      header: 'Statut',
      accessorKey: 'status',
      cell: ({ row }: { row: { original: PackagingObligation } }) => (
        <span
          className={
            row.original.overdue
              ? 'rounded px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300'
              : row.original.status === 'converted'
                ? 'rounded px-2 py-0.5 text-xs font-semibold bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                : 'rounded px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }
        >
          {row.original.overdue
            ? 'Échu (> 15 j)'
            : (STATUS_LABELS[row.original.status] ?? row.original.status)}
        </span>
      ),
    },
    {
      header: 'Actions',
      accessorKey: 'id',
      cell: ({ row }: { row: { original: PackagingObligation } }) => {
        const o = row.original;
        const maxLateReturn = Math.max(
          0,
          o.pieces - o.returned_pieces - (o.lost_pieces ?? 0) - (o.destroyed_pieces ?? 0)
        );
        const canDeclareLoss =
          o.pending_pieces > 0 &&
          !['settled', 'returned', 'cancelled', 'converted'].includes(o.status);

        if (maxLateReturn <= 0 && !canDeclareLoss) {
          return <span className="text-xs text-[#667085]">—</span>;
        }

        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {maxLateReturn > 0 && o.status !== 'cancelled' && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setLossTarget(null);
                  setLateReturnTarget(o);
                  setLateReturnPieces(maxLateReturn);
                }}
                className="inline-flex items-center gap-1 rounded border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
              >
                <RotateCcw className="h-3 w-3" />
                {(o.converted_pieces ?? 0) > 0 ? 'Retour tardif' : 'Restituer'}
              </button>
            )}
            {canDeclareLoss && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setLateReturnTarget(null);
                  setLossTarget(o);
                  setLossPieces(o.pending_pieces);
                  setLossReason('');
                }}
                className="inline-flex items-center gap-1 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                <AlertTriangle className="h-3 w-3" />
                Perte
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 px-4 py-3 text-xs">
        <div className="flex items-center gap-2 text-[#182230] dark:text-slate-200">
          <Clock className="h-4 w-4 text-[#1D4ED8] dark:text-blue-400 shrink-0" />
          <span>
            <strong>Règle des 15 jours :</strong> tout emballage non restitué sous 15 jours max est
            converti en créance financière au tarif consigne. Un retour tardif génère une
            contre-écriture automatique et réintègre le stock du sous-dépôt.
          </span>
        </div>
        <button
          type="button"
          disabled={processingDue}
          onClick={handleProcessDue}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${processingDue ? 'animate-spin' : ''}`} />
          {processingDue ? 'Traitement…' : 'Traiter les échéances (> 15 j)'}
        </button>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {errorMsg}
        </div>
      )}

      {infoMsg && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{infoMsg}</span>
          </div>
          {lastReceiptDoc && (
            <button
              type="button"
              onClick={() => setPrintDoc(lastReceiptDoc)}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/60 dark:hover:bg-slate-800"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimer le reçu
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-[#667085] dark:text-slate-300">Client :</label>
          <select
            value={clientId ?? ''}
            onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-3 py-2 text-xs"
          >
            <option value="">Tous les clients</option>
            {clientsQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {obligations.length > 0 && (
          <button
            type="button"
            onClick={() =>
              exportPackagingObligationsCsv(
                obligations.map((o) => ({
                  ...o,
                  client_name:
                    o.client_id != null
                      ? clientsQuery.data?.find((c) => c.id === o.client_id)?.name
                      : undefined,
                }))
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter CSV (15 j)
          </button>
        )}
      </div>

      {dashboard && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-3">
            <p className="text-xs text-[#667085] dark:text-slate-400">Dette commerciale</p>
            <p className="text-lg font-bold font-mono-num">{formatFcfa(dashboard.commercial_debt)}</p>
          </div>
          <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/25 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Emballages en attente ({formatNumber(dashboard.pending_pieces)} pcs)
            </p>
            <p className="text-lg font-bold font-mono-num text-amber-800 dark:text-amber-200">
              {formatFcfa(dashboard.pending_reference_value)}
            </p>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400">
              Indicatif · Non exigible avant 15 jours
            </p>
          </div>
          <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/25 p-3">
            <p className="text-xs text-red-700 dark:text-red-300">Créance d&apos;emballages exigible</p>
            <p className="text-lg font-bold font-mono-num text-red-800 dark:text-red-200">
              {formatFcfa(dashboard.packaging_financial_debt)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-3">
            <p className="text-xs text-[#667085] dark:text-slate-400">Total financièrement dû</p>
            <p className="text-lg font-bold font-mono-num">
              {formatFcfa(dashboard.total_financial_due)}
            </p>
          </div>
        </div>
      )}

      {dashboard && dashboard.packaging_financial_debt > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-3">
          <Banknote className="h-4 w-4 text-emerald-600 shrink-0" />
          <input
            type="number"
            min="1"
            max={dashboard.packaging_financial_debt}
            placeholder={`Max ${formatFcfa(dashboard.packaging_financial_debt)}`}
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            className="w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono-num"
          />
          <button
            type="button"
            onClick={() => setPayAmount(String(dashboard.packaging_financial_debt))}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Tout solder
          </button>
          <select
            value={payMethod}
            onChange={(e) => setPayMethod(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          >
            {activeMethods.length > 0 ? (
              activeMethods.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))
            ) : (
              <option value="cash">Espèces</option>
            )}
          </select>
          <input
            type="text"
            placeholder="Note (optionnel)"
            value={payNote}
            onChange={(e) => setPayNote(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          />
          <button
            type="button"
            disabled={paying}
            onClick={handlePay}
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {paying ? '…' : 'Enregistrer le règlement'}
          </button>
        </div>
      )}

      {lateReturnTarget && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/25 p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-emerald-900 dark:text-emerald-200">
              Restitution / Retour tardif — Vente{' '}
              {lateReturnTarget.sale_reference ?? `#${lateReturnTarget.sale_id}`} (tarif consigne :{' '}
              {formatFcfa(lateReturnTarget.unit_value)}/pc)
            </div>
            <button
              type="button"
              onClick={() => setLateReturnTarget(null)}
              className="text-[#667085] hover:text-[#182230] dark:hover:text-white"
            >
              Fermer
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="font-medium">Pièces rendues au sous-dépôt :</label>
            <input
              type="number"
              min={1}
              max={Math.max(
                1,
                lateReturnTarget.pieces -
                  lateReturnTarget.returned_pieces -
                  (lateReturnTarget.lost_pieces ?? 0) -
                  (lateReturnTarget.destroyed_pieces ?? 0)
              )}
              value={lateReturnPieces}
              onChange={(e) =>
                setLateReturnPieces(
                  Math.max(
                    1,
                    Math.min(
                      lateReturnTarget.pieces -
                        lateReturnTarget.returned_pieces -
                        (lateReturnTarget.lost_pieces ?? 0) -
                        (lateReturnTarget.destroyed_pieces ?? 0),
                      Math.trunc(Number(e.target.value) || 1)
                    )
                  )
                )
              }
              className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-mono-num"
            />
            <button
              type="button"
              disabled={submittingLateReturn}
              onClick={handleLateReturnSubmit}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submittingLateReturn ? 'Validation…' : 'Confirmer l’entrée stock sous-dépôt'}
            </button>
          </div>
        </div>
      )}

      {lossTarget && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/25 p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              Déclarer une perte / casse — Vente{' '}
              {lossTarget.sale_reference ?? `#${lossTarget.sale_id}`} (max{' '}
              {lossTarget.pending_pieces} pcs)
            </div>
            <button
              type="button"
              onClick={() => setLossTarget(null)}
              className="text-[#667085] hover:text-[#182230] dark:hover:text-white"
            >
              Fermer
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="number"
              min={1}
              max={lossTarget.pending_pieces}
              value={lossPieces}
              onChange={(e) =>
                setLossPieces(
                  Math.max(
                    1,
                    Math.min(lossTarget.pending_pieces, Math.trunc(Number(e.target.value) || 1))
                  )
                )
              }
              className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-mono-num"
            />
            <input
              type="text"
              placeholder="Motif obligatoire (ex. casse transport, perte client)..."
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value)}
              className="flex-1 min-w-[220px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
            />
            <button
              type="button"
              disabled={submittingLoss}
              onClick={handleDeclareLossSubmit}
              className="rounded-lg bg-amber-600 px-3.5 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {submittingLoss ? 'Envoi…' : 'Enregistrer la déclaration'}
            </button>
          </div>
        </div>
      )}

      <DataTable
        data={obligations}
        columns={columns}
        emptyMessage="Aucune obligation d'emballages enregistrée."
      />

      {losses.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-4 space-y-3">
          <h4 className="font-display text-sm font-semibold">
            Déclarations de perte / casse ({losses.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[#667085]">
                  <th className="py-2">Réf.</th>
                  <th className="py-2">Client / Vente</th>
                  <th className="py-2">Emballage</th>
                  <th className="py-2 text-right">Qté</th>
                  <th className="py-2 text-right">Montant consigne</th>
                  <th className="py-2">Motif</th>
                  <th className="py-2">Statut</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {losses.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 font-mono-num">{l.request_key}</td>
                    <td className="py-2">
                      <div>{l.client_name || 'Comptoir'}</div>
                      <div className="text-[11px] text-[#667085]">
                        {l.sale_reference || `#${l.deposit_issue_id}`} ·{' '}
                        {formatDateTime(l.created_at)}
                      </div>
                    </td>
                    <td className="py-2">{l.packaging_name}</td>
                    <td className="py-2 text-right font-mono-num">{l.pieces} pcs</td>
                    <td className="py-2 text-right font-mono-num font-semibold">
                      {formatFcfa(l.estimated_amount)}
                    </td>
                    <td className="py-2 text-[#667085] dark:text-slate-300">{l.reason}</td>
                    <td className="py-2">
                      <span
                        className={
                          l.status === 'validated'
                            ? 'rounded px-2 py-0.5 text-[11px] font-medium bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            : 'rounded px-2 py-0.5 text-[11px] font-medium bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                        }
                      >
                        {l.status === 'validated' ? 'Convertie en créance' : 'À valider'}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {l.status === 'declared' ? (
                        <button
                          type="button"
                          disabled={validatingLossId === l.id}
                          onClick={() => handleValidateLoss(l.id)}
                          className="rounded-lg bg-[#1D4ED8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                        >
                          {validatingLossId === l.id ? '…' : 'Valider en créance'}
                        </button>
                      ) : (
                        <span className="text-[#667085]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DocumentPrintModal doc={printDoc} onClose={() => setPrintDoc(null)} />
    </div>
  );
}
