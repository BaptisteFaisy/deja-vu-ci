import { defineConfig } from 'vitest/config';

// Les tests vivent à côté du code (packages/**) et dans les apps (apps/**/test).
// Aucun test ne doit toucher au réseau : le jeu d'exemple est rejoué en local.
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/test/**/*.test.ts', 'tools/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 20000,
    reporters: ['dot'],
  },
});
