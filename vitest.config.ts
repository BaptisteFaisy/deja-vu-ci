import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Les tests vivent à côté du code (packages/**) et dans les apps (apps/**/test).
// Aucun test ne doit toucher au réseau : le jeu d'exemple est rejoué en local.
//
// `@dejavu/present` est un paquet source (comme `@dejavu/core`) : son `dist/`
// n'existe qu'après `npm run build`. Les tests du dépôt tournent sans build —
// l'alias leur fait lire la source TypeScript, exactement comme les tests des
// apps importent `../src/*.js`. Les apps Forge, elles, résolvent le paquet
// publié (`dist/`) au moment du bundle.
export default defineConfig({
  resolve: {
    alias: {
      '@dejavu/present': fileURLToPath(new URL('./packages/present/src/index.ts', import.meta.url)),
      // Le Cerveau importe le moteur en **valeurs** (`src/seed.ts` : rejeu,
      // diagnostic, tickets). Le paquet publié pointe vers `dist/`, qui
      // n'existe qu'après `npm run build` : sans cet alias, le test du rejeu
      // ne trouve pas le moteur. Les apps Forge, elles, résolvent le paquet
      // publié au moment du bundle.
      '@dejavu/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/test/**/*.test.ts', 'tools/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 20000,
    reporters: ['dot'],
  },
});
