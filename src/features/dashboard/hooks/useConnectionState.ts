import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  describeLocalServerState,
  resolveLocalServerState,
  type LocalServerMessage,
  type LocalServerState,
} from '../../quality/utils/operationalSafety.ts';

/**
 * État de connexion **au serveur local**, pas seulement de la carte réseau.
 *
 * Le Lot 3 se contentait de `navigator.onLine`, qui vaut `true` quand le wifi
 * fonctionne — y compris si le processus du serveur local est arrêté, cas très
 * fréquent sur un poste de dépôt. Ce hook distingue donc trois états :
 *
 *  - `offline` : le navigateur lui-même n'a pas de réseau ;
 *  - `server-unreachable` : le poste a du réseau, mais le serveur local ne
 *    répond plus (dernier appel en `NETWORK_ERROR` / `TIMEOUT_ERROR`) ;
 *  - `online` : le dernier appel API a abouti.
 *
 * Il ne prétend jamais qu'une écriture a réussi : il sert à avertir **avant**
 * l'action, ou à expliquer pourquoi une action vient d'échouer.
 */
export interface ConnectionState {
  isOnline: boolean;
  /** Compatibilité Lot 3 : `true` uniquement si le serveur local répond. */
  serverState: LocalServerState;
  offlineSince: Date | null;
  /** Message prêt à afficher (déjà formulé, jamais une fausse confirmation). */
  message: LocalServerMessage | null;
}

/** Délai au-delà duquel un succès ancien ne prouve plus que le serveur vit. */
const PROBE_TTL_MS = 60_000;

/** Cadence de reprise tant que le serveur local est considéré injoignable. */
const RESUME_PROBE_MS = 30_000;

export function useConnectionState(): ConnectionState {
  const queryClient = useQueryClient();

  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [offlineSince, setOfflineSince] = useState<Date | null>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? new Date() : null
  );
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  // Horodatage capturé à chaque réévaluation périodique : lire l'horloge pendant
  // le rendu est impur, on la mémorise donc dans un état déclenché par l'intervalle.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const goOnline = () => {
      setBrowserOnline(true);
      setOfflineSince(null);
    };
    const goOffline = () => {
      setBrowserOnline(false);
      setOfflineSince((prev) => prev ?? new Date());
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Observe le cache React Query : un succès prouve que le serveur local vit,
  // un échec réseau prouve l'inverse. Aucune requête supplémentaire n'est émise.
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const query = event.query;
      if (event.type === 'updated' && query.state.status === 'success') {
        const at = new Date();
        setLastSuccessAt(at);
        setLastErrorCode(null);
        // L'horloge de référence doit suivre : sinon `now - lastSuccess` devient
        // négatif et le prochain échec réseau serait ignoré jusqu'au tick suivant.
        setNowMs(at.getTime());
        return;
      }
      if (event.type === 'updated' && query.state.status === 'error') {
        const code = (query.state.error as { code?: unknown } | null)?.code;
        const typed = typeof code === 'string' ? code : 'UNKNOWN_ERROR';
        setLastErrorCode(typed);
        // Un échec réseau survenu à l'instant est postérieur à tout succès connu.
        setNowMs(Date.now());
        if (typed === 'NETWORK_ERROR') {
          setOfflineSince((prev) => prev ?? new Date());
        }
      }
    });
    return unsubscribe;
  }, [queryClient]);

  // Réévalue périodiquement : un succès ancien doit finir par expirer.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), PROBE_TTL_MS);
    return () => clearInterval(id);
  }, []);

  const serverState = resolveLocalServerState({
    browserOnline,
    lastSuccessfulApiCallAt: lastSuccessAt,
    lastApiErrorCode: lastErrorCode,
    now: new Date(nowMs),
  });

  /**
   * Reprise automatique : sans cela, le bandeau resterait affiché après le
   * redémarrage du serveur local jusqu'à ce que l'utilisateur navigue.
   * On rejoue donc les requêtes en échec :
   *  - immédiatement quand le réseau du poste revient ;
   *  - toutes les 30 s tant que le serveur local est injoignable.
   * Rien n'est rejoué tant que l'état est `online` (aucune requête parasite).
   */
  useEffect(() => {
    if (serverState === 'online') return;

    let cancelled = false;
    const retry = () => {
      if (cancelled) return;
      void queryClient.invalidateQueries({
        refetchType: 'active',
        predicate: (q) => q.state.status === 'error',
      });
    };

    const onOnline = () => {
      setNowMs(Date.now());
      retry();
    };
    window.addEventListener('online', onOnline);

    const id = setInterval(retry, RESUME_PROBE_MS);

    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      clearInterval(id);
    };
  }, [serverState, queryClient]);

  return {
    isOnline: serverState === 'online',
    serverState,
    offlineSince,
    message: describeLocalServerState(serverState, offlineSince),
  };
}
