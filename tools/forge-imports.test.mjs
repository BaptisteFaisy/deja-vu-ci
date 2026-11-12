/**
 * Garde : aucun import à préfixe `node:` dans le code que Forge bundle.
 *
 * Le bundler de Forge (webpack) ne gère pas le schéma `node:` : un seul
 * `import … from 'node:crypto'` dans les sources de `packages` ou d'une app et
 * `forge deploy` échoue avec `UnhandledSchemeError: Reading from "node:crypto"
 * is not handled by plugins`. C'est arrivé en production de déploiement après
 * l'ajout de modules purs qui hachaient (journal d'audit, minimisation) : les
 * tests passaient tous, seul le déploiement réel le voyait.
 *
 * La forme nue (`from 'crypto'`) est acceptée partout : Node, vitest, tsc et le
 * bundler Forge. Les scripts `tools/**` (Node seul, jamais bundlés) et le site
 * public (qui substitue le module) ne sont pas concernés.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Les racines dont le code est bundlé par Forge. */
const RACINES_BUNDLEES = ['packages/core/src', 'packages/bridge/src', 'packages/present/src', 'apps/brain/src', 'apps/sensor/src'];

/** Liste récursive des fichiers TypeScript d'un dossier. */
function fichiers(dossier) {
  const trouves = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
    else if (/\.(ts|tsx)$/.test(entree)) trouves.push(chemin);
  }
  return trouves;
}

describe('imports Node dans le code bundlé par Forge', () => {
  it('n’utilise jamais le préfixe node:', () => {
    const fautifs = [];
    for (const racine of RACINES_BUNDLEES) {
      for (const chemin of fichiers(join(RACINE, racine))) {
        const code = readFileSync(chemin, 'utf8');
        for (const match of code.matchAll(/from\s*'(node:[^']+)'/g)) {
          fautifs.push(`${chemin.slice(RACINE.length + 1)} → ${match[1]}`);
        }
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('ne dépend d’aucun autre module intégré que crypto', () => {
    const autres = ['fs', 'path', 'os', 'http', 'https', 'url', 'util', 'child_process', 'stream', 'buffer', 'events', 'zlib', 'net', 'tls', 'worker_threads'];
    const fautifs = [];
    for (const racine of RACINES_BUNDLEES) {
      for (const chemin of fichiers(join(RACINE, racine))) {
        const code = readFileSync(chemin, 'utf8');
        for (const module of autres) {
          if (new RegExp(`from\\s*'${module}'`).test(code)) {
            fautifs.push(`${chemin.slice(RACINE.length + 1)} → ${module}`);
          }
        }
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });
});
