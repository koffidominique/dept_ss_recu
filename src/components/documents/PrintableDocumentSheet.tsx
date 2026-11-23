import type { AppSettings } from '../../types/erp.ts';
import { formatDate, formatDateTime, formatFcfa } from '../../utils/format.ts';
import type { PrintableDocumentData } from './DocumentPrintModal.tsx';

function companyDetails(company: AppSettings | undefined) {
  return [
    company?.business_activity,
    company?.address,
    [company?.commune, company?.quartier, company?.city, company?.country].filter(Boolean).join(', '),
    company?.phone ? `Tél. ${company.phone}` : null,
    company?.whatsapp && company.whatsapp !== company.phone ? `WhatsApp ${company.whatsapp}` : null,
    company?.email,
    company?.rccm ? `RCCM : ${company.rccm}` : null,
    company?.ncc ? `NCC : ${company.ncc}` : null,
  ].filter(Boolean).join(' · ');
}

function matchPaymentChannel(doc: PrintableDocumentData, key: string): boolean {
  const hay = [
    doc.plannedPaymentChannel,
    doc.plannedPaymentMethod,
    ...(doc.payments?.map((p) => p.label) || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (key === 'cash') return hay.includes('cash') || hay.includes('esp');
  if (key === 'wave') return hay.includes('wave');
  if (key === 'orange_money') return hay.includes('orange');
  if (key === 'mtn_money') return hay.includes('mtn');
  if (key === 'moov_money') return hay.includes('moov');
  if (key === 'credit') return hay.includes('credit') || hay.includes('crédit') || hay.includes('autre') || hay.includes('other') || hay.includes('mixed');
  return false;
}

export function PrintableDocumentSheet({
  doc,
  company,
}: {
  doc: PrintableDocumentData;
  company: AppSettings | undefined;
}) {
  const isOrderReceipt =
    doc.docType === 'REÇU DE COMMANDE' ||
    doc.docType === 'BON DE COMMANDE CLIENT – ACCUSÉ DE RÉCEPTION';
  const isPaymentReceipt = doc.docType === 'REÇU DE PAIEMENT';
  const isCustomerReceipt = ['REÇU DE VENTE', 'REÇU DE COMMANDE', 'BON DE COMMANDE CLIENT – ACCUSÉ DE RÉCEPTION'].includes(doc.docType);
  const isPurchaseOrder = doc.docType === 'BON DE COMMANDE' || doc.docType === 'BON DE COMMANDE FOURNISSEUR';
  const isPurchaseReceipt = doc.docType === 'BON DE RÉCEPTION' || doc.docType === 'BON DE RÉCEPTION FOURNISSEUR';
  const secondaryName = doc.secondaryPartyName || company?.company_name || 'Sous-dépôt';
  const secondaryDetails = doc.secondaryPartyDetails || companyDetails(company);
  const senderTitle = (isPurchaseOrder || isPurchaseReceipt) ? 'FOURNISSEUR' : (doc.partyTitle || 'CLIENT');
  const receiverTitle = doc.secondaryPartyTitle || (isPurchaseOrder ? 'LIVRER À' : 'DESTINATAIRE');
  const clientSignatures = isCustomerReceipt || isPaymentReceipt || doc.partyTitle?.toLowerCase().includes('client');

  if (isOrderReceipt) {
    const notes = (doc.notes || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const cashier =
      doc.cashierName ||
      notes.find((line) => line.startsWith('Émis par :'))?.replace('Émis par :', '').trim() ||
      'Caissier / Opérateur';
    const operationalNotes = notes.filter(
      (line) => !/^(Émis par :|Commande source :|Statut de la commande :|Mode de règlement prévu :|Statut du paiement :)/.test(line),
    );
    const drinkLines = doc.lines.filter((line) => !line.label.startsWith('Emballage :'));
    const isDelivery =
      doc.deliveryMode === 'delivery' ||
      Boolean(doc.courierName) ||
      Boolean(doc.deliveryFeeXof && doc.deliveryFeeXof > 0) ||
      (Boolean(doc.secondaryPartyDetails) && doc.secondaryPartyDetails !== 'À retirer au sous-dépôt' && doc.secondaryPartyDetails !== 'Enlèvement sur place (au sous-dépôt)');

    const extRefs = doc.externalReferences?.length
      ? doc.externalReferences.join(', ')
      : null;

    const depotLocation = [company?.commune, company?.quartier, company?.city, company?.country]
      .filter(Boolean)
      .join(' / ');

    return (
      <article className="order-receipt-sheet bg-white px-5 py-5 text-slate-800 sm:px-7">
        <header className="order-receipt-header">
          <div className="order-receipt-brand">
            {company?.logo_path ? (
              <img src={company.logo_path} alt="Logo du sous-dépôt" />
            ) : (
              <div className="order-receipt-logo-placeholder">LOGO DU DÉPÔT</div>
            )}
            <div className="min-w-0">
              <h1>{company?.company_name || 'SOUS-DÉPÔT DE BOISSONS'}</h1>
              {company?.business_activity && <p className="font-semibold">{company.business_activity}</p>}
              {company?.address && <p>Adresse : {company.address}</p>}
              {depotLocation && <p>Localisation : {depotLocation}</p>}
              {(company?.phone || company?.whatsapp) && (
                <p>
                  {company?.phone ? `Tél : ${company.phone}` : ''}
                  {company?.phone && company?.whatsapp ? ' · ' : ''}
                  {company?.whatsapp ? `WhatsApp : ${company.whatsapp}` : ''}
                </p>
              )}
              {(company?.rccm || company?.ncc || company?.email) && (
                <p>
                  {[
                    company?.rccm ? `RCCM : ${company.rccm}` : null,
                    company?.ncc ? `NCC : ${company.ncc}` : null,
                    company?.email || null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <div className="order-receipt-number order-receipt-number--right">
            <strong className="text-green-700 border-green-300 border rounded px-3 py-1 text-sm font-bold">
              REÇU DE COMMANDE
            </strong>
            <small className="text-sm">
              {doc.version && doc.version > 1
                ? `VERSION CORRIGÉE V${doc.version}`
                : 'DOCUMENT OFFICIEL'}
            </small>
            <span className="font-bold">
              N° Reçu : <b>{doc.reference}</b>
            </span>
            {doc.orderReference && <span>Réf. Commande : {doc.orderReference}</span>}
            <span>Date / Heure : {formatDateTime(doc.date)}</span>
            <span>Caissier / Agent : {cashier}</span>
            {doc.statusLabel && <span>Statut : <b>{doc.statusLabel}</b></span>}
          </div>
        </header>

        {doc.revisionReason && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-[8.5px] font-semibold text-amber-900">
            Révision propriétaire (V{doc.version}) — Motif : {doc.revisionReason}
          </div>
        )}

        <div className="order-receipt-party-grid">
          <section>
            <h2>INFORMATIONS CLIENT</h2>
            <p className="font-bold text-[10px]">
              {doc.partyName || '—'}
              {doc.customerEstablishment ? ` · ${doc.customerEstablishment}` : ''}
            </p>
            {doc.customerCategory && <p>Catégorie : {doc.customerCategory}</p>}
            {doc.partyPhone && <p>Téléphone : {doc.partyPhone}</p>}
            {(doc.customerLocation || doc.partyDetails) && (
              <p>Quartier / Zone : {doc.customerLocation || doc.partyDetails}</p>
            )}
            {doc.deliveryLandmark && <p>Point de repère : {doc.deliveryLandmark}</p>}
          </section>
          <section>
            <h2>LOGISTIQUE &amp; LIVRAISON</h2>
            <p className="font-semibold">
              [{!isDelivery ? 'x' : ' '}] Enlèvement au Dépôt &nbsp;&nbsp; [{isDelivery ? 'x' : ' '}] Livraison à Domicile
            </p>
            <p>Adresse / Zone : {doc.secondaryPartyDetails || 'À retirer au sous-dépôt'}</p>
            {doc.courierName && <p>Livreur / Tricycle : <b>{doc.courierName}</b></p>}
            <p>
              Date / Heure prévue :{' '}
              {doc.plannedDeliveryTime || (doc.deliveryDate ? formatDate(doc.deliveryDate) : 'Non précisée')}
            </p>
          </section>
        </div>

        {/* Orange separation line */}
        <div className="mt-4 border-orange-500 border-b border-2 pb-4">

        </div>

        <section className="order-receipt-products">
          <h2 className="text-orange-700 border-b border-orange-300 border-b px-2 py-1 text-xs font-bold uppercase tracking-wider">
            DÉTAIL DES BOISSONS COMMANDÉES
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-orange-300 bg-orange-50 text-orange-800 uppercase text-xs font-bold">
                <th className="p-2 text-left">N°</th>
                <th className="p-2 text-left">Désignation Boisson & Format</th>
                <th className="p-2 text-center">Conditionnement</th>
                <th className="p-2 text-center">Qté</th>
                <th className="p-2 text-right">P.U. (FCFA)</th>
                <th className="p-2 text-right">Total (FCFA)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(10, drinkLines.length) }, (_, index) => {
                const line = drinkLines[index];
                return (
                  <tr key={line ? `${line.label}-${index}` : `blank-${index}`} className={!line ? 'order-receipt-empty-row' : undefined}>
                    <td>{index + 1}</td>
                    <td>
                      {line && <>
                        <span className="font-semibold">{line.label}</span>
                        {line.sublabel && <span className="block text-[7.5px] text-slate-500">{line.sublabel}</span>}
                      </>}
                    </td>
                    <td>{line?.packagingInfo || ''}</td>
                    <td className="font-mono-num font-semibold">{line?.quantity || ''}</td>
                    <td className="font-mono-num">{line?.unitPrice == null ? '' : formatFcfa(line.unitPrice)}</td>
                    <td className="font-mono-num font-semibold">{line?.total == null ? '' : formatFcfa(line.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="order-receipt-bottom-grid">
          <div className="space-y-2">
            <section className="order-receipt-packaging">
              <h2 className="text-green-700 border-b border-green-300 border-b px-2 py-1 text-xs font-bold uppercase tracking-wider">SUIVI DES CASIERS & BOUTEILLES VIDES (CONSIGNES)</h2>
              {doc.packagingLines?.length ? (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>Type d&apos;emballage</th>
                        <th>Sortis</th>
                        <th>Rendus</th>
                        <th>Solde dû</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.packagingLines.map((line, index) => (
                        <tr key={`${line.label}-${index}`}>
                          <td>
                            {line.label}
                            <small>{line.statusLabel}</small>
                          </td>
                          <td className="text-center font-mono-num">{line.issuedQuantity ?? line.expectedQuantity}</td>
                          <td className="text-center font-mono-num">{line.returnedQuantity ?? 0}</td>
                          <td className="text-center font-mono-num font-semibold">
                            {Math.max(0, (line.issuedQuantity ?? line.expectedQuantity) - (line.returnedQuantity ?? 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 rounded border border-amber-200 bg-amber-50/70 p-1.5 text-[7.5px] font-medium text-amber-900">
                    Délai de retour des emballages consignés : <b>15 jours maximum</b> à compter de l’émission. Le montant des retours d’emballages est comptabilisé <b>hors total commande</b>.
                  </p>
                </>
              ) : (
                <p className="rounded border border-slate-200 p-2 text-[8px] text-slate-500">
                  Aucun emballage consigné sur cette commande.
                </p>
              )}
            </section>
            {operationalNotes.length > 0 && (
              <p className="order-receipt-notes rounded border border-slate-200 p-2">
                <b>Observations :</b> {operationalNotes.join(' · ')}
              </p>
            )}
          </div>

          <section className="order-receipt-finance">
            <h2 className="text-orange-700 border-b border-orange-300 border-b px-2 py-1 text-xs font-bold uppercase tracking-wider">DÉCOMPTE FINANCIER (FCFA)</h2>
            <div className="order-receipt-summary">
              {doc.summaryRows.map((row, index) => {
                const isNet = row.tone === 'success' || /net à (payer|percevoir)/i.test(row.label);
                const isDue = row.tone === 'danger' || /reste à payer/i.test(row.label);
                return (
                  <div
                    key={`${row.label}-${index}`}
                    className={`${isNet ? 'is-total' : ''} ${isDue ? 'is-due' : ''}`}
                  >
                    <span>{row.label}</span>
                    <b className="font-mono-num">{row.value}</b>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="order-receipt-payment">
          <div className="flex flex-wrap items-center justify-between gap-2 text-orange-700">
            <b>MODE DE RÈGLEMENT / CANAL PRÉVU</b>
            {extRefs && <span>Réf. Mobile Money / Externe : <b>{extRefs}</b></span>}
          </div>
          <div className="order-receipt-payment-channels">
            <span>[{matchPaymentChannel(doc, 'cash') ? 'x' : ' '}] Espèces</span>
            <span>[{matchPaymentChannel(doc, 'wave') ? 'x' : ' '}] Wave</span>
            <span>[{matchPaymentChannel(doc, 'orange_money') ? 'x' : ' '}] Orange Money</span>
            <span>[{matchPaymentChannel(doc, 'mtn_money') ? 'x' : ' '}] MTN Money</span>
            <span>[{matchPaymentChannel(doc, 'moov_money') ? 'x' : ' '}] Moov Money</span>
            <span>[{matchPaymentChannel(doc, 'credit') ? 'x' : ' '}] Crédit / Autre</span>
          </div>
          {doc.payments?.length ? (
            <div className="mt-1.5 border-t border-slate-200 pt-1 space-y-0.5">
              {doc.payments.map((payment, index) => (
                <div key={`${payment.label}-${index}`} className="flex justify-between gap-3">
                  <span>{payment.label}</span>
                  <b className="font-mono-num">{formatFcfa(payment.amount)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-[8px] text-slate-500">
              Aucun règlement effectif enregistré à l&apos;émission de ce reçu.
            </div>
          )}
        </section>

        <section className="order-receipt-signatures">
          <div>
            <b>VISA DU CLIENT</b>
            <p className="mt-4 text-[8px] text-slate-500">Nom &amp; Signature (bon pour accord &amp; quantités)</p>
          </div>
          <div>
            <b>VISA DU CAISSIER / DÉPÔT</b>
            <p className="mt-4 text-[8px] text-slate-500">{cashier} · Cachet &amp; Signature</p>
          </div>
        </section>

        <footer className="mt-8">
          Merci pour votre confiance ! Veuillez vérifier vos quantités et emballages avant de quitter le dépôt.
        </footer>

        {/* Page 2: Thank you message */}
        <div className="mt-8 page-break-inside-avoid second-page">
          <div className="max-w-2xl mx-auto px-5 py-10 text-center">
            <p className="text-2xl text-green-700 font-bold mb-6">
              Merci pour votre confiance&nbsp;!
            </p>
            <p className="text-slate-600 text-lg mb-8">
              Veuillez vérifier vos quantités et emballages avant de quitter le dépôt.
            </p>
            <div className="border border-slate-300 p-4 rounded mb-6">
              <h3 className="text-orange-700 text-xs font-bold uppercase tracking-wider mb-3">
                RÉFÉRENCE RAPIDE
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="font-bold text-slate-600">N° Reçu</p>
                  <p className="font-mono-num font-bold">{doc.reference}</p>
                </div>
                <div>
                  <p className="font-bold text-slate-600">Montant Total</p>
                  <p className="font-mono-num font-bold text-orange-700">
                    {doc.summaryRows.find(
                      (r) =>
                        /NET À PAYER|TOTAL/i.test(r.label) &&
                        !/hors total|total liquide|total marchandises/i.test(r.label)
                    )?.value || '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="document-sheet space-y-5 bg-white px-7 py-7 text-black sm:px-10 sm:py-9">
      <header className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-black uppercase leading-none tracking-tight sm:text-3xl">
            {isPurchaseOrder ? 'BON DE COMMANDE FOURNISSEUR' : isPurchaseReceipt ? 'BON DE RÉCEPTION FOURNISSEUR' : doc.docType}
          </h1>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {isPaymentReceipt
              ? 'Justificatif officiel d’encaissement client (trésorerie / mobile money / espèces)'
              : isCustomerReceipt
                ? 'Reçu client · Détail des marchandises et des emballages remis'
                : isPurchaseOrder
                  ? 'Demande d’approvisionnement fournisseur · Ne modifie pas le stock'
                  : isPurchaseReceipt
                    ? 'Contrôle d’entrée physique en stock & échange d’emballages vides'
                    : 'Document commercial'}
          </p>
        </div>
        <div className="flex max-w-[48%] items-start gap-3 text-right">
          {company?.logo_path ? (
            <img src={company.logo_path} alt={company.company_name || 'Logo'} className="h-14 w-14 shrink-0 object-contain" />
          ) : (
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-950 text-lg font-black text-white">
              {(company?.company_name || 'DP').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <div className="font-display text-base font-extrabold uppercase leading-tight">{company?.company_name || 'DEPOTPRO'}</div>
            {company?.company_legal_name && <div className="mt-0.5 text-[11px] text-slate-600">{company.company_legal_name}</div>}
            <div className="mt-1 max-w-64 text-[10px] leading-relaxed text-slate-600">{companyDetails(company) || 'Coordonnées à compléter dans les paramètres'}</div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 divide-x divide-white bg-black text-white sm:grid-cols-3">
        <div className="px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-300">N° document</div>
          <div className="mt-0.5 font-mono-num text-base font-bold">{doc.reference}</div>
          {doc.linkedDocumentRef && doc.linkedDocumentRef !== doc.reference && (
            <div className="mt-0.5 text-[10px] text-slate-300">Réf. liée : {doc.linkedDocumentRef}</div>
          )}
        </div>
        <div className="px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Date d’émission</div>
          <div className="mt-0.5 text-sm font-bold">{formatDateTime(doc.date)}</div>
          {doc.deliveryDate && <div className="mt-0.5 text-[10px]">Livraison prévue : {formatDate(doc.deliveryDate)}</div>}
        </div>
        <div className="px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Émis / Contrôlé par</div>
          <div className="mt-0.5 text-sm font-bold">{doc.cashierName || 'Opérateur dépôt'}</div>
          {doc.statusLabel && <div className="mt-0.5 text-[10px] uppercase">{doc.statusLabel}</div>}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4">
        <div className="min-h-24 border border-black">
          <h2 className="bg-black px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">{senderTitle}</h2>
          <div className="space-y-1 px-3 py-2 text-xs">
            <div className="font-bold">{doc.partyName || '—'}</div>
            {doc.partyDetails && <div className="whitespace-pre-line leading-relaxed text-slate-700">{doc.partyDetails}</div>}
            {doc.partyPhone && !doc.partyDetails?.includes(doc.partyPhone) && <div>Tél. {doc.partyPhone}</div>}
          </div>
        </div>
        <div className="min-h-24 border border-black">
          <h2 className="bg-black px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">{receiverTitle}</h2>
          <div className="space-y-1 px-3 py-2 text-xs">
            <div className="font-bold">{secondaryName}</div>
            {secondaryDetails && <div className="whitespace-pre-line leading-relaxed text-slate-700">{secondaryDetails}</div>}
            {doc.paymentTermsLabel && <div>Conditions : {doc.paymentTermsLabel}</div>}
            {doc.externalReferences?.length ? (
              <div className="font-mono-num font-semibold text-blue-700">
                Réf. Txn externe : {doc.externalReferences.join(', ')}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {!isPaymentReceipt && (
        <div className="overflow-hidden border border-black">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-black text-white">
              <tr>
                <th className="w-[15%] px-2 py-2 text-center font-bold uppercase">Qté</th>
                <th className="px-2 py-2 font-bold uppercase">Description</th>
                <th className="w-[18%] px-2 py-2 text-right font-bold uppercase">Prix unitaire</th>
                <th className="w-[19%] px-2 py-2 text-right font-bold uppercase">Total</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.length ? doc.lines.map((line, index) => (
                <tr key={`${line.label}-${index}`} className="border-t border-black align-top">
                  <td className="border-r border-black px-2 py-2 text-center font-mono-num">{line.quantity}</td>
                  <td className="border-r border-black px-2 py-2">
                    <div className="font-semibold">{line.label}</div>
                    {line.sublabel && <div className="mt-0.5 whitespace-pre-line text-[10px] leading-relaxed text-slate-600">{line.sublabel}</div>}
                    {(line.missingQuantity || line.damagedQuantity || line.refusedQuantity || line.discrepancyReason) && (
                      <div className="mt-1 rounded bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-800">
                        {[
                          line.missingQuantity ? `Manquant : ${line.missingQuantity}` : null,
                          line.damagedQuantity ? `Endommagé : ${line.damagedQuantity}` : null,
                          line.refusedQuantity ? `Refusé : ${line.refusedQuantity}` : null,
                          line.discrepancyReason ? `Motif : ${line.discrepancyReason}` : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="border-r border-black px-2 py-2 text-right font-mono-num">{line.unitPrice == null ? '—' : formatFcfa(line.unitPrice)}</td>
                  <td className="px-2 py-2 text-right font-mono-num font-semibold">{line.total == null ? '—' : formatFcfa(line.total)}</td>
                </tr>
              )) : <tr className="border-t border-black"><td colSpan={4} className="px-3 py-6 text-center text-slate-500">Aucune ligne</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {doc.packagingLines && doc.packagingLines.length > 0 && (
        <section className="border border-slate-400 p-3 text-xs">
          <h2 className="mb-2 font-bold uppercase">
            {isPurchaseOrder
              ? 'Emballages vides à préparer'
              : isPurchaseReceipt
                ? 'Emballages vides remis au fournisseur'
                : isCustomerReceipt || doc.docType === 'FACTURE'
                  ? 'Emballages consignés & retours client (délai : 15 jours max)'
                  : 'Emballages physiques / consignes'}
          </h2>
          <div className="divide-y divide-slate-200">
            {doc.packagingLines.map((line, index) => {
              const isClientReturnOnly =
                line.expectedQuantity === 0 && (line.returnedQuantity ?? 0) > 0;
              return (
                <div key={`${line.label}-${index}`} className="grid grid-cols-[1fr_auto] gap-2 py-2">
                  <div>
                    <div className="font-semibold">
                      {line.label} ·{' '}
                      {line.kind === 'bottle'
                        ? 'bouteilles'
                        : line.kind === 'crate'
                          ? 'casiers'
                          : 'autre'}
                    </div>
                    {line.detail && <div className="text-[10px] text-slate-600">{line.detail}</div>}
                    <div className="text-[10px] font-medium text-slate-700">{line.statusLabel}</div>
                  </div>
                  <div className="text-right font-mono-num">
                    {isClientReturnOnly ? (
                      <>
                        <div className="font-semibold text-emerald-700">
                          Retour reçu : {line.returnedQuantity} pcs
                        </div>
                        {line.amount != null && (
                          <div className="text-[10px] text-emerald-700">
                            {formatFcfa(line.amount)} (hors total)
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div>Attendu : {line.expectedQuantity}</div>
                        {line.issuedQuantity != null && <div>Remis : {line.issuedQuantity}</div>}
                        {line.returnedQuantity != null && (
                          <div>
                            Retourné : {line.returnedQuantity} · Solde :{' '}
                            {Math.max(0, line.expectedQuantity - line.returnedQuantity)}
                          </div>
                        )}
                        {line.amount != null && <div>{formatFcfa(line.amount)}</div>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {(isCustomerReceipt || doc.docType === 'FACTURE') && (
            <p className="mt-2 border-t border-slate-200 pt-1.5 text-[10px] font-medium text-slate-700">
              Délai de retour des emballages consignés : 15 jours maximum à compter de l’émission. Le montant des retours d’emballages est comptabilisé hors total commande.
            </p>
          )}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-[1.2fr_0.8fr]">
        <div className="border border-black">
          <h2 className="bg-black px-3 py-2 text-xs font-bold text-white">Observations et conditions</h2>
          <div className="min-h-24 whitespace-pre-line px-3 py-3 text-xs leading-relaxed text-slate-700">
            {[doc.commercialConditions, doc.notes, doc.missingPackagingNote].filter(Boolean).join('\n') || (isPurchaseOrder
              ? 'Merci de confirmer la disponibilité et le délai de livraison. Toute réception physique sera contrôlée séparément.'
              : 'Merci pour votre confiance.')}
          </div>
        </div>
        <div className="space-y-2 self-start px-1 py-1 text-xs">
          {(doc.summaryRows || []).map((row, index) => {
            const emphasis =
              row.bold ||
              (!/hors total/i.test(row.label) &&
                /total|reste à payer|montant encaissé|net commande/i.test(row.label));
            return (
              <div key={`${row.label}-${index}`} className={`flex justify-between gap-3 ${emphasis ? 'border-t border-black pt-2 text-sm font-bold' : ''} ${row.tone === 'danger' ? 'text-red-700' : row.tone === 'success' ? 'text-emerald-700' : row.tone === 'warning' ? 'text-amber-700' : ''}`}>
                <span>{row.label}</span><span className="shrink-0 text-right font-mono-num">{row.value}</span>
              </div>
            );
          })}
        </div>
      </section>

      {doc.payments && doc.payments.length > 0 && (
        <section className="border border-slate-400 p-3 text-xs">
          <h2 className="mb-2 font-bold uppercase">Règlements enregistrés</h2>
          {doc.payments.map((payment, index) => <div key={`${payment.label}-${index}`} className="flex justify-between border-t border-slate-200 py-1"><span>{payment.label}</span><span className="font-mono-num font-semibold">{formatFcfa(payment.amount)}</span></div>)}
        </section>
      )}

      <section className="grid grid-cols-2 gap-5 pt-1 text-xs">
        <div className="min-h-24 border border-slate-400 px-3 py-2">
          <div className="font-bold">{clientSignatures ? (isPaymentReceipt ? 'Signature du payeur / client' : 'Reçu par le client') : (isPurchaseOrder || isPurchaseReceipt) ? 'Visa du fournisseur' : 'Le tiers'}</div>
          <div className="mt-2 space-y-3 text-slate-600"><div>Nom : __________________________</div><div>Date et signature : __________________________</div></div>
        </div>
        <div className="min-h-24 border border-slate-400 px-3 py-2">
          <div className="font-bold">{isPurchaseOrder ? 'Émis par le sous-dépôt' : isPurchaseReceipt ? 'Réceptionné par le sous-dépôt' : isPaymentReceipt ? 'Caissier / Responsable encaissement' : 'Responsable du sous-dépôt'}</div>
          <div className="mt-2 space-y-3 text-slate-600"><div>Nom : {doc.cashierName || '__________________________'}</div><div>Date et cachet : __________________________</div></div>
        </div>
      </section>

      <footer className="border-t border-slate-300 pt-3 text-center text-[10px] italic text-slate-500">
        {doc.docType === 'REÇU DE VENTE'
          ? 'Reçu de vente détaillé ; les marchandises, emballages remis, règlements et solde sont indiqués séparément.'
          : isPaymentReceipt
            ? 'Reçu de paiement officiel ; seul ce justificatif atteste de la somme encaissée en caisse ou via Mobile Money.'
            : isPurchaseOrder
              ? 'Bon de commande fournisseur émis sous réserve de validation et de contrôle quantitatif à la réception.'
              : isPurchaseReceipt
                ? 'Bon de réception physique lié au bon de commande indiqué ; les emballages remis sont un échange matériel.'
                : `${company?.company_name || 'DEPOTPRO'} · Document généré à partir des données commerciales enregistrées.`}
        <div className="mt-1 not-italic">Réf. {doc.reference} · {company?.company_name || 'DEPOTPRO'}</div>
      </footer>
    </article>
  );
}
