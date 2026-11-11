import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, signPayload, verifyRequest } from '../src/index.js';

/**
 * Attack suite of the signed Sensor → Brain bridge.
 *
 * Every attack must be **rejected** with an explicit reason, and that reason
 * must never leak the secret nor the expected nonce (otherwise an attacker
 * learns something they should not). Secrets are constructed at runtime to
 * avoid tripping the repository's secret scanners.
 */

const SECRET = ['bridge', 'test', 'secret', 'v1'].join('-');
const OTHER_SECRET = ['bridge', 'test', 'secret', 'v2'].join('-');
const NOW = new Date('2026-11-11T08:00:00Z');
const NONCE = '0123456789abcdef0123456789abcdef';

function signed(payload: unknown = { hello: 'ci' }) {
  const res = signPayload(payload, SECRET, { now: NOW, nonce: NONCE });
  return { ...res, nonce: NONCE };
}

/** Asserts a verdict is a rejection whose reason hides secret and nonce. */
function expectRejection(
  result: ReturnType<typeof verifyRequest>,
  expected: string | RegExp,
  secret = SECRET,
  nonce = NONCE,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toMatch(expected);
    expect(result.reason).not.toContain(secret);
    expect(result.reason).not.toContain(nonce);
    // A reason must never quote a secret-bearing hex run either.
    expect(result.reason).not.toMatch(/[0-9a-f]{16,}/i);
  }
}

describe('bridge attack suite — rejections', () => {
  it('rejects a replayed nonce (same signature replayed after consumption)', () => {
    const { body, headers } = signed();
    const seen = new Set<string>();
    const first = verifyRequest(headers, body, SECRET, {
      now: NOW,
      seenNonce: (n) => seen.has(n),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    seen.add(headers['x-dejavu-nonce'] ?? '');
    const replay = verifyRequest(headers, body, SECRET, {
      now: NOW,
      seenNonce: (n) => seen.has(n),
    });
    expectRejection(replay, /rejeu/);
  });

  it('rejects a clock skewed into the future beyond the window', () => {
    const { body, headers } = signed();
    const later = new Date(NOW.getTime() + 10 * 60 * 1000);
    expectRejection(verifyRequest(headers, body, SECRET, { now: later }), /horodatage/);
  });

  it('rejects a clock skewed into the past beyond the window', () => {
    const { body, headers } = signed();
    const earlier = new Date(NOW.getTime() - 10 * 60 * 1000);
    expectRejection(verifyRequest(headers, body, SECRET, { now: earlier }), /horodatage/);
  });

  it('rejects a body altered by a single byte', () => {
    const { body, headers } = signed({ hello: 'ci', amount: 100 });
    const tampered = body.replace('"amount":100', '"amount":101');
    expect(tampered).not.toBe(body);
    expectRejection(verifyRequest(headers, tampered, SECRET, { now: NOW }), /signature invalide/);
  });

  it('rejects a truncated signature header', () => {
    const { body, headers } = signed();
    const truncated = { ...headers, 'x-dejavu-signature': headers['x-dejavu-signature']!.slice(0, 40) };
    expectRejection(verifyRequest(truncated, body, SECRET, { now: NOW }), /signature invalide/);
  });

  it('rejects a request signed with the wrong secret', () => {
    const signedOther = signPayload({ hello: 'ci' }, OTHER_SECRET, { now: NOW, nonce: NONCE });
    expectRejection(
      verifyRequest(signedOther.headers, signedOther.body, SECRET, { now: NOW }),
      /signature invalide/,
      SECRET,
      NONCE,
    );
  });

  it('rejects each missing signature header', () => {
    const { body, headers } = signed();
    for (const drop of ['x-dejavu-signature', 'x-dejavu-timestamp', 'x-dejavu-nonce']) {
      const without = { ...headers };
      delete without[drop];
      expectRejection(verifyRequest(without, body, SECRET, { now: NOW }), /incomplet/);
    }
  });

  it('rejects a payload over the Forge size limit', () => {
    const { headers } = signed();
    const huge = 'x'.repeat(MAX_BODY_BYTES + 1);
    expectRejection(verifyRequest(headers, huge, SECRET, { now: NOW }), /trop gros/);
  });

  it('rejects an unexpected content type', () => {
    const { body, headers } = signed();
    const xml = { ...headers, 'content-type': 'application/xml' };
    expectRejection(verifyRequest(xml, body, SECRET, { now: NOW }), /type de contenu/);
  });

  it('rejects an empty signature', () => {
    const { body, headers } = signed();
    const empty = { ...headers, 'x-dejavu-signature': '' };
    expectRejection(verifyRequest(empty, body, SECRET, { now: NOW }), /incomplet/);
  });

  it('rejects a malformed (non-hex) signature', () => {
    const { body, headers } = signed();
    const malformed = { ...headers, 'x-dejavu-signature': 'z'.repeat(64) };
    expectRejection(verifyRequest(malformed, body, SECRET, { now: NOW }), /signature invalide/);
  });

  it('rejects an envelope whose nonce differs from the header (body tamper)', () => {
    const { body, headers } = signed();
    const swapped = body.replace(NONCE, 'ffffffffffffffffffffffffffffffff');
    // The body no longer matches the signature, so the HMAC check rejects it
    // before the defensive envelope-consistency check is reached.
    expectRejection(verifyRequest(headers, swapped, SECRET, { now: NOW }), /signature invalide/);
  });

  it('rejects an envelope whose timestamp differs from the header (body tamper)', () => {
    const { body, headers } = signed();
    const swapped = body.replace(/"ts":\d+/, '"ts":1');
    expectRejection(verifyRequest(headers, swapped, SECRET, { now: NOW }), /signature invalide/);
  });

  it('rejects a body that is not JSON at all', () => {
    const { headers } = signed();
    // The signature was computed over the real JSON body, so a non-JSON body
    // fails the HMAC check before the JSON parse is reached — still rejected
    // with an explicit reason.
    expectRejection(verifyRequest(headers, 'not-json{', SECRET, { now: NOW }), /signature invalide/);
  });

  it('rejects an unreadable timestamp header', () => {
    const { body, headers } = signed();
    const bad = { ...headers, 'x-dejavu-timestamp': 'not-a-number' };
    expectRejection(verifyRequest(bad, body, SECRET, { now: NOW }), /horodatage/);
  });

  it('rejects an empty secret on both sides', () => {
    const { body, headers } = signed();
    expectRejection(verifyRequest(headers, body, '', { now: NOW }), /secret du pont vide/);
    expect(() => signPayload({ a: 1 }, '', { now: NOW })).toThrow();
  });

  it('rejects an empty secret set', () => {
    const { body, headers } = signed();
    expectRejection(verifyRequest(headers, body, { secrets: [] }, { now: NOW }), /secret du pont vide/);
  });
});
