/**
 * Substitut de test pour `virtual:pwa-register`, module virtuel fourni par
 * vite-plugin-pwa au bundler uniquement. Il n'existe pas sur le disque, donc un
 * exécution Node directe (tsx --test) ne peut pas le résoudre. Le hook de
 * résolution de `src/test/registerVirtualModules.ts` redirige son import ici.
 * Aucun comportement applicatif n'est simulé : les fonctions sont inertes.
 */
export function registerSW(_options?: unknown): () => void {
  return () => {};
}

export default { registerSW };
