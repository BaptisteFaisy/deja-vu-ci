#!/usr/bin/env node
/**
 * Construit le site public de Déjà-vu CI dans `site/public/`.
 *
 * Trois étapes, aucune magie :
 *  1. **bundle** — esbuild compile `site/src/main.ts` avec le moteur réel
 *     (`packages/core`) et les libellés partagés (`packages/present`), plus le
 *     jeu d'exemple en JSON : le site est autonome, aucun appel réseau ;
 *  2. **copie** — `index.html`, `styles.css` et l'icône passent dans
 *     `site/public/`, tel quel ;
 *  3. **empreinte** — `build-manifest.json` porte une empreinte des sources
 *     (site + moteur + jeu d'exemple). `site/test/bundle.test.mjs` la recalcule
 *     et refuse un bundle plus vieux que ses sources.
 *
 * Le résultat est **commité** : le workflow Pages ne fait que téléverser
 * `site/public/`, donc aucun `npm ci` n'est nécessaire en CI (budget de 5 min)
 * et un visiteur voit exactement ce que le dépôt contient.
 *
 * Usage : `cd site && npm install && npm run build` (ou `npm run build:site`).
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt (ce script vit dans `tools/`). */
export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Dossier du site, et dossier publié (celui que Pages sert). */
export const SITE = join(RACINE, 'site');
export const PUBLIC = join(SITE, 'public');

/** Fichiers statiques copiés tels quels dans `site/public/`. */
const STATIQUES = ['index.html', 'styles.css', 'icon.svg'];

/** Dossiers dont chaque fichier compte dans l'empreinte. */
const SOURCES = ['site/src', 'packages/core/src', 'packages/present/src'];

/** Un fichier suivi par git, en plus des dossiers ci-dessus. */
const FICHIERS_SUIVIS = ['site/index.html', 'site/styles.css', 'data/sample/occurrences.json', 'tools/build-site.mjs'];

/** Liste récursive des fichiers d'un dossier (ni `node_modules`, ni `.git`). */
function fichiers(dossier) {
  const trouve = [];
  for (const entree of readdirSync(dossier, { recursive: true })) {
    const chemin = join(dossier, String(entree));
    if (String(entree).includes('node_modules')) continue;
    if (statSync(chemin).isFile()) trouve.push(chemin);
  }
  return trouve;
}

/** Tous les fichiers dont dépend le bundle, en chemins relatifs triés. */
export function sourceFiles() {
  const chemins = [...SOURCES.flatMap((d) => fichiers(join(RACINE, d)))];
  for (const fichier of FICHIERS_SUIVIS) chemins.push(join(RACINE, fichier));
  return chemins.map((c) => relative(RACINE, c)).sort();
}

/** Empreinte SHA-256 des sources : même contenu, même empreinte. */
export function fingerprint() {
  const hachage = createHash('sha256');
  for (const chemin of sourceFiles()) {
    hachage.update(chemin);
    hachage.update('\0');
    hachage.update(readFileSync(join(RACINE, chemin)));
    hachage.update('\0');
  }
  return hachage.digest('hex');
}

/** Charge esbuild depuis les dépendances du site (pas de dépendance à la racine). */
async function esbuildDuSite() {
  const require = createRequire(join(SITE, 'package.json'));
  const module = await import(require.resolve('esbuild'));
  return module.default ?? module;
}

/** Construit le bundle, copie les statiques, écrit l'empreinte. */
export async function buildSite() {
  const esbuild = await esbuildDuSite();
  mkdirSync(PUBLIC, { recursive: true });
  const resultat = await esbuild.build({
    entryPoints: [join(SITE, 'src/main.ts')],
    outfile: join(PUBLIC, 'bundle.js'),
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
    alias: {
      '@dejavu/core': join(RACINE, 'packages/core/src/index.ts'),
      '@dejavu/present': join(RACINE, 'packages/present/src/index.ts'),
      // Le moteur hache avec `node:crypto` (identifiants de signatures) : le
      // navigateur n'a pas ce module. Le substitut produit exactement les
      // mêmes hachages (vérifié contre Node par `site/test/sha256.test.ts` et
      // sur les identifiants réels par `site/test/shim.test.ts`).
      'node:crypto': join(SITE, 'src/lib/nodeCrypto.ts'),
    },
  });
  for (const fichier of STATIQUES) cpSync(join(SITE, fichier), join(PUBLIC, fichier));
  const manifeste = {
    empreinte: fingerprint(),
    sources: sourceFiles().length,
    octets: statSync(join(PUBLIC, 'bundle.js')).size,
    avertissements: resultat.warnings.length,
  };
  writeFileSync(join(PUBLIC, 'build-manifest.json'), `${JSON.stringify(manifeste, null, 2)}\n`);
  return manifeste;
}

const invoque = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoque) {
  const manifeste = await buildSite();
  process.stdout.write(
    `site construit → ${relative(RACINE, PUBLIC)}/ ` +
      `(bundle ${manifeste.octets} o, ${manifeste.sources} sources, empreinte ${manifeste.empreinte.slice(0, 12)})\n`,
  );
}
