import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { apiClient } from '../services/api/createApiClient.ts';
import { usePwaInstall } from '../pwa/pwaManager.ts';
import { useUiStore } from '../stores/uiStore.ts';
import {
  DocumentPrintModal,
  type PrintableDocumentData,
} from '../components/documents/DocumentPrintModal.tsx';
import { newRequestKey } from '../utils/format.ts';
import {
  calculateSaleCart,
  computeAvailableReturnableRows,
  computeReturnedPackagingSummary,
} from '../features/sales/utils/saleCalculations.ts';
import {
  buildCartItemFromPackaging,
  buildCartItemFromSalesUnit,
  buildSaleDraftFingerprint,
  computePosCheckoutReadiness,
  matchBarcodeProduct,
} from '../features/sales/utils/posCartBuilders.ts';
import {
  getSalesUnitTierPrice,
  getTierPrice,
  usePosMutations,
  usePosQueries,
} from '../features/sales/hooks/usePosData.ts';
import { usePosShortcuts } from '../features/sales/hooks/usePosShortcuts.ts';
import {
  PosCatalogPanel,
  type BarcodeScanFeedback,
} from '../features/sales/components/PosCatalogPanel.tsx';
import { PosCartPanel } from '../features/sales/components/PosCartPanel.tsx';
import {
  ValidatedSaleBanner,
  buildMissingPackagingNote,
} from '../features/sales/components/ValidatedSaleBanner.tsx';
import { HeldSalesModal } from '../features/sales/components/HeldSalesModal.tsx';
import { QuickClientModal } from '../features/sales/components/QuickClientModal.tsx';
import type {
  PriceTier,
  Product,
  ProductPackaging,
  ProductSalesUnit,
  SaleDetail,
} from '../types/erp.ts';

export function SalesPage() {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { isOnline } = usePwaInstall();
  const [search, setSearch] = useState('');
  const [scanFeedback, setScanFeedback] = useState<BarcodeScanFeedback | null>(null);
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [dueDate, setDueDate] = useState('');
  const [paymentRows, setPaymentRows] = useState<Array<{ method_code: string; amount: number }>>([
    { method_code: 'cash', amount: 0 },
  ]);
  const [requestKeyState, setRequestKeyState] = useState<{
    key: string;
    lockedFingerprint: string | null;
  }>(() => ({ key: newRequestKey('sale'), lockedFingerprint: null }));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [validatedSale, setValidatedSale] = useState<SaleDetail | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const [heldModalOpen, setHeldModalOpen] = useState(false);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientError, setQuickClientError] = useState<string | null>(null);
  const [receivedReturnables, setReceivedReturnables] = useState<
    Array<{ returnable_id: number; pieces: number }>
  >([]);

  const {
    posCart,
    posClientId,
    posPriceTier,
    posSaleType,
    heldCarts,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    holdCurrentCart,
    resumeHeldCart,
    deleteHeldCart,
    setPosClientId,
    setPosPriceTier,
    setPosSaleType,
  } = useUiStore();

  const {
    productsRes,
    isLoadingProducts,
    isFetchingProducts,
    productsError,
    refetchProducts,
    clients,
    clientReturnables,
    isLoadingClientReturnables,
    cashStatus,
    isCashLoading,
    activeMethods,
  } = usePosQueries(search, posClientId);

  const selectedClient = useMemo(
    () => clients?.find((c) => c.id === posClientId) ?? null,
    [clients, posClientId]
  );

  const totals = useMemo(
    () => calculateSaleCart(posCart, globalDiscount, paymentRows),
    [posCart, globalDiscount, paymentRows]
  );

  const normalizedReceivedReturnables = useMemo(() => {
    if (posClientId === null) return [];
    const rows = computeAvailableReturnableRows(clientReturnables, posCart);
    return computeReturnedPackagingSummary(rows, receivedReturnables).normalized;
  }, [posClientId, clientReturnables, posCart, receivedReturnables]);

  const draftFingerprint = useMemo(
    () =>
      buildSaleDraftFingerprint({
        posClientId,
        posPriceTier,
        posSaleType,
        globalDiscount,
        dueDate,
        posCart,
        paymentRows,
        receivedReturnables: normalizedReceivedReturnables,
      }),
    [
      posClientId,
      posPriceTier,
      posSaleType,
      globalDiscount,
      dueDate,
      posCart,
      paymentRows,
      normalizedReceivedReturnables,
    ]
  );

  const effectiveRequestKey = useMemo(() => {
    if (
      requestKeyState.lockedFingerprint !== null &&
      requestKeyState.lockedFingerprint !== draftFingerprint
    ) {
      return newRequestKey('sale');
    }
    return requestKeyState.key;
  }, [requestKeyState, draftFingerprint]);

  const handleClientChange = useCallback(
    (nextClientId: number | null) => {
      setPosClientId(nextClientId);
      setReceivedReturnables([]);
      setErrorMsg(null);
    },
    [setPosClientId]
  );

  const { createSaleMutation, quickClientMutation } = usePosMutations({
    requestKey: effectiveRequestKey,
    posClientId,
    posPriceTier,
    posSaleType,
    globalDiscount,
    dueDate,
    posCart,
    paymentRows,
    totals,
    receivedReturnables: normalizedReceivedReturnables,
    onSaleSuccess: (sale) => {
      setValidatedSale(sale);
      clearCart();
      setReceivedReturnables([]);
      setGlobalDiscount(0);
      setDueDate('');
      setPaymentRows([{ method_code: 'cash', amount: 0 }]);
      setRequestKeyState({ key: newRequestKey('sale'), lockedFingerprint: null });
      setErrorMsg(null);
      setScanFeedback(null);
    },
    onSaleError: (msg) => {
      setRequestKeyState({
        key: effectiveRequestKey,
        lockedFingerprint: draftFingerprint,
      });
      setErrorMsg(msg);
    },
    onQuickClientSuccess: (clientId) => {
      setPosClientId(clientId);
      setReceivedReturnables([]);
      setQuickClientError(null);
      setQuickClientOpen(false);
    },
    onQuickClientError: setQuickClientError,
  });

  const hasOpenCashSession = isCashLoading ? true : Boolean(cashStatus?.activeSession);

  const readiness = useMemo(
    () =>
      computePosCheckoutReadiness({
        cartLength: posCart.length,
        totals,
        posSaleType,
        posClientId,
        selectedClient,
        hasOpenCashSession,
        isSubmitting: createSaleMutation.isPending,
        lastError: errorMsg,
        isOnline,
      }),
    [
      posCart.length,
      totals,
      posSaleType,
      posClientId,
      selectedClient,
      hasOpenCashSession,
      createSaleMutation.isPending,
      errorMsg,
      isOnline,
    ]
  );

  const handleSubmitSale = useCallback(() => {
    if (!readiness.canSubmit || createSaleMutation.isPending) return;
    setRequestKeyState({
      key: effectiveRequestKey,
      lockedFingerprint: draftFingerprint,
    });
    createSaleMutation.mutate();
  }, [
    readiness.canSubmit,
    createSaleMutation,
    effectiveRequestKey,
    draftFingerprint,
  ]);

  const handleSettleExact = useCallback(() => {
    if (posSaleType !== 'cash' || !totals.isValid || totals.grandTotal === null) return;
    setPaymentRows((prev) => [
      {
        method_code: prev[0]?.method_code || activeMethods[0]?.code || 'cash',
        amount: totals.grandTotal as number,
      },
    ]);
    setErrorMsg(null);
  }, [posSaleType, totals.isValid, totals.grandTotal, activeMethods]);

  const handleHoldCart = useCallback(() => {
    if (posCart.length === 0) return;
    holdCurrentCart({
      label: selectedClient ? selectedClient.name : `Ticket ${heldCarts.length + 1}`,
      discountAmount: globalDiscount,
      dueDate,
      paymentRows,
      receivedReturnables,
    });
    setReceivedReturnables([]);
    setGlobalDiscount(0);
    setDueDate('');
    setPaymentRows([{ method_code: 'cash', amount: 0 }]);
    setErrorMsg(null);
    setScanFeedback({
      tone: 'success',
      message: 'Panier mis en attente avec l’ensemble de son contexte.',
    });
  }, [
    posCart.length,
    holdCurrentCart,
    selectedClient,
    heldCarts.length,
    globalDiscount,
    dueDate,
    paymentRows,
    receivedReturnables,
  ]);

  const handleHoldOrOpenHeld = useCallback(() => {
    if (posCart.length > 0) {
      handleHoldCart();
    } else if (heldCarts.length > 0) {
      setHeldModalOpen(true);
    }
  }, [posCart.length, heldCarts.length, handleHoldCart]);

  const handleEscape = useCallback(() => {
    if (quickClientOpen) setQuickClientOpen(false);
    else if (heldModalOpen) setHeldModalOpen(false);
    else if (validatedSale) setValidatedSale(null);
    else if (scanFeedback) setScanFeedback(null);
  }, [quickClientOpen, heldModalOpen, validatedSale, scanFeedback]);

  usePosShortcuts({
    searchInputRef,
    canValidate: readiness.canSubmit && !createSaleMutation.isPending,
    onValidate: handleSubmitSale,
    canSettleExact:
      posSaleType === 'cash' &&
      posCart.length > 0 &&
      totals.isValid &&
      totals.grandTotal !== null &&
      totals.grandTotal > 0,
    onSettleExact: handleSettleExact,
    onHoldOrOpenHeld: handleHoldOrOpenHeld,
    hasModalOpen: quickClientOpen || heldModalOpen || Boolean(printDoc),
    onEscape: handleEscape,
  });

  const handleAddPackaging = (
    prod: Product,
    pkg: ProductPackaging,
    tier = posPriceTier
  ): boolean => {
    const built = buildCartItemFromPackaging(prod, pkg, tier);
    if (!built.ok) {
      setErrorMsg(built.error);
      return false;
    }
    setErrorMsg(null);
    addToCart(built.item);
    return true;
  };

  const handleAddSalesUnit = (
    prod: Product,
    unit: ProductSalesUnit,
    tier = posPriceTier
  ): boolean => {
    const built = buildCartItemFromSalesUnit(prod, unit, tier);
    if (!built.ok) {
      setErrorMsg(built.error);
      return false;
    }
    setErrorMsg(null);
    addToCart(built.item);
    return true;
  };

  const handlePriceTierChange = (tier: PriceTier) => {
    setPosPriceTier(tier);
    setErrorMsg(null);
    for (const cartItem of posCart) {
      if (cartItem.tierPrices) continue;
      const prod = (productsRes?.items ?? []).find((p) => p.id === cartItem.productId);
      if (!prod) continue;
      if (cartItem.salesUnitId) {
        const su = prod.sales_units?.find((u) => u.id === cartItem.salesUnitId);
        if (su) updateCartItem(cartItem.key, { unitPrice: getSalesUnitTierPrice(su, tier) });
      } else {
        const pk = prod.packagings.find((p) => p.id === cartItem.packagingId);
        if (pk) updateCartItem(cartItem.key, { unitPrice: getTierPrice(pk, tier) });
      }
    }
  };

  const handleScanEnter = async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;

    const applyMatch = (prods: Product[]) => {
      const m = matchBarcodeProduct(prods, trimmed);
      if (!m) return false;
      const added =
        m.type === 'unit'
          ? handleAddSalesUnit(m.prod, m.unit)
          : handleAddPackaging(m.prod, m.pkg);
      if (added) {
        const unitLabel =
          m.type === 'unit' ? m.unit.label : m.pkg.display_label || m.pkg.name;
        setScanFeedback({
          tone: 'success',
          message: `Ajouté au panier : ${m.prod.name} · ${unitLabel}`,
        });
        setSearch('');
      }
      return true;
    };

    if (applyMatch(productsRes?.items || [])) return;
    try {
      const fresh = await apiClient.listProducts({ search: trimmed, page: 1, pageSize: 20 });
      if (applyMatch(fresh.items || [])) return;
      setScanFeedback({
        tone: 'error',
        message: `Aucun article actif trouvé pour le code ou la référence « ${trimmed} ».`,
      });
      searchInputRef.current?.select();
    } catch {
      setScanFeedback({
        tone: 'error',
        message: `Impossible de vérifier le code « ${trimmed} » : serveur local injoignable.`,
      });
    }
  };

  return (
    <div className="space-y-4">
      {!isOnline && (
        <div
          role="status"
          className="flex items-center justify-between gap-4 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-[#BE123C] dark:text-rose-300"
        >
          <div className="flex items-center gap-2 font-medium">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>
              Mode hors ligne détecté. Votre panier reste modifiable localement ; aucune vente ne sera marquée validée tant que le serveur local n’aura pas confirmé l’écriture.
            </span>
          </div>
        </div>
      )}

      {!isCashLoading && !cashStatus?.activeSession && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 text-xs text-[#8A5A0B] dark:text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Aucune session de caisse ouverte. Ouvrez la caisse avant d&apos;encaisser une vente.
            </span>
          </div>
          <Link
            to="/cash"
            className="rounded-lg bg-[#9A6300] px-3 py-1.5 font-semibold text-white whitespace-nowrap shrink-0"
          >
            Ouvrir la caisse
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <PosCatalogPanel
          searchInputRef={searchInputRef}
          search={search}
          onSearchChange={(val) => {
            setSearch(val);
            if (scanFeedback) setScanFeedback(null);
          }}
          onScanEnter={handleScanEnter}
          scanFeedback={scanFeedback}
          onDismissScanFeedback={() => setScanFeedback(null)}
          priceTier={posPriceTier}
          onPriceTierChange={handlePriceTierChange}
          products={productsRes?.items || []}
          isLoadingProducts={isLoadingProducts}
          isFetchingProducts={isFetchingProducts}
          productsError={productsError}
          onRetryProducts={() => void refetchProducts()}
          onAddPackaging={(p, pk) => {
            handleAddPackaging(p, pk);
          }}
          onAddSalesUnit={(p, su) => {
            handleAddSalesUnit(p, su);
          }}
        />
        <PosCartPanel
          posCart={posCart}
          heldCarts={heldCarts}
          clients={clients}
          posClientId={posClientId}
          onClientChange={handleClientChange}
          posSaleType={posSaleType}
          onSaleTypeChange={(nextType) => {
            setPosSaleType(nextType);
            setErrorMsg(null);
          }}
          dueDate={dueDate}
          onDueDateChange={setDueDate}
          globalDiscount={globalDiscount}
          onGlobalDiscountChange={setGlobalDiscount}
          totals={totals}
          paymentRows={paymentRows}
          onPaymentRowsChange={setPaymentRows}
          activeMethods={activeMethods}
          errorMsg={errorMsg}
          readiness={readiness}
          isOnline={isOnline}
          isSubmitting={createSaleMutation.isPending}
          onUpdateCartItem={(key, patch) => {
            updateCartItem(key, patch);
            if (errorMsg) setErrorMsg(null);
          }}
          onRemoveFromCart={(key) => {
            removeFromCart(key);
            if (errorMsg) setErrorMsg(null);
          }}
          onClearCart={() => {
            clearCart();
            setReceivedReturnables([]);
            setGlobalDiscount(0);
            setDueDate('');
            setPaymentRows([{ method_code: 'cash', amount: 0 }]);
            setErrorMsg(null);
          }}
          onHoldCart={handleHoldCart}
          onOpenHeldModal={() => setHeldModalOpen(true)}
          onOpenQuickClient={() => {
            setQuickClientError(null);
            setQuickClientOpen(true);
          }}
          onSubmitSale={handleSubmitSale}
          clientReturnables={clientReturnables}
          isLoadingClientReturnables={isLoadingClientReturnables}
          receivedReturnables={receivedReturnables}
          onReceivedReturnableChange={(returnableId, pieces) => {
            const safePieces = Number.isFinite(pieces) ? Math.max(0, Math.trunc(pieces)) : 0;
            setReceivedReturnables((prev) => {
              const next = [...prev];
              const idx = next.findIndex((r) => r.returnable_id === returnableId);
              if (idx >= 0) next[idx] = { returnable_id: returnableId, pieces: safePieces };
              else next.push({ returnable_id: returnableId, pieces: safePieces });
              return next;
            });
          }}
          onResetReceivedReturnables={() => setReceivedReturnables([])}
        />
      </div>

      {validatedSale && (
        <ValidatedSaleBanner
          sale={validatedSale}
          onPrint={setPrintDoc}
          onClose={() => setValidatedSale(null)}
          missingPackagingNote={buildMissingPackagingNote(validatedSale.deposits)}
        />
      )}
      <HeldSalesModal
        open={heldModalOpen}
        onOpenChange={setHeldModalOpen}
        heldCarts={heldCarts}
        hasActiveCart={posCart.length > 0}
        onResume={(ticketId) => {
          const resumed = resumeHeldCart(ticketId, {
            label: selectedClient ? selectedClient.name : `Panier en cours (${posCart.length} art.)`,
            discountAmount: globalDiscount,
            dueDate,
            paymentRows,
            receivedReturnables,
          });
          if (resumed) {
            setGlobalDiscount(resumed.discountAmount);
            setDueDate(resumed.dueDate ?? '');
            setPaymentRows(
              resumed.paymentRows && resumed.paymentRows.length > 0
                ? resumed.paymentRows
                : [{ method_code: 'cash', amount: 0 }]
            );
            setReceivedReturnables(resumed.receivedReturnables ?? []);
            setErrorMsg(null);
            if (resumed.autoHeldLabel) {
              setScanFeedback({
                tone: 'success',
                message: `Ticket « ${resumed.label} » repris (${resumed.autoHeldLabel} mis en attente).`,
              });
            }
          }
          setHeldModalOpen(false);
        }}
        onDelete={deleteHeldCart}
      />
      <QuickClientModal
        open={quickClientOpen}
        onOpenChange={setQuickClientOpen}
        error={quickClientError}
        isPending={quickClientMutation.isPending}
        onSubmit={(values) => quickClientMutation.mutate(values)}
      />
      <DocumentPrintModal doc={printDoc} onClose={() => setPrintDoc(null)} />
    </div>
  );
}
