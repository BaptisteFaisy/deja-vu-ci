import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, signPayload, verifyRequest } from '../src/index.js';

const SECRET = 'secret-de-test-du-pont';
const NOW = new Date('2026-11-11T08:00:00Z');

describe('pont signé Capteur → Cerveau', () => {
  it('accepte une requête signée et rend la charge utile', () => {
    const { body, headers } = signPayload({ hello: 'ci' }, SECRET, { now: NOW, nonce: 'abcd' });
    const verdict = verifyRequest(headers, body, SECRET, { now: NOW });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.payload).toEqual({ hello: 'ci' });
  });

  it('refuse une signature falsifiée', () => {
    const { body, headers } = signPayload({ hello: 'ci' }, SECRET, { now: NOW, nonce: 'abcd' });
    const tampered = { ...headers, 'x-dejavu-signature': '0'.repeat(64) };
    expect(verifyRequest(tampered, body, SECRET, { now: NOW }).ok).toBe(false);
  });

  it('refuse un corps modifié après signature', () => {
    const { body, headers } = signPayload({ hello: 'ci' }, SECRET, { now: NOW, nonce: 'abcd' });
    const verdict = verifyRequest(headers, body.replace('ci', 'cd'), SECRET, { now: NOW });
    expect(verdict.ok).toBe(false);
  });

  it('refuse un horodatage hors fenêtre', () => {
    const { body, headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const later = new Date(NOW.getTime() + 10 * 60 * 1000);
    const verdict = verifyRequest(headers, body, SECRET, { now: later });
    expect(verdict).toMatchObject({ ok: false, reason: expect.stringContaining('horodatage') });
  });

  it('refuse un nonce déjà consommé', () => {
    const { body, headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const verdict = verifyRequest(headers, body, SECRET, { now: NOW, seenNonce: () => true });
    expect(verdict).toMatchObject({ ok: false, reason: expect.stringContaining('rejeu') });
  });

  it('refuse un corps au-delà de la limite Forge', () => {
    const { headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    expect(verifyRequest(headers, big, SECRET, { now: NOW }).ok).toBe(false);
  });

  it('refuse un en-tête manquant', () => {
    const { body } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    expect(verifyRequest({}, body, SECRET, { now: NOW }).ok).toBe(false);
  });
});
