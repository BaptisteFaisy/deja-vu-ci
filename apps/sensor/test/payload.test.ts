/**
 * Payload construction — specification § 8.1 step 3, § 18 (Secrets),
 * § 19 (50 KiB cap), § 10.2 (ancestor verdict).
 */

import { describe, expect, it } from 'vitest';
import { buildIngestPayload, boundHistory, maskTestCase, MAX_BRANCH_HISTORY } from '../src/pure/payload.js';
import { MAX_TOTAL_BLOCK_BYTES } from '../src/pure/blocks.js';
import { fakeMaskSecrets, masker } from './fakes/mask.js';
import type { FailedTestCase, IngestPayload } from '@dejavu/core';

const BASE = {
  workspace: 'acme',
  repository: 'payments',
  branch: 'feature/pr-42',
  commit: 'a'.repeat(40),
  author: 'alice@example.com',
  stepName: 'test',
  durationS: 42,
  failedAt: '2026-11-11T09:15:00Z',
};

describe('buildIngestPayload', () => {
  it('produces a payload shaped like the frozen IngestPayload contract', () => {
    const payload = buildIngestPayload({ ...BASE, logTail: 'step failed' }, masker);
    const keys = Object.keys(payload).sort();
    expect(keys).toEqual(
      [
        'author',
        'branch',
        'commit',
        'durationS',
        'errorBlocks',
        'failedAt',
        'repository',
        'stepName',
        'version',
        'workspace',
      ].sort(),
    );
    expect(payload.version).toBe(1);
    expect(payload.workspace).toBe('acme');
    expect(payload.repository).toBe('payments');
    expect(payload.errorBlocks).toEqual(['step failed']);
  });

  it('masks the secrets of the log before they leave Bitbucket', () => {
    const log = 'curl -H "Authorization: Bearer ghp_ABCDEF0123456789" failed\ncontact alice@example.com';
    const payload = buildIngestPayload({ ...BASE, logTail: log }, masker);
    expect(payload.errorBlocks.join('\n')).toContain('«[masqué:token]»');
    expect(payload.errorBlocks.join('\n')).not.toContain('ghp_ABCDEF0123456789');
    expect(payload.errorBlocks.join('\n')).not.toContain('alice@example.com');
  });

  it('masks the message and the stack of a failed test case', () => {
    const testCase: FailedTestCase = {
      name: 'test_payment_refused',
      message: 'token ghp_ABCDEF0123456789 rejected',
      stack: 'at test.test.ts:12',
      classname: 'TestPayment',
      durationMs: 15,
    };
    const masked = maskTestCase(testCase, fakeMaskSecrets);
    expect(masked.message).toContain('«[masqué:token]»');
    expect(masked.message).not.toContain('ghp_');
    expect(masked.name).toBe('test_payment_refused');
    expect(masked.classname).toBe('TestPayment');
  });

  it('bounds the total size of the error blocks to 50 KiB', () => {
    const block = 'x'.repeat(20 * 1024);
    const log = Array.from({ length: 8 }, () => block).join('\n\n');
    const payload = buildIngestPayload({ ...BASE, logTail: log }, masker);
    const total = payload.errorBlocks.reduce((sum, b) => sum + Buffer.byteLength(b, 'utf8'), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BLOCK_BYTES);
    expect(payload.errorBlocks.length).toBeGreaterThan(0);
  });

  it('bounds the branch history to 100 commit hashes', () => {
    const history = Array.from({ length: 250 }, (_, i) => `sha${i}`);
    const payload = buildIngestPayload({ ...BASE, logTail: 'boom', branchHistory: history }, masker);
    expect(payload.branchHistory).toHaveLength(MAX_BRANCH_HISTORY);
    expect(payload.branchHistory?.[0]).toBe('sha0');
  });

  it('omits the optional fields that were not collected', () => {
    const payload: IngestPayload = buildIngestPayload(BASE, masker);
    expect(payload.prId).toBeUndefined();
    expect(payload.testCases).toBeUndefined();
    expect(payload.branchHistory).toBeUndefined();
    expect(payload.changedFiles).toBeUndefined();
    expect(payload.containsResolution).toBeUndefined();
    expect(payload.errorBlocks).toEqual([]);
  });

  it('keeps the ancestor verdict only when the Sensor could compute it', () => {
    const commit = 'b'.repeat(40);
    const payload = buildIngestPayload(
      { ...BASE, logTail: 'boom', containsResolution: { commit, contains: false } },
      masker,
    );
    expect(payload.containsResolution).toEqual({ commit, contains: false });
  });

  it('keeps the files touched by the pull request', () => {
    const payload = buildIngestPayload(
      { ...BASE, logTail: 'boom', changedFiles: ['src/pay.ts', 'src/pay.test.ts'] },
      masker,
    );
    expect(payload.changedFiles).toEqual(['src/pay.ts', 'src/pay.test.ts']);
  });
});

describe('boundHistory', () => {
  it('returns undefined for an empty or missing history', () => {
    expect(boundHistory(undefined)).toBeUndefined();
    expect(boundHistory([])).toBeUndefined();
  });
});
