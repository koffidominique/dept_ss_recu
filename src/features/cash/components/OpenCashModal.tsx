import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as Dialog from '@radix-ui/react-dialog';
import { ModalDialog } from '../../../components/dialogs/ModalDialog.tsx';
import { MoneyInput } from '../../../components/common/MoneyInput.tsx';
import { newRequestKey } from '../../../utils/format.ts';

const openCashSchema = z.object({
  opening_cash: z.number().int().min(0, 'Le fond de caisse doit être positif ou nul.'),
});
type OpenCashFormValues = z.infer<typeof openCashSchema>;

interface OpenCashModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: string | null;
  isPending: boolean;
  onSubmit: (payload: { opening_cash: number; request_key: string }) => void;
}

/**
 * Corps du formulaire isolé dans son propre composant : Radix démonte le contenu
 * du portail à la fermeture, donc chaque ouverture repart d'un formulaire vierge
 * et d'une nouvelle `request_key`, sans `setState` dans un effet.
 */
function OpenCashForm({
  isPending,
  onSubmit,
}: Pick<OpenCashModalProps, 'isPending' | 'onSubmit'>) {
  const [keyState, setKeyState] = useState<{ key: string; amount: number | null }>(() => ({
    key: newRequestKey('open'),
    amount: null,
  }));

  const form = useForm<OpenCashFormValues>({
    resolver: zodResolver(openCashSchema),
    defaultValues: { opening_cash: 0 },
  });

  return (
    <form
      onSubmit={form.handleSubmit((vals) => {
        const effectiveKey =
          keyState.amount !== null && keyState.amount !== vals.opening_cash
            ? newRequestKey('open')
            : keyState.key;
        setKeyState({ key: effectiveKey, amount: vals.opening_cash });
        onSubmit({ opening_cash: vals.opening_cash, request_key: effectiveKey });
      })}
      noValidate
    >
      <div className="mt-4">
        <Controller
          control={form.control}
          name="opening_cash"
          render={({ field, fieldState }) => (
            <MoneyInput
              label="Fond de caisse initial en espèces *"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
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
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white disabled:text-[#6B7280] dark:disabled:text-[#9CA3AF] disabled:opacity-100"
        >
          {isPending ? 'Ouverture en cours…' : "Confirmer l'ouverture"}
        </button>
      </div>
    </form>
  );
}

export function OpenCashModal({
  open,
  onOpenChange,
  error,
  isPending,
  onSubmit,
}: OpenCashModalProps) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ouvrir la caisse"
      tipsTopicId="cash"
      tipsLabel="Aide caisse"
      maxWidthClass="max-w-md"
      error={error}
    >
      <OpenCashForm isPending={isPending} onSubmit={onSubmit} />
    </ModalDialog>
  );
}
