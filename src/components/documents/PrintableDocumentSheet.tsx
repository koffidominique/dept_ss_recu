import type { AppSettings } from '../../types/erp.ts';
import { formatDate, formatDateTime, formatFcfa } from '../../utils/format.ts';
import type { PrintableDocumentData } from './DocumentPrintModal.tsx';

const NAVY = '#1F2937';
const ORANGE = '#C65309';
const GREEN = '#00805A';

function val(v: string | null | undefined, fallback = '—'): string {
  return v && v.trim() ? v.trim() : fallback;
}

function companyLocation(company: AppSettings | undefined): string {
  return [company?.commune, company?.quartier, company?.city, company?.country]
    .filter((v) => v && v.trim())
    .join(' / ');
}

function companyPhones(company: AppSettings | undefined): string {
  const parts = [company?.phone, company?.whatsapp]
    .filter((v, i, arr) => v && v.trim() && arr.indexOf(v) === i)
    .map((v) => v!.trim());
  return parts.join(' / ');
}

function isChecked(doc: PrintableDocumentData, key: string): boolean {
  const hay = [
    doc.plannedPaymentChannel,
    doc.plannedPaymentMethod,
    ...(doc.payments?.map((p) => p.label) || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (key === 'cash') return /cash|esp[eè]ce/.test(hay);
  if (key === 'wave') return hay.includes('wave');
  if (key === 'orange_money') return hay.includes('orange');
  if (key === 'mtn_money') return hay.includes('mtn');
  if (key === 'moov_money') return hay.includes('moov');
  if (key === 'other') return /autre|other|cr[eé]dit|ch[eè]que|virement|mixed/.test(hay);
  return false;
}

function Checkbox({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[9px] text-slate-800">
      <span
        className="inline-grid h-3.5 w-3.5 place-items-center border border-slate-700 text-[9px] font-bold leading-none"
        style={{ color: checked ? GREEN : 'transparent' }}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </span>
  );
}

function Box({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-[#D1D5DB] bg-white ${className}`}>
      <div className="border-b border-[#D1D5DB] px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wide" style={{ color: ORANGE }}>
        {title}
      </div>
      <div className="px-2.5 py-2 text-[9px] leading-[1.45] text-slate-800">{children}</div>
    </section>
  );
}

function DocHeader({
  company,
  doc,
  title,
  subtitle,
}: {
  company: AppSettings | undefined;
  doc: PrintableDocumentData;
  title: string;
  subtitle?: string;
}) {
  const location = companyLocation(company);
  const phones = companyPhones(company);
  const refLabel = doc.docType.includes('COMMANDE FOURNISSEUR')
    ? 'N° BC'
    : doc.docType.includes('RÉCEPTION')
      ? 'N° BR'
      : 'N° Reçu';
  return (
    <header className="grid grid-cols-[88px_1fr_220px] gap-3 border-b-2 pb-2.5" style={{ borderColor: ORANGE }}>
      <div className="flex items-start justify-center">
        {company?.logo_path ? (
          <img src={company.logo_path} alt="Logo" className="h-[84px] w-[84px] object-contain border border-dashed border-slate-300" />
        ) : (
          <div className="grid h-[84px] w-[84px] place-items-center border border-dashed border-slate-400 px-1 text-center text-[8px] font-bold uppercase leading-tight text-slate-500">
            Emplacement
            <br />
            Logo
            <br />
            <span className="font-normal">(Cachet / Visuel)</span>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-black uppercase leading-tight" style={{ color: ORANGE }}>
          {val(company?.company_name, '[NOM DU SOUS-DÉPÔT DE BOISSONS]')}
        </div>
        <div className="mt-0.5 text-[9px] font-semibold text-slate-700">
          {val(company?.business_activity, 'Distribution & Vente de Boissons (Gros / Demi-Gros / Détail)')}
        </div>
        <div className="mt-1 space-y-0.5 text-[8.5px] text-slate-700">
          <div><span className="font-semibold">Commune / Quartier :</span> {val(location, '..........................................................')}</div>
          {company?.address ? <div><span className="font-semibold">Adresse :</span> {company.address}</div> : null}
          <div><span className="font-semibold">Tél / WhatsApp :</span> {val(phones, '+225 .... ........ / ...........')}</div>
          <div>
            <span className="font-semibold">RCCM :</span> {val(company?.rccm, 'CI-ABJ-...........')}
            {'  |  '}
            <span className="font-semibold">NCC :</span> {val(company?.ncc, '....................')}
          </div>
        </div>
      </div>
      <div className="border-2 px-2.5 py-2" style={{ borderColor: GREEN, background: '#F0FDF8' }}>
        <div className="text-center text-[12px] font-black uppercase tracking-wide" style={{ color: GREEN }}>{title}</div>
        {subtitle ? <div className="text-center text-[8px] font-semibold uppercase text-slate-500">{subtitle}</div> : null}
        <div className="mt-2 space-y-1 text-[8.5px] text-slate-800">
          <div className="flex justify-between gap-2"><span className="font-semibold">{refLabel} :</span><span className="font-bold text-right">{doc.reference}</span></div>
          {doc.linkedDocumentRef && doc.linkedDocumentRef !== doc.reference ? (
            <div className="flex justify-between gap-2"><span className="font-semibold">Réf. liée :</span><span className="text-right">{doc.linkedDocumentRef}</span></div>
          ) : null}
          <div className="flex justify-between gap-2"><span className="font-semibold">Date :</span><span>{formatDate(doc.date)}</span></div>
          <div className="flex justify-between gap-2"><span className="font-semibold">Heure :</span><span>{new Date(doc.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')}</span></div>
          <div className="flex justify-between gap-2"><span className="font-semibold">Opérateur :</span><span className="text-right">{val(doc.cashierName, '—')}</span></div>
          {doc.statusLabel ? <div className="flex justify-between gap-2"><span className="font-semibold">Statut :</span><span className="font-bold text-right" style={{ color: GREEN }}>{doc.statusLabel}</span></div> : null}
        </div>
      </div>
    </header>
  );
}

function PaymentModes({ doc }: { doc: PrintableDocumentData }) {
  const refs = doc.externalReferences?.filter(Boolean).join(' ; ');
  return (
    <section className="border border-[#D1D5DB] bg-[#FAFAFA] px-2.5 py-2 text-[9px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-extrabold uppercase" style={{ color: ORANGE }}>Mode de règlement :</span>
        <Checkbox checked={isChecked(doc, 'cash')} label="Espèces" />
        <Checkbox checked={isChecked(doc, 'wave')} label="Wave" />
        <Checkbox checked={isChecked(doc, 'orange_money')} label="Orange Money" />
        <Checkbox checked={isChecked(doc, 'mtn_money')} label="MTN MoMo" />
        <Checkbox checked={isChecked(doc, 'moov_money')} label="Moov Money" />
        <Checkbox checked={isChecked(doc, 'other')} label="Autre" />
      </div>
      <div className="mt-1.5 text-[8.5px] text-slate-700">
        <span className="font-semibold">Réf. Transaction Mobile Money / Observation :</span> {refs || '........................................................................................'}
      </div>
    </section>
  );
}

function Signatures({ leftTitle, rightTitle, rightName }: { leftTitle: string; rightTitle: string; rightName?: string | null }) {
  return (
    <section className="grid grid-cols-2 gap-4">
      <div className="min-h-[72px] border border-[#D1D5DB] px-2.5 py-2">
        <div className="text-[9px] font-extrabold text-slate-800">{leftTitle}</div>
      </div>
      <div className="min-h-[72px] border border-[#D1D5DB] px-2.5 py-2">
        <div className="text-[9px] font-extrabold text-slate-800">{rightTitle}</div>
        {rightName ? <div className="mt-6 text-[8px] text-slate-500">Nom : {rightName}</div> : null}
      </div>
    </section>
  );
}

function SummaryBox({ rows }: { rows: PrintableDocumentData['summaryRows'] }) {
  return (
    <section className="border border-[#D1D5DB]">
      <div className="border-b border-[#D1D5DB] px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wide" style={{ color: ORANGE }}>
        Décompte financier (en FCFA)
      </div>
      <div>
        {rows.map((row, i) => {
          const isNet = row.tone === 'success' || /net à payer/i.test(row.label);
          const isDue = row.tone === 'danger' || /reste à payer/i.test(row.label);
          return (
            <div
              key={`${row.label}-${i}`}
              className={`flex items-center justify-between gap-3 border-b border-[#E5E7EB] px-2.5 py-1.5 text-[9px] last:border-b-0 ${isNet ? 'font-extrabold text-white' : isDue ? 'font-extrabold' : 'text-slate-800'}`}
              style={isNet ? { background: GREEN } : isDue ? { background: '#FEF2F2', color: '#DC2626' } : undefined}
            >
              <span>{row.label}</span>
              <span className="font-mono-num whitespace-nowrap">{row.value}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProductTable({
  doc,
  minRows = 10,
  columns,
}: {
  doc: PrintableDocumentData;
  minRows?: number;
  columns: { key: string; label: string; align?: 'left' | 'center' | 'right'; width?: string }[];
}) {
  const rows = doc.lines;
  const totalRows = Math.max(minRows, rows.length);
  return (
    <section>
      <table className="w-full border-collapse text-[8.5px]">
        <thead>
          <tr style={{ background: NAVY, color: '#fff' }}>
            {columns.map((c) => (
              <th key={c.key} className={`border border-[#374151] px-1.5 py-1.5 font-bold uppercase ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: totalRows }).map((_, i) => {
            const line = rows[i];
            return (
              <tr key={i} className={i % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'}>
                {columns.map((c) => {
                  let content: React.ReactNode = '';
                  if (c.key === 'no') content = i + 1;
                  else if (c.key === 'designation') content = line ? (<><div className="font-semibold text-slate-900">{line.label}</div>{line.sublabel ? <div className="text-[7.5px] text-slate-500">{line.sublabel}</div> : null}</>) : '';
                  else if (c.key === 'conditionnement') content = line?.packagingInfo || '';
                  else if (c.key === 'qty') content = line?.quantity || '';
                  else if (c.key === 'pu') content = line?.unitPrice == null ? '' : formatFcfa(line.unitPrice);
                  else if (c.key === 'total') content = line?.total == null ? '' : formatFcfa(line.total);
                  else if (c.key === 'ordered') content = line?.orderedQuantity || line?.quantity || '';
                  else if (c.key === 'received') content = line?.quantity || '';
                  else if (c.key === 'missing') content = line?.missingQuantity || '—';
                  else if (c.key === 'damaged') content = line?.damagedQuantity || line?.refusedQuantity || '—';
                  return (
                    <td key={c.key} className={`border border-[#D1D5DB] px-1.5 py-1 align-top ${c.align === 'right' ? 'text-right font-mono-num' : c.align === 'center' ? 'text-center font-mono-num' : 'text-left'} ${c.key === 'no' ? 'text-center text-slate-500' : ''}`} style={{ height: 24 }}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PackagingTable({ doc, title, note, variant }: { doc: PrintableDocumentData; title: string; note?: string; variant: 'customer' | 'supplier-order' | 'supplier-receipt' }) {
  const lines = doc.packagingLines || [];
  const rows = Math.max(4, lines.length);
  return (
    <section className="border border-[#D1D5DB]">
      <div className="border-b border-[#D1D5DB] px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wide" style={{ color: ORANGE }}>
        {title}
      </div>
      <table className="w-full border-collapse text-[8.5px]">
        <thead>
          <tr style={{ background: '#FEF3C7', color: '#92400E' }}>
            <th className="border border-[#D1D5DB] px-1.5 py-1 text-left font-bold uppercase">Type d&apos;emballage</th>
            {variant === 'supplier-receipt' ? (
              <>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[70px]">Exigé</th>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[70px]">Remis</th>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[70px]">Écart</th>
              </>
            ) : variant === 'supplier-order' ? (
              <>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[70px]">Requis</th>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[70px]">Préparé</th>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[70px]">Manquant</th>
              </>
            ) : (
              <>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[64px]">Sortis</th>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[64px]">Rendus</th>
                <th className="border border-[#D1D5DB] px-1.5 py-1 text-center font-bold uppercase w-[64px]">Solde Dû</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => {
            const l = lines[i];
            const expected = l?.expectedQuantity ?? 0;
            const issued = l?.issuedQuantity ?? null;
            const returned = l?.returnedQuantity ?? null;
            const solde = l ? Math.max(0, (issued ?? expected) - (returned ?? 0)) : '';
            const gap = l ? Math.max(0, expected - (issued ?? 0)) : '';
            return (
              <tr key={i} className={i % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'}>
                <td className="border border-[#D1D5DB] px-1.5 py-1">{l?.label || ''}{l?.detail ? <span className="block text-[7px] text-slate-500">{l.detail}</span> : null}</td>
                {variant === 'supplier-receipt' ? (
                  <>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{l ? expected : ''}</td>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{l ? (issued ?? '—') : ''}</td>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{gap}</td>
                  </>
                ) : variant === 'supplier-order' ? (
                  <>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{l ? expected : ''}</td>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{l ? (issued ?? 0) : ''}</td>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{l ? Math.max(0, expected - (issued ?? 0)) : ''}</td>
                  </>
                ) : (
                  <>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{l ? (issued ?? expected) : ''}</td>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num">{l ? (returned ?? 0) : ''}</td>
                    <td className="border border-[#D1D5DB] px-1.5 py-1 text-center font-mono-num font-semibold">{solde}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {note ? <div className="border-t border-[#D1D5DB] px-2.5 py-1 text-[7.5px] italic text-slate-600">{note}</div> : null}
    </section>
  );
}

function Footer({ text }: { text: string }) {
  return (
    <footer className="border-t border-[#D1D5DB] pt-2 text-center text-[8px] italic text-slate-500">
      {text}
    </footer>
  );
}

export function PrintableDocumentSheet({ doc, company: companyProp }: { doc: PrintableDocumentData; company: AppSettings | undefined }) {
  const company = doc.companySnapshot || companyProp;
  const isCustomerOrder = doc.docType === 'REÇU DE COMMANDE';
  const isPurchaseOrder = doc.docType === 'BON DE COMMANDE' || doc.docType === 'BON DE COMMANDE FOURNISSEUR';
  const isPurchaseReceipt = doc.docType === 'BON DE RÉCEPTION' || doc.docType === 'BON DE RÉCEPTION FOURNISSEUR';

  if (isCustomerOrder) {
    const isDelivery = doc.deliveryMode === 'delivery' || Boolean(doc.courierName) || Boolean(doc.deliveryFeeXof && doc.deliveryFeeXof > 0);
    const notes = (doc.notes || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const filteredNotes = notes.filter((l) => !/^(Émis par :|Commande source :|Statut de la commande :|Mode de règlement prévu :|Statut du paiement :)/.test(l));
    return (
      <article className="document-sheet mx-auto w-full max-w-[794px] bg-white px-6 py-5 text-slate-900" style={{ fontFamily: 'Arial, sans-serif' }}>
        <DocHeader company={company} doc={doc} title="REÇU DE COMMANDE" />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Box title="Informations du client">
            <div className="font-bold text-[10px]">{val(doc.partyName)}</div>
            <div className="text-[8px] text-slate-500">(Maquis, Cave, Bar, Restaurant, Particulier, Événement)</div>
            {doc.customerCategory ? <div className="mt-1"><span className="font-semibold">Type :</span> {doc.customerCategory}</div> : null}
            <div className="mt-1"><span className="font-semibold">Contact (+225) :</span> {val(doc.partyPhone, '....................................')}</div>
            <div><span className="font-semibold">Quartier / Repère :</span> {val(doc.customerLocation || doc.partyDetails, '....................................')}</div>
            {doc.deliveryLandmark ? <div><span className="font-semibold">Point de repère :</span> {doc.deliveryLandmark}</div> : null}
          </Box>
          <Box title="Mode de retrait / livraison">
            <div className="space-y-1">
              <Checkbox checked={!isDelivery} label="Enlèvement sur place (au sous-dépôt)" />
              <div><Checkbox checked={isDelivery} label="Livraison à domicile / sur site" /></div>
            </div>
            <div className="mt-2 space-y-0.5">
              <div><span className="font-semibold">Livreur / Tricycle :</span> {val(doc.courierName, '....................................')}</div>
              <div><span className="font-semibold">Date / Heure prévue :</span> {val(doc.plannedDeliveryTime || (doc.deliveryDate ? formatDate(doc.deliveryDate) : null), '..... / ..... / 20..... à ..... h .....')}</div>
              {doc.secondaryPartyDetails && isDelivery ? <div><span className="font-semibold">Adresse :</span> {doc.secondaryPartyDetails}</div> : null}
            </div>
          </Box>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[9px] font-extrabold uppercase" style={{ color: ORANGE }}>Détail des boissons commandées</div>
          <ProductTable
            doc={doc}
            minRows={10}
            columns={[
              { key: 'no', label: 'N°', align: 'center', width: '34px' },
              { key: 'designation', label: 'Désignation de la boisson & format (CL)' },
              { key: 'conditionnement', label: 'Conditionnement (Casier / Pack)', align: 'center', width: '120px' },
              { key: 'qty', label: 'Qté', align: 'center', width: '54px' },
              { key: 'pu', label: 'Prix unitaire (FCFA)', align: 'right', width: '95px' },
              { key: 'total', label: 'Montant total (FCFA)', align: 'right', width: '100px' },
            ]}
          />
        </div>

        <div className="mt-3 grid grid-cols-[1fr_270px] gap-3 items-start">
          <PackagingTable
            doc={doc}
            variant="customer"
            title="Suivi des casiers & emballages réutilisables (consignes)"
            note="* Tout emballage non restitué à la livraison est facturé au tarif de consigne en vigueur."
          />
          <SummaryBox rows={doc.summaryRows} />
        </div>

        <div className="mt-3">
          <PaymentModes doc={doc} />
        </div>

        {filteredNotes.length ? (
          <div className="mt-2 border border-[#D1D5DB] px-2.5 py-1.5 text-[8px] text-slate-600">
            <span className="font-semibold">Observations :</span> {filteredNotes.join(' · ')}
          </div>
        ) : null}

        <div className="mt-3">
          <Signatures
            leftTitle="Signature & Cachet du Sous-Dépôt :"
            rightTitle="Signature du Client (Bon pour accord & réception) :"
          />
        </div>

        <div className="mt-3">
          <Footer text="Merci pour votre confiance ! Veuillez vérifier vos quantités et emballages avant de quitter le dépôt." />
        </div>
      </article>
    );
  }

  if (isPurchaseOrder) {
    return (
      <article className="document-sheet mx-auto w-full max-w-[794px] bg-white px-6 py-5 text-slate-900" style={{ fontFamily: 'Arial, sans-serif' }}>
        <DocHeader company={company} doc={doc} title="Bon de commande fournisseur" subtitle="Approvisionnement sous-dépôt" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Box title="Fournisseur">
            <div className="font-bold text-[10px]">{val(doc.partyName)}</div>
            {doc.partyPhone ? <div><span className="font-semibold">Téléphone :</span> {doc.partyPhone}</div> : null}
            {doc.partyDetails ? <div className="whitespace-pre-line"><span className="font-semibold">Adresse / Infos :</span> {doc.partyDetails}</div> : null}
          </Box>
          <Box title="Conditions de commande">
            <div><span className="font-semibold">Date prévue :</span> {doc.deliveryDate ? formatDate(doc.deliveryDate) : '—'}</div>
            <div><span className="font-semibold">Conditions paiement :</span> {val(doc.paymentTermsLabel, '—')}</div>
            <div><span className="font-semibold">Conditions commerciales :</span> {val(doc.commercialConditions, '—')}</div>
            <div><span className="font-semibold">Réf. liée :</span> {val(doc.linkedDocumentRef, '—')}</div>
          </Box>
        </div>
        <div className="mt-3">
          <div className="mb-1 text-[9px] font-extrabold uppercase" style={{ color: ORANGE }}>Produits commandés</div>
          <ProductTable
            doc={doc}
            minRows={8}
            columns={[
              { key: 'no', label: 'N°', align: 'center', width: '34px' },
              { key: 'designation', label: 'Brasserie / Marque / Désignation' },
              { key: 'conditionnement', label: 'Conditionnement', align: 'center', width: '120px' },
              { key: 'qty', label: 'Qté commandée', align: 'center', width: '80px' },
              { key: 'pu', label: 'Prix unitaire (FCFA)', align: 'right', width: '95px' },
              { key: 'total', label: 'Montant total (FCFA)', align: 'right', width: '100px' },
            ]}
          />
        </div>
        <div className="mt-3 grid grid-cols-[1fr_270px] gap-3 items-start">
          <PackagingTable
            doc={doc}
            variant="supplier-order"
            title="Casiers vides à remettre au fournisseur"
            note="Échange physique selon compatibilité des casiers. Aucun mouvement de stock à la commande."
          />
          <SummaryBox rows={doc.summaryRows} />
        </div>
        {doc.notes ? <div className="mt-2 border border-[#D1D5DB] px-2.5 py-1.5 text-[8px] text-slate-600"><span className="font-semibold">Observations :</span> {doc.notes}</div> : null}
        <div className="mt-3"><Signatures leftTitle="Signature du responsable du sous-dépôt :" rightTitle="Signature / Visa du fournisseur :" rightName={doc.cashierName} /></div>
        <div className="mt-3"><Footer text="Bon de commande fournisseur — document d'approvisionnement. La réception physique fait foi pour l'entrée en stock." /></div>
      </article>
    );
  }

  if (isPurchaseReceipt) {
    return (
      <article className="document-sheet mx-auto w-full max-w-[794px] bg-white px-6 py-5 text-slate-900" style={{ fontFamily: 'Arial, sans-serif' }}>
        <DocHeader company={company} doc={doc} title="Bon de réception fournisseur" subtitle="Contrôle d'entrée physique" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Box title="Fournisseur / Référence">
            <div className="font-bold text-[10px]">{val(doc.partyName)}</div>
            <div><span className="font-semibold">Bon de commande :</span> {val(doc.linkedDocumentRef || doc.orderReference, '—')}</div>
            {doc.partyPhone ? <div><span className="font-semibold">Téléphone :</span> {doc.partyPhone}</div> : null}
            {doc.partyDetails ? <div className="whitespace-pre-line">{doc.partyDetails}</div> : null}
          </Box>
          <Box title="Réception">
            <div><span className="font-semibold">Réceptionnaire :</span> {val(doc.cashierName, '—')}</div>
            <div><span className="font-semibold">Statut :</span> {val(doc.statusLabel, '—')}</div>
            <div><span className="font-semibold">Date :</span> {formatDateTime(doc.date)}</div>
          </Box>
        </div>
        <div className="mt-3">
          <div className="mb-1 text-[9px] font-extrabold uppercase" style={{ color: ORANGE }}>Contrôle des produits reçus</div>
          <ProductTable
            doc={doc}
            minRows={8}
            columns={[
              { key: 'no', label: 'N°', align: 'center', width: '34px' },
              { key: 'designation', label: 'Désignation / Format' },
              { key: 'ordered', label: 'Commandé', align: 'center', width: '72px' },
              { key: 'received', label: 'Reçu', align: 'center', width: '72px' },
              { key: 'missing', label: 'Manquant', align: 'center', width: '72px' },
              { key: 'damaged', label: 'Endommagé/Refusé', align: 'center', width: '90px' },
            ]}
          />
        </div>
        <div className="mt-3 grid grid-cols-[1fr_270px] gap-3 items-start">
          <PackagingTable
            doc={doc}
            variant="supplier-receipt"
            title="Contrôle des casiers vides remis"
            note="Échange physique : les casiers remis au fournisseur ne constituent pas une dette financière client."
          />
          <SummaryBox rows={doc.summaryRows} />
        </div>
        {doc.notes ? <div className="mt-2 border border-[#D1D5DB] px-2.5 py-1.5 text-[8px] text-slate-600"><span className="font-semibold">Observations / Anomalies :</span> {doc.notes}</div> : null}
        <div className="mt-3"><Signatures leftTitle="Visa réceptionnaire dépôt :" rightTitle="Signature livreur / fournisseur :" rightName={doc.cashierName} /></div>
        <div className="mt-3"><Footer text="Bon de réception fournisseur — la validation déclenche le mouvement de stock réel. L'impression ne rejoue pas la réception." /></div>
      </article>
    );
  }

  // Fallback: keep old generic layout for other document types for now
  const isPaymentReceipt = doc.docType === 'REÇU DE PAIEMENT';
  const companyDetails = [company?.business_activity, company?.address, companyLocation(company), company?.phone ? `Tél. ${company.phone}` : null, company?.rccm ? `RCCM : ${company.rccm}` : null, company?.ncc ? `NCC : ${company.ncc}` : null].filter(Boolean).join(' · ');
  return (
    <article className="document-sheet mx-auto w-full max-w-[794px] bg-white px-6 py-5 text-slate-900" style={{ fontFamily: 'Arial, sans-serif' }}>
      <DocHeader company={company} doc={doc} title={doc.docType} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Box title={doc.partyTitle || 'Tiers'}><div className="font-bold">{val(doc.partyName)}</div><div className="whitespace-pre-line">{val(doc.partyDetails, '')}</div></Box>
        <Box title={doc.secondaryPartyTitle || 'Émetteur'}><div className="font-bold">{val(company?.company_name)}</div><div className="whitespace-pre-line">{companyDetails}</div></Box>
      </div>
      {!isPaymentReceipt ? (
        <div className="mt-3">
          <ProductTable doc={doc} minRows={5} columns={[
            { key: 'no', label: 'N°', align: 'center', width: '34px' },
            { key: 'designation', label: 'Description' },
            { key: 'qty', label: 'Qté', align: 'center', width: '70px' },
            { key: 'pu', label: 'P.U. (FCFA)', align: 'right', width: '95px' },
            { key: 'total', label: 'Total (FCFA)', align: 'right', width: '100px' },
          ]} />
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-[1fr_270px] gap-3 items-start">
        <div className="border border-[#D1D5DB] px-2.5 py-2 text-[8.5px] text-slate-700 min-h-[80px]"><span className="font-bold uppercase" style={{ color: ORANGE }}>Observations</span><div className="mt-1 whitespace-pre-line">{[doc.commercialConditions, doc.notes, doc.missingPackagingNote].filter(Boolean).join('\n') || '—'}</div></div>
        <SummaryBox rows={doc.summaryRows} />
      </div>
      {doc.payments?.length ? <div className="mt-3"><PaymentModes doc={doc} /></div> : null}
      <div className="mt-3"><Signatures leftTitle="Signature tiers :" rightTitle="Signature responsable :" rightName={doc.cashierName} /></div>
      <div className="mt-3"><Footer text={`${company?.company_name || 'DEPOTPRO'} · Document généré à partir des données commerciales enregistrées.`} /></div>
    </article>
  );
}
