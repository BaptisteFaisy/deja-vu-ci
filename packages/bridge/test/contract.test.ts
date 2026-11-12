/**
 * End-to-end contract between the Sensor (Capteur) and the Brain (Cerveau).
 *
 * The chain exercised here is the real one, with no network at all:
 *
 *   sample dataset → Sensor payload builder (masking included)
 *                 → signed bridge request
 *                 → bridge verification
 *                 → Brain payload validation
 *                 → ingestion into the real in-memory memory
 *                   (the Brain's pure consumer module + the real engine).
 *
 * Only the Jira side stays a double (no Atlassian call is possible in a
 * test), everything else is production code: the bridge, the Sensor's pure
 * payload builder, the Brain's pure validation and consumer modules, the
 * core engine and the core in-memory store.
 *
 * Secrets are built at runtime so that the repository's secret scanners and
 * the `couche0` guard never see a literal key.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BRIDGE_HEADERS,
  MAX_BODY_BYTES,
  signPayload,
  verifyRequest,
} from '../src/index.js';
import {
  MemoryStore,
  assessFlakiness,
  detectOutbreak,
  detectRegression,
  diagnose,
  extractErrorBlocks,
  maskSecrets,
  planTicketActions,
  signatureKeys,
  testStats,
} from '@dejavu/core';
import type { IngestPayload, SampleDataset, SampleOccurrence } from '@dejavu/core';
import { MAX_TOTAL_BLOCK_BYTES } from '../../../apps/sensor/src/pure/blocks.js';
import { buildIngestPayload, type SensorInputs } from '../../../apps/sensor/src/pure/payload.js';
import {
  consumeIngest,
  type ConsumerDeps,
  type ConsumerEngine,
} from '../../../apps/brain/src/pure/consume.js';
import { createNonceCache } from '../../../apps/brain/src/pure/nonce.js';
import { validateIngestPayload } from '../../../apps/brain/src/pure/validate.js';
import { FakeTicketApplier } from '../../../apps/brain/test/fakes/consumer.js';

const SECRET = ['bridge', 'contract', 'secret'].join('-');
const NOW = new Date('2026-11-11T08:00:00Z');
const NONCE = '0123456789abcdef0123456789abcdef';
const DATASET_URL = new URL('../../../data/sample/occurrences.json', import.meta.url);

/** The shipped sample dataset (40 failures over 14 days). */
function dataset(): SampleDataset {
  return JSON.parse(readFileSync(DATASET_URL, 'utf8')) as SampleDataset;
}

/** A real failure of the sample dataset, log included. */
function sampleFailure(): SampleOccurrence {
  const found = dataset().occurrences.find((o) => o.outcome === 'failure' && o.log);
  if (!found) throw new Error('the sample dataset holds no failure with a log');
  return found;
}

/** What the Sensor collected for one failing step. */
function sensorInputs(occurrence: SampleOccurrence): SensorInputs {
  return {
    workspace: 'payments',
    repository: occurrence.repo,
    branch: occurrence.branch,
    commit: occurrence.commit,
    author: occurrence.author,
    stepName: occurrence.step,
    durationS: occurrence.durationS,
    failedAt: occurrence.at,
    logTail: occurrence.log,
    ...(occurrence.buildUrl ? { buildUrl: occurrence.buildUrl } : {}),
  };
}

/** The payload the Sensor really sends, masking included. */
function realPayload(occurrence: SampleOccurrence = sampleFailure()): IngestPayload {
  return buildIngestPayload(sensorInputs(occurrence), maskSecrets);
}

/** The real engine, assembled exactly like the Brain's consumer does. */
function realEngine(): ConsumerEngine {
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

/** The consumer wiring: real memory, real engine, Jira double. */
function consumerDeps(store: MemoryStore): ConsumerDeps {
  return {
    store,
    engine: realEngine(),
    tickets: new FakeTicketApplier(),
    now: () => NOW,
  };
}

/** Signs a payload with a fixed clock and a fixed nonce. */
function sign(payload: unknown, nonce = NONCE) {
  return signPayload(payload, SECRET, { now: NOW, nonce });
}

describe('Capteur → Cerveau: the payload round trip', () => {
  it('carries a real Sensor payload through signing without deforming it', () => {
    const payload = realPayload();
    const { body, headers } = sign(payload);
    const verdict = verifyRequest(headers, body, SECRET, { now: NOW });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.payload).toEqual(payload);
    expect(JSON.parse(body).payload).toEqual(payload);
  });

  it('ingests the verified payload into the real in-memory memory', async () => {
    const payload = realPayload();
    const { body, headers } = sign(payload);
    const verdict = verifyRequest(headers, body, SECRET, { now: NOW });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    const validated = validateIngestPayload(verdict.payload);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const store = new MemoryStore();
    const result = await consumeIngest(validated.value, consumerDeps(store));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.processed.length).toBeGreaterThanOrEqual(1);

    const signatureId = result.processed[0].signatureId;
    const signature = await store.getSignature(signatureId);
    expect(signature?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(signature?.familyId).toMatch(/^[0-9a-f]{16}$/);

    const occurrences = await store.listOccurrences(signatureId);
    expect(occurrences).toHaveLength(result.processed.length);
    expect(occurrences[0].repo).toBe(payload.repository);
    expect(occurrences[0].commit).toBe(payload.commit);
    expect(occurrences[0].occurredAt).toBe(payload.failedAt);

    const diagnostic = result.processed[0].diagnostic;
    expect(diagnostic.facts.length).toBeGreaterThanOrEqual(1);
    expect(diagnostic.title.length).toBeLessThanOrEqual(90);
    expect(diagnostic.confidence).toBeGreaterThan(0);
  });

  it('refuses a payload version the Brain does not know', () => {
    const payload = { ...realPayload(), version: 2 } as unknown as IngestPayload;
    const { body, headers } = sign(payload);
    const verdict = verifyRequest(headers, body, SECRET, { now: NOW });

    // The transport proves authenticity only: it never inspects the payload.
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    const validated = validateIngestPayload(verdict.payload);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.error).toMatch(/version/i);
    expect(validated.error).toMatch(/\d/);
  });
});

describe('Capteur → Cerveau: the size ceilings', () => {
  it('accepts a body of exactly 5 MiB and refuses one byte more', () => {
    const empty = sign({ blob: '' });
    const overhead = Buffer.byteLength(empty.body, 'utf8');

    const exact = sign({ blob: 'x'.repeat(MAX_BODY_BYTES - overhead) });
    expect(Buffer.byteLength(exact.body, 'utf8')).toBe(MAX_BODY_BYTES);
    expect(verifyRequest(exact.headers, exact.body, SECRET, { now: NOW }).ok).toBe(true);

    const over = sign({ blob: 'x'.repeat(MAX_BODY_BYTES - overhead + 1) });
    expect(Buffer.byteLength(over.body, 'utf8')).toBe(MAX_BODY_BYTES + 1);
    const verdict = verifyRequest(over.headers, over.body, SECRET, { now: NOW });
    expect(verdict).toMatchObject({ ok: false, reason: expect.stringContaining('trop gros') });
  });

  it('bounds the error blocks to the 50 KiB payload budget before signing', () => {
    // One huge single-chunk log (no blank line): ~53 KiB of realistic stack
    // frames, over the 50 KiB budget, so the block must be truncated to it.
    const frames = Array.from(
      { length: 700 },
      () => '\tat com.payments.settlement.SettlementService.round(SettlementService.java)',
    ).join('\n');
    const noisy = `java.lang.AssertionError: expected:<200> but was:<500>\n${frames}`;
    expect(Buffer.byteLength(noisy, 'utf8')).toBeGreaterThan(MAX_TOTAL_BLOCK_BYTES);
    const payload = buildIngestPayload(
      { ...sensorInputs(sampleFailure()), logTail: noisy },
      maskSecrets,
    );

    const total = payload.errorBlocks.reduce(
      (sum, block) => sum + Buffer.byteLength(block, 'utf8'),
      0,
    );
    expect(payload.errorBlocks.length).toBeGreaterThan(0);
    expect(total).toBe(MAX_TOTAL_BLOCK_BYTES);

    const { body } = sign(payload);
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });
});

describe('Capteur → Cerveau: signature stability', () => {
  it('signs the same payload identically with the same clock and nonce', () => {
    const payload = realPayload();
    const first = sign(payload);
    const second = sign(payload);

    expect(second.body).toBe(first.body);
    expect(second.headers[BRIDGE_HEADERS.signature]).toBe(first.headers[BRIDGE_HEADERS.signature]);
    expect(verifyRequest(first.headers, first.body, SECRET, { now: NOW }).ok).toBe(true);
  });
});

describe('Capteur → Cerveau: masking happens before the signature', () => {
  it('never lets a secret reach the signed body', () => {
    const token = ['ghp', '_', 'T'.repeat(36)].join('');
    const excerpt = [
      'FAIL src/settlement/SettlementServiceTest.java',
      '  expected:<200> but was:<500>',
      `  Authorization: Bearer ${token}`,
    ].join('\n');

    const masked = maskSecrets(excerpt);
    expect(masked.masked).toBeGreaterThanOrEqual(1);
    expect(masked.text).not.toContain(token);

    const payload = buildIngestPayload(
      { ...sensorInputs(sampleFailure()), logTail: excerpt },
      maskSecrets,
    );
    expect(JSON.stringify(payload)).not.toContain(token);

    const { body, headers } = sign(payload);
    expect(body).not.toContain(token);
    expect(body).toContain('[masqué:');
    for (const value of Object.values(headers)) {
      expect(value).not.toContain(token);
    }
  });
});

describe('Capteur → Cerveau: replay and idempotency', () => {
  it('refuses a replayed request and stays idempotent in the memory', async () => {
    const payload = realPayload();
    const { body, headers } = sign(payload);
    const nonces = createNonceCache();

    const first = verifyRequest(headers, body, SECRET, {
      now: NOW,
      seenNonce: (nonce) => nonces.seen(nonce),
    });
    expect(first.ok).toBe(true);

    const replay = verifyRequest(headers, body, SECRET, {
      now: NOW,
      seenNonce: (nonce) => nonces.seen(nonce),
    });
    expect(replay).toMatchObject({ ok: false, reason: expect.stringContaining('rejeu') });

    const validated = validateIngestPayload(payload);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const store = new MemoryStore();
    const deps = consumerDeps(store);
    const once = await consumeIngest(validated.value, deps);
    const twice = await consumeIngest(validated.value, deps);
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;

    expect(twice.processed).toHaveLength(0);
    expect(twice.replays).toBeGreaterThanOrEqual(1);
    const signatures = await store.listSignatures();
    expect(signatures[0].occurrences).toBe(1);
  });
});
