/**
 * Un seul React par app Forge — le contrôle qui précède un déploiement.
 *
 * Le 13/11/2026, l'app Cerveau déployée en production n'affichait qu'une page
 * blanche : `TypeError: Cannot read properties of null (reading 'useState')`.
 * Le bundle embarquait **deux** copies de React — le code de l'app d'un côté,
 * le moteur de rendu `react-reconciler` (qui installe le dispatcher que les
 * hooks lisent) de l'autre. Le rendu écrivait dans une copie, l'app lisait
 * l'autre.
 *
 * La copie parasite venait d'un `node_modules/node_modules/` dans l'arbre de
 * travail : le bundler Forge construit avec l'arbre local. D'où ce contrôle :
 * avant `forge deploy`, l'arbre doit contenir une seule copie de React.
 *
 * Usage : `node tools/forge-tree.mjs` (sortie 1 si une app est en faute).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Les apps Forge du dépôt. */
export const APPS = ['brain', 'sensor'];

/** Les paquets dont une duplication casse le rendu ou l'hydratation. */
export const CRITICAL_PACKAGES = ['react', 'react-dom', 'react-reconciler'];

/** Renvoie le nom du paquet si le répertoire en est un, sinon null. */
export function packageName(dir) {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).name ?? null;
  } catch {
    return null;
  }
}

/** Liste les entrées d'un répertoire, sans lever si le dossier manque. */
function entries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Cherche les copies d'un paquet dans les arbres `node_modules` d'une app. */
export function findCopies(appDir, pkgName) {
  const found = [];
  const visit = (modulesDir) => {
    for (const entry of entries(modulesDir)) {
      if (!entry.isDirectory()) continue;
      const full = path.join(modulesDir, entry.name);
      if (entry.name === 'node_modules') {
        visit(full);
      } else if (entry.name.startsWith('@')) {
        visitChildren(full, pkgName, found);
      } else if (entry.name === pkgName && packageName(full) === pkgName) {
        found.push(full);
      }
    }
  };
  const visitChildren = (scopeDir, name, acc) => {
    for (const entry of entries(scopeDir)) {
      if (!entry.isDirectory()) continue;
      const full = path.join(scopeDir, entry.name);
      if (entry.name === name && packageName(full) === name) acc.push(full);
      const nested = path.join(full, 'node_modules');
      if (existsSync(nested)) visit(nested);
    }
  };
  visit(path.join(appDir, 'node_modules'));
  return found;
}

/** Vérifie l'arbre installé d'une app : une seule copie de chaque paquet. */
export function checkApp(appDir, packages = CRITICAL_PACKAGES) {
  if (!existsSync(path.join(appDir, 'node_modules'))) {
    return { app: path.basename(appDir), installed: false, duplicates: [] };
  }
  const duplicates = [];
  for (const pkg of packages) {
    const copies = findCopies(appDir, pkg);
    if (copies.length > 1) {
      duplicates.push({ package: pkg, copies: copies.map((c) => path.relative(appDir, c)) });
    }
  }
  return { app: path.basename(appDir), installed: true, duplicates };
}

/** Vérifie toutes les apps du dépôt. */
export function checkAll(apps = APPS) {
  return apps.map((app) => checkApp(path.join(repoRoot, 'apps', app)));
}

/** Le contrôle en ligne de commande : un mot par app, sortie 1 si une faute. */
export function main() {
  const results = checkAll();
  let failed = false;
  for (const result of results) {
    if (!result.installed) {
      console.log(`- ${result.app} : non installée (rien à vérifier)`);
      continue;
    }
    if (result.duplicates.length === 0) {
      console.log(`- ${result.app} : une seule copie de ${CRITICAL_PACKAGES.join(', ')}`);
      continue;
    }
    failed = true;
    for (const dup of result.duplicates) {
      console.error(`::error::${result.app} : ${dup.package} est en double — ${dup.copies.join(' , ')}`);
    }
  }
  if (failed) {
    console.error("Arbre en double : le bundle aurait deux React. `npm ci` dans l'app, puis recommencer.");
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main());
}
