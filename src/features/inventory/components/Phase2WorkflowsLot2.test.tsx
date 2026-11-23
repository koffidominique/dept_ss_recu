import '../../../test/setupDom.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { CloseCashModal } from '../../cash/components/CloseCashModal.tsx';
import { InventoryCountModal } from './InventoryCountModal.tsx';
import { OrderStepConfirm } from '../../orders/components/OrderStepConfirm.tsx';
import type { CustomerOrderDetail } from '../../../types/erp.ts';
import type { InventoryRecord } from '../types.ts';

/**
 * Les dialogues utilisent `motion/react` : le démontage annule les animations en
 * cours, ce qui produit un `AbortError` asynchrone. On laisse la boucle
 * d'événements résorber ces rejets pendant que le test est encore actif, sinon
 * Node les signale comme activité asynchrone après la fin du test.
 */
async function flushAnimations(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
}

test('CloseCashModal : exige un motif >= 10 car. sur écart significatif, demande confirmation explicite et conserve request_key stable', async () => {
  cleanup();

  const submitted: Array<{ physical_cash: number; closing_notes: string; request_key: string }> =
    [];

  render(
    <CloseCashModal
      open
      onOpenChange={() => {}}
      sessionReference="CAI-2026-0001"
      theoreticalCash={100_000}
      digitalNet={25_000}
      error={null}
      isPending={false}
      onSubmit={(vals) => submitted.push(vals)}
    />
  );

  const physInput = document.querySelector<HTMLInputElement>(
    'input[inputmode="numeric"]'
  );
  assert.ok(physInput, 'Champ espèces physiques présent');
  fireEvent.change(physInput, { target: { value: '95000' } });

  // Motif trop court (< 10 caractères pour écart -5 000 FCFA)
  const notesArea = document.getElementById('cash-closing-notes') as HTMLTextAreaElement;
  assert.ok(notesArea, 'Zone commentaire présente');
  fireEvent.change(notesArea, { target: { value: 'Court' } });

  const submitBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Vérifier & clôturer')
  );
  assert.ok(submitBtn);
  fireEvent.click(submitBtn);

  await waitFor(() => {
    const alertText = document.body.textContent ?? '';
    assert.match(alertText, /10 caractères/);
  });
  assert.equal(submitted.length, 0);

  // Motif valide -> ouvre ConfirmationDialog sans soumettre immédiatement
  fireEvent.change(notesArea, {
    target: { value: 'Manquant constaté au comptage contradictoire du soir' },
  });
  fireEvent.click(submitBtn);

  await waitFor(() => {
    const confirmBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Clôturer définitivement')
    );
    assert.ok(confirmBtn, 'La boîte de confirmation explicite doit apparaître avant clôture');
    fireEvent.click(confirmBtn);
  });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.physical_cash, 95_000);
  const firstRequestKey = submitted[0]!.request_key;
  assert.ok(firstRequestKey.startsWith('close-'));

  // Nouvelle tentative identique (ex. après erreur réseau) -> conserve la même request_key
  fireEvent.click(submitBtn);
  await waitFor(() => {
    const confirmBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Clôturer définitivement')
    );
    assert.ok(confirmBtn);
    fireEvent.click(confirmBtn);
  });
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1]?.request_key, firstRequestKey);

  cleanup();
  await flushAnimations();
});

test('InventoryCountModal : bloque les écarts sans motif et exige confirmation irréversible avant onValidate', async () => {
  cleanup();

  const inv: InventoryRecord = {
    id: 7,
    reference: 'INV-2026-0007',
    status: 'draft',
    notes: 'Contrôle hebdomadaire',
    created_at: '2026-11-23T10:00:00Z',
    validated_at: null,
    lines: [
      {
        id: 1,
        product_id: 501,
        product_name: 'Castel Beer 65cl',
        product_reference: 'PRD-501',
        base_unit: 'btl',
        theoretical_milli: 20_000,
        counted_milli: 18_000,
        reason: null,
      },
    ],
  };

  let validatedCalls = 0;
  render(
    <InventoryCountModal
      inventory={inv}
      onClose={() => {}}
      errorMsg={null}
      isPending={false}
      onValidate={() => {
        validatedCalls += 1;
      }}
    />
  );

  const validateBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Valider et ajuster le stock')
  ) as HTMLButtonElement | undefined;
  assert.ok(validateBtn);
  assert.equal(validateBtn.disabled, true, 'Bloqué tant que l’écart de -2 btl n’est pas motivé');

  const reasonInput = document.querySelector<HTMLInputElement>(
    'input[placeholder*="Casse"]'
  );
  assert.ok(reasonInput);
  fireEvent.change(reasonInput, { target: { value: '2 bouteilles cassées en rayon' } });

  assert.equal(validateBtn.disabled, false);
  fireEvent.click(validateBtn);
  assert.equal(validatedCalls, 0, 'Doit attendre la confirmation explicite');

  const confirmFinalBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Confirmer et ajuster le stock')
  );
  assert.ok(confirmFinalBtn, 'ConfirmationDialog affichée avec récapitulatif des écarts');
  fireEvent.click(confirmFinalBtn);
  assert.equal(validatedCalls, 1);

  cleanup();
  await flushAnimations();
});

test('OrderStepConfirm : bloque encaissement sans caisse ouverte, normalise "credit" -> "cash" et confirme avant livraison', async () => {
  cleanup();

  const detail: CustomerOrderDetail = {
    order: {
      id: 42,
      order_number: 'CMD-CLI-0042',
      customer_id: 9,
      customer_name: 'Maquis Le Palais',
      order_type: 'vente',
      status: 'confirmed',
      approval_status: 'approved',
      subtotal_xof: 48_000,
      discount_xof: 0,
      tax_xof: 0,
      total_xof: 48_000,
      deposit_total_xof: 7_200,
      deposit_due_xof: 7_200,
      delivery_fee_xof: 0,
      total_to_collect_xof: 55_200,
      paid_xof: 0,
      payment_status: 'unpaid',
      payment_method: 'credit',
      planned_payment_channel: 'credit',
      delivery_mode: 'pickup',
      delivery_date: null,
      delivery_address: null,
      notes: null,
      created_at: '2026-11-23T09:00:00Z',
      updated_at: '2026-11-23T09:00:00Z',
    },
    lines: [
      {
        id: 1,
        order_id: 42,
        product_id: 10,
        variant_id: 100,
        variant_name: 'Casier 12',
        product_name: 'Flag Spéciale 65cl',
        base_unit: 'btl',
        compatibility_class: 'casier_12',
        requested_unit: 'casier_12',
        requested_quantity: 4,
        base_quantity: 48,
        unit_price_xof: 12_000,
        line_total_xof: 48_000,
        discount_xof: 0,
        notes: null,
      },
    ],
    allocations: [
      {
        id: 1,
        order_id: 42,
        packaging_asset_id: 3,
        packaging_name: 'Casier plastique 12x65cl',
        compatibility_class: 'casier_12',
        capacity: 12,
        quantity: 4,
        is_consigned: 1,
        deposit_amount_xof: 7_200,
        provided_by: 'client',
        returned_quantity: 0,
        notes: null,
      },
    ],
    links: [],
    customer_deposits: [],
    payments: [],
  };

  let deliverCount = 0;
  const fullPayCalls: Array<{ requestKey: string; method: string }> = [];

  // 1) Session de caisse fermée -> bouton Encaisser solde désactivé + alerte affichée
  const { rerender } = render(
    <OrderStepConfirm
      orderDetail={detail}
      isBusy={false}
      isOwner
      hasOpenCashSession={false}
      onSubmitForApproval={() => {}}
      onConfirm={() => {}}
      onDeliver={() => {
        deliverCount += 1;
      }}
      onInvoice={() => {}}
      onPayFull={(requestKey, method) => fullPayCalls.push({ requestKey, method })}
      onPayCustom={() => {}}
      onPrintPaymentReceipt={() => {}}
      onCancel={() => {}}
      onEditDraft={() => {}}
      onReturnCrate={() => {}}
      onResetWizard={() => {}}
      onPrintReceipt={() => {}}
      onViewReceiptHistory={() => {}}
    />
  );

  assert.match(document.body.textContent ?? '', /Aucune session de caisse ouverte/);
  const payFullBtnClosed = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Encaisser solde')
  ) as HTMLButtonElement | undefined;
  assert.ok(payFullBtnClosed);
  assert.equal(payFullBtnClosed.disabled, true);

  // 2) Session de caisse ouverte -> Encaisser solde envoie method='cash' (jamais 'credit') et même requestKey au retry
  rerender(
    <OrderStepConfirm
      orderDetail={detail}
      isBusy={false}
      isOwner
      hasOpenCashSession
      onSubmitForApproval={() => {}}
      onConfirm={() => {}}
      onDeliver={() => {
        deliverCount += 1;
      }}
      onInvoice={() => {}}
      onPayFull={(requestKey, method) => fullPayCalls.push({ requestKey, method })}
      onPayCustom={() => {}}
      onPrintPaymentReceipt={() => {}}
      onCancel={() => {}}
      onEditDraft={() => {}}
      onReturnCrate={() => {}}
      onResetWizard={() => {}}
      onPrintReceipt={() => {}}
      onViewReceiptHistory={() => {}}
    />
  );

  const payFullBtnOpen = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Encaisser solde')
  ) as HTMLButtonElement | undefined;
  assert.ok(payFullBtnOpen);
  assert.equal(payFullBtnOpen.disabled, false);
  fireEvent.click(payFullBtnOpen);
  fireEvent.click(payFullBtnOpen);

  assert.equal(fullPayCalls.length, 2);
  assert.equal(fullPayCalls[0]?.method, 'cash', 'Ne doit jamais transmettre "credit" à payCustomerOrder');
  assert.equal(fullPayCalls[0]?.requestKey, fullPayCalls[1]?.requestKey, 'Même request_key sur double clic');

  // 3) Livrer exige ConfirmationDialog avant d'exécuter onDeliver
  const deliverBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Livrer (imputer consignes client)')
  );
  assert.ok(deliverBtn);
  fireEvent.click(deliverBtn);
  assert.equal(deliverCount, 0);

  const confirmDeliverBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Valider la livraison')
  );
  assert.ok(confirmDeliverBtn);
  fireEvent.click(confirmDeliverBtn);
  assert.equal(deliverCount, 1);

  cleanup();
  await flushAnimations();
});
