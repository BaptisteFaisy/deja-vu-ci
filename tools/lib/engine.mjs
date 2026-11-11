// Loads the compiled Déjà-vu engine (packages/core/dist) for the CLI tools.
//
// The engine is built from packages/core (lots A to D). The tools must work
// whatever the barrel shape is: the barrel `dist/index.js` when it exists,
// otherwise the individual compiled modules. Nothing is duplicated here: the
// tools never re-implement signature, extraction or masking logic.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const coreDist = path.join(repoRoot, 'packages', 'core', 'dist');

/** Engine entry points used by the tools, with the module that owns them. */
const ENTRY_POINTS = {
  extractErrorBlocks: ['extract.js'],
  signatureOf: ['sign.js'],
  familyOf: ['sign.js'],
  signatureShort: ['sign.js'],
  maskSecrets: ['mask.js'],
  assessFlakiness: ['flaky.js'],
  replay: ['replay.js'],
};

async function importIfPresent(file) {
  try {
    return await import(pathToFileURL(path.join(coreDist, file)).href);
  } catch {
    return undefined;
  }
}

/**
 * Loads the engine, returning every entry point it exposes.
 * Missing entry points stay `undefined` so callers can degrade gracefully.
 */
export async function loadEngine() {
  const barrel = (await importIfPresent('index.js')) ?? {};
  const modules = { barrel };
  const engine = {};

  for (const [name, owners] of Object.entries(ENTRY_POINTS)) {
    let value = barrel[name];
    if (typeof value !== 'function') {
      for (const owner of owners) {
        if (!modules[owner]) modules[owner] = await importIfPresent(owner);
        const candidate = modules[owner]?.[name];
        if (typeof candidate === 'function') {
          value = candidate;
          break;
        }
      }
    }
    engine[name] = value;
  }
  engine.barrel = barrel;
  return engine;
}

/** Names of the engine entry points that are missing (empty when ready). */
export function missingEntryPoints(engine) {
  return Object.keys(ENTRY_POINTS).filter((name) => typeof engine[name] !== 'function');
}
