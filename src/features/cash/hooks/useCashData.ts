import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/createApiClient.ts';

export function useCashQuery() {
  return useQuery({
    queryKey: ['cash'],
    queryFn: () => apiClient.getCashStatus(),
  });
}

interface UseCashMutationsOptions {
  activeSessionId: number | null;
  onOpened: () => void;
  onClosed: () => void;
  onError: (msg: string) => void;
}

export function useCashMutations({
  activeSessionId,
  onOpened,
  onClosed,
  onError,
}: UseCashMutationsOptions) {
  const qc = useQueryClient();

  const openMut = useMutation({
    mutationFn: (input: { opening_cash: number; request_key: string }) =>
      apiClient.openCashSession({
        opening_cash: input.opening_cash,
        request_key: input.request_key,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onOpened();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : 'Erreur ouverture caisse.'),
  });

  const closeMut = useMutation({
    mutationFn: (input: {
      physical_cash: number;
      closing_notes: string;
      request_key: string;
    }) => {
      if (!activeSessionId) throw new Error('Aucune session ouverte');
      return apiClient.closeCashSession({
        session_id: activeSessionId,
        physical_cash: input.physical_cash,
        closing_notes: input.closing_notes.trim(),
        request_key: input.request_key,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      onClosed();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : 'Erreur clôture caisse.'),
  });

  return { openMut, closeMut };
}
