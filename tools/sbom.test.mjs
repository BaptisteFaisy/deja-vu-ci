/**
 * Test of the SBOM tool (tools/sbom.mjs).
 *
 * The SBOM is a deterministic CycloneDX 1.5 document read from the workspace
 * `package.json` files — no install, no network. This test pins three
 * properties: two generations are byte-identical, the expected runtime
 * components are present, and no dev/toolchain dependency leaks in.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSbom, renderSbom, OUTPUT_PATH } from './sbom.mjs';

function names(sbom) {
  return sbom.components.map((c) => c.name);
}

describe('SBOM (CycloneDX 1.5)', () => {
  it('is deterministic: two generations are byte-identical', () => {
    const first = renderSbom(buildSbom());
    const second = renderSbom(buildSbom());
    expect(second).toBe(first);
  });

  it('lists the internal packages and both apps', () => {
    const list = names(buildSbom());
    for (const expected of ['@dejavu/sensor', '@dejavu/brain', '@dejavu/bridge', '@dejavu/core', '@dejavu/present']) {
      expect(list).toContain(expected);
    }
  });

  it('lists the @forge runtime dependencies of the apps', () => {
    const list = names(buildSbom());
    for (const expected of ['@forge/api', '@forge/bridge', '@forge/kvs', '@forge/events', '@forge/llm', '@forge/react', '@forge/resolver', '@forge/sql']) {
      expect(list).toContain(expected);
    }
  });

  it('does not invent dev or toolchain dependencies', () => {
    const list = names(buildSbom());
    for (const phantom of ['typescript', 'vitest', 'esbuild', 'react', 'react-dom', 'js-yaml', 'ajv', '@forge/manifest']) {
      expect(list).not.toContain(phantom);
    }
  });

  it('the committed docs/SBOM.json matches a fresh generation', () => {
    const committed = readFileSync(OUTPUT_PATH, 'utf8');
    expect(committed).toBe(renderSbom(buildSbom()));
  });
});