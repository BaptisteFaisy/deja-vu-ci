/**
 * Test de la copie du jeu d'exemple dans l'app Cerveau.
 *
 * Le bundle Forge embarque `apps/brain/src/data/sample-dataset.json` : cette
 * copie doit être **identique** au jeu suivi par git (`data/sample/…`), sinon
 * le juge rejoue autre chose que ce que le dépôt contient. La copie se fait
 * par `tools/copy-sample.mjs`, jamais à la main.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CIBLE, SOURCE, copySample } from './copy-sample.mjs';

describe('copie du jeu d’exemple', () => {
  it('la copie embarquée est identique au jeu du dépôt', () => {
    expect(readFileSync(CIBLE).equals(readFileSync(SOURCE))).toBe(true);
  });

  it('le script recopie le jeu sans le modifier', () => {
    const octets = copySample();
    expect(octets).toBe(readFileSync(SOURCE).byteLength);
    expect(readFileSync(CIBLE).equals(readFileSync(SOURCE))).toBe(true);
  });
});
