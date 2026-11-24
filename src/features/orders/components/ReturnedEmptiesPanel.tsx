import { useMemo, useState } from 'react';
import { AlertTriangle, PackageCheck, Undo2 } from 'lucide-react';
import type { CustomerDepositBalance, PackagingObligationRef } from '../../../types/erp.ts';
import { formatFcfa } from '../../../utils/format.ts';
import {
  aggregateDueEmpties,
  surplusWarning,
  type DueEmptyLine,
  type ReturnedEmptyLine,
} from '../utils/returnedEmpties.ts';

export type { DueEmptyLine, ReturnedEmptyLine };

interface ReturnedEmptiesPanelProps {
  deposits: CustomerDepositBalance[];
  obligations: PackagingObligationRef[];
  /** Nom du client, pour le titre. */
  clientName: string | null;
  value: ReturnedEmptyLine[];
  onChange: (next: ReturnedEmptyLine[]) => void;
  /** Désactivé quand aucun client n'est choisi. */
  disabled?: boolean;
}

export function ReturnedEmptiesPanel({
  deposits,
  obligations,
  clientName,
  value,
  onChange,
  disabled = false,
}: ReturnedEmptiesPanelProps) {
  const [ouvert, setOuvert] = useState(false);
  const dues = useMemo(() => aggregateDueEmpties(deposits, obligations), [deposits, obligations]);
  const avertissements = useMemo(() => surplusWarning(value, dues), [value, dues]);

  if (disabled || !clientName) {
    return null;
  }

  const piecesSaisies = (returnable_id: number) =>
    value.find((v) => v.returnable_id === returnable_id)?.pieces ?? 0;

  const setPieces = (ligne: DueEmptyLine, pieces: number) => {
    const propre = Math.max(0, Math.trunc(pieces) || 0);
    const sans = value.filter((v) => v.returnable_id !== ligne.returnable_id);
    if (propre === 0 || ligne.packaging_asset_id == null) {
      onChange(sans);
      return;
    }
    onChange([
      ...sans,
      {
        returnable_id: ligne.returnable_id,
        packaging_asset_id: ligne.packaging_asset_id,
        packaging_name: ligne.packaging_name,
        pieces: propre,
      },
    ]);
  };

  const totalPieces = value.reduce((acc, v) => acc + v.pieces, 0);
  const totalDette = dues.reduce((acc, d) => acc + d.due_pieces, 0);

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-300">
          <PackageCheck className="h-4 w-4" />
          <span>Emballages vides rapportés par {clientName}</span>
        </div>
        <button
          type="button"
          onClick={() => setOuvert((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:text-emerald-300"
          aria-expanded={ouvert}
        >
          <Undo2 className="h-3.5 w-3.5" />
          {ouvert ? 'Masquer' : 'Saisir les vides'}
          {totalPieces > 0 && (
            <span className="ml-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {totalPieces}
            </span>
          )}
        </button>
      </div>

      {!ouvert && totalPieces > 0 && (
        <p className="text-[11px] text-emerald-900 dark:text-emerald-200">
          {value
            .map((v) => `${v.pieces} ${v.packaging_name}`)
            .join(', ')}{' '}
          — déduits des consignes dues à l&apos;enregistrement.
        </p>
      )}

      {ouvert && (
        <>
          {dues.length === 0 ? (
            <p className="text-xs text-[#667085] dark:text-slate-400">
              Ce client ne doit aucun emballage consigné. Rien à déduire.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-white dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="bg-emerald-50 dark:bg-emerald-950/30 text-[#667085] dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      Emballage dû
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium text-right">
                      Dû
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium text-right">
                      Valeur réf.
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      Échéance
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium text-right">
                      Rapporté
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100 dark:divide-emerald-900/40">
                  {dues.map((ligne) => {
                    const saisi = piecesSaisies(ligne.returnable_id);
                    return (
                      <tr key={ligne.returnable_id}>
                        <td className="px-3 py-1.5 font-medium">{ligne.packaging_name}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {ligne.due_pieces}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num text-[#667085] dark:text-slate-400">
                          {formatFcfa(ligne.due_pieces * ligne.unit_value)}
                        </td>
                        <td className="px-3 py-1.5">
                          {ligne.overdue ? (
                            <span className="inline-flex items-center gap-1 font-medium text-[#BE123C]">
                              <AlertTriangle className="h-3 w-3" />
                              Échu
                            </span>
                          ) : (
                            <span className="text-[#667085] dark:text-slate-400">
                              {ligne.due_date ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            max={ligne.due_pieces}
                            value={saisi}
                            aria-label={`${ligne.packaging_name} rapportés`}
                            onChange={(e) => setPieces(ligne, Number(e.target.value))}
                            className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-right font-mono-num text-xs"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {avertissements.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-2">
              {avertissements.map((a, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}

          {totalPieces > 0 && (
            <p className="text-[11px] text-emerald-900 dark:text-emerald-200">
              {totalPieces} emballage(s) rapporté(s) sur {totalDette} dû(s). Ces retours soldent les
              consignes ouvertes les plus anciennes à l&apos;enregistrement de la commande.
            </p>
          )}
        </>
      )}
    </div>
  );
}
