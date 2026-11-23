import { useUiStore } from '../../../stores/uiStore.ts';
import { ApiError } from '../ApiClient.ts';
import { redactSecrets } from '../../../features/quality/utils/operationalSafety.ts';

/* ============================================================================
 * Transport HTTP commun (JSON, CSV, binaires PDF/backups, query string)
 * ============================================================================ */

function buildHeaders(init: RequestInit): Headers {
  const token = useUiStore.getState().token;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && token !== 'cookie-session') {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-DepotPro-Token', token);
  }
  return headers;
}

export function normalizeFetchError(err: unknown): ApiError {
  if (err instanceof ApiError) {
    return err;
  }
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || /aborted|timeout/i.test(err.message))
  ) {
    return new ApiError(
      'TIMEOUT_ERROR',
      'Délai de réponse dépassé : l’opération n’a pas pu être confirmée. Vérifiez l’état avant de relancer.',
      0
    );
  }
  return new ApiError(
    'NETWORK_ERROR',
    'Connexion au serveur local indisponible (ou mode hors ligne) : aucune écriture n’a été validée. Vos saisies sont conservées.',
    0
  );
}

export async function httpRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = buildHeaders(init);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch (err) {
    throw normalizeFetchError(err);
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    useUiStore.getState().setToken(null);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    if (contentType.includes('application/json')) {
      const err = (await res.json()) as { code?: string; message?: string };
      // Le message serveur est masqué avant de devenir une exception : un jeton
      // ou une phrase secrète renvoyés par une couche basse ne doivent jamais
      // atteindre l'écran ni un log de console.
      throw new ApiError(
        err.code || 'API_ERROR',
        redactSecrets(err.message || '') || 'Erreur lors de la requête.',
        res.status
      );
    }
    throw new ApiError('HTTP_ERROR', `Erreur HTTP ${res.status}`, res.status);
  }
  if (contentType.includes('text/csv')) {
    return (await res.text()) as unknown as T;
  }
  return (await res.json()) as T;
}

export async function httpRequestBytes(path: string, init: RequestInit = {}): Promise<Uint8Array> {
  const headers = buildHeaders(init);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch (err) {
    throw normalizeFetchError(err);
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    useUiStore.getState().setToken(null);
  }
  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const err = (await res.json()) as { code?: string; message?: string };
      throw new ApiError(
        err.code || 'API_ERROR',
        redactSecrets(err.message || '') || 'Erreur lors de la requête.',
        res.status
      );
    }
    throw new ApiError('HTTP_ERROR', `Erreur HTTP ${res.status}`, res.status);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export function buildQueryString(params: Record<string, unknown> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
