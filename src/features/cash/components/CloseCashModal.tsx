import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { ConfirmationDialog } from '../../../components/common/ConfirmationDialog.tsx';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { MoneyInput } from '../../../components/common/MoneyInput.tsx';
import { formatFcfa, newRequestKey } from '../../../utils/format.ts';
import { evaluateCashDiscrepancy } from '../../inventory/utils/phase2OperationsGuards.ts';
import { evaluateUnsavedChanges } from '../../quality/utils/operationalSafety.ts';

type CloseCashFormValues = {
  physical_cash: number;
  closing_notes: string;
};

interface CloseCashModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionReference?: string;
  theoreticalCash: number;
  digitalNet: number;
  error: string | null;
  isPending: boolean;
  onSubmit: (values: CloseCashFormValues & { request_key: string }) => void;
}

export function CloseCashModal({
  open,
  onOpenChange,
  sessionReference,
  theoreticalCash,
  digitalNet,
  error,
  isPending,
  onSubmit,
}: CloseCashModalProps) {
  const theoreticalCashRef = useRef(theoreticalCash);
  theoreticalCashRef.current = theoreticalCash;

  const [pendingConfirm, setPendingConfirm] = useState<
    (CloseCashFormValues & { request_key: string }) | null
  >(null);
  // Lot 4 : Fermer une clôture en cours de saisie doit être explicite.
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [keyState, setKeyState] = useState<{ key: string; sig: string | null }>(() => ({
    key: newRequestKey('close'),
    sig: null,
  }));

  const schema = useRef(
    z
      .object({
        physical_cash: z.number().int().min(0, 'Le montant physique doit être positif ou nul.'),
        closing_notes: z.string(),
      })
      .superRefine((vals, ctx) => {
        const evalRes = evaluateCashDiscrepancy(
          theoreticalCashRef.current,
          vals.physical_cash,
          vals.closing_notes
        );
        if (!evalRes.isReasonValid && evalRes.validationMessage) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['closing_notes'],
            message: evalRes.validationMessage,
          });
        }
      })
  ).current;

  const form = useForm<CloseCashFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { physical_cash: theoreticalCash, closing_notes: '' },
  });

  useEffect(() => {
    if (open) {
      form.reset({ physical_cash: theoreticalCash, closing_notes: '' });
      setPendingConfirm(null);
      setKeyState({ key: newRequestKey('close'), sig: null });
    }
  }, [open, theoreticalCash, form]);

  const unsaved = evaluateUnsavedChanges({
    dirty: Boolean(form.formState.isDirty),
    submitting: isPending,
    contextLabel: `Clôture de caisse ${sessionReference ?? ''}`.trim(),
  });

  const physicalCashWatched = form.watch('physical_cash');
  const closingNotesWatched = form.watch('closing_notes') ?? '';
  const evalPreview = evaluateCashDiscrepancy(
    theoreticalCash,
    physicalCashWatched,
    closingNotesWatched
  );
  const diffPreview = evalPreview.diffXof;
  const isShortage = diffPreview < 0;
  const isSignificant =
    evalPreview.severity === 'significant_shortage' ||
    evalPreview.severity === 'significant_surplus';

  return (
    <>
      <ModalDialog
        open={open}
        onOpenChange={(next) => {
          if (isPending) return;
          if (!next && unsaved.hasUnsavedChanges) {
            setLeavePromptOpen(true);
            return;
          }
          onOpenChange(next);
        }}
        title={`Clôture de caisse · ${sessionReference ?? ''}`}
        tipsTopicId="cash"
        tipsLabel="Règle clôture"
        maxWidthClass="max-w-md"
        error={error}
      >
        <form
          onSubmit={form.handleSubmit((vals) => {
            const sig = `${vals.physical_cash}::${vals.closing_notes.trim()}`;
            const effectiveKey =
              keyState.sig !== null && keyState.sig !== sig
                ? newRequestKey('close')
                : keyState.key;
            setKeyState({ key: effectiveKey, sig });
            setPendingConfirm({ ...vals, request_key: effectiveKey });
          })}
          noValidate
        >
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[#667085] dark:text-slate-400">
                  Espèces théoriques attendues (tiroir)
                </span>
                <span className="font-mono-num font-semibold">{formatFcfa(theoreticalCash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#667085] dark:text-slate-400">
                  Flux digitaux hors tiroir (contrôle)
                </span>
                <span className="font-mono-num">{formatFcfa(digitalNet)}</span>
              </div>
            </div>

            <Controller
              control={form.control}
              name="physical_cash"
              render={({ field, fieldState }) => (
                <MoneyInput
                  label="Espèces physiques comptées *"
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />

            <div
              role="status"
              className={`rounded-lg border px-3 py-2.5 text-xs space-y-1 ${
                diffPreview === 0
                  ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
                  : isShortage
                    ? 'border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 text-[#BE123C] dark:text-rose-300'
                    : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {diffPreview === 0 ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : isShortage ? (
                    <TrendingDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <TrendingUp className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {diffPreview === 0
                      ? 'Caisse équilibrée'
                      : isShortage
                        ? isSignificant
                          ? 'Manquant significatif en caisse'
                          : 'Manquant en caisse'
                        : isSignificant
                          ? 'Excédent significatif en caisse'
                          : 'Excédent en caisse'}
                  </span>
                </span>
                <span className="font-mono-num font-bold">
                  {diffPreview > 0 ? '+' : ''}
                  {formatFcfa(diffPreview)}
                </span>
              </div>
              {isSignificant && (
                <p className="flex items-center gap-1 text-[11px] opacity-90">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Écart ≥ 1 000 FCFA : un motif circonstancié (min. 10 caractères) sera consigné au journal d&apos;audit.
                  </span>
                </p>
              )}
            </div>

            <div>
              <label htmlFor="cash-closing-notes" className="block text-xs font-medium">
                Commentaire de clôture{' '}
                {evalPreview.requiresReason
                  ? `(obligatoire · min. ${evalPreview.minReasonLength} car.) *`
                  : '(optionnel)'}
              </label>
              <textarea
                id="cash-closing-notes"
                rows={2}
                aria-invalid={Boolean(form.formState.errors.closing_notes)}
                placeholder={
                  isSignificant
                    ? 'Précisez la cause vérifiée de cet écart (ex. rendu monnaie client, dépense non saisie)…'
                    : diffPreview !== 0
                      ? 'Justifiez brièvement l’écart constaté…'
                      : 'Observation éventuelle de fin de poste…'
                }
                {...form.register('closing_notes')}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
              {form.formState.errors.closing_notes && (
                <p className="mt-1 text-[11px] text-[#BE123C]" role="alert">
                  {form.formState.errors.closing_notes.message}
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={isPending}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
              >
                Annuler
              </button>
            </Dialog.Close>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[#182230] dark:bg-slate-100 px-4 py-2 text-xs font-semibold text-white dark:text-slate-900 disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
            >
              {isPending ? 'Clôture en cours…' : 'Vérifier & clôturer'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ConfirmationDialog
        open={Boolean(pendingConfirm)}
        onOpenChange={(next) => {
          if (!next && !isPending) setPendingConfirm(null);
        }}
        title={`Confirmer la clôture définitive · ${sessionReference ?? ''}`}
        description="Cette opération verrouille définitivement la session de caisse en cours et fige les totaux au journal d’audit."
        consequences={
          pendingConfirm
            ? [
                `Espèces théoriques attendues : ${formatFcfa(theoreticalCash)}`,
                `Espèces physiques comptées : ${formatFcfa(pendingConfirm.physical_cash)}`,
                `Écart enregistré : ${pendingConfirm.physical_cash - theoreticalCash > 0 ? '+' : ''}${formatFcfa(pendingConfirm.physical_cash - theoreticalCash)}`,
                ...(pendingConfirm.closing_notes.trim()
                  ? [`Motif / note : ${pendingConfirm.closing_notes.trim()}`]
                  : []),
              ]
            : []
        }
        confirmLabel="Clôturer définitivement"
        destructive={Boolean(
          pendingConfirm && pendingConfirm.physical_cash - theoreticalCash !== 0
        )}
        loading={isPending}
        onConfirm={() => {
          if (!pendingConfirm) return;
          const payload = pendingConfirm;
          setPendingConfirm(null);
          onSubmit(payload);
        }}
      />

      <ConfirmationDialog
        open={leavePromptOpen}
        onOpenChange={setLeavePromptOpen}
        title="Fermer sans enregistrer la clôture ?"
        description={
          unsaved.leaveWarning ??
          'Les saisies de clôture en cours seront perdues. La session restera ouverte.'
        }
        consequences={[
          'Le tiroir reste sous la responsabilité de l’opérateur en poste.',
          'Aucune écriture de clôture ne sera transmise au journal d’audit.',
        ]}
        confirmLabel="Fermer et perdre la saisie"
        cancelLabel="Continuer la clôture"
        destructive
        onConfirm={() => {
          setLeavePromptOpen(false);
          form.reset({ physical_cash: theoreticalCash, closing_notes: '' });
          onOpenChange(false);
        }}
      />
    </>
  );
}
