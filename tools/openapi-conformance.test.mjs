/**
 * OpenAPI conformance of the universal entry (docs/openapi.yaml).
 *
 * The document must describe what the code really does — the other way round
 * is how API documentation dies. This test binds the two together:
 *
 *   - the YAML loads and every schema compiles under `ajv` (already a root
 *     dev dependency — no new package);
 *   - the `required` list of `UniversalRequest` is exactly the list the
 *     engine checks in `packages/core/src/universal.ts`, and every property
 *     the document cites is a field the engine reads (plus `idempotencyKey`,
 *     documented as accepted-and-ignored until deduplication lands);
 *   - valid and invalid payloads get the same verdict from `ajv` and from
 *     the engine's `parseUniversalPayload`;
 *   - every response code the document promises is returned somewhere in
 *     the Brain's universal route (`apps/brain/src/universal.ts`) — except
 *     413, which the Forge platform itself enforces on oversized bodies and
 *     no repository code can return;
 *   - the 50 KiB cap on `log` is the engine's own `MAX_LOG_BYTES`, not a
 *     number recopied by hand.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import { MAX_LOG_BYTES, parseUniversalPayload } from '@dejavu/core';
import { repoRoot } from './lib/verify.mjs';

const OPENAPI = path.join(repoRoot, 'docs', 'openapi.yaml');
const ENGINE = path.join(repoRoot, 'packages', 'core', 'src', 'universal.ts');
const ROUTE = path.join(repoRoot, 'apps', 'brain', 'src', 'universal.ts');

/** Response codes enforced by the Forge platform, not by repository code. */
const PLATFORM_CODES = new Set(['413']);

function loadDoc() {
  return yaml.load(readFileSync(OPENAPI, 'utf8'));
}

/** Compiles one component schema with ajv, refs resolved inside the doc. */
function compileSchema(doc, name) {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  return ajv.compile({ $ref: `#/components/schemas/${name}`, components: doc.components });
}

/** The `for (const field of ['a', 'b'])` lists of the engine's parser. */
function fieldLists(source) {
  const lists = [];
  for (const match of source.matchAll(/for \(const field of \[([^\]]*)\]\)/g)) {
    lists.push([...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
  }
  return lists;
}

/** The keys of the payload object built by `toPayload` in the engine. */
function payloadKeys(source) {
  const start = source.indexOf('function toPayload');
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf('{', source.indexOf('): UniversalPayload', start));
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const body = source.slice(open, close);
  // Keys with a value (`field: …`) and shorthand keys (`testCases,`).
  return [...body.matchAll(/^\s{4}(\w+)[:,]/gm)].map((match) => match[1]);
}

/** The HTTP status codes the Brain's universal route can answer with. */
function routeStatusCodes(source) {
  const codes = new Set();
  const shapes = [
    /status:\s*(\d{3})/g, // returned objects
    /jsonResponse\((\d{3})/g, // direct answers
    /\?\s*(\d{3})\s*:\s*(\d{3})/g, // ternaries pick both branches
  ];
  for (const shape of shapes) {
    for (const match of source.matchAll(shape)) {
      codes.add(match[1]);
      if (match[2]) codes.add(match[2]);
    }
  }
  return codes;
}

const VALID_PAYLOAD = {
  projectKey: 'demo-key',
  repository: 'acme/payments',
  branch: 'main',
  commit: 'a'.repeat(40),
  author: 'dev@example.com',
  step: 'pytest',
  log: 'FAILED tests/test_x.py::test_a - AssertionError: 1 != 2',
  failedAt: '2026-11-01T10:00:00Z',
  testCases: [{ name: 'tests/test_x.py::test_a', message: 'AssertionError: 1 != 2' }],
};

describe('docs/openapi.yaml loads and compiles', () => {
  it('is an OpenAPI 3.1 document describing POST /universal', () => {
    const doc = loadDoc();
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.paths['/universal'].post).toBeDefined();
  });

  it('compiles every component schema under ajv', () => {
    const doc = loadDoc();
    for (const name of Object.keys(doc.components.schemas)) {
      expect(typeof compileSchema(doc, name), `schema ${name}`).toBe('function');
    }
  });
});

describe('the schemas cite exactly the fields the engine reads', () => {
  const source = readFileSync(ENGINE, 'utf8');
  const [required, optionalStrings] = fieldLists(source);
  const schema = loadDoc().components.schemas.UniversalRequest;

  it('the engine source still exposes the two field lists', () => {
    expect(required).toEqual(['projectKey', 'repository', 'branch', 'log']);
    expect(optionalStrings).toEqual(['commit', 'author', 'step', 'failedAt']);
  });

  it('requires exactly what the engine requires', () => {
    expect([...schema.required].sort()).toEqual([...required].sort());
  });

  it('documents every field the validated payload carries', () => {
    const properties = Object.keys(schema.properties);
    for (const key of payloadKeys(source)) {
      expect(properties, `field ${key} read by the engine`).toContain(key);
    }
    for (const field of [...required, ...optionalStrings, 'testCases']) {
      expect(properties, `field ${field}`).toContain(field);
    }
  });

  it('documents no field the engine ignores, except idempotencyKey', () => {
    // `idempotencyKey` is accepted and ignored by today's Brain (reserved for
    // deduplication) — it is the single documented extra, on purpose.
    const known = new Set([...payloadKeys(source), 'idempotencyKey']);
    for (const property of Object.keys(schema.properties)) {
      expect(known, `undocumented drift: ${property}`).toContain(property);
    }
  });

  it('pins the log cap to the engine constant, not a recopied number', () => {
    expect(schema.properties.log['x-dejavu-max-bytes']).toBe(MAX_LOG_BYTES);
  });
});

describe('ajv and the engine agree on payloads', () => {
  const validate = compileSchema(loadDoc(), 'UniversalRequest');

  it('accepts the same valid payload', () => {
    expect(validate(VALID_PAYLOAD), JSON.stringify(validate.errors)).toBe(true);
    expect(parseUniversalPayload(VALID_PAYLOAD).ok).toBe(true);
  });

  it('refuses the same payloads missing a required field', () => {
    for (const field of ['projectKey', 'repository', 'branch', 'log']) {
      const payload = { ...VALID_PAYLOAD };
      delete payload[field];
      expect(validate(payload), `ajv on missing ${field}`).toBe(false);
      expect(parseUniversalPayload(payload).ok, `engine on missing ${field}`).toBe(false);
    }
  });

  it('refuses the same wrongly typed payloads', () => {
    const cases = [
      { ...VALID_PAYLOAD, projectKey: 42 },
      { ...VALID_PAYLOAD, log: ['not', 'a', 'string'] },
      { ...VALID_PAYLOAD, testCases: 'not-an-array' },
      { ...VALID_PAYLOAD, testCases: [{ message: 'no name' }] },
      { ...VALID_PAYLOAD, testCases: [{ name: 'no message' }] },
    ];
    for (const payload of cases) {
      expect(validate(payload), `ajv on ${JSON.stringify(payload).slice(0, 80)}`).toBe(false);
      expect(parseUniversalPayload(payload).ok, `engine on ${JSON.stringify(payload).slice(0, 80)}`).toBe(false);
    }
  });

  // Known and accepted divergence: the engine also rejects empty strings
  // (a required field must be non-empty after trim) while the JSON Schema
  // only requires `type: string`. The engine is the stricter of the two, so
  // nothing invalid slips through the route.
});

describe('the documented response codes exist in the route', () => {
  const doc = loadDoc();
  const documented = Object.keys(doc.paths['/universal'].post.responses);
  const coded = routeStatusCodes(readFileSync(ROUTE, 'utf8'));

  it('every documented code is returned by the code or by the platform', () => {
    for (const code of documented) {
      expect(coded.has(code) || PLATFORM_CODES.has(code), `response ${code}`).toBe(true);
    }
  });

  it('every code the route returns is documented', () => {
    for (const code of coded) {
      expect(documented, `response ${code}`).toContain(code);
    }
  });

  it('validates the two response shapes under ajv', () => {
    const accepted = compileSchema(doc, 'AcceptedResponse');
    const refused = compileSchema(doc, 'ErrorResponse');
    expect(accepted({ ok: true, queued: true })).toBe(true);
    expect(accepted({ ok: true })).toBe(false);
    expect(refused({ ok: false, error: 'invalid universal key' })).toBe(true);
    expect(refused({ ok: false })).toBe(false);
  });
});
