/**
 * Version policy of the bridge payload.
 *
 * Two version switches protect the Sensor ↔ Brain pair:
 *
 *  - the **envelope** version (`v`, transport level) — frozen at 1; an
 *    unknown envelope is refused by `verifyRequest` with an explicit reason,
 *    even when it is perfectly signed;
 *  - the **payload** version (`payload.version`, application level) — the
 *    Brain accepts exactly `1` (strict numeric comparison, no coercion);
 *    anything else is an explicit refusal with an actionable message.
 *
 * The rule both switches enforce: a Sensor newer than the Brain, or older,
 * is **never** accepted silently. Within a known version, the reader stays
 * tolerant: unknown extra fields are ignored, never fatal.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BRIDGE_HEADERS, signPayload, verifyRequest } from '../src/index.js';
import {
  validateIngestPayload,
  validateQueryRequest,
} from '../../../apps/brain/src/pure/validate.js';

const SECRET = ['bridge', 'versioning', 'secret'].join('-');
const NOW = new Date('2026-11-11T08:00:00Z');
const NONCE = '0123456789abcdef0123456789abcdef';
const TS = Math.floor(NOW.getTime() / 1000);

/** A minimal valid ingest payload, shaped like the Sensor builds it. */
function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    workspace: 'acme',
    repository: 'acme/payments',
    branch: 'feature/login',
    commit: 'a'.repeat(40),
    author: 'marie',
    stepName: 'test',
    durationS: 95,
    failedAt: '2026-11-05T09:00:00.000Z',
    errorBlocks: ['AssertionError: expected 200 but was 500'],
    ...overrides,
  };
}

/**
 * Signs an envelope the frozen `signPayload` cannot produce (v ≠ 1), using
 * the documented string-to-sign "<ts>.<nonce>.<body>". Every cryptographic
 * check passes, so only the version policy is exercised.
 */
function signedEnvelope(envelope: Record<string, unknown>) {
  const body = JSON.stringify(envelope);
  const signature = createHmac('sha256', SECRET).update(`${TS}.${NONCE}.${body}`).digest('hex');
  return {
    body,
    headers: {
      'content-type': 'application/json',
      [BRIDGE_HEADERS.signature]: signature,
      [BRIDGE_HEADERS.timestamp]: String(TS),
      [BRIDGE_HEADERS.nonce]: NONCE,
    },
  };
}

/** Pushes a payload through the normal signed path and verifies it. */
function throughBridge(payload: unknown) {
  const { body, headers } = signPayload(payload, SECRET, { now: NOW, nonce: NONCE });
  return verifyRequest(headers, body, SECRET, { now: NOW });
}

/** Asserts an explicit refusal whose reason leaks neither secret nor nonce. */
function expectCleanRefusal(result: ReturnType<typeof verifyRequest>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason.length).toBeGreaterThan(0);
  expect(result.reason).not.toContain(SECRET);
  expect(result.reason).not.toContain(NONCE);
  expect(result.reason).not.toMatch(/[0-9a-f]{16,}/i);
}

describe('envelope version — the transport never accepts silently', () => {
  it('accepts the frozen envelope version 1', () => {
    const verdict = throughBridge(basePayload());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.envelope.v).toBe(1);
    expect(verdict.payload).toEqual(basePayload());
  });

  it('refuses a newer envelope (v 2) even when it is correctly signed', () => {
    const { body, headers } = signedEnvelope({ v: 2, nonce: NONCE, ts: TS, payload: basePayload() });
    expectCleanRefusal(verifyRequest(headers, body, SECRET, { now: NOW }));
  });

  it.each([
    ['older', { v: 0, nonce: NONCE, ts: TS, payload: {} }],
    ['missing', { nonce: NONCE, ts: TS, payload: {} }],
    ['a coerced string', { v: '1', nonce: NONCE, ts: TS, payload: {} }],
  ])('refuses a %s envelope version', (_label, envelope) => {
    const { body, headers } = signedEnvelope(envelope);
    expectCleanRefusal(verifyRequest(headers, body, SECRET, { now: NOW }));
  });
});

describe('payload version — the Sensor ↔ Brain compatibility policy', () => {
  it('accepts the only version the Brain speaks', () => {
    const validated = validateIngestPayload(basePayload());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.version).toBe(1);
  });

  it('refuses a payload from a newer Sensor with an actionable message', () => {
    const validated = validateIngestPayload(basePayload({ version: 2 }));
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    // Actionable: it names the field and the version the Brain expects.
    expect(validated.error).toMatch(/version/i);
    expect(validated.error).toContain('1');
  });

  it('refuses a payload from an older Sensor just as explicitly', () => {
    const validated = validateIngestPayload(basePayload({ version: 0 }));
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.error).toMatch(/version/i);
  });

  it.each([
    ['missing', undefined],
    ['a string', '1'],
    ['null', null],
    ['a boolean', true],
  ])('refuses a %s version without coercion', (_label, version) => {
    expect(validateIngestPayload(basePayload({ version })).ok).toBe(false);
  });

  it('never throws on garbage and never accepts it', () => {
    for (const garbage of [null, 42, 'payload', [], undefined, NaN]) {
      const validated = validateIngestPayload(garbage);
      expect(validated.ok).toBe(false);
    }
  });

  it('stays tolerant to unknown extra fields within a known version', () => {
    const validated = validateIngestPayload(basePayload({ futureFlag: true, newField: 'x' }));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    // The validated value is rebuilt from the contract: extras never leak in.
    expect(validated.value).not.toHaveProperty('futureFlag');
    expect(validated.value).not.toHaveProperty('newField');
    expect(validated.value).toEqual(basePayload());
  });

  it('applies the compatibility matrix: only equal versions talk', () => {
    const sensorVersions: unknown[] = [0, 1, 2, 3, '1', null, undefined];
    for (const version of sensorVersions) {
      const validated = validateIngestPayload(basePayload({ version }));
      expect(validated.ok).toBe(version === 1);
    }
  });
});

describe('query payload — the same transport, its own switch', () => {
  it('carries a pr-card query through the bridge and the validator', () => {
    const request = { kind: 'pr-card', repository: 'acme/payments', branch: 'feature/login' };
    const verdict = throughBridge(request);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const validated = validateQueryRequest(verdict.payload);
    expect(validated.ok).toBe(true);
  });

  it('refuses an unknown query kind explicitly', () => {
    const validated = validateQueryRequest({ kind: 'future-query', repository: 'a/b', branch: 'x' });
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.error).toMatch(/kind/);
  });
});
