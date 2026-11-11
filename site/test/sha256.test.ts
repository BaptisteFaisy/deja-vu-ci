/**
 * Le SHA-256 du site est-il **exactement** celui de Node ?
 *
 * L'identifiant d'une signature est ce hachage (`packages/core/src/sign.ts`) :
 * une seule différence d'octet et le site public afficherait une autre mémoire
 * que l'app Jira. D'où ce test brut : les mêmes entrées des deux côtés, y
 * compris les longueurs qui changent le nombre de blocs (55, 56, 63, 64, 119,
 * 120) et l'UTF-8 multi-octets.
 */

import { createHash as nodeHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256, sha256Hex } from '../src/lib/sha256';
import { createHash } from '../src/lib/nodeCrypto';

const encode = new TextEncoder();

/** Hachage de référence, côté Node. */
function node(text: string): string {
  return nodeHash('sha256').update(text, 'utf8').digest('hex');
}

const CAS = [
  '',
  'a',
  'abc',
  'The quick brown fox jumps over the lazy dog',
  'héllo ✓ ünicode — accentué',
  'x'.repeat(55),
  'x'.repeat(56),
  'x'.repeat(63),
  'x'.repeat(64),
  'x'.repeat(65),
  'x'.repeat(119),
  'x'.repeat(120),
  'é'.repeat(40),
  JSON.stringify({ category: 'test', errorType: 'AssertionError', message: 'expected 200 got 500' }),
];

describe('SHA-256 du site', () => {
  it('rend les vecteurs publics', () => {
    expect(sha256Hex(encode.encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(encode.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produit le même hachage que node:crypto', () => {
    for (const cas of CAS) {
      expect(sha256Hex(encode.encode(cas)), `cas de ${cas.length} caractère(s)`).toBe(node(cas));
      expect(createHash('sha256').update(cas).digest('hex'), cas.slice(0, 20)).toBe(node(cas));
      expect(createHash('sha256').update(cas, 'utf8').digest('hex')).toBe(node(cas));
    }
  });

  it('accumule plusieurs update comme un seul', () => {
    const morceaux = ['paiements', '-api', '|', 'AssertionError'];
    const hachage = createHash('sha256');
    for (const morceau of morceaux) hachage.update(morceau);
    expect(hachage.digest('hex')).toBe(node(morceaux.join('')));
  });

  it('rend 32 octets sans encodage demandé', () => {
    const brut = createHash('sha256').update('abc').digest();
    expect(brut).toBeInstanceOf(Uint8Array);
    expect((brut as Uint8Array).byteLength).toBe(32);
    expect(sha256(encode.encode('abc')).byteLength).toBe(32);
  });

  it('refuse ce qu’il ne sait pas faire, au lieu de répondre faux', () => {
    expect(() => createHash('sha1')).toThrow(/sha256/);
    expect(() => createHash('md5')).toThrow(/sha256/);
    expect(() => createHash('sha256').update('abc').digest('base64')).toThrow(/hex/);
    expect(() => createHash('sha256').update('abc', 'latin1')).toThrow(/utf8/);
  });
});
