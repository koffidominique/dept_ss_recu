/**
 * Résolveur ESM minimal : redirige `virtual:pwa-register` vers le stub de test.
 * Tout autre spécificateur est laissé au résolveur suivant.
 */
const STUB = new URL('./virtualPwaStub.ts', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'virtual:pwa-register' || specifier.startsWith('virtual:')) {
    return { url: STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
