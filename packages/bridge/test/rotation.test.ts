import { describe, expect, it } from 'vitest';
import { rotateSecret, signPayload, verifyRequest, type SecretSet } from '../src/index.js';

/**
 * Key rotation without downtime.
 *
 * `rotateSecret` is pure: old pair → new pair, keeping the previous active
 * key so that verify accepts both during the overlap window (double
 * acceptance). Signing always uses the first (active) key. The single-key
 * API keeps behaving exactly as before.
 */

const OLD = ['old', 'bridge', 'key'].join('-');
const NEW = ['new', 'bridge', 'key'].join('-');
const NEWER = ['newer', 'bridge', 'key'].join('-');
const NOW = new Date('2026-11-11T08:00:00Z');

describe('rotateSecret', () => {
  it('rotates a single legacy key into a set that keeps both', () => {
    const rotated = rotateSecret(OLD, NEW);
    expect(rotated).toEqual({ secrets: [NEW, OLD] });
  });

  it('rotates an existing set, keeping the older key second', () => {
    const first = rotateSecret(OLD, NEW);
    const second = rotateSecret(first, NEWER);
    expect(second.secrets[0]).toBe(NEWER);
    expect(second.secrets).toContain(NEW);
    expect(second.secrets).toContain(OLD);
  });

  it('is a no-op when the new key equals the active key', () => {
    expect(rotateSecret(OLD, OLD)).toEqual({ secrets: [OLD] });
    const set: SecretSet = { secrets: [OLD, 'older'] };
    expect(rotateSecret(set, OLD).secrets).toEqual([OLD, 'older']);
  });

  it('throws on an empty new secret', () => {
    expect(() => rotateSecret(OLD, '')).toThrow();
  });
});

describe('rotation acceptance', () => {
  it('signs with the active (first) key of a set', () => {
    const rotated = rotateSecret(OLD, NEW);
    const signedWithSet = signPayload({ a: 1 }, rotated, { now: NOW, nonce: 'beef' });
    const signedWithNew = signPayload({ a: 1 }, NEW, { now: NOW, nonce: 'beef' });
    expect(signedWithSet.headers['x-dejavu-signature']).toBe(signedWithNew.headers['x-dejavu-signature']);
  });

  it('accepts a message signed with the new key', () => {
    const rotated = rotateSecret(OLD, NEW);
    const signed = signPayload({ a: 1 }, NEW, { now: NOW, nonce: 'abcd' });
    expect(verifyRequest(signed.headers, signed.body, rotated, { now: NOW }).ok).toBe(true);
  });

  it('accepts a message still signed with the old key during overlap', () => {
    const rotated = rotateSecret(OLD, NEW);
    const signed = signPayload({ a: 1 }, OLD, { now: NOW, nonce: 'abcd' });
    expect(verifyRequest(signed.headers, signed.body, rotated, { now: NOW }).ok).toBe(true);
  });

  it('rejects an old-key message once the overlap window has closed', () => {
    // After the operator drops the retired key, the old signature is refused.
    const closed: SecretSet = { secrets: [NEW] };
    const signed = signPayload({ a: 1 }, OLD, { now: NOW, nonce: 'abcd' });
    expect(verifyRequest(signed.headers, signed.body, closed, { now: NOW }).ok).toBe(false);
  });

  it('keeps the single-string API working exactly as before', () => {
    const signed = signPayload({ a: 1 }, OLD, { now: NOW, nonce: 'abcd' });
    expect(verifyRequest(signed.headers, signed.body, OLD, { now: NOW }).ok).toBe(true);
  });
});
