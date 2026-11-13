/**
 * Le contrôle de l'arbre installé doit voir le doublon qui a cassé la prod.
 *
 * Fixture : un `node_modules/node_modules/react` à côté du `node_modules/react`
 * normal — l'arbre exact qui a produit le bundle à deux React le 13/11/2026.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkApp, findCopies, packageName } from './forge-tree.mjs';

const created = [];

/** Écrit un paquet factice (name + version) dans un répertoire. */
function writePackage(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '18.3.1' }));
}

/** Crée un arbre d'app factice : chaque entrée est [répertoire, nom du paquet]. */
function fakeApp(entries) {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-tree-'));
  created.push(root);
  for (const [relative, name] of entries) {
    writePackage(path.join(root, relative), name);
  }
  return root;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('copies de React dans l arbre installé', () => {
  it('trouve le doublon qui a cassé la production', () => {
    const app = fakeApp([
      ['node_modules/react', 'react'],
      ['node_modules/node_modules/react', 'react'],
    ]);
    expect(findCopies(app, 'react')).toHaveLength(2);
  });

  it('ne compte qu une copie quand l arbre est propre', () => {
    const app = fakeApp([
      ['node_modules/react', 'react'],
      ['node_modules/react-dom', 'react-dom'],
    ]);
    expect(findCopies(app, 'react')).toHaveLength(1);
  });

  it('ignore les paquets voisins qui ne sont pas le paquet demandé', () => {
    const app = fakeApp([
      ['node_modules/react', 'react'],
      ['node_modules/@types/react', '@types/react'],
    ]);
    expect(findCopies(app, 'react')).toHaveLength(1);
    expect(packageName(path.join(app, 'node_modules', '@types', 'react'))).toBe('@types/react');
  });

  it('signale l app en faute quand un paquet est en double', () => {
    const app = fakeApp([
      ['node_modules/react', 'react'],
      ['node_modules/node_modules/react', 'react'],
    ]);
    const result = checkApp(app, ['react']);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].package).toBe('react');
  });

  it('laisse passer une app installée sans doublon', () => {
    const app = fakeApp([['node_modules/react', 'react']]);
    expect(checkApp(app, ['react']).duplicates).toEqual([]);
  });

  it('ne juge pas une app non installée', () => {
    const app = fakeApp([]);
    const result = checkApp(app, ['react']);
    expect(result.installed).toBe(false);
    expect(result.duplicates).toEqual([]);
  });
});
