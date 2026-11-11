/**
 * Integration of the consumer core with the REAL engine.
 *
 * The unit tests of `consume.test.ts` drive the ports with doubles; this
 * file wires `consumeIngest` to the actual `@dejavu/core` functions
 * (imported from source: the package is not built when the app tests run)
 * and proves that the `ConsumerEngine` contract matches the engine — same
 * signatures, same behaviour, idempotency included. Only the memory and the
 * Jira side stay doubles.
 */

import { describe, expect, it } from 'vitest';
import type { IngestPayload } from '@dejavu/core';
import {
  assessFlakiness,
  detectOutbreak,
  detectRegression,
  diagnose,
  extractErrorBlocks,
  planTicketActions,
  signatureKeys,
  testStats,
} from '../../../packages/core/src/index';
import { consumeIngest, type ConsumerDeps, type ConsumerEngine } from '../src/pure/consume';
import { FakeConsumerStore, FakeTicketApplier } from './fakes/consumer';

/** The real engine, assembled exactly like `src/consumer.ts` does. */
export function realEngine(): ConsumerEngine {
  return {
    extractErrorBlocks,
    signatureKeys,
    diagnose,
    assessFlakiness,
    planTicketActions,
    detectOutbreak,
    testStats,
    detectRegression,
  };
}

const JEST_LOG = [
  'FAIL src/auth/login.test.ts',
  '  ● login › accepts a valid user',
  '',
  '    expect(received).toBe(expected) // Object.is equality',
  '',
  '    Expected: 200',
  '    Received: 500',
  '',
  '      at Object.<anonymous> (src/auth/login.test.ts:42:21)',
].join('\n');

function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    version: 1,
    workspace: 'acme',
    repository: 'acme/payments',
    branch: 'feature/login',
    commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    author: 'marie',
    prId: 42,
    stepName: 'test',
    durationS: 95,
    failedAt: '2026-11-05T09:00:00.000Z',
    errorBlocks: [JEST_LOG],
    changedFiles: ['src/auth/login.ts'],
    ...overrides,
  };
}

function deps(store: FakeConsumerStore): ConsumerDeps {
  return {
    store,
    engine: realEngine(),
    tickets: new FakeTicketApplier(),
    now: () => new Date('2026-11-05T09:05:00.000Z'),
  };
}

describe('consumeIngest with the real engine', () => {
  it('extracts, signs, stores and diagnoses a Jest failure', async () => {
    const store = new FakeConsumerStore();
    const result = await consumeIngest(payload(), deps(store));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.processed.length).toBeGreaterThanOrEqual(1);
    const signature = [...store.signatures.values()][0];
    expect(signature.id).toMatch(/^[0-9a-f]{16}$/);
    expect(signature.familyId).toMatch(/^[0-9a-f]{16}$/);
    expect(signature.category).toBe('test');
    expect(store.occurrences.size).toBe(result.processed.length);

    const diagnostic = result.processed[0].diagnostic;
    expect(diagnostic.kind).toBe('new');
    expect(diagnostic.confidence).toBeGreaterThan(0);
    expect(diagnostic.facts.length).toBeGreaterThanOrEqual(1);
    expect(diagnostic.title.length).toBeLessThanOrEqual(90);
  });

  it('groups a second, cosmetic-different failure under the same signature', async () => {
    const store = new FakeConsumerStore();
    const d = deps(store);
    await consumeIngest(payload(), d);
    const second = payload({
      failedAt: '2026-11-06T09:00:00.000Z',
      branch: 'feature/logout',
      errorBlocks: [JEST_LOG.replace('login.test.ts:42:21', 'login.test.ts:57:9')],
    });
    const result = await consumeIngest(second, d);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same normalized error, only the line number changed: one signature.
    expect(store.signatures.size).toBe(1);
    const signature = [...store.signatures.values()][0];
    expect(signature.occurrences).toBe(2);
    expect(signature.status).toBe('known');
  });

  it('stays idempotent with the real engine too', async () => {
    const store = new FakeConsumerStore();
    const d = deps(store);
    const first = await consumeIngest(payload(), d);
    expect(first.ok).toBe(true);
    const replay = await consumeIngest(payload(), d);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replays).toBeGreaterThan(0);
    expect(replay.processed).toHaveLength(0);
    const signature = [...store.signatures.values()][0];
    expect(signature.occurrences).toBe(1);
  });

  it('stores the raw excerpt with the retention of the settings', async () => {
    const store = new FakeConsumerStore();
    store.settings = { ...store.settings, rawRetentionDays: 7 };
    const result = await consumeIngest(payload(), deps(store));
    expect(result.ok).toBe(true);
    const excerpt = [...store.excerpts.values()][0];
    expect(excerpt.expiresAt).toBe('2026-11-12T09:05:00.000Z');
    expect(excerpt.text).toContain('Expected: 200');
  });
});
