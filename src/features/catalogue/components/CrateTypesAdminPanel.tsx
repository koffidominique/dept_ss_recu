import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../../../components/tables/DataTable.tsx';
import { ErrorState, LoadingState } from '../../../components/common/States.tsx';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type { CrateType, CrateTypeInput } from '../../../types/erp.ts';
import { formatFcfa } from '../../../utils/format.ts';

interface CrateTypeFormState {
  id?: number;
  code: string;
  name: string;
  producer: string;
  capacity: number | null;
  bottle_capacity_ml: number;
  bottle_profile_id: number;
  compatibility_group_id: number | null;
  dimensions: string | null;
  weight_g: number | null;
  material: string;
  deposit_value: number;
  description: string | null;
  capacity_verification_status: 'to_verify' | 'verified' | 'owner_confirmed' | null;
  is_active: boolean;
}

const DEFAULT_FORM: CrateTypeFormState = {
  code: '',
  name: '',
  producer: '',
  capacity: null,
  bottle_capacity_ml: 0,
  bottle_profile_id: 0,
  compatibility_group_id: null,
  dimensions: null,
  weight_g: null,
  material: 'plastic',
  deposit_value: 0,
  description: null,
  capacity_verification_status: 'to_verify',
  is_active: true,
};

export function CrateTypesAdminPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CrateTypeFormState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const crateTypesQuery = useQuery({
    queryKey: ['crate-types-admin', search, showArchived],
    queryFn: () => apiClient.listCrateTypes(search),
  });

  const createMut = useMutation({
    mutationFn: (input: CrateTypeInput) => apiClient.createCrateType(input),
    onSuccess: () => {
      setEditing(null);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['crate-types-admin'] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur création'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<CrateTypeInput> }) =>
      apiClient.updateCrateType(id, input),
    onSuccess: () => {
      setEditing(null);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['crate-types-admin'] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur modification'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.deleteCrateType(id),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['crate-types-admin'] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : 'Erreur suppression'),
  });

  const crateTypes = crateTypesQuery.data?.items ?? [];

  if (crateTypesQuery.isLoading) return <LoadingState rows={6} />;
  if (crateTypesQuery.error || !crateTypesQuery.data) {
    return (
      <ErrorState
        message={
          crateTypesQuery.error instanceof Error
            ? crateTypesQuery.error.message
            : 'Erreur chargement des types de casiers.'
        }
        onRetry={() => void crateTypesQuery.refetch()}
      />
    );
  }

  const activeCount = crateTypes.filter((c) => c.is_active === 1).length;

  const columns: ColumnDef<CrateType>[] = [
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
      accessorKey: 'producer',
      header: 'Producteur',
      cell: ({ row }) => (
        <div className="text-xs text-[#667085] dark:text-slate-400">
          {row.original.producer}
        </div>
      ),
    },
    {
      accessorKey: 'capacity',
      header: 'Capacité (bouteilles)',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm font-semibold text-[#182230] dark:text-slate-100">
          {row.original.capacity}
        </span>
      ),
    },
    {
      accessorKey: 'bottle_capacity_ml',
      header: 'Volume bouteille (ml)',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm text-[#667085] dark:text-slate-400">
          {row.original.bottle_capacity_ml} ml
        </span>
      ),
    },
    {
      accessorKey: 'material',
      header: 'Matériau',
      cell: ({ row }) => (
        <span className="text-xs capitalize text-[#667085] dark:text-slate-400">
          {row.original.material}
        </span>
      ),
    },
    {
      accessorKey: 'deposit_value',
      header: 'Consigne casier',
      cell: ({ row }) => (
        <span className="font-mono-num text-sm font-semibold text-[#1D4ED8] dark:text-[#60A5FA]">
          {formatFcfa(row.original.deposit_value)}
        </span>
      ),
    },
    {
      accessorKey: 'capacity_verification_status',
      header: 'Vérif. capacité',
      cell: ({ row }) => {
        const status = row.original.capacity_verification_status;
        if (!status) return <span className="text-xs text-slate-400">—</span>;
        const colors = {
          to_verify: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
          verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
          owner_confirmed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        };
        const labels = {
          to_verify: 'À vérifier',
          verified: 'Vérifié',
          owner_confirmed: 'Confirmé propriétaire',
        };
        return (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${colors[status as keyof typeof colors] || 'bg-slate-100 text-slate-600'}`}>
            {labels[status as keyof typeof labels] || status}
          </span>
        );
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Statut',
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
            row.original.is_active === 1
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {row.original.is_active === 1 ? 'Actif' : 'Archivé'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleEdit(row.original)}
            title="Modifier"
            className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => handleDelete(row.original.id)}
            title="Supprimer"
            className="rounded-md border border-red-200 dark:border-red-900 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      ),
    },
  ];

  function handleEdit(crate: CrateType) {
    setEditing({
      id: crate.id,
      code: crate.code,
      name: crate.name,
      producer: crate.producer,
      capacity: crate.capacity,
      bottle_capacity_ml: crate.bottle_capacity_ml,
      bottle_profile_id: crate.bottle_profile_id,
      compatibility_group_id: crate.compatibility_group_id,
      dimensions: crate.dimensions,
      weight_g: crate.weight_g,
      material: crate.material,
      deposit_value: crate.deposit_value,
      description: crate.description,
      capacity_verification_status: crate.capacity_verification_status,
      is_active: crate.is_active === 1,
    });
    setErrorMsg(null);
  }

  function handleNew() {
    setEditing({ ...DEFAULT_FORM });
    setErrorMsg(null);
  }

  function handleDelete(id: number) {
    if (confirm('Supprimer ce type de casier ? Cette action est irréversible.')) {
      deleteMut.mutate(id);
    }
  }

  function handleSubmit(form: CrateTypeFormState) {
    const { id, ...input } = form;
    if (id) {
      updateMut.mutate({ id, input });
    } else {
      createMut.mutate(input as CrateTypeInput);
    }
  }

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (code, nom, producteur)…"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs w-64"
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Afficher les archivés
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {activeCount} actif(s) · {crateTypes.length} affiché(s)
          </span>
          <button
            type="button"
            onClick={handleNew}
            className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D4ED8]"
          >
            Nouveau type de casier
          </button>
        </div>
      </div>

      <DataTable data={crateTypes} columns={columns} emptyMessage="Aucun type de casier." />

      <CrateTypeFormModal
        editing={editing}
        isPending={createMut.isPending || updateMut.isPending}
        onClose={() => setEditing(null)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

function CrateTypeFormModal({
  editing,
  isPending,
  onClose,
  onSubmit,
}: {
  editing: CrateTypeFormState | null;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (form: CrateTypeFormState) => void;
}) {
  const [form, setForm] = useState<CrateTypeFormState>(DEFAULT_FORM);

  if (!editing) return null;

  const isEdit = Boolean(editing.id);

  const handleChange = (field: keyof CrateTypeFormState, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value as CrateTypeFormState[typeof field] }));
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim() || !form.producer.trim()) {
      return;
    }
    if (form.bottle_capacity_ml <= 0 || form.bottle_profile_id <= 0) {
      return;
    }
    if (form.capacity !== null && form.capacity <= 0) {
      return;
    }
    onSubmit(form);
  };

  return (
    <ModalDialog
      open={true}
      onOpenChange={onClose}
      title={isEdit ? `Modifier ${editing.name}` : 'Nouveau type de casier'}
      maxWidthClass="max-w-2xl"
      scrollable
    >
      <form onSubmit={handleSubmitForm} noValidate className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="crate-code" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Code *
          </label>
          <input
            id="crate-code"
            type="text"
            value={form.code}
            onChange={(e) => handleChange('code', e.target.value.toUpperCase())}
            disabled={isEdit}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            placeholder="Ex: CASIER-33CL, CASIER-50CL"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="crate-name" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Nom *
          </label>
          <input
            id="crate-name"
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            placeholder="Ex: Casier 24x33cl, Casier 12x50cl"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="crate-producer" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Producteur *
          </label>
          <input
            id="crate-producer"
            type="text"
            value={form.producer}
            onChange={(e) => handleChange('producer', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            placeholder="Ex: SOLIBRA, BRASSIVOIRE"
          />
        </div>

        <div>
          <label htmlFor="crate-capacity" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Capacité (nb bouteilles)
          </label>
          <input
            id="crate-capacity"
            type="number"
            min="1"
            value={form.capacity ?? ''}
            onChange={(e) => handleChange('capacity', e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="crate-bottle-capacity" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Volume bouteille (ml) *
          </label>
          <input
            id="crate-bottle-capacity"
            type="number"
            min="1"
            value={form.bottle_capacity_ml}
            onChange={(e) => handleChange('bottle_capacity_ml', Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="crate-bottle-profile" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Profil bouteille ID *
          </label>
          <input
            id="crate-bottle-profile"
            type="number"
            min="1"
            value={form.bottle_profile_id}
            onChange={(e) => handleChange('bottle_profile_id', Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="crate-capacity-verification" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Statut vérification capacité
          </label>
          <select
            id="crate-capacity-verification"
            value={form.capacity_verification_status ?? ''}
            onChange={(e) => handleChange('capacity_verification_status', e.target.value || null)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="">— Non défini —</option>
            <option value="to_verify">À vérifier</option>
            <option value="verified">Vérifié</option>
            <option value="owner_confirmed">Confirmé par propriétaire</option>
          </select>
        </div>

        <div>
          <label htmlFor="crate-compat-group" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Groupe compatibilité ID
          </label>
          <input
            id="crate-compat-group"
            type="number"
            min="1"
            value={form.compatibility_group_id ?? ''}
            onChange={(e) => handleChange('compatibility_group_id', e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="crate-material" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Matériau
          </label>
          <select
            id="crate-material"
            value={form.material}
            onChange={(e) => handleChange('material', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="plastic">Plastique</option>
            <option value="wood">Bois</option>
            <option value="metal">Métal</option>
            <option value="other">Autre</option>
          </select>
        </div>

        <div>
          <label htmlFor="crate-deposit" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Consigne casier (FCFA)
          </label>
          <input
            id="crate-deposit"
            type="number"
            min="0"
            value={form.deposit_value}
            onChange={(e) => handleChange('deposit_value', Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="crate-weight" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Poids (g)
          </label>
          <input
            id="crate-weight"
            type="number"
            min="1"
            value={form.weight_g ?? ''}
            onChange={(e) => handleChange('weight_g', e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

<div className="sm:col-span-2">
          <label htmlFor="crate-dimensions" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Dimensions (JSON: length_mm, width_mm, height_mm)
          </label>
          <input
            id="crate-dimensions"
            type="text"
            value={form.dimensions ?? ''}
            onChange={(e) => handleChange('dimensions', e.target.value || null)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono-num text-xs"
            placeholder='{"length_mm": 400, "width_mm": 300, "height_mm": 250}'
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="crate-description" className="block text-xs font-medium text-[#182230] dark:text-slate-200">
            Description
          </label>
          <textarea
            id="crate-description"
            value={form.description ?? ''}
            onChange={(e) => handleChange('description', e.target.value || null)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2 flex items-center gap-2">
          <input
            id="crate-active"
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => handleChange('is_active', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
          />
          <label htmlFor="crate-active" className="text-sm text-[#182230] dark:text-slate-200">
            Actif
          </label>
        </div>

        <div className="sm:col-span-2 flex flex-wrap justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-[#1D4ED8]"
          >
            {isPending ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}