// Tests of docs/openapi.yaml: it loads, and its schemas cite the fields the
// universal entry really expects (`packages/core/src/universal.ts`).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const OPENAPI = fileURLToPath(new URL('../docs/openapi.yaml', import.meta.url));

function loadDoc() {
  return yaml.load(readFileSync(OPENAPI, 'utf8'));
}

describe('docs/openapi.yaml', () => {
  it('is valid OpenAPI 3.1 and describes POST /universal', () => {
    const doc = loadDoc();
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.paths['/universal'].post).toBeDefined();
  });

  it('requires the four mandatory fields of the universal payload', () => {
    const req = loadDoc().components.schemas.UniversalRequest;
    for (const field of ['projectKey', 'repository', 'branch', 'log']) {
      expect(req.required).toContain(field);
    }
  });

  it('cites every field the engine actually reads', () => {
    const props = loadDoc().components.schemas.UniversalRequest.properties;
    for (const field of ['projectKey', 'repository', 'branch', 'commit', 'author', 'step', 'log', 'failedAt', 'testCases']) {
      expect(props[field], `missing field ${field}`).toBeDefined();
    }
  });

  it('documents the 50 KiB journal cap on the log field', () => {
    const log = loadDoc().components.schemas.UniversalRequest.properties.log;
    expect(log['x-dejavu-max-bytes']).toBe(51200);
  });

  it('documents the response codes the route can return', () => {
    const responses = loadDoc().paths['/universal'].post.responses;
    for (const code of ['202', '400', '401', '404', '500', '503']) {
      expect(responses[code], `missing response ${code}`).toBeDefined();
    }
  });

  it('describes a FailedTestCase with its required fields', () => {
    const tc = loadDoc().components.schemas.FailedTestCase;
    expect(tc.required).toEqual(expect.arrayContaining(['name', 'message']));
  });
});