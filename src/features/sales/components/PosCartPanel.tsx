import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PackageCheck, PauseCircle, PlayCircle, RotateCcw, ShoppingCart, Trash2, UserPlus } from 'lucide-react';
import { FormTipsButton } from '../../../components/common/FormTipsButton.tsx';
import { DP_EASE } from '../../../components/motion/MotionPrimitives.tsx';
import { QuantityInput } from '../../../components/common/QuantityInput.tsx';
import { formatFcfa } from '../../../utils/format.ts';
import type { CartItem, HeldCart } from '../../../stores/uiStore.ts';
import type { Client, ClientPackagingBalance, PaymentMethodConfig } from '../../../types/erp.ts';
import {
  computeAvailableReturnableRows,
  computeReturnedPackagingSummary,
  parseQtyInputToMilliBigInt,
  type SaleCalculationResult,
} from '../utils/saleCalculations.ts';
import type { PosCheckoutReadiness } from '../utils/posCartBuilders.ts';
import { PosPaymentPanel } from './PosPaymentPanel.tsx';

interface PosCartPanelProps {
  posCart: CartItem[];
  heldCarts: HeldCart[];
  clients?: Client[];
  posClientId: number | null;
  onClientChange: (clientId: number | null) => void;
  posSaleType: 'cash' | 'credit';
  onSaleTypeChange: (saleType: 'cash' | 'credit') => void;
  dueDate: string;
  onDueDateChange: (value: string) => void;
  globalDiscount: number;
  onGlobalDiscountChange: (value: number) => void;
  totals: SaleCalculationResult;
  paymentRows: Array<{ method_code: string; amount: number }>;
  onPaymentRowsChange: (
    updater: (
      prev: Array<{ method_code: string; amount: number }>
    ) => Array<{ method_code: string; amount: number }>
  ) => void;
  activeMethods: PaymentMethodConfig[];
  errorMsg: string | null;
  readiness: PosCheckoutReadiness;
  isOnline?: boolean;
  isSubmitting: boolean;
  onUpdateCartItem: (key: string, patch: Partial<CartItem>) => void;
  onRemoveFromCart: (key: string) => void;
  onClearCart: () => void;
  onHoldCart: () => void;
  onOpenHeldModal: () => void;
  onOpenQuickClient: () => void;
  onSubmitSale: () => void;
  clientReturnables: ClientPackagingBalance[];
  isLoadingClientReturnables?: boolean;
  receivedReturnables: Array<{ returnable_id: number; pieces: number }>;
  onReceivedReturnableChange: (returnableId: number, pieces: number) => void;
  /** Restitutions saisies sur une ligne du panier. */
  lineReturnables?: Array<{ cartIndex: number; returnable_id: number; pieces: number }>;
  onLineReturnableChange?: (cartIndex: number, returnableId: number, pieces: number) => void;
  onResetReceivedReturnables?: () => void;
}

export function PosCartPanel({
  posCart,
  heldCarts,
  clients,
  posClientId,
  onClientChange,
  posSaleType,
  onSaleTypeChange,
  dueDate,
  onDueDateChange,
  globalDiscount,
  onGlobalDiscountChange,
  totals,
  paymentRows,
  onPaymentRowsChange,
  activeMethods,
  errorMsg,
  readiness,
  isOnline = true,
  isSubmitting,
  onUpdateCartItem,
  onRemoveFromCart,
  onClearCart,
  onHoldCart,
  onOpenHeldModal,
  onOpenQuickClient,
  onSubmitSale,
  clientReturnables,
  isLoadingClientReturnables = false,
  receivedReturnables,
  onReceivedReturnableChange,
  lineReturnables,
  onLineReturnableChange,
  onResetReceivedReturnables,
}: PosCartPanelProps) {
  const selectedClient = clients?.find((c) => c.id === posClientId);
  const availCredit =
    selectedClient &&
    selectedClient.credit_policy === 'limited' &&
    selectedClient.credit_limit !== null
      ? Math.max(0, selectedClient.credit_limit - selectedClient.unpaid_balance)
      : null;

  const availableReturnableRows = useMemo(
    () => (selectedClient ? computeAvailableReturnableRows(clientReturnables, posCart) : []),
    [selectedClient, clientReturnables, posCart]
  );

  const returnedSummary = useMemo(
    () => computeReturnedPackagingSummary(availableReturnableRows, receivedReturnables),
    [availableReturnableRows, receivedReturnables]
  );

  return (
    <div className="space-y-4 lg:col-span-5">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111A2E] dp-surface p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2 font-display text-sm font-semibold">
            <ShoppingCart className="h-4 w-4 text-[#1D4ED8] dark:text-[#60A5FA]" />
            <span>Panier de vente ({posCart.length})</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {heldCarts.length > 0 && (
              <button
                type="button"
                onClick={onOpenHeldModal}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 text-[11px] font-semibold text-[#8A5A0B] dark:text-[#FBBF24]"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                En attente ({heldCarts.length})
              </button>
            )}
            {posCart.length > 0 && (
              <button
                type="button"
                onClick={onHoldCart}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-[#667085] dark:text-[#94A3B8] hover:border-[#2563EB] hover:text-[#1D4ED8] dark:text-[#60A5FA]"
              >
                <PauseCircle className="h-3.5 w-3.5" />
                Mettre en attente
              </button>
            )}
            <FormTipsButton topicId="sales-pos" label="Aide saisie" />
            {posCart.length > 0 && (
              <button
                type="button"
                onClick={onClearCart}
                className="text-xs font-medium text-[#BE123C] hover:underline"
              >
                Vider
              </button>
            )}
          </div>
        </div>

        {/* Sélection client et mode vente */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-[#667085] dark:text-slate-400">
                Client
              </label>
              <button
                type="button"
                onClick={onOpenQuickClient}
                aria-label="Créer rapidement un client"
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#1D4ED8] dark:text-[#60A5FA] hover:underline"
              >
                <UserPlus className="h-3 w-3" />
                Nouveau client
              </button>
            </div>
            <select
              aria-label="Client de la vente"
              value={posClientId ?? ''}
              onChange={(e) => onClientChange(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs"
            >
              <option value="">Client Comptoir (Anonyme)</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.credit_policy === 'forbidden' ? 'Comptant' : 'Crédit OK'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#667085] dark:text-slate-400">
              Type de vente
            </label>
            <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
              <button
                type="button"
                onClick={() => onSaleTypeChange('cash')}
                className={`rounded-md py-1.5 text-xs font-medium ${
                  posSaleType === 'cash'
                    ? 'bg-[#2563EB] text-white'
                    : 'text-[#667085] dark:text-slate-300'
                }`}
              >
                Comptant
              </button>
              <button
                type="button"
                onClick={() => onSaleTypeChange('credit')}
                className={`rounded-md py-1.5 text-xs font-medium ${
                  posSaleType === 'credit'
                    ? 'bg-[#9A6300] text-white'
                    : 'text-[#667085] dark:text-slate-300'
                }`}
              >
                À crédit
              </button>
            </div>
          </div>
        </div>

        {selectedClient && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-[#182230] dark:text-slate-200">
              {selectedClient.credit_policy === 'forbidden'
                ? 'Crédit interdit'
                : selectedClient.credit_policy === 'unlimited'
                  ? 'Crédit autorisé (sans plafond)'
                  : `Plafond ${formatFcfa(selectedClient.credit_limit ?? 0)} · Dispo ${formatFcfa(availCredit ?? 0)}`}
            </span>
            <span className="font-mono-num text-[#667085] dark:text-slate-400">
              Dû : {formatFcfa(selectedClient.unpaid_balance)} · Vides :{' '}
              {selectedClient.returnable_pieces_due} pcs
            </span>
          </div>
        )}
        
        {selectedClient && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <PackageCheck className="h-3.5 w-3.5 text-[#16A36A]" />
                <span className="font-semibold text-[#182230] dark:text-slate-200 text-xs">
                  Retour d’emballages client
                </span>
              </div>
              {returnedSummary.totalPieces > 0 && onResetReceivedReturnables && (
                <button
                  type="button"
                  onClick={onResetReceivedReturnables}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#667085] dark:text-[#94A3B8] hover:text-[#BE123C]"
                >
                  <RotateCcw className="h-3 w-3" />
                  Réinitialiser
                </button>
              )}
            </div>

            {isLoadingClientReturnables ? (
              <p className="text-[11px] text-[#667085] dark:text-slate-400">
                Chargement des soldes d’emballages du client…
              </p>
            ) : availableReturnableRows.length === 0 ? (
              <p className="text-[11px] text-[#667085] dark:text-slate-400">
                Aucun emballage consigné dû par ce client ni émis dans le panier.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2">
                  {availableReturnableRows.map((row) => {
                    const rawCurrent =
                      receivedReturnables.find((r) => r.returnable_id === row.returnable_id)
                        ?.pieces ?? 0;
                    const current = Math.min(
                      row.max_returnable_pieces,
                      Math.max(0, Number.isFinite(rawCurrent) ? Math.trunc(rawCurrent) : 0)
                    );
                    const remainingAfterReturn = Math.max(0, row.max_returnable_pieces - current);
                    const lineReturnValue = current * row.deposit_value;

                    return (
                      <div
                        key={row.returnable_id}
                        className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-lg p-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-semibold text-[#182230] dark:text-slate-100 truncate">
                            {row.packaging_name}{' '}
                            <span className="font-normal text-[#667085] dark:text-slate-400">
                              ({row.packaging_code})
                            </span>
                          </div>
                          <div className="text-[10px] text-[#667085] dark:text-slate-400 font-mono-num">
                            Solde dû : {row.prior_due_pieces} pcs
                            {row.cart_outgoing_pieces > 0
                              ? ` · +${row.cart_outgoing_pieces} vente (max ${row.max_returnable_pieces})`
                              : ''}{' '}
                            · {formatFcfa(row.deposit_value)}/pc
                          </div>
                          {current > 0 && (
                            <div className="mt-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 font-mono-num">
                              Valorisation retour : {formatFcfa(lineReturnValue)} · Reste dû :{' '}
                              {remainingAfterReturn} pcs
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={current <= 0}
                            onClick={() =>
                              onReceivedReturnableChange(
                                row.returnable_id,
                                Math.max(0, current - 1)
                              )
                            }
                            className="h-7 w-7 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 hover:bg-slate-50 dark:hover:bg-slate-800"
                            aria-label={`Diminuer ${row.packaging_name}`}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={row.max_returnable_pieces}
                            step={1}
                            value={current}
                            aria-label={`Retour ${row.packaging_name}`}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              const safe = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
                              onReceivedReturnableChange(
                                row.returnable_id,
                                Math.min(row.max_returnable_pieces, safe)
                              );
                            }}
                            className="w-16 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-center text-xs font-mono-num"
                          />
                          <button
                            type="button"
                            disabled={current >= row.max_returnable_pieces}
                            onClick={() =>
                              onReceivedReturnableChange(
                                row.returnable_id,
                                Math.min(row.max_returnable_pieces, current + 1)
                              )
                            }
                            className="h-7 w-7 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100 hover:bg-slate-50 dark:hover:bg-slate-800"
                            aria-label={`Augmenter ${row.packaging_name}`}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            disabled={current === row.max_returnable_pieces}
                            onClick={() =>
                              onReceivedReturnableChange(
                                row.returnable_id,
                                row.max_returnable_pieces
                              )
                            }
                            className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
                          >
                            Max
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {returnedSummary.totalPieces > 0 && (
                  <div className="flex items-center justify-between rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 px-2.5 py-1.5 text-[11px]">
                    <span className="font-medium text-emerald-800 dark:text-emerald-300">
                      Montant retour ({returnedSummary.totalPieces} pcs · hors total commande)
                    </span>
                    <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                      {formatFcfa(returnedSummary.totalAmountFcfa)}
                    </span>
                  </div>
                )}
              </>
            )}
            <p className="text-[10px] text-[#667085] dark:text-slate-400 italic">
              Délai de retour des emballages consignés : 15 jours maximum. Le montant des retours est comptabilisé hors total commande et les pièces rentrent au stock du sous-dépôt.
            </p>
          </div>
        )}

        {!selectedClient && (totals.totalDeposit ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200">
            Sélectionnez ou créez un client pour enregistrer un retour d&apos;emballages vides sur cette vente.
          </div>
        )}

        {posSaleType === 'credit' && (
          <div>
            <label
              htmlFor="pos-due-date"
              className="block text-xs font-medium text-[#667085] dark:text-slate-400"
            >
              Date d&apos;échéance (optionnelle, sinon calculée selon délai client)
            </label>
            <input
              id="pos-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => onDueDateChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono-num text-xs"
            />
          </div>
        )}

        {/* Lignes du panier */}
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {posCart.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#667085] dark:text-slate-400">
              Sélectionnez un conditionnement à gauche ou scannez un article (F2) pour démarrer la vente.
            </p>
          ) : (
            <AnimatePresence initial={false}>
              {posCart.map((item, cartIndex) => {
                const lineCalc = totals.lineResults[item.key];
                const parsedMilli = parseQtyInputToMilliBigInt(item.quantity || '0');
                const canDecrementOne = parsedMilli.ok && parsedMilli.milli > 1000n;
                // Emballage remis sur CETTE ligne : seul un conditionnement qui
                // émet un casier le propose. Un produit vendu à la bouteille n'a
                // rien à rendre en casier, et le bloc global reste là pour lui.
                const crateComponent = item.depositComponents?.find((c) => c.kind === 'crate');
                const crateQuantity = Number.parseInt(item.quantity, 10);
                const maxCrates = Number.isFinite(crateQuantity) ? Math.max(0, crateQuantity) : 0;
                const crateReturn =
                  lineReturnables?.find(
                    (r) => r.cartIndex === cartIndex && r.returnable_id === crateComponent?.returnable_id
                  )?.pieces ?? 0;
                const setCrateReturn = (pieces: number) => {
                  if (!crateComponent) return;
                  const safe = Math.max(0, Math.min(maxCrates, Math.trunc(pieces) || 0));
                  onLineReturnableChange?.(cartIndex, crateComponent.returnable_id, safe);
                };
                const adjustWholeStep = (delta: 1 | -1) => {
                  const cur = parseQtyInputToMilliBigInt(item.quantity || '0');
                  if (!cur.ok) {
                    if (delta > 0) onUpdateCartItem(item.key, { quantity: '1' });
                    return;
                  }
                  const next = cur.milli + BigInt(delta) * 1000n;
                  if (next <= 0n) return;
                  const intPart = next / 1000n;
                  const fracPart = next % 1000n;
                  const formatted =
                    fracPart === 0n
                      ? intPart.toString()
                      : `${intPart.toString()}.${fracPart.toString().padStart(3, '0').replace(/0+$/, '')}`;
                  onUpdateCartItem(item.key, { quantity: formatted });
                };
                const exceedsShownStock =
                  Boolean(lineCalc?.valid) &&
                  lineCalc?.baseQtyMilli !== null &&
                  lineCalc.baseQtyMilli > item.stockMilli;

                return (
                  <motion.div
                    key={item.key}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 14, transition: { duration: 0.14 } }}
                    transition={{ duration: 0.2, ease: DP_EASE }}
                    className="py-2.5 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-[#182230] dark:text-slate-100">
                          {item.productName}
                        </div>
                        <div className="text-[11px] text-[#667085] dark:text-slate-400">
                          <span className="capitalize">
                            {item.salesUnitLabel || item.packagingName}
                          </span>{' '}
                          · {formatFcfa(item.unitPrice)}
                          {item.depositMode === 'deposit' && item.depositPerPack > 0
                            ? ` + consigne ${formatFcfa(item.depositPerPack)}`
                            : ''}
                        </div>
                        {exceedsShownStock && (
                          <div className="text-[10px] font-medium text-[#8A5A0B] dark:text-amber-300">
                            Attention : quantité supérieure au stock affiché
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`Retirer ${item.productName} (${item.salesUnitLabel || item.packagingName})`}
                        onClick={() => onRemoveFromCart(item.key)}
                        className="rounded p-1 text-slate-400 hover:text-[#BE123C] transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={!canDecrementOne}
                          aria-label={`Diminuer quantité ${item.productName}`}
                          onClick={() => adjustWholeStep(-1)}
                          className="h-8 w-7 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35"
                        >
                          −
                        </button>
                        <QuantityInput
                          value={item.quantity}
                          onChange={(q) => onUpdateCartItem(item.key, { quantity: q })}
                          allowFraction={item.allowFraction}
                          unit={item.packagingName}
                          error={lineCalc && !lineCalc.valid ? lineCalc.error || undefined : undefined}
                          className="w-32"
                        />
                        <button
                          type="button"
                          aria-label={`Augmenter quantité ${item.productName}`}
                          onClick={() => adjustWholeStep(1)}
                          className="h-8 w-7 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          +
                        </button>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <div className="text-right min-w-[78px]">
                          <div className="font-mono-num text-xs font-semibold">
                            {lineCalc && lineCalc.valid && lineCalc.lineNet !== null
                              ? formatFcfa(lineCalc.lineNet)
                              : '—'}
                          </div>
                          {lineCalc &&
                            lineCalc.valid &&
                            lineCalc.lineDeposit !== null &&
                            lineCalc.lineDeposit > 0 && (
                              <div className="font-mono-num text-[10px] text-[#8A5A0B] dark:text-amber-300">
                                +{formatFcfa(lineCalc.lineDeposit)} cons.
                              </div>
                            )}
                        </div>
                      </div>
                      {crateComponent && maxCrates > 0 && (
                        <div className="mt-2 rounded-lg border border-dashed border-[#1D4ED8]/40 dark:border-[#60A5FA]/40 bg-[#1D4ED8]/5 dark:bg-[#60A5FA]/10 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label
                              htmlFor={`crate-return-${item.key}`}
                              className="text-[11px] font-medium text-[#1D4ED8] dark:text-[#93C5FD]"
                            >
                              Emballage remis par le client
                            </label>
                            <div className="flex items-center gap-1.5">
                              <input
                                id={`crate-return-${item.key}`}
                                type="number"
                                min={0}
                                max={maxCrates}
                                step={1}
                                inputMode="numeric"
                                value={crateReturn}
                                onChange={(e) => setCrateReturn(Number(e.target.value))}
                                aria-label={`Emballage remis par le client — ${item.productName}`}
                                className="h-8 w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111A2E] px-2 text-right font-mono-num text-xs"
                              />
                              <span className="font-mono-num text-[11px] text-[#667085] dark:text-slate-400">
                                / {maxCrates} casier{maxCrates > 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                          <div className="mt-1 font-mono-num text-[10px] text-[#667085] dark:text-slate-400">
                            {crateReturn > 0
                              ? `${crateReturn} casier(s) + ${crateReturn * (crateComponent.pieces_per_pack ?? 0)} bouteille(s) rendus · ${formatFcfa(crateReturn * crateComponent.deposit_value * ((crateComponent.pieces_per_pack ?? 0) + 1))} hors total`
                              : `aucun emballage rendu — dette totale de ${formatFcfa(maxCrates * crateComponent.deposit_value * ((crateComponent.pieces_per_pack ?? 0) + 1))}`}
                          </div>
                          {maxCrates - crateReturn > 0 && (
                            <div className="mt-0.5 text-[10px] font-medium text-[#8A5A0B] dark:text-amber-300">
                              Reste {maxCrates - crateReturn} casier(s) +{' '}
                              {(maxCrates - crateReturn) * (crateComponent.pieces_per_pack ?? 0)}{' '}
                              bouteille(s) à restituer sous 15 jours
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        <PosPaymentPanel
          posSaleType={posSaleType}
          globalDiscount={globalDiscount}
          onGlobalDiscountChange={onGlobalDiscountChange}
          totals={totals}
          returnedPackagingAmount={returnedSummary.totalAmountFcfa}
          returnedPackagingPieces={returnedSummary.totalPieces}
          paymentRows={paymentRows}
          onPaymentRowsChange={onPaymentRowsChange}
          activeMethods={activeMethods}
          errorMsg={errorMsg}
          readiness={readiness}
          isOnline={isOnline}
          isSubmitting={isSubmitting}
          onSubmitSale={onSubmitSale}
        />
      </div>
    </div>
  );
}
