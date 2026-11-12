/**
 * Garde de compatibilité navigateur — parce que la suite tourne sous Node.
 *
 * Le site public fait tourner le **vrai** code du produit dans un navigateur.
 * Or les tests, eux, tournent sous Node : `Buffer`, `process.env` ou un import
 * `node:fs` y passent inaperçus et cassent le site chez le visiteur (c'est
 * arrivé : `Buffer.byteLength` dans l'extraction, invisible en test).
 *
 * Cette garde analyse la liste exacte des sources embarquées dans le bundle
 * (écrite par `tools/build-site.mjs` depuis le metafile esbuild) et refuse :
 *  - tout module Node autre que `node:crypto` (substitué par le site) ;
 *  - toute primitive de `node:crypto` non fournie par le substitut ;
 *  - tout global Node non substitué (`process`, `__dirname`, `require`, …) ;
 *  - toute référence de ce genre dans le bundle publié lui-même.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC, RACINE } from '../../tools/build-site.mjs';

const manifeste = JSON.parse(readFileSync(join(PUBLIC, 'build-manifest.json'), 'utf8'));
const sources = manifeste.embarquees.filter((chemin) => chemin.endsWith('.ts'));

/** Les modules intégrés à Node (forme nue) — un seul est autorisé : `crypto`. */
const INTEGRES = ['crypto', 'fs', 'path', 'os', 'http', 'https', 'url', 'util', 'child_process', 'stream', 'buffer', 'events', 'zlib', 'net', 'tls', 'worker_threads'];

/** Les primitives de `crypto` que le substitut du site fournit. */
const PRIMITIVES = ['createHash', 'createHmac', 'timingSafeEqual', 'randomBytes', 'type Hash'];

/** Tous les identifiants importés d'un module, sur une instruction d'import. */
function importsDe(code, module) {
  const motif = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*'${module}'`, 'g');
  const noms = [];
  for (const groupe of code.matchAll(motif)) {
    for (const nom of groupe[1].split(',')) noms.push(nom.trim());
  }
  return noms.filter(Boolean);
}

describe('compatibilité navigateur', () => {
  it('connaît la liste des sources embarquées', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('n’embarque aucun module Node autre que crypto', () => {
    for (const chemin of sources) {
      const code = readFileSync(join(RACINE, chemin), 'utf8');
      for (const module of code.matchAll(/from\s*'((?:node:)?[a-z_/]+)'/g)) {
        const nom = module[1];
        if (!nom.startsWith('node:') && !INTEGRES.includes(nom)) continue;
        expect(nom.replace('node:', ''), `${chemin} importe ${nom}`).toBe('crypto');
      }
    }
  });

  it('n’utilise que les primitives fournies par le substitut', () => {
    for (const chemin of sources) {
      const code = readFileSync(join(RACINE, chemin), 'utf8');
      for (const forme of ['crypto', 'node:crypto']) {
        for (const nom of importsDe(code, forme)) {
          expect(PRIMITIVES, `${chemin} importe ${nom}`).toContain(nom);
        }
      }
    }
  });

  it('n’utilise aucun global Node non substitué', () => {
    const interdits = [
      [/\bprocess\.(env|argv|cwd|exit|stdout|stdin|platform|versions)\b/, 'process'],
      [/\b__dirname\b|\b__filename\b/, '__dirname/__filename'],
      [/\brequire\s*\(/, 'require()'],
      [/\bglobal\.(?!This)/, 'global'],
      [/\bsetImmediate\s*\(/, 'setImmediate'],
    ];
    for (const chemin of sources) {
      if (chemin.startsWith('site/src/lib/nodeGlobals.ts')) continue; // le substitut lui-même
      const code = readFileSync(join(RACINE, chemin), 'utf8');
      for (const [motif, nom] of interdits) {
        expect(motif.test(code), `${chemin} utilise ${nom}`).toBe(false);
      }
    }
  });

  it('le bundle publié ne référence ni process ni require', () => {
    const bundle = readFileSync(join(PUBLIC, 'bundle.js'), 'utf8');
    expect(bundle).not.toMatch(/\bprocess\.(env|argv|cwd|exit)\b/);
    expect(bundle).not.toMatch(/\brequire\s*\(/);
    expect(bundle).not.toMatch(/\b__dirname\b/);
  });
});
