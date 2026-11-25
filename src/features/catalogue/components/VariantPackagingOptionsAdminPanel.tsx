import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../../../components/tables/DataTable.tsx';
import { ErrorState, LoadingState } from '../../../components/common/States.tsx';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type { VariantPackagingOption, CreateVariantPackagingOptionInput, UpdateVariantPackagingOptionInput } from '../../../types/erp.ts';
import { formatFcfa } from '../../../utils/format.ts';

interface VariantPackagingOptionFormState {
  id?: number;
  variant_id: number;
  commercial_packaging_type_id: number;
  packaging_profile_id: number | null;
  is_default_sale: boolean;
  is_default_purchase: boolean;
  is_active: boolean;
}

const DEFAULT_FORM: VariantPackagingOptionFormState = {
  variant_id: 0,
  commercial_packaging_type_id: 0,
  packaging_profile_id: null,
  is_default_sale: false,
  is_default_purchase: false,
  is_active: true,
};

export function VariantPackagingOptionsAdminPanel({ variantId }: { variantId?: number }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<VariantPackagingOptionFormState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number>(variantId ?? 0);

  const optionsQuery = useQuery({
    queryKey: ['variant-packaging-options', selectedVariantId],
    queryFn: () => selectedVariantId ? apiClient.listVariantPackagingOptions(selectedVariantId) : Promise.resolve([]),
    enabled: !!selectedVariantId,
  });

  const createMut = useMutation({
    mutationFn: (input: CreateVariantPackagingOptionInput) => apiClient.createVariantPackagingOption(input),
    onSuccess: () => {
      setEditing(null);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['variant-packaging-options', selectedVariantId] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur création'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateVariantPackagingOptionInput }) =>
      apiClient.updateVariantPackagingOption(id, input),
    onSuccess: () => {
      setEditing(null);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['variant-packaging-options', selectedVariantId] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur modification'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.deleteVariantPackagingOption(id),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['variant-packaging-options', selectedVariantId] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur suppression'),
  });

  const options = optionsQuery.data ?? [];

  if (optionsQuery.isLoading) return <LoadingState rows={6} />;
  if (optionsQuery.error) {
    return (
      <ErrorState
        message={
          optionsQuery.error instanceof Error
            ? optionsQuery.error.message
            : 'Erreur chargement des options de conditionnement.'
        }
        onRetry={() => void optionsQuery.refetch()}
      />
    );
  }

  const columns: ColumnDef<VariantPackagingOption>[] = [
    {
      accessorKey: 'variant_name',
      header: 'Variante',
      cell: ({ row }) => (
        <div className="font-medium text-[#182230] dark:text-slate-100">
          {row.original.variant_name || `ID: ${row.original.variant_id}`}
        </div>
      ),
    },
    {
      accessorKey: 'packaging_type_code',
      header: 'Type conditionnement',
      cell: ({ row }) => (
        <span className="font-mono-num text-xs font-semibold text-[#182230] dark:text-slate-100">
          {row.original.packaging_type_code || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'packaging_type_name',
      header: 'Nom type',
      cell: ({ row }) => (
        <div className="text-sm text-[#667085] dark:text-slate-400">
          {row.original.packaging_type_name || '—'}
        </div>
      ),
    },
    {
      accessorKey: 'profile_code',
      header: 'Profil d\'emballage',
      cell: ({ row }) => (
        <span className="font-mono-num text-xs text-[#667085] dark:text-slate-400">
          {row.original.profile_code || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'profile_name',
      header: 'Nom profil',
      cell: ({ row }) => (
        <div className="text-sm text-[#667085] dark:text-slate-400">
          {row.original.profile_name || '—'}
        </div>
      ),
    },
    {
      accessorKey: 'profile_capacity',
      header: 'Capacité profil',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm font-semibold text-[#182230] dark:text-slate-100">
          {row.original.profile_capacity !== null && row.original.profile_capacity !== undefined ? `${row.original.profile_capacity} unités` : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'profile_verification_status',
      header: 'Statut vérif.',
      cell: ({ row }) => {
        const status = row.original.profile_verification_status;
        const labels: Record<string, string> = {
          verified: 'Vérifié',
          needs_verification: 'À vérifier',
          owner_confirmed: 'Confirmé owner',
          inactive: 'Inactif',
        };
        const colors: Record<string, string> = {
          verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
          needs_verification: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
          owner_confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
          inactive: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
        };
        return status ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.inactive}`}>
            {labels[status] || status}
          </span>
        ) : (
          <span className="text-xs text-[#9CA3AF] dark:text-slate-500">—</span>
        );
      },
    },
    {
      accessorKey: 'profile_value',
      header: 'Valeur profil (XOF)',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm text-[#667085] dark:text-slate-400">
          {row.original.profile_value !== null && row.original.profile_value !== undefined ? formatFcfa(row.original.profile_value) : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'is_default_sale',
      header: 'Défaut vente',
      cell: ({ row }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          row.original.is_default_sale === 1
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
        }`}>
          {row.original.is_default_sale === 1 ? 'Oui' : 'Non'}
        </span>
      ),
    },
    {
      accessorKey: 'is_default_purchase',
      header: 'Défaut achat',
      cell: ({ row }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          row.original.is_default_purchase === 1
            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
            : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
        }`}>
          {row.original.is_default_purchase === 1 ? 'Oui' : 'Non'}
        </span>
      ),
    },
    {
      accessorKey: 'is_active',
      header: 'Actif',
      cell: ({ row }) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          row.original.is_active === 1
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
        }`}>
          {row.original.is_active === 1 ? 'Oui' : 'Non'}
        </span>
      ),
    },
  ];

  const handleOpenCreate = () => {
    setEditing({ ...DEFAULT_FORM, variant_id: selectedVariantId });
    setErrorMsg(null);
  };

  const handleEdit = (option: VariantPackagingOption) => {
    setEditing({
      id: option.id,
      variant_id: option.variant_id,
      commercial_packaging_type_id: option.commercial_packaging_type_id,
      packaging_profile_id: option.packaging_profile_id,
      is_default_sale: option.is_default_sale === 1,
      is_default_purchase: option.is_default_purchase === 1,
      is_active: option.is_active === 1,
    });
    setErrorMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    const { id, ...input } = editing;
    const payload: CreateVariantPackagingOptionInput | UpdateVariantPackagingOptionInput = {
      variant_id: input.variant_id,
      commercial_packaging_type_id: input.commercial_packaging_type_id,
      packaging_profile_id: input.packaging_profile_id,
      is_default_sale: input.is_default_sale,
      is_default_purchase: input.is_default_purchase,
      is_active: input.is_active,
    };

    if (id) {
      updateMut.mutate({ id, input: payload as UpdateVariantPackagingOptionInput });
    } else {
      createMut.mutate(payload as CreateVariantPackagingOptionInput);
    }
  };

  if (!selectedVariantId) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold">Options de conditionnement par variante</h3>
            <p className="mt-1 text-xs text-[#667085] dark:text-[#94A3B8]">
              Sélectionnez une variante pour gérer ses options de conditionnement commercial.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] p-6 text-center">
          <p className="text-[#667085] dark:text-slate-400">Aucune variante sélectionnée. Utilisez ce composant depuis la fiche variante ou passez variantId en prop.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-semibold">Options de conditionnement — Variante #{selectedVariantId}</h3>
          <p className="mt-1 text-xs text-[#667085] dark:text-[#94A3B8]">
            {options.length} option(s) — Lie chaque type de conditionnement commercial à un profil d'emballage physique.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-4 py-2 text-xs font-medium text-[#182230] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <span className="h-4 w-4" aria-hidden="true">➕</span>
          Nouvelle option
        </button>
      </div>

      <DataTable
        data={options}
        columns={columns}
        onRowClick={handleEdit}
        emptyMessage="Aucune option de conditionnement pour cette variante."
      />

      <ModalDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? 'Modifier l\'option' : 'Nouvelle option de conditionnement'}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-800 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">ID Variante *</label>
              <input
                type="number"
                min="1"
                value={editing?.variant_id || ''}
                onChange={(e) => setEditing({ ...editing!, variant_id: e.target.value ? parseInt(e.target.value, 10) : 0 })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Type conditionnement commercial *</label>
              <input
                type="number"
                min="1"
                value={editing?.commercial_packaging_type_id || ''}
                onChange={(e) => setEditing({ ...editing!, commercial_packaging_type_id: e.target.value ? parseInt(e.target.value, 10) : 0 })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                required
                placeholder="ID du packaging_type"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Profil d'emballage physique</label>
              <input
                type="number"
                min="1"
                value={editing?.packaging_profile_id ?? ''}
                onChange={(e) => setEditing({ ...editing!, packaging_profile_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="ID du packaging_profile (optionnel)"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_default_sale"
                checked={editing?.is_default_sale ?? false}
                onChange={(e) => setEditing({ ...editing!, is_default_sale: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]"
              />
              <label htmlFor="is_default_sale" className="text-sm text-[#182230] dark:text-slate-100 cursor-pointer">
                Défaut pour la vente
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_default_purchase"
                checked={editing?.is_default_purchase ?? false}
                onChange={(e) => setEditing({ ...editing!, is_default_purchase: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]"
              />
              <label htmlFor="is_default_purchase" className="text-sm text-[#182230] dark:text-slate-100 cursor-pointer">
                Défaut pour l'achat
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={editing?.is_active ?? true}
                onChange={(e) => setEditing({ ...editing!, is_active: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]"
              />
              <label htmlFor="is_active" className="text-sm text-[#182230] dark:text-slate-100 cursor-pointer">
                Actif
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-4 py-2 text-xs font-medium text-[#182230] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
              className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-medium text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMut.isPending || updateMut.isPending ? 'Enregistrement...' : editing?.id ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}