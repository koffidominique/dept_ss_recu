import { Truck } from 'lucide-react';
import { formatFcfa } from '../../../utils/format.ts';
import type { RunInTransit } from '../../../types/erp.ts';
import {
  isCollecting,
  remainingToCollect,
  summarizeTransit,
  transitCaption,
} from '../utils/cashInTransit.ts';

/**
 * Argent en tournée — hors caisse.
 *
 * Ce panneau existe pour répondre à une question que rien ne couvrait : « où
 * est l'argent encaissé ce matin ? ». Avant lui, les encaissements déclarés
 * par les livreurs n'apparaissaient nulle part hors de la réconciliation.
 *
 * Il est volontairement séparé des cartes de synthèse de caisse, avec un
 * bandeau qui dit « hors caisse » : le montant ne doit jamais être lu comme du
 * tiroir. Seule la réconciliation le fera entrer en caisse.
 */
export function CashInTransitPanel({ runs }: { runs: RunInTransit[] | undefined }) {
  const summary = summarizeTransit(runs);
  if (!runs || runs.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-[#182230] dark:text-slate-100">
            <Truck className="h-4 w-4" aria-hidden="true" />
            Argent en tournée ({summary.runsCount})
          </h2>
          <p className="mt-0.5 max-w-xl text-[11px] text-[#8A5A0B] dark:text-amber-300">
            {transitCaption(summary.totalDeclared)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono-num text-lg font-bold text-[#8A5A0B] dark:text-amber-300">
            {formatFcfa(summary.totalDeclared)}
          </p>
          <p className="text-[11px] text-[#8A5A0B] dark:text-amber-300">
            sur {formatFcfa(summary.totalExpected)} attendus
          </p>
        </div>
      </header>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-[#8A5A0B] dark:text-amber-300">
            <tr>
              <th className="py-1 pr-3 font-medium">Tournée</th>
              <th className="py-1 pr-3 font-medium">Livreur</th>
              <th className="py-1 pr-3 font-medium">Date</th>
              <th className="py-1 pr-3 font-medium text-right">Déclaré</th>
              <th className="py-1 pr-3 font-medium text-right">Attendu</th>
              <th className="py-1 pr-3 font-medium text-right">Reste</th>
              <th className="py-1 font-medium">Arrêts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-200/60 dark:divide-amber-900/40">
            {runs.map((r) => {
              const rest = remainingToCollect(r);
              return (
                <tr key={r.runId}>
                  <td className="py-1.5 pr-3 font-mono-num font-medium">{r.reference}</td>
                  <td className="py-1.5 pr-3">{r.driverName}</td>
                  <td className="py-1.5 pr-3">{r.runDate}</td>
                  <td className="py-1.5 pr-3 text-right font-mono-num">
                    {formatFcfa(r.declaredAmount)}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono-num">
                    {formatFcfa(r.expectedAmount)}
                  </td>
                  <td
                    className={`py-1.5 pr-3 text-right font-mono-num ${
                      rest === 0
                        ? 'text-[#16A36A] dark:text-emerald-400'
                        : rest > 0
                          ? 'text-[#8A5A0B] dark:text-amber-300'
                          : 'font-semibold text-[#BE123C]'
                    }`}
                  >
                    {formatFcfa(rest)}
                  </td>
                  <td className="py-1.5 text-[11px]">
                    {r.declaredStops}/{r.plannedStops} déclaré(s)
                    {isCollecting(r) ? ' · en cours' : ' · complet'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
