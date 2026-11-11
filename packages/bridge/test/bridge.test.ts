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

describe('pont signé — cas ajoutés par le lot E (Capteur)', () => {
  it('accepte un corps à la limite exacte des 5 Mo', () => {
    const payload = { blob: 'x'.repeat(MAX_BODY_BYTES - 512) };
    const { body, headers } = signPayload(payload, SECRET, { now: NOW, nonce: 'beef' });
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(verifyRequest(headers, body, SECRET, { now: NOW }).ok).toBe(true);
  });

  it('lit les en-têtes quelle que soit leur casse', () => {
    const { body, headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'cafe' });
    const upper = {
      'X-Dejavu-Signature': headers['x-dejavu-signature'],
      'X-Dejavu-Timestamp': headers['x-dejavu-timestamp'],
      'X-Dejavu-Nonce': headers['x-dejavu-nonce'],
    };
    expect(verifyRequest(upper, body, SECRET, { now: NOW }).ok).toBe(true);
  });

  it('refuse une enveloppe dont le nonce diffère de l’en-tête', () => {
    const { body, headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const swapped = body.replace('"nonce":"abcd"', '"nonce":"dcba"');
    const verdict = verifyRequest(headers, swapped, SECRET, { now: NOW });
    expect(verdict.ok).toBe(false);
  });

  it('refuse un horodatage illisible', () => {
    const { body, headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const tampered = { ...headers, 'x-dejavu-timestamp': 'bientôt' };
    expect(verifyRequest(tampered, body, SECRET, { now: NOW }).ok).toBe(false);
  });

  it('accepte un écart autorisé plus large et refuse au-delà', () => {
    const { body, headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const later = new Date(NOW.getTime() + 20 * 60 * 1000);
    expect(verifyRequest(headers, body, SECRET, { now: later, maxSkewS: 3600 }).ok).toBe(true);
    expect(verifyRequest(headers, body, SECRET, { now: later, maxSkewS: 60 }).ok).toBe(false);
  });

  it('refuse un secret vide des deux côtés', () => {
    expect(() => signPayload({ a: 1 }, '', { now: NOW })).toThrow();
    const { body, headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    expect(verifyRequest(headers, body, '', { now: NOW }).ok).toBe(false);
  });

  it('couvre l’horodatage et le nonce dans la signature', () => {
    const signed = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const later = new Date(NOW.getTime() + 1000);
    const resigned = signPayload({ a: 1 }, SECRET, { now: later, nonce: 'abcd' });
    expect(resigned.headers['x-dejavu-signature']).not.toBe(signed.headers['x-dejavu-signature']);
  });

  it('produit un nonce de 32 hexadécimaux par défaut, unique à chaque appel', () => {
    const first = signPayload({ a: 1 }, SECRET, { now: NOW });
    const second = signPayload({ a: 1 }, SECRET, { now: NOW });
    expect(first.headers['x-dejavu-nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(first.headers['x-dejavu-nonce']).not.toBe(second.headers['x-dejavu-nonce']);
  });

  it('transporte une charge utile de Capteur sans la déformer', () => {
    const payload = {
      version: 1,
      workspace: 'acme',
      repository: 'payments',
      branch: 'feature/pr-42',
      commit: 'a'.repeat(40),
      author: 'alice',
      stepName: 'test',
      durationS: 42,
      failedAt: '2026-11-11T09:15:00Z',
      errorBlocks: ['AssertionError: expected «[masqué:token]» to be 200'],
      branchHistory: ['a'.repeat(40), 'b'.repeat(40)],
    };
    const { body, headers } = signPayload(payload, SECRET, { now: NOW });
    const verdict = verifyRequest(headers, body, SECRET, { now: NOW });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.payload).toEqual(payload);
  });

  it('refuse un corps qui n’est pas du JSON', () => {
    const { headers } = signPayload({ a: 1 }, SECRET, { now: NOW, nonce: 'abcd' });
    const verdict = verifyRequest(headers, 'pas-du-json', SECRET, { now: NOW });
    expect(verdict.ok).toBe(false);
  });
});
