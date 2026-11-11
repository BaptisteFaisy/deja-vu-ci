import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_LOG_BYTES,
  clearMasker,
  initUniversal,
  parseUniversalPayload,
  setMasker,
  universalToIngest,
  type Masker,
} from '../src/universal.js';

/** Minimal masker double, used until the masking module lands (lot A). */
const fakeMasker: Masker = (text: string) => {
  const matches = text.match(/gh[pousr]_[A-Za-z0-9]{10,}/g) ?? [];
  return {
    text: text.replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, '[redacted]'),
    masked: matches.length,
    kinds: matches.length > 0 ? ['token'] : [],
  };
};

/** Valid payload, with the fields any CI sends. */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectKey: 'demo',
    repository: 'acme/api',
    branch: 'main',
    commit: 'abc123',
    author: 'marie',
    step: 'test',
    log: 'AssertionError: expected true to be false\n  at spec/api.ts:12',
    ...overrides,
  };
}

/** Parse a body that is known to be valid. */
function parsed(overrides: Record<string, unknown> = {}) {
  const result = parseUniversalPayload(validBody(overrides));
  if (!result.ok) throw new Error(`unexpected invalid payload: ${result.error}`);
  return result.payload;
}

describe('parseUniversalPayload', () => {
  it('accepts a valid payload', () => {
    const result = parseUniversalPayload(validBody());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.projectKey).toBe('demo');
    expect(result.payload.repository).toBe('acme/api');
    expect(result.payload.branch).toBe('main');
    expect(result.payload.commit).toBe('abc123');
    expect(result.payload.log).toContain('AssertionError');
  });

  it('refuses a payload without log', () => {
    const result = parseUniversalPayload(validBody({ log: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('log');
  });

  it('refuses a payload that is not an object', () => {
    const result = parseUniversalPayload('not a payload');
    expect(result).toEqual({ ok: false, error: 'payload must be a JSON object' });
  });

  it('names the missing field in the error', () => {
    const result = parseUniversalPayload(validBody({ projectKey: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('projectKey is required');
  });

  it('refuses a field of the wrong type', () => {
    const result = parseUniversalPayload(validBody({ commit: 42 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('commit must be a string');
  });

  it('refuses malformed test cases', () => {
    const result = parseUniversalPayload(validBody({ testCases: [{ message: 'no name' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('test case');
  });

  it('truncates a journal longer than 50 KiB', () => {
    const result = parseUniversalPayload(validBody({ log: 'x'.repeat(MAX_LOG_BYTES + 5000) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.byteLength(result.payload.log, 'utf8')).toBeLessThanOrEqual(MAX_LOG_BYTES);
  });

  it('keeps a journal of the allowed size untouched', () => {
    const log = 'y'.repeat(MAX_LOG_BYTES);
    const result = parseUniversalPayload(validBody({ log }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.log).toBe(log);
  });
});

describe('universalToIngest', () => {
  beforeEach(() => setMasker(fakeMasker));
  afterEach(() => clearMasker());

  it('produces an ingest payload with the same fields', () => {
    const ingest = universalToIngest(parsed());
    expect(ingest.version).toBe(1);
    expect(ingest.repository).toBe('acme/api');
    expect(ingest.branch).toBe('main');
    expect(ingest.commit).toBe('abc123');
    expect(ingest.author).toBe('marie');
    expect(ingest.stepName).toBe('test');
    expect(ingest.errorBlocks).toHaveLength(1);
    expect(ingest.errorBlocks[0]).toContain('AssertionError');
  });

  it('masks the token found in the payload', () => {
    const ingest = universalToIngest(
      parsed({ log: 'failed with token ghp_exampleToken012345' }),
    );
    expect(ingest.errorBlocks[0]).not.toContain('ghp_exampleToken012345');
    expect(ingest.errorBlocks[0]).toContain('[redacted]');
  });

  it('masks the token found in the test cases', () => {
    const ingest = universalToIngest(
      parsed({
        testCases: [{ name: 'spec/api', message: 'boom ghp_exampleToken012345' }],
      }),
    );
    expect(ingest.testCases?.[0].message).not.toContain('ghp_');
  });

  it('refuses a payload whose key does not match the setting', () => {
    expect(() => universalToIngest(parsed(), { settings: { universalKey: 'other' } })).toThrow(
      /universal key/,
    );
  });

  it('refuses to build a payload when no masker is available', () => {
    clearMasker();
    expect(() => universalToIngest(parsed())).toThrow(/masking/);
  });

  it('wires the masking module when it is reachable', async () => {
    const loaded = await initUniversal();
    expect(typeof loaded).toBe('boolean');
  });
});
