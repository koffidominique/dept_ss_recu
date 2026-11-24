import { ShieldCheck, Trash2 } from 'lucide-react';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import type { HeldCart } from '../../../stores/uiStore.ts';
import type { PriceTier } from '../../../types/erp.ts';
import { formatDateTime, formatFcfa } from '../../../utils/format.ts';
import { calculateSaleCart } from '../utils/saleCalculations.ts';

const TIER_LABELS: Record<PriceTier, string> = {
  retail: 'Détail',
  semi_wholesale: 'Demi-gros',
  wholesale: 'Gros',
};

interface HeldSalesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heldCarts: HeldCart[];
  hasActiveCart?: boolean;
  onResume: (ticketId: string) => void;
  onDelete: (ticketId: string) => void;
}

export function HeldSalesModal({
  open,
  onOpenChange,
  heldCarts,
  hasActiveCart = false,
  onResume,
  onDelete,
}: HeldSalesModalProps) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Ventes mises en attente (${heldCarts.length})`}
      maxWidthClass="max-w-md"
    >
      {hasActiveCart && heldCarts.length > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/30 px-3 py-2 text-[11px] text-[#1D4ED8] dark:text-blue-300">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>
            Un panier est déjà en cours : il sera mis en attente automatiquement si vous reprenez un autre ticket.
          </span>
        </div>
      )}
      <div className="mt-4 max-h-80 space-y-2.5 overflow-y-auto text-xs">
        {heldCarts.length === 0 ? (
          <p className="py-6 text-center text-[#667085] dark:text-[#94A3B8]">Aucun panier en attente.</p>
        ) : (
          heldCarts.map((ticket) => {
            const ticketCalc = calculateSaleCart(ticket.items, ticket.discountAmount);
            const returnPieces = (ticket.receivedReturnables ?? []).reduce(
              (acc, r) => acc + (r.pieces > 0 ? r.pieces : 0),
              0
            );
            return (
              <div
                key={ticket.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold text-[#182230] dark:text-slate-100 truncate">
                    {ticket.label}
                  </div>
                  <div className="text-[11px] text-[#667085] dark:text-slate-400 font-mono-num">
                    {ticket.items.length} ligne(s) ·{' '}
                    {ticketCalc.isValid && ticketCalc.grandTotal !== null
                      ? formatFcfa(ticketCalc.grandTotal)
                      : 'Total à vérifier'}{' '}
                    · {TIER_LABELS[ticket.priceTier] ?? 'Détail'} ·{' '}
                    {ticket.saleType === 'credit' ? 'Crédit' : 'Comptant'}
                    {returnPieces > 0 ? ` · ${returnPieces} vide(s)` : ''}
                  </div>
                  <div className="text-[10px] text-[#667085] dark:text-slate-500 font-mono-num">
                    {formatDateTime(ticket.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onResume(ticket.id)}
                    className="rounded-lg bg-[#2563EB] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                  >
                    Reprendre
                  </button>
                  <button
                    type="button"
                    aria-label={`Supprimer ticket ${ticket.label}`}
                    onClick={() => onDelete(ticket.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:text-[#BE123C]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </ModalDialog>
  );
}
