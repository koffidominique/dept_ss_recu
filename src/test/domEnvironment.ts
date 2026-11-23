import { Window } from 'happy-dom';

/**
 * Installe un DOM `happy-dom` dans `globalThis` pour les tests de composants
 * exécutés hors navigateur (`npx tsx --test`).
 *
 * Pourquoi ne pas se limiter à `document`/`window` : les primitives Radix
 * (`FocusScope`, `Portal`, `DismissableLayer`) utilisent `NodeFilter`,
 * `CustomEvent`, `getComputedStyle`, `ResizeObserver`, etc. Si une seule de ces
 * globales manque, le portail Radix ne se monte pas et aucun dialogue
 * n'apparaît dans le DOM.
 *
 * Règle de sûreté : on n'écrase **jamais** une globale déjà fournie par Node
 * (sinon `Object.defineProperty` peut corrompre les internes V8 et provoquer un
 * `SIGABRT`). On ajoute uniquement les globales absentes ou explicitement
 * rattachées au DOM.
 */
let domRegistered = false;

const DOM_OVERRIDES = new Set([
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'matchMedia',
]);

const isDomCtor = (key: string): boolean =>
  /^(HTML|SVG|CSS|DOM|Node|Element|Event|Mouse|Keyboard|Focus|Pointer|Touch|Wheel|Input|Drag|Clipboard|Mutation|Resize|Intersection|Document|Text|Comment|Range|Selection|File|Blob|FormData|DataTransfer|DOMParser|XMLHttpRequest|TreeWalker|NodeFilter|CustomEvent|Image|Audio|Option)/.test(
    key
  );

const SKIP = new Set([
  'undefined',
  'NaN',
  'Infinity',
  'globalThis',
  'self',
  'top',
  'parent',
  'global',
  'process',
  'require',
  'eval',
]);

export function ensureDom(url = 'http://localhost:5173/'): Window {
  if (domRegistered) {
    return globalThis.window as unknown as Window;
  }

  const win = new Window({ url }) as unknown as Window & Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;

  const keys = new Set<string>();
  for (const k of Object.getOwnPropertyNames(win)) keys.add(k);
  let proto: object | null = Object.getPrototypeOf(win) as object | null;
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) keys.add(k);
    proto = Object.getPrototypeOf(proto) as object | null;
  }

  for (const key of keys) {
    if (SKIP.has(key)) continue;
    const alreadyInNode = Object.prototype.hasOwnProperty.call(g, key);
    if (alreadyInNode && !DOM_OVERRIDES.has(key) && !isDomCtor(key)) continue;

    let value: unknown;
    try {
      value = (win as unknown as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (typeof value !== 'function' && (value === null || typeof value !== 'object')) continue;
    try {
      Object.defineProperty(g, key, { value, configurable: true, writable: true });
    } catch {
      // Globales non redéfinissables : ignorées volontairement.
    }
  }

  Object.defineProperty(g, 'window', {
    value: win,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(g, 'document', {
    value: (win as unknown as { document: Document }).document,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(g, 'navigator', {
    value: (win as unknown as { navigator: Navigator }).navigator,
    configurable: true,
    writable: true,
  });
  g.IS_REACT_ACT_ENVIRONMENT = true;

  // `motion` (framer-motion) bascule sur l'API Web Animations (`Element.animate`)
  // dès qu'elle existe. L'implémentation `happy-dom` rejette ces animations avec
  // `AbortError` au démontage des dialogues Radix, ce qui fait échouer la suite
  // via `unhandledRejection`. En retirant `animate`, on force le moteur JS de
  // `motion`, piloté par `requestAnimationFrame` et sans rejet asynchrone.
  try {
    const elementProto = (win as unknown as { Element: { prototype: object } }).Element
      .prototype as Record<string, unknown>;
    if ('animate' in elementProto) {
      delete elementProto.animate;
    }
  } catch {
    // Environnement sans API Web Animations : rien à neutraliser.
  }

  domRegistered = true;
  return win;
}
