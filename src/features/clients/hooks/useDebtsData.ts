import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';
import { createIdempotentRequestTracker } from '../../inventory/utils/phase2OperationsGuards.ts';

export function useDebtsQueries(historySaleId: number | null) {
  const receivablesQuery = useQuery({
    queryKey: ['receivables'],
    queryFn: () => apiClient.listReceivables(),
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.getSettings(),
  });
  const historySaleQuery = useQuery({
    queryKey: ['sale', historySaleId],
    queryFn: () => apiClient.getSaleDetail(historySaleId!),
    enabled: Boolean(historySaleId),
  });

  const activeMethods = (settingsQuery.data?.paymentMethods || []).filter((m) => m.active === 1);
  return { receivablesQuery, historySaleQuery, activeMethods };
}

export function usePayReceivableMutation(options: {
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const keyTrackerRef = useRef(createIdempotentRequestTracker('recpay'));

  return useMutation({
    mutationFn: (args: {
      receivableId: number;
      note: string;
      parts: Array<{ method_code: string; amount: number }>;
    }) => {
      const cleanParts = args.parts.filter((p) => p.amount > 0);
      return apiClient.payReceivable(args.receivableId, {
        request_key: keyTrackerRef.current.resolveKey(
          JSON.stringify({ id: args.receivableId, note: args.note.trim(), parts: cleanParts })
        ),
        note: args.note,
        parts: cleanParts,
      });
    },
    onSuccess: () => {
      keyTrackerRef.current.reset();
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['sale'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      options.onSuccess();
    },
    onError: (err) => options.onError(err instanceof Error ? err.message : 'Erreur encaissement.'),
  });
}
