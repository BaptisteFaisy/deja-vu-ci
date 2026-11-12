/**
 * Les primitifs Node du site sont-ils ceux de Node ?
 *
 * Le produit compte des octets, tronque sans couper un caractère UTF-8, compare
 * des signatures à temps constant et tire des nonces. Le navigateur n'a ni
 * `Buffer` ni `crypto.timingSafeEqual` : le site les fournit. Une seule
 * différence de sémantique et le site afficherait d'autres tailles, d'autres
 * troncatures ou refuserait une signature valide — d'où cette comparaison
 * systématique avec le vrai Node.
 */

import { randomBytes as nodeRandom, timingSafeEqual as nodeSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BufferShim, randomBytes, timingSafeEqual } from '../src/lib/nodeGlobals';

const TEXTES = ['', 'a', 'abc', 'héllo ✓ ünicode', 'x'.repeat(300), '日本-🎉-é'];

describe('Buffer de navigateur', () => {
  it('compte les octets comme Node', () => {
    for (const texte of TEXTES) {
      expect(BufferShim.byteLength(texte, 'utf8'), texte).toBe(Buffer.byteLength(texte, 'utf8'));
      expect(BufferShim.from(texte, 'utf8').length).toBe(Buffer.from(texte, 'utf8').length);
    }
  });

  it('tronque sans couper un caractère, comme le produit le fait', () => {
    for (const texte of TEXTES) {
      for (const max of [0, 1, 5, 17, 64, 4096]) {
        const attendu = Buffer.from(texte, 'utf8').subarray(0, max).toString('utf8');
        const obtenu = BufferShim.from(texte, 'utf8').subarray(0, max).toString('utf8');
        expect(obtenu, `${texte.slice(0, 12)}/${max}`).toBe(attendu);
      }
    }
  });

  it('lit et écrit l’hexadécimal comme Node', () => {
    for (const hex of ['', '00', 'ff', 'a1b2c3d4e5', 'deadbeef'.repeat(8)]) {
      expect(BufferShim.from(hex, 'hex').toString('hex')).toBe(Buffer.from(hex, 'hex').toString('hex'));
    }
    const texte = 'charge utile du pont';
    expect(BufferShim.from(texte, 'utf8').toString('hex')).toBe(Buffer.from(texte, 'utf8').toString('hex'));
  });

  it('indexe les octets et compare comme Node', () => {
    const texte = '日本-🎉';
    const reel = Buffer.from(texte, 'utf8');
    const site = BufferShim.from(texte, 'utf8');
    for (let i = 0; i < reel.length; i += 1) expect(site[i] & 0xc0).toBe(reel[i] & 0xc0);
    expect(site.equals(BufferShim.from(texte, 'utf8'))).toBe(true);
    expect(site.equals(BufferShim.from('autre', 'utf8'))).toBe(false);
    expect(BufferShim.isBuffer(site)).toBe(true);
  });
});

describe('comparaison à temps constant et aléa', () => {
  it('compare comme node:crypto', () => {
    const a = Buffer.from('deadbeef', 'hex');
    const b = Buffer.from('deadbeef', 'hex');
    const c = Buffer.from('deadbee0', 'hex');
    expect(timingSafeEqual(a, b)).toBe(nodeSafeEqual(a, b));
    expect(timingSafeEqual(a, c)).toBe(nodeSafeEqual(a, c));
    expect(() => timingSafeEqual(a, Buffer.alloc(3))).toThrow(RangeError);
  });

  it('tire des octets aléatoires de la bonne taille', () => {
    const tirage = randomBytes(16);
    expect(tirage.byteLength).toBe(16);
    expect(tirage.some((octet) => octet !== 0)).toBe(true);
    expect(randomBytes(16)).not.toEqual(nodeRandom(16));
  });
});
