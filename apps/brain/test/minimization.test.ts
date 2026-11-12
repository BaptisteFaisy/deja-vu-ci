/**
 * Wiring of the data minimization on the ingestion path (§ 18, CI-18).
 *
 * What is verified here is the Brain's part: the per-project setting reaches the
 * consumer, `hash-only` keeps **no text at all**, a bounded snippet stays
 * bounded, and a project that never chose a policy stores exactly what it always
 * stored.
 *
 * The policy itself is the engine's (`packages/core/src/minimize.ts`). The core
 * barrel does not re-export it and this lot may not change the engine, so the app
 * applies it through `applyExcerptPolicy` — and the last block of this file
 * asserts, input for input, that the app's application agrees with the engine's
 * `minimizeExcerpt`. The two can never drift silently.
 *
 * The fake secret below is built at runtime: a key-shaped literal never appears
 * in the repository.
 */

import { describe, expect, it } from 'vitest';
import type { IngestPayload } from '@dejavu/core';
import {
  MINIMIZE_POLICIES as ENGINE_POLICIES,
  minimizeExcerpt as engineMinimize,
} from '../../../packages/core/src/minimize';
import { consumeIngest, storedExcerpt, type ConsumerDeps } from '../src/pure/consume';
import { DEFAULT_SETTINGS } from '../src/pure/defaults';
import {
  DEFAULT_EXCERPT_POLICY,
  MINIMIZE_POLICIES,
  applyExcerptPolicy,
  excerptFingerprint,
  isMinimizePolicy,
  policyOr,
} from '../src/pure/excerptPolicy';
import { excerptPolicyOf, toSettingsPayload } from '../src/pure/settingsSchema';
import { FakeConsumerEngine, FakeConsumerStore, FakeTicketApplier } from './fakes/consumer';

/** A token-shaped secret, assembled at runtime. */
const FAKE_TOKEN = ['ghp', 'A'.repeat(36)].join('_');

/** A failure log that holds a secret and more text than a snippet keeps. */
const LOG = [
  'AssertionError: expected 200 got 500',
  `authorization: ${FAKE_TOKEN}`,
  'x'.repeat(900),
].join('\n');

function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    version: 1,
    workspace: 'acme',
    repository: 'acme/payments',
    branch: 'feature/login',
    commit: 'a'.repeat(40),
    author: 'marie',
    stepName: 'test',
    durationS: 90,
    failedAt: '2026-11-12T09:00:00.000Z',
    errorBlocks: [LOG],
    ...overrides,
  };
}

function deps(store: FakeConsumerStore, over: Partial<ConsumerDeps> = {}): ConsumerDeps {
  return {
    store,
    engine: new FakeConsumerEngine(),
    tickets: new FakeTicketApplier(),
    now: () => new Date('2026-11-12T09:05:00.000Z'),
    ...over,
  };
}

/** The single excerpt the ingestion stored. */
function storedText(store: FakeConsumerStore): string {
  return [...store.excerpts.values()][0].text;
}

describe('the ingestion path under each policy', () => {
  it('stores no text at all under hash-only', async () => {
    const store = new FakeConsumerStore();
    const result = await consumeIngest(
      payload(),
      deps(store, { excerptPolicy: 'hash-only', minimize: applyExcerptPolicy }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(storedText(store)).toBe('');
    expect(result.processed[0].excerpt.policy).toBe('hash-only');
    expect(result.processed[0].excerpt.bytes).toBe(0);
    // The fingerprint survives: the failure can still be correlated.
    expect(result.processed[0].excerpt.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // The memory itself is untouched by the policy.
    expect(store.occurrences.size).toBe(1);
    expect(store.signatures.size).toBe(1);
  });

  it('keeps a bounded, masked snippet under masked-snippet', async () => {
    const store = new FakeConsumerStore();
    await consumeIngest(
      payload(),
      deps(store, { excerptPolicy: 'masked-snippet', minimize: applyExcerptPolicy }),
    );
    const text = storedText(store);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(512);
    expect(text).not.toContain(FAKE_TOKEN);
  });

  it('keeps the masked text under full', async () => {
    const store = new FakeConsumerStore();
    await consumeIngest(
      payload(),
      deps(store, { excerptPolicy: 'full', minimize: applyExcerptPolicy }),
    );
    const text = storedText(store);
    expect(text).toContain('AssertionError');
    expect(text).not.toContain(FAKE_TOKEN);
  });

  it('never keeps the secret, whatever the project chose', async () => {
    for (const policy of MINIMIZE_POLICIES) {
      const store = new FakeConsumerStore();
      await consumeIngest(
        payload(),
        deps(store, { excerptPolicy: policy, minimize: applyExcerptPolicy }),
      );
      expect(storedText(store)).not.toContain(FAKE_TOKEN);
    }
  });

  it('stores the excerpt as it arrives when no minimizer is wired', async () => {
    const store = new FakeConsumerStore();
    await consumeIngest(payload(), deps(store, { excerptPolicy: 'full' }));
    expect(storedText(store)).toBe(LOG);
  });

  it('keeps the retention window of the settings under every policy', async () => {
    const store = new FakeConsumerStore();
    store.settings = { ...store.settings, rawRetentionDays: 7 };
    await consumeIngest(
      payload(),
      deps(store, { excerptPolicy: 'hash-only', minimize: applyExcerptPolicy }),
    );
    expect([...store.excerpts.values()][0].expiresAt).toBe('2026-11-19T09:05:00.000Z');
  });
});

describe('storedExcerpt', () => {
  const store = new FakeConsumerStore();

  it('reports the default policy and the size of the text it keeps', () => {
    const stored = storedExcerpt('some text', deps(store));
    expect(stored.text).toBe('some text');
    expect(stored.excerpt.policy).toBe(DEFAULT_EXCERPT_POLICY);
    expect(stored.excerpt.bytes).toBe(9);
    expect(stored.excerpt.fingerprint).toBeUndefined();
  });

  it('hands the fingerprint back when the minimizer ran', () => {
    const stored = storedExcerpt('some text', deps(store, {
      excerptPolicy: 'hash-only',
      minimize: applyExcerptPolicy,
    }));
    expect(stored.text).toBe('');
    expect(stored.excerpt.bytes).toBe(0);
    expect(stored.excerpt.fingerprint).toBe(excerptFingerprint('some text'));
  });
});

describe('the per-project setting', () => {
  it('defaults to today behaviour and knows the three policies', () => {
    expect(DEFAULT_EXCERPT_POLICY).toBe('full');
    expect([...MINIMIZE_POLICIES]).toEqual([...ENGINE_POLICIES]);
    expect(isMinimizePolicy('hash-only')).toBe(true);
    expect(isMinimizePolicy('everything')).toBe(false);
    expect(policyOr('masked-snippet')).toBe('masked-snippet');
    expect(policyOr('everything')).toBe(DEFAULT_EXCERPT_POLICY);
    expect(policyOr(undefined)).toBe(DEFAULT_EXCERPT_POLICY);
  });

  it('reads the policy out of a settings payload', () => {
    expect(excerptPolicyOf({ excerptPolicy: 'hash-only' })).toEqual({ ok: true, value: 'hash-only' });
    expect(excerptPolicyOf({})).toEqual({ ok: true, value: undefined });
    expect(excerptPolicyOf({ excerptPolicy: null })).toEqual({ ok: true, value: undefined });
    expect(excerptPolicyOf('nope')).toEqual({ ok: true, value: undefined });
  });

  it('refuses a policy that is not one of the three', () => {
    expect(excerptPolicyOf({ excerptPolicy: 'keep-everything' }).ok).toBe(false);
  });

  it('carries the policy to the settings page, and only when it is known', () => {
    expect(toSettingsPayload(DEFAULT_SETTINGS, 'hash-only').excerptPolicy).toBe('hash-only');
    expect('excerptPolicy' in toSettingsPayload(DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('the app policy agrees with the engine minimizer', () => {
  const SAMPLES = [
    '',
    'plain failure',
    LOG,
    'x'.repeat(2000),
    'hélïnde ünïcode ✅ — accents and a multi-byte character',
    `Bearer ${FAKE_TOKEN}`,
  ];

  it('produces exactly what minimizeExcerpt produces, on every policy', () => {
    for (const policy of MINIMIZE_POLICIES) {
      for (const text of SAMPLES) {
        expect(applyExcerptPolicy({ text }, policy)).toEqual(engineMinimize({ text }, policy));
      }
    }
  });

  it('honours a custom snippet budget like the engine does', () => {
    expect(applyExcerptPolicy({ text: LOG }, 'masked-snippet', 64)).toEqual(
      engineMinimize({ text: LOG }, 'masked-snippet', { maxChars: 64 }),
    );
  });

  it('keeps a fingerprint the caller already computed', () => {
    const excerpt = { text: LOG, fingerprint: 'deadbeefcafe1234' };
    expect(applyExcerptPolicy(excerpt, 'hash-only')).toEqual(engineMinimize(excerpt, 'hash-only'));
    expect(applyExcerptPolicy(excerpt, 'hash-only').fingerprint).toBe('deadbeefcafe1234');
  });

  it('fingerprints the raw text, identically under every policy', () => {
    const fingerprints = MINIMIZE_POLICIES.map(
      (policy) => applyExcerptPolicy({ text: LOG }, policy).fingerprint,
    );
    expect(new Set(fingerprints).size).toBe(1);
    expect(fingerprints[0]).toMatch(/^[0-9a-f]{16}$/);
  });
});
