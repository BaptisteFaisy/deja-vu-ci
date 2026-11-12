/**
 * Tests of tools/check-licences.mjs.
 *
 * The fixtures live in `os.tmpdir()`: a fake SBOM, a fake licence table, and
 * the four buckets the classifier knows (permissive, platform, copyleft,
 * undeclared). The last test runs the checker on the real repository, whose
 * runtime dependencies are all Forge SDK packages — nothing copyleft may
 * ever ship inside an MIT repository.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkLicences, classify, thirdPartyLicences } from './check-licences.mjs';
import { repoRoot } from './lib/verify.mjs';

/** Builds a fake repository: SBOM + licence table + optional node_modules. */
function fixture(components, documented, installed = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'dv-licences-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  const sbom = {
    components: components.map((component) => ({
      type: component.firstParty ? 'application' : 'library',
      name: component.name,
      version: component.version,
      ...(component.firstParty
        ? { properties: [{ name: 'dejavu:first-party', value: 'true' }] }
        : {}),
    })),
  };
  writeFileSync(path.join(root, 'docs', 'SBOM.json'), JSON.stringify(sbom));
  const rows = Object.entries(documented).map(([name, licence]) => `| \`${name}\` | \`^\` | \`${licence}\` | note |`);
  writeFileSync(path.join(root, 'docs', 'THIRD-PARTY.md'), ['# Licences', '', ...rows, ''].join('\n'));
  for (const [name, licence] of Object.entries(installed)) {
    const dir = path.join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, license: licence }));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('classify', () => {
  it('recognises permissive licences as MIT-compatible', () => {
    for (const licence of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'Unlicense', 'CC0-1.0']) {
      expect(classify(licence).bucket, licence).toBe('permissive');
      expect(classify(licence).blocking, licence).toBe(false);
    }
  });

  it('recognises copyleft licences as blocking', () => {
    for (const licence of ['GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'SSPL-1.0', 'EUPL-1.2', 'CDDL-1.0']) {
      expect(classify(licence).bucket, licence).toBe('copyleft');
      expect(classify(licence).blocking, licence).toBe(true);
    }
  });

  it('reports platform licences without blocking', () => {
    for (const licence of ['SEE LICENSE IN LICENSE.txt', 'UNLICENSED']) {
      expect(classify(licence).bucket, licence).toBe('platform');
      expect(classify(licence).blocking, licence).toBe(false);
    }
  });

  it('reports undeclared and unknown licences without blocking', () => {
    expect(classify(undefined).bucket).toBe('undeclared');
    expect(classify('').bucket).toBe('undeclared');
    expect(classify('NOASSERTION').bucket).toBe('undeclared');
    expect(classify('Some Custom Terms 1.0').bucket).toBe('unknown');
    expect(classify('Some Custom Terms 1.0').blocking).toBe(false);
  });
});

describe('checkLicences on fixtures', () => {
  it('blocks on a copyleft runtime dependency and names it', () => {
    const tree = fixture(
      [{ name: '@acme/app', version: '1.0.0', firstParty: true }, { name: 'viral', version: '2.0.0' }],
      { viral: 'GPL-3.0' },
    );
    const result = checkLicences({ root: tree.root });
    tree.cleanup();
    expect(result.ok).toBe(false);
    expect(result.incompatible).toEqual(['viral@2.0.0: GPL-3.0']);
  });

  it('signals an undeclared licence without blocking', () => {
    const tree = fixture([{ name: 'mystery', version: '1.2.3' }], {});
    const result = checkLicences({ root: tree.root });
    tree.cleanup();
    expect(result.ok).toBe(true);
    expect(result.reported.join('\n')).toContain('mystery@1.2.3: licence not declared');
  });

  it('prefers the installed manifest over the documented table', () => {
    const tree = fixture([{ name: 'pkg', version: '1.0.0' }], { pkg: 'GPL-3.0' }, { pkg: 'MIT' });
    const result = checkLicences({ root: tree.root });
    tree.cleanup();
    expect(result.ok).toBe(true);
    expect(result.components[0].licence).toBe('MIT');
    expect(result.components[0].source).toBe('node_modules');
  });

  it('ignores first-party components (covered by the repository licence)', () => {
    const tree = fixture([{ name: '@acme/app', version: '1.0.0', firstParty: true }], {});
    const result = checkLicences({ root: tree.root });
    tree.cleanup();
    expect(result.components).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('checkLicences on the repository', () => {
  it('parses the documented licence table of docs/THIRD-PARTY.md', () => {
    const table = thirdPartyLicences(repoRoot);
    expect(table.get('@forge/api')).toBe('SEE LICENSE IN LICENSE.txt');
    expect(table.size).toBeGreaterThanOrEqual(8);
  });

  it('ships nothing copyleft inside the MIT repository', () => {
    const result = checkLicences();
    expect(result.incompatible).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.components.length).toBeGreaterThanOrEqual(8);
    for (const component of result.components) {
      expect(component.name.startsWith('@forge/'), component.name).toBe(true);
      expect(['platform', 'permissive', 'undeclared', 'unknown'], component.name).toContain(component.bucket);
    }
  });
});
