import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../../../components/tables/DataTable.tsx';
import { ErrorState, LoadingState } from '../../../components/common/States.tsx';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type { CatalogueVerificationLog } from '../../../types/erp.ts';

interface VerificationLogsAdminPanelProps {
  entityType?: string;
  entityId?: number;
}

export function CatalogueVerificationLogsAdminPanel({ entityType, entityId }: VerificationLogsAdminPanelProps) {
  const [selectedEntityType, setSelectedEntityType] = useState<string>(entityType || 'packaging_profile');
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(entityId || null);

  const logsQuery = useQuery({
    queryKey: ['catalogue-verification-logs', selectedEntityType, selectedEntityId],
    queryFn: () => selectedEntityType && selectedEntityId
      ? apiClient.listCatalogueVerificationLogs(selectedEntityType, selectedEntityId)
      : Promise.resolve([]),
    enabled: !!selectedEntityType && !!selectedEntityId,
  });

  const logs = logsQuery.data ?? [];

  if (logsQuery.isLoading) return <LoadingState rows={6} />;
  if (logsQuery.error) {
    return (
      <ErrorState
        message={
          logsQuery.error instanceof Error
            ? logsQuery.error.message
            : 'Erreur chargement des journaux de vérification.'
        }
        onRetry={() => void logsQuery.refetch()}
      />
    );
  }

  const columns: ColumnDef<CatalogueVerificationLog>[] = [
    {
      accessorKey: 'created_at',
      header: 'Date',
      cell: ({ row }) => (
        <span className="font-mono-num text-xs text-[#667085] dark:text-slate-400">
          {new Date(row.original.created_at).toLocaleString('fr-FR')}
        </span>
      ),
    },
    {
      accessorKey: 'field_name',
      header: 'Champ modifié',
      cell: ({ row }) => (
        <span className="font-mono-num text-xs font-semibold text-[#182230] dark:text-slate-100">
          {row.original.field_name}
        </span>
      ),
    },
    {
      accessorKey: 'old_value',
      header: 'Ancienne valeur',
      cell: ({ row }) => (
        <span className="text-xs text-rose-600 dark:text-rose-400 font-mono-num">
          {row.original.old_value ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'new_value',
      header: 'Nouvelle valeur',
      cell: ({ row }) => (
        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono-num">
          {row.original.new_value ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'changed_by',
      header: 'Modifié par',
      cell: ({ row }) => (
        <span className="text-xs text-[#667085] dark:text-slate-400">
          {row.original.changed_by || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'change_reason',
      header: 'Motif',
      cell: ({ row }) => (
        <span className="text-xs text-[#667085] dark:text-slate-400 max-w-[200px] truncate block">
          {row.original.change_reason || '—'}
        </span>
      ),
    },
  ];

  const entityTypes = [
    { value: 'packaging_profile', label: 'Profil emballage' },
    { value: 'variant_packaging_option', label: 'Option conditionnement variante' },
    { value: 'crate_type', label: 'Type de casier' },
    { value: 'product_variant', label: 'Variante produit' },
    { value: 'packaging_type', label: 'Type conditionnement' },
    { value: 'compatibility_group', label: 'Groupe compatibilité' },
  ];

  if (!entityType || !entityId) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold">Journaux de vérification du catalogue</h3>
            <p className="mt-1 text-xs text-[#667085] dark:text-[#94A3B8]">
              Traçabilité des modifications sur les données de référence du catalogue (capacités, valeurs, statuts de vérification).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Type d'entité</label>
            <select
              value={selectedEntityType}
              onChange={(e) => setSelectedEntityType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            >
              {entityTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">ID de l'entité</label>
            <input
              type="number"
              min="1"
              value={selectedEntityId ?? ''}
              onChange={(e) => setSelectedEntityId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              placeholder="Ex: 42"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-6 text-center">
          <p className="text-[#667085] dark:text-slate-400">Sélectionnez un type d'entité et un ID pour afficher l'historique des vérifications.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-semibold">
            Journaux — {entityTypes.find(t => t.value === selectedEntityType)?.label || selectedEntityType} #{selectedEntityId}
          </h3>
          <p className="mt-1 text-xs text-[#667085] dark:text-[#94A3B8]">
            {logs.length} entrée(s) — Historique des changements de capacités, valeurs et statuts de vérification.
          </p>
        </div>
      </div>

      <DataTable
        data={logs}
        columns={columns}
        emptyMessage="Aucun journal de vérification pour cette entité."
      />
    </div>
  );
}