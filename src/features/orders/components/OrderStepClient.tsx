import { useState } from 'react';
import { Plus, PackageCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import type {
  Client,
  CustomerDepositBalance,
  PackagingMovementRecord,
} from '../../../types/erp.ts';
import { formatFcfa } from '../../../utils/format.ts';

interface OrderStepClientProps {
  clients: Client[];
  customerId: number | null;
  onSelectCustomer: (id: number | null) => void;
  deposits: CustomerDepositBalance[];
  depositHistory?: PackagingMovementRecord[];
}

const PACKAGING_MOVEMENT_LABELS: Record<string, string> = {
  SORTIE_COMMANDE: 'Sortie commande',
  RETOUR_CLIENT: 'Retour client',
  ANNULATION_COMMANDE: 'Annulation commande',
};

const CREDIT_POLICY_LABELS: Record<string, string> = {
  forbidden: 'Crédit interdit',
  limited: 'Plafond limité',
  unlimited: 'Crédit illimité',
};

export function OrderStepClient({
  clients,
  customerId,
  onSelectCustomer,
  deposits,
  depositHistory = [],
}: OrderStepClientProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientType, setClientType] = useState<'particulier' | 'professionnel'>('particulier');
  const [allowCredit, setAllowCredit] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = clients.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return c.is_active === 1;
    return (
      c.is_active === 1 &&
      (c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q))
    );
  });

  const activeClient = clients.find((c) => c.id === customerId) ?? null;
  const heldDeposits = deposits.filter((d) => d.quantity_held > 0);
  const heldValue = heldDeposits.reduce((acc, d) => acc + d.amount_held_xof, 0);

  const handleQuickCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await apiClient.createClient({
        name: name.trim(),
        client_type: clientType,
        phone: phone.trim() || undefined,
        credit_policy: allowCredit ? 'limited' : 'forbidden',
        credit_limit: allowCredit ? 100_000 : null,
      });
      await qc.invalidateQueries({ queryKey: ['clients'] });
      onSelectCustomer(created.id);
      setCreating(false);
      setName('');
      setPhone('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un client par nom, téléphone ou code..."
          className="flex-1 min-w-[220px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs font-medium text-[#1D4ED8] dark:text-[#60A5FA]"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouveau client rapide
        </button>
      </div>

      {creating && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 sm:grid-cols-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom client *"
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
          />
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Téléphone"
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
          />
          <select
            aria-label="Type de client"
            value={clientType}
            onChange={(e) => setClientType(e.target.value as 'particulier' | 'professionnel')}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
          >
            <option value="particulier">Particulier</option>
            <option value="professionnel">Revendeur / Bar</option>
          </select>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={allowCredit}
                onChange={(e) => setAllowCredit(e.target.checked)}
              />
              Crédit
            </label>
            <button
              type="button"
              disabled={saving || !name.trim()}
              onClick={() => void handleQuickCreate()}
              className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
            >
              Créer
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-[#182230] dark:text-slate-200">
          Client sélectionné *
        </label>
        <select aria-label="Client sélectionné"
          value={customerId ?? ''}
          onChange={(e) => onSelectCustomer(e.target.value ? Number(e.target.value) : null)}
          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        >
          <option value="">-- Choisir un client --</option>
          {filtered.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code}) {c.phone ? `— ${c.phone}` : ''}
            </option>
          ))}
        </select>
      </div>

      {activeClient && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2 font-semibold text-amber-900 dark:text-amber-300">
              <span className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4" />
                Emballages dus — {activeClient.name}
              </span>
              <span className="text-[11px] font-normal text-amber-800/80 dark:text-amber-400">
                Échéance 15 j max
              </span>
            </div>
            {heldDeposits.length === 0 ? (
              <p className="text-[#667085] dark:text-slate-400">
                Aucun emballage consigné dû actuellement (0 FCFA).
              </p>
            ) : (
              <p className="text-amber-900 dark:text-amber-200">
                En attente de retour :{' '}
                {heldDeposits.map((d) => `${d.quantity_held} ${d.packaging_name}`).join(', ')}{' '}
                (valeur réf. : <strong>{formatFcfa(heldValue)}</strong>).
              </p>
            )}
            {depositHistory.length > 0 && (
              <div className="pt-1.5 border-t border-amber-200/70 dark:border-amber-900/40 text-[11px] text-[#667085] dark:text-slate-400">
                Derniers mouvements :{' '}
                {depositHistory
                  .slice(0, 3)
                  .map(
                    (m) =>
                      `${PACKAGING_MOVEMENT_LABELS[m.movement_type] ?? m.movement_type} (${m.quantity} × ${m.packaging_name})`
                  )
                  .join(' · ')}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2 font-semibold text-[#182230] dark:text-slate-200">
              <span>Encours financier &amp; politique crédit</span>
              <span className="rounded bg-slate-200/70 dark:bg-slate-800 px-2 py-0.5 text-[10px]">
                {CREDIT_POLICY_LABELS[activeClient.credit_policy ?? 'forbidden'] ??
                  activeClient.credit_policy}
              </span>
            </div>
            <p className="text-[#667085] dark:text-slate-300">
              Encours exigible actuel (marchandises + emballages échus) :{' '}
              <strong
                className={
                  activeClient.unpaid_balance > 0
                    ? 'text-[#BE123C] font-mono-num'
                    : 'text-emerald-700 dark:text-emerald-400 font-mono-num'
                }
              >
                {formatFcfa(activeClient.unpaid_balance)}
              </strong>
            </p>
            {activeClient.credit_policy === 'limited' && activeClient.credit_limit != null && (
              <p className="text-[11px] text-[#667085] dark:text-slate-400">
                Plafond autorisé :{' '}
                <strong className="font-mono-num">{formatFcfa(activeClient.credit_limit)}</strong> ·
                Disponible :{' '}
                <strong className="font-mono-num">
                  {formatFcfa(Math.max(0, activeClient.credit_limit - activeClient.unpaid_balance))}
                </strong>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
