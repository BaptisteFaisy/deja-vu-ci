#!/usr/bin/env node
/**
 * Copie le jeu d'exemple du dépôt dans l'app Cerveau.
 *
 * Le bouton « Rejouer le jeu d'exemple » (§ 22, CI-11) embarque le jeu dans le
 * bundle Forge. Le bundler de Forge construit depuis le dossier de l'app : la
 * copie vit donc dans `apps/brain/src/data/`, à côté du code qui l'importe.
 *
 * La copie est faite par ce script, **jamais à la main** : `seed.test.ts`
 * compare les deux fichiers et refuse toute divergence.
 *
 * Usage : `node tools/copy-sample.mjs` (ou `npm run build:seed` dans l'app).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt (ce script vit dans `tools/`). */
export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Chemin par défaut du jeu source, suivi par git, unique référence. */
export const SOURCE = resolve(RACINE, 'data/sample/occurrences.json');

/** Chemin par défaut de la copie embarquée dans l'app Cerveau. */
export const CIBLE = resolve(RACINE, 'apps/brain/src/data/sample-dataset.json');

/**
 * Copie le jeu d'exemple, octet pour octet.
 *
 * @returns le nombre d'octets écrits.
 */
export function copySample(source = SOURCE, cible = CIBLE) {
  const contenu = readFileSync(source);
  mkdirSync(dirname(cible), { recursive: true });
  writeFileSync(cible, contenu);
  return contenu.byteLength;
}

const invoque = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoque) {
  const octets = copySample();
  process.stdout.write(`jeu d'exemple copié (${octets} octets) → ${CIBLE}\n`);
}
