import * as React from "react";
import { formatFcfa } from '../../utils/format';

export interface PaymentReceiptData {
  reference: string;
  orderReference?: string | null;
  date: string;
  cashierName?: string | null;
  statusLabel?: string;
  partyName?: string | null;
  partyDetails?: string | null;
  partyPhone?: string | null;
  externalReferences?: string[] | null;
  payments?: Array<{ label: string; amount: number }>;
  balanceAfterXof?: number | null; plannedPaymentMethod?: string;
}

export function PaymentReceipt({
  data,
  company,
}: {
  data: PaymentReceiptData;
  company: any;
}): React.ReactNode {
  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      cash: 'Espèces',
      wave: 'Wave',
      orange_money: 'Orange Money',
      mtn_money: 'MTN MoMo',
      moov_money: 'Moov Money',
    };
    return labels[method] || method;
  };

  const paidMethods = data.payments || [];
  const totalPaid = paidMethods.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4 p-4 border-t border-orange-500 border-2">
      <h3 className="text-orange-700 text-xs font-bold uppercase tracking-wider mb-3">
        RÉCU DE PAIEMENT CLIENT
      </h3>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="font-bold text-slate-600">Montant encaissé</p>
          <p className="font-mono-num text-orange-700 font-bold">
    {data.balanceAfterXof !== null && typeof data.balanceAfterXof === "number" && data.balanceAfterXof >= 0 ? formatFcfa(data.balanceAfterXof) : "—"}
          </p>
        </div>
        <div>
          <p className="font-bold text-slate-600">Mode de règlement</p>
          <p className="font-mono-num">{data.plannedPaymentMethod || '—'}</p>
        </div>
        <div>
          <p className="font-bold text-slate-600">Date / Heure</p>
          <p className="font-mono-num">{data.date}</p>
        </div>
        <div>
          <p className="font-bold text-slate-600">Utilisateur</p>
          <p className="font-mono-num">{data.cashierName || '—'}</p>
        </div>
      </div>

      {data.externalReferences?.length ? (
        <div className="mt-3 p-3 border-l border-orange-500 bg-orange-50 text-orange-700 text-xs font-semibold">
          <p className="font-bold text-slate-600">Réf. Transaction Mobile Money</p>
          <p className="font-mono-num">{data.externalReferences.join(', ')}</p>
        </div>
      ) : null}

      {data.orderReference && (
        <div className="mt-3 text-sm text-slate-500">
          <p className="font-bold text-slate-600">Commande associée</p>
          <p>{data.orderReference}</p>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-200">
        <p className="text-xs text-slate-500">
          Seule la somme réellement encaissée fait foi. La référence interne du paiement
          ne correspond pas à la référence de transaction du prestataire Mobile Money.
        </p>
      </div>
    </div>
  );
}