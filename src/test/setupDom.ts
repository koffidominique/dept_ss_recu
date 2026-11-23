/**
 * Module à importer **en premier** dans les suites de tests de composants.
 *
 * `react-dom` effectue de la détection d'environnement au chargement du module :
 * si le DOM est installé après son import, les portails Radix ne se montent pas.
 * Comme les dépendances ESM sont évaluées dans l'ordre des `import`, placer
 * `import '<chemin>/setupDom.ts';` avant `@testing-library/react` garantit un
 * DOM disponible au moment où `react-dom` s'initialise.
 */
import { ensureDom } from './domEnvironment.ts';

ensureDom();
