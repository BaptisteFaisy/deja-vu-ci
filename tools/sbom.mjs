#!/usr/bin/env node
/**
 * tools/sbom.mjs — deterministic software bill of materials.
 *
 * Generates a simplified CycloneDX 1.5 document (JSON) of the *runtime*
 * dependencies of the two Forge apps and of the internal packages, read
 * strictly from the workspace `package.json` files. No install, no network,
 * no lockfile: the `version` of each component is the semver range as
 * declared in the manifest (see docs/THIRD-PARTY.md for the licences).
 *
 * Dev dependencies and transitive packages are intentionally absent, so a
 * component listed here is one that actually ships inside at least one app
 * bundle — not a phantom of the toolchain.
 *
 * Usage: `node tools/sbom.mjs` (writes docs/SBOM.json) — or import
 * `buildSbom` / `renderSbom` from a test.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved once from this file's location. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** First-party package directories, in a stable order. */
const FIRST_PARTY_DIRS = [
  'apps/sensor',
  'apps/brain',
  'packages/bridge',
  'packages/core',
  'packages/present',
];

/** Output path of the committed SBOM. */
export const OUTPUT_PATH = resolve(ROOT, 'docs', 'SBOM.json');

/** Semver range or `file:` reference of a declared dependency. */
function declaredVersion(dep) {
  return typeof dep === 'string' ? dep : (dep && dep.version) || '*';
}

/** Reads and parses one package.json; throws if absent or malformed. */
function readPackage(dir) {
  return JSON.parse(readFileSync(resolve(ROOT, dir, 'package.json'), 'utf8'));
}

/**
 * Builds the map of every first-party package, keyed by its workspace
 * directory (so a `file:` reference can be resolved back to its manifest).
 */
function collectFirstParty() {
  const byDir = new Map();
  for (const dir of FIRST_PARTY_DIRS) {
    byDir.set(dir, readPackage(dir));
  }
  return byDir;
}

/**
 * Resolves a declared dependency to a first-party manifest when it is a
 * `file:` reference pointing at one of the workspace packages, or undefined.
 */
function resolveInternal(dep, fromDir, byDir) {
  const version = declaredVersion(dep);
  if (!version.startsWith('file:')) return undefined;
  const target = resolve(ROOT, fromDir, version.slice('file:'.length));
  const rel = target.slice(ROOT.length + 1);
  return byDir.get(rel) ?? undefined;
}

/**
 * Splits a package's `dependencies` into internal (`file:`) and external.
 * Returns two arrays of `{ name, version }`, deduplicated by name.
 */
function classifyDeps(manifest, fromDir, byDir) {
  const internal = [];
  const external = [];
  for (const [name, dep] of Object.entries(manifest.dependencies ?? {})) {
    const manifestOf = resolveInternal(dep, fromDir, byDir);
    if (manifestOf) {
      internal.push({ name: manifestOf.name, version: manifestOf.version });
    } else {
      external.push({ name, version: declaredVersion(dep) });
    }
  }
  return { internal, external };
}

/** One CycloneDX component (name + version), with an npm purl. */
function componentFor(name, version, firstParty) {
  const purl = `pkg:npm/${name}@${version}`;
  const component = {
    type: firstParty ? 'application' : 'library',
    'bom-ref': purl,
    name,
    version,
    purl,
  };
  if (firstParty) {
    component.properties = [{ name: 'dejavu:first-party', value: 'true' }];
  }
  return component;
}

/** Orders components deterministically (by name, then version). */
function sortComponents(components) {
  return components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Builds the SBOM object. Pure and injectable for the tests. */
export function buildSbom() {
  const byDir = collectFirstParty();

  const components = new Map();
  const dependencies = new Map();

  const ensure = (name, version, firstParty) => {
    const key = `${name}@${version}`;
    if (!components.has(key)) {
      components.set(key, componentFor(name, version, firstParty));
    }
    return `pkg:npm/${name}@${version}`;
  };

  for (const dir of FIRST_PARTY_DIRS) {
    const manifest = readPackage(dir);
    const ref = ensure(manifest.name, manifest.version, true);
    const { internal, external } = classifyDeps(manifest, dir, byDir);
    const dependsOn = [
      ...internal.map((d) => ensure(d.name, d.version, true)),
      ...external.map((d) => ensure(d.name, d.version, false)),
    ];
    dependencies.set(ref, [...new Set(dependsOn)].sort());
  }

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        'bom-ref': 'pkg:npm/deja-vu-ci@0.1.0',
        name: 'deja-vu-ci',
        version: '0.1.0',
        licenses: [{ license: { name: 'MIT' } }],
      },
    },
    components: sortComponents([...components.values()]),
    dependencies: [...dependencies.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ref, dependsOn]) => ({ ref, dependsOn: [...new Set(dependsOn)].sort() })),
  };
}

/** Serialises the SBOM in a stable form (sorted keys, trailing newline). */
export function renderSbom(sbom) {
  return JSON.stringify(sbom, null, 2) + '\n';
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  writeFileSync(OUTPUT_PATH, renderSbom(buildSbom()));
  console.log(`Wrote ${OUTPUT_PATH}`);
}