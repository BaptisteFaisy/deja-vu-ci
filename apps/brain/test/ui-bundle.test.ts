/**
 * Garde du bundle UI : aucun module reachable depuis l'écran ne peut dépendre
 * de Node.
 *
 * `forge deploy` compile l'entrée UI Kit (`src/frontend.tsx`) avec une cible
 * **web** où les modules intégrés de Node sont désactivés
 * (`resolve.fallback: { crypto: false }`). Un seul écran qui importe une
 * **valeur** d'un module hachant (`crypto`) ou du barrel `@dejavu/core` — lequel
 * tire tout le moteur, donc `crypto` — et le déploiement échoue avec
 * « Can't resolve 'crypto' », alors que tous les tests passent (ils tournent
 * sous Node). C'est arrivé pour de vrai : `WORTH_IT` dans un écran,
 * `computeCost` dans la tendance de coût, `MINIMIZE_POLICIES` dans les réglages.
 *
 * Ce test rejoue statically le graphe d'imports de l'entrée UI et refuse toute
 * dépendance Node. Les imports **de types** sont ignorés : TypeScript les efface
 * à la compilation, ils n'entrent pas dans le bundle.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(APP, 'src/frontend.tsx');

/** Une instruction d'import : sa clause et son spécificateur. */
interface ImportStatement {
  clause: string;
  spec: string;
}

/** Retire les commentaires : le mot « import » y apparaît souvent. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Toutes les instructions d'import d'un fichier (multi-lignes comprises).
 *
 * L'ancre `^` (drapeau `m`) évite de prendre une phrase de commentaire pour un
 * import : sans elle, « … runtime import of the engine … from '@dejavu/core' »
 * était lu comme un import de valeur.
 */
function importsOf(code: string): ImportStatement[] {
  const found: ImportStatement[] = [];
  const pattern = /^\s*import\s+([\s\S]*?)\s+from\s*'([^']+)';/gm;
  for (const match of stripComments(code).matchAll(pattern)) {
    found.push({ clause: match[1].trim(), spec: match[2] });
  }
  return found;
}

/** Vrai si l'import n'apporte que des types (effacés à la compilation). */
function typeOnly(statement: ImportStatement): boolean {
  if (statement.clause.startsWith('type ')) return true;
  const braces = statement.clause.match(/\{([\s\S]*)\}/);
  if (!braces) return false; // import par défaut ou d'effet, traité comme valeur
  const outside = statement.clause.replace(/\{[\s\S]*\}/, '').trim();
  if (outside !== '' && !outside.startsWith('type ')) return false;
  const specifiers = braces[1]
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean);
  return specifiers.every((one) => one.startsWith('type '));
}

/** Résout un import relatif vers un fichier existant de l'app. */
function resolveRelative(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Un module intégré à Node, sous sa forme nue ou préfixée. */
const NODE_BUILTINS = [
  'crypto', 'fs', 'path', 'os', 'http', 'https', 'url', 'util', 'child_process',
  'stream', 'buffer', 'events', 'zlib', 'net', 'tls', 'worker_threads',
];

/** Ce qu'un fichier importé de l'UI n'a pas le droit de tirer. */
function violationsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const faults: string[] = [];
  for (const statement of importsOf(code)) {
    if (typeOnly(statement)) continue;
    const bare = statement.spec.replace(/^node:/, '');
    if (NODE_BUILTINS.includes(bare)) {
      faults.push(`${statement.spec} (module Node)`);
    }
    if (statement.spec === '@dejavu/core') {
      faults.push('@dejavu/core en valeur (le barrel tire tout le moteur, dont crypto)');
    }
  }
  return faults;
}

/** Parcourt le graphe d'imports depuis l'entrée UI, sans repasser deux fois. */
function walk(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue: Array<{ file: string; via: string[] }> = [{ file: entry, via: [] }];
  while (queue.length > 0) {
    const { file, via } = queue.shift() as { file: string; via: string[] };
    if (seen.has(file)) continue;
    const faults = violationsOf(file);
    seen.set(file, faults);
    const chain = [...via, file.slice(APP.length + 1)];
    for (const statement of importsOf(readFileSync(file, 'utf8'))) {
      if (typeOnly(statement)) continue;
      const next = resolveRelative(statement.spec, file);
      if (next && !seen.has(next)) queue.push({ file: next, via: chain });
    }
  }
  return seen;
}

describe('bundle UI Kit', () => {
  const visited = walk(ENTRY);
  const fautifs = [...visited.entries()]
    .filter(([, faults]) => faults.length > 0)
    .map(([file, faults]) => `${file.slice(APP.length + 1)} → ${faults.join(', ')}`);

  it('part bien de l’entrée UI Kit et parcourt les écrans', () => {
    expect(visited.size).toBeGreaterThan(5);
    expect([...visited.keys()].some((file) => file.endsWith('projectPage.tsx'))).toBe(true);
  });

  it('n’atteint aucun module Node ni le barrel du moteur', () => {
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });
});
