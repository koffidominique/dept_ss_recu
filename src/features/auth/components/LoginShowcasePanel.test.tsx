import '../../../test/setupDom.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { LoginShowcasePanel } from './LoginShowcasePanel.tsx';

/**
 * LOT 6 — PHASE 5 · Garde-fous de mise en page responsive.
 *
 * Défaut réel trouvé en navigateur (Chrome 153, `vite preview`) : sur un écran
 * de 360 px, la carte de connexion se trouvait à `left: 366px`, donc **hors
 * écran**, parce que le panneau de présentation était `w-full` sans garde de
 * point de rupture et occupait toute la hauteur de la fenêtre.
 *
 * happy-dom ne calcule pas les media queries : un test de rendu ne peut pas
 * reproduire la panne. Ces tests verrouillent donc la **cause** dans le code
 * source, ce qui est vérifiable et suffisant pour empêcher la régression.
 */

const source = readFileSync(
  new URL('./LoginShowcasePanel.tsx', import.meta.url),
  'utf8'
);

test('le panneau de présentation est masqué sous le point de rupture lg', () => {
  // Sans `hidden` + `lg:block`, le panneau occupe 100 % de la largeur sur mobile
  // et repousse la carte de connexion hors de l'écran.
  assert.match(
    source,
    /className="relative hidden lg:block lg:w-1\/2 min-h-screen"/,
    'Le panneau doit être `hidden lg:block` : masqué sur mobile, visible à partir de lg.'
  );
});

test('le panneau ne reprend la moitié de la largeur qu’à partir de lg', () => {
  const classes = source.match(/className="relative[^"]*"/g)?.join(' ') ?? '';
  assert.ok(
    classes.includes('lg:w-1/2'),
    'La largeur 1/2 doit être conditionnée par un préfixe de point de rupture.'
  );
});

test('le composant rend la présentation métier (contenu attendu)', () => {
  const el = LoginShowcasePanel();
  const html = JSON.stringify(el);
  assert.match(html, /DEPOTPRO/);
  assert.match(html, /Livraisons|Stock/);
});
