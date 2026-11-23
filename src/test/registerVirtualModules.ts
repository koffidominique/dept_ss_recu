/**
 * Enregistre un hook de résolution ESM pour les modules virtuels de Vite
 * (`virtual:*`), absents du disque et donc non résolvables par Node.
 * Chargé via `--import` dans les scripts de test.
 */
import { register } from 'node:module';

register(new URL('./virtualPwaResolver.mjs', import.meta.url));
