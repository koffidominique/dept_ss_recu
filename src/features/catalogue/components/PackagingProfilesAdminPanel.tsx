import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../../../components/tables/DataTable.tsx';
import { ErrorState, LoadingState } from '../../../components/common/States.tsx';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type { PackagingProfile, PackagingProfileInput } from '../../../types/erp.ts';
import { formatFcfa } from '../../../utils/format.ts';

interface PackagingProfileFormState {
  id?: number;
  code: string;
  name: string;
  description: string | null;
  profile_type: 'crate' | 'pallet' | 'bin' | 'other';
  capacity_units: number | null;
  capacity_unit_label: string | null;
  dimensions_cm: string | null;
  weight_kg: number | null;
  material: string | null;
  default_value_xof: number;
  default_deposit_value_xof: number | null;
  compatible_group_id: number | null;
  verification_status: 'verified' | 'needs_verification' | 'owner_confirmed' | 'inactive';
  verification_notes: string | null;
  is_active: boolean;
}

const DEFAULT_FORM: PackagingProfileFormState = {
  code: '',
  name: '',
  description: null,
  profile_type: 'crate',
  capacity_units: null,
  capacity_unit_label: 'bouteille',
  dimensions_cm: null,
  weight_kg: null,
  material: null,
  default_value_xof: 0,
  default_deposit_value_xof: null,
  compatible_group_id: null,
  verification_status: 'needs_verification',
  verification_notes: null,
  is_active: true,
};

const VERIFICATION_STATUS_LABELS: Record<string, string> = {
  verified: 'Vérifié',
  needs_verification: 'À vérifier',
  owner_confirmed: 'Confirmé owner',
  inactive: 'Inactif',
};

const VERIFICATION_STATUS_COLORS: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  needs_verification: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  owner_confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  inactive: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
};

const PROFILE_TYPE_LABELS: Record<string, string> = {
  crate: 'Casier',
  pallet: 'Palette',
  bin: 'Bac / Grand contenant',
  other: 'Autre',
};

export function PackagingProfilesAdminPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<PackagingProfileFormState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['packaging-profiles-admin', search, showArchived],
    queryFn: () => apiClient.listPackagingProfiles({ include_archived: showArchived, verification_status: undefined }),
  });

  const createMut = useMutation({
    mutationFn: (input: PackagingProfileInput) => apiClient.createPackagingProfile(input),
    onSuccess: () => {
      setEditing(null);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['packaging-profiles-admin'] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur création'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<PackagingProfileInput> }) =>
      apiClient.updatePackagingProfile(id, input),
    onSuccess: () => {
      setEditing(null);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['packaging-profiles-admin'] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur modification'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.deletePackagingProfile(id),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['packaging-profiles-admin'] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur suppression'),
  });

  const profiles = profilesQuery.data?.items ?? [];

  if (profilesQuery.isLoading) return <LoadingState rows={6} />;
  if (profilesQuery.error || !profilesQuery.data) {
    return (
      <ErrorState
        message={
          profilesQuery.error instanceof Error
            ? profilesQuery.error.message
            : 'Erreur chargement des profils d\'emballage.'
        }
        onRetry={() => void profilesQuery.refetch()}
      />
    );
  }

  const activeCount = profiles.filter((p) => p.is_active === 1).length;

  const columns: ColumnDef<PackagingProfile>[] = [
    {
      accessorKey: 'code',
      header: 'Code',
      cell: ({ row }) => (
        <span className="font-mono-num text-xs font-semibold text-[#182230] dark:text-slate-100">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Nom',
      cell: ({ row }) => (
        <div className="font-medium text-[#182230] dark:text-slate-100">
          {row.original.name}
        </div>
      ),
    },
    {
      accessorKey: 'profile_type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="text-xs capitalize px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[#667085] dark:text-slate-400">
          {PROFILE_TYPE_LABELS[row.original.profile_type] || row.original.profile_type}
        </span>
      ),
    },
    {
      accessorKey: 'capacity_units',
      header: 'Capacité (unités)',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm font-semibold text-[#182230] dark:text-slate-100">
          {row.original.capacity_units ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'capacity_unit_label',
      header: 'Unité capacité',
      cell: ({ row }) => (
        <span className="text-xs text-[#667085] dark:text-slate-400">
          {row.original.capacity_unit_label || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'material',
      header: 'Matériau',
      cell: ({ row }) => (
        <span className="text-xs capitalize text-[#667085] dark:text-slate-400">
          {row.original.material || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'default_value_xof',
      header: 'Valeur (XOF)',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm font-semibold text-[#182230] dark:text-slate-100">
          {formatFcfa(row.original.default_value_xof)}
        </span>
      ),
    },
    {
      accessorKey: 'default_deposit_value_xof',
      header: 'Consigne (XOF)',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm text-[#667085] dark:text-slate-400">
          {row.original.default_deposit_value_xof !== null ? formatFcfa(row.original.default_deposit_value_xof) : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'compatible_group_id',
      header: 'Groupe compat.',
      cell: ({ row }) => (
        <span className="text-xs font-mono-num text-[#667085] dark:text-slate-400">
          {row.original.compatible_group_id ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'verification_status',
      header: 'Statut vérif.',
      cell: ({ row }) => {
        const status = row.original.verification_status;
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${VERIFICATION_STATUS_COLORS[status] || VERIFICATION_STATUS_COLORS.inactive}`}>
            {VERIFICATION_STATUS_LABELS[status] || status}
          </span>
        );
      },
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
    setEditing({ ...DEFAULT_FORM });
    setErrorMsg(null);
  };

  const handleEdit = (profile: PackagingProfile) => {
    setEditing({
      id: profile.id,
      code: profile.code,
      name: profile.name,
      description: profile.description,
      profile_type: profile.profile_type,
      capacity_units: profile.capacity_units,
      capacity_unit_label: profile.capacity_unit_label,
      dimensions_cm: profile.dimensions_cm,
      weight_kg: profile.weight_kg,
      material: profile.material,
      default_value_xof: profile.default_value_xof,
      default_deposit_value_xof: profile.default_deposit_value_xof,
      compatible_group_id: profile.compatible_group_id,
      verification_status: profile.verification_status,
      verification_notes: profile.verification_notes,
      is_active: profile.is_active === 1,
    });
    setErrorMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    const { id, ...input } = editing;
    const payload: PackagingProfileInput = {
      code: input.code,
      name: input.name,
      description: input.description,
      profile_type: input.profile_type,
      capacity_units: input.capacity_units,
      capacity_unit_label: input.capacity_unit_label,
      dimensions_cm: input.dimensions_cm,
      weight_kg: input.weight_kg,
      material: input.material,
      default_value_xof: input.default_value_xof,
      default_deposit_value_xof: input.default_deposit_value_xof,
      compatible_group_id: input.compatible_group_id,
      verification_status: input.verification_status,
      verification_notes: input.verification_notes,
      is_active: input.is_active,
    };

    if (id) {
      updateMut.mutate({ id, input: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-semibold">Profils d'emballages physiques</h3>
          <p className="mt-1 text-xs text-[#667085] dark:text-[#94A3B8]">
            {activeCount} actif(s) sur {profiles.length} total — Définissent les casiers, palettes, bacs avec capacité, valeur et groupe de compatibilité.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-4 py-2 text-xs font-medium text-[#182230] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <span className="h-4 w-4" aria-hidden="true">➕</span>
          Nouveau profil
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Rechercher (code, nom...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
        <label className="inline-flex items-center gap-2 text-sm text-[#667085] dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]"
          />
          Inclure archivés
        </label>
      </div>

      <DataTable
        data={profiles}
        columns={columns}
        onRowClick={handleEdit}
        emptyMessage="Aucun profil d'emballage trouvé."
      />

      <ModalDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? 'Modifier le profil' : 'Nouveau profil d\'emballage'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-800 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Code *</label>
              <input
                type="text"
                value={editing?.code || ''}
                onChange={(e) => setEditing({ ...editing!, code: e.target.value.toUpperCase() })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Nom *</label>
              <input
                type="text"
                value={editing?.name || ''}
                onChange={(e) => setEditing({ ...editing!, name: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Type de profil *</label>
              <select
                value={editing?.profile_type || 'crate'}
                onChange={(e) => setEditing({ ...editing!, profile_type: e.target.value as PackagingProfileFormState['profile_type'] })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              >
                <option value="crate">Casier</option>
                <option value="pallet">Palette</option>
                <option value="bin">Bac / Grand contenant</option>
                <option value="other">Autre</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Capacité (unités)</label>
              <input
                type="number"
                min="0"
                value={editing?.capacity_units ?? ''}
                onChange={(e) => setEditing({ ...editing!, capacity_units: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="Laisser vide si non applicable"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Unité de capacité</label>
              <input
                type="text"
                value={editing?.capacity_unit_label || ''}
                onChange={(e) => setEditing({ ...editing!, capacity_unit_label: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="ex: bouteille, caisse"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Matériau</label>
              <input
                type="text"
                value={editing?.material || ''}
                onChange={(e) => setEditing({ ...editing!, material: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="ex: plastique, bois, métal"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Valeur par défaut (XOF) *</label>
              <input
                type="number"
                min="0"
                value={editing?.default_value_xof || 0}
                onChange={(e) => setEditing({ ...editing!, default_value_xof: e.target.value ? parseInt(e.target.value, 10) : 0 })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Consigne par défaut (XOF)</label>
              <input
                type="number"
                min="0"
                value={editing?.default_deposit_value_xof ?? ''}
                onChange={(e) => setEditing({ ...editing!, default_deposit_value_xof: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="Optionnel"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Groupe de compatibilité</label>
              <input
                type="number"
                min="1"
                value={editing?.compatible_group_id ?? ''}
                onChange={(e) => setEditing({ ...editing!, compatible_group_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="ID du groupe (optionnel)"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Dimensions (cm)</label>
              <input
                type="text"
                value={editing?.dimensions_cm || ''}
                onChange={(e) => setEditing({ ...editing!, dimensions_cm: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="ex: 60x40x30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Poids (kg)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={editing?.weight_kg ?? ''}
                onChange={(e) => setEditing({ ...editing!, weight_kg: e.target.value ? parseFloat(e.target.value) : null })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="Optionnel"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Statut de vérification *</label>
              <select
                value={editing?.verification_status || 'needs_verification'}
                onChange={(e) => setEditing({ ...editing!, verification_status: e.target.value as PackagingProfileFormState['verification_status'] })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              >
                <option value="needs_verification">À vérifier</option>
                <option value="verified">Vérifié</option>
                <option value="owner_confirmed">Confirmé owner</option>
                <option value="inactive">Inactif</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Notes de vérification</label>
              <textarea
                value={editing?.verification_notes || ''}
                onChange={(e) => setEditing({ ...editing!, verification_notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="Notes sur la vérification de la capacité/valeur..."
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400 mb-1">Description</label>
              <textarea
                value={editing?.description || ''}
                onChange={(e) => setEditing({ ...editing!, description: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111A2E] px-3 py-2 text-sm text-[#182230] dark:text-slate-100 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
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