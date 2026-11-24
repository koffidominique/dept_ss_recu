import { useRef } from 'react';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import { createIdempotentRequestTracker } from '../../inventory/utils/phase2OperationsGuards.ts';

export const expenseSchema = z.object({
  category: z.string().trim().min(1, 'La catégorie est obligatoire.'),
  amount: z
    .number()
    .int('Montant entier FCFA requis.')
    .positive('Le montant doit être supérieur à 0 FCFA.'),
  method_code: z.string().trim().min(1, 'Choisissez un moyen de paiement.'),
  beneficiary: z.string().optional(),
  notes: z.string().optional(),
  receipt_path: z.string().nullable().optional(),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;

export function useExpensesQueries() {
  const expensesQuery = useQuery({
    queryKey: ['expenses'],
    queryFn: () => apiClient.listExpenses(),
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.getSettings(),
  });

  const activeMethods = (settingsQuery.data?.paymentMethods || []).filter((m) => m.active === 1);
  return { expensesQuery, activeMethods };
}

export function useCreateExpenseMutation(options: {
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const keyTrackerRef = useRef(createIdempotentRequestTracker('exp'));

  return useMutation({
    mutationFn: (values: ExpenseFormValues) =>
      apiClient.createExpense({
        request_key: keyTrackerRef.current.resolveKey(
          JSON.stringify({
            category: values.category.trim(),
            amount: values.amount,
            method_code: values.method_code,
            beneficiary: values.beneficiary?.trim() || '',
            notes: values.notes?.trim() || '',
          })
        ),
        category: values.category,
        amount: values.amount,
        method_code: values.method_code,
        beneficiary: values.beneficiary?.trim() || undefined,
        notes: values.notes?.trim() || undefined,
        receipt_path: values.receipt_path || null,
      }),
    onSuccess: () => {
      keyTrackerRef.current.reset();
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      options.onSuccess();
    },
    onError: (err) =>
      options.onError(err instanceof Error ? err.message : 'Erreur enregistrement dépense.'),
  });
}
