/**
 * Tests of the runtime payload validation (`src/pure/validate.ts`).
 */

import { describe, expect, it } from 'vitest';
import { validateIngestPayload, validateQueryRequest, validateTestCase } from '../src/pure/validate.js';

const VALID = {
  version: 1,
  workspace: 'acme',
  repository: 'acme/payments',
  branch: 'main',
  commit: 'deadbeef',
  author: 'marie',
  stepName: 'test',
  durationS: 60,
  failedAt: '2026-11-05T09:00:00.000Z',
  errorBlocks: ['boom'],
};

describe('validateIngestPayload', () => {
  it('accepts a minimal valid payload', () => {
    const result = validateIngestPayload(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.repository).toBe('acme/payments');
  });

  it('accepts every optional field', () => {
    const result = validateIngestPayload({
      ...VALID,
      prId: 12,
      stepUuid: '{uuid}',
      buildUrl: 'https://ci.example.com/1',
      buildNumber: 7,
      testCases: [{ name: 't', message: 'm', stack: 's', classname: 'c', durationMs: 5 }],
      branchHistory: ['a', 'b'],
      containsResolution: { commit: 'abc', contains: true },
      changedFiles: ['src/a.ts'],
      linkedIssueKey: 'PAY-1',
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['a non-object', 'hello'],
    ['the wrong version', { ...VALID, version: 2 }],
    ['a missing repository', { ...VALID, repository: undefined }],
    ['an empty branch', { ...VALID, branch: '' }],
    ['a non-ISO failedAt', { ...VALID, failedAt: 'yesterday' }],
    ['a negative duration', { ...VALID, durationS: -1 }],
    ['non-string error blocks', { ...VALID, errorBlocks: [42] }],
    ['a malformed containsResolution', { ...VALID, containsResolution: { commit: 3 } }],
  ])('refuses %s', (_label, body) => {
    expect(validateIngestPayload(body).ok).toBe(false);
  });

  it('reports the offending field in the error', () => {
    const result = validateIngestPayload({ ...VALID, author: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('author');
  });
});

describe('validateTestCase', () => {
  it('accepts a minimal case and refuses a nameless one', () => {
    expect(validateTestCase({ name: 't', message: 'm' }, 0).ok).toBe(true);
    expect(validateTestCase({ message: 'm' }, 0).ok).toBe(false);
  });
});

describe('validateQueryRequest', () => {
  const QUERY = { kind: 'pr-card', repository: 'acme/payments', branch: 'main' };

  it('accepts a pr-card request, with or without commit', () => {
    expect(validateQueryRequest(QUERY).ok).toBe(true);
    expect(validateQueryRequest({ ...QUERY, commit: 'abc' }).ok).toBe(true);
  });

  it('refuses another kind or a missing branch', () => {
    expect(validateQueryRequest({ ...QUERY, kind: 'other' }).ok).toBe(false);
    expect(validateQueryRequest({ kind: 'pr-card', repository: 'r' }).ok).toBe(false);
  });
});
