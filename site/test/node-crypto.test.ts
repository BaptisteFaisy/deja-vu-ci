/**
 * Le HMAC-SHA256 du navigateur est-il celui de Node ?
 *
 * Le pont signé (`packages/bridge`) signe ses charges avec `createHmac` : si le
 * substitut du site produisait une autre mac, le panneau « Sécurité » montrerait
 * une signature que le vrai Cerveau refuserait. Vérification octet par octet,
 * y compris une clé plus longue qu'un bloc (64 octets), cas où HMAC hache la clé.
 */

import { createHmac as nodeHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHmac } from '../src/lib/nodeCrypto';

const CLES = ['secret-partage-de-jumelage', 'x'.repeat(64), 'x'.repeat(65), 'clé-unicode-✓', ''];
const MESSAGES = ['', 'a', '{"repo":"payments-api","commit":"abc123"}', 'é'.repeat(70), 'x'.repeat(200)];

describe('HMAC-SHA256 du site', () => {
  it('signe exactement comme node:crypto', () => {
    for (const cle of CLES) {
      for (const message of MESSAGES) {
        const attendu = nodeHmac('sha256', cle).update(message, 'utf8').digest('hex');
        expect(createHmac('sha256', cle).update(message).digest('hex'), `${cle.length}/${message.length}`).toBe(attendu);
      }
    }
  });

  it('accumule plusieurs update comme un seul', () => {
    const attendu = nodeHmac('sha256', 'cle').update('a').update('b').digest('hex');
    const hachage = createHmac('sha256', 'cle');
    hachage.update('a');
    hachage.update('b');
    expect(hachage.digest('hex')).toBe(attendu);
  });

  it('rend 32 octets sans encodage demandé', () => {
    const brut = createHmac('sha256', 'cle').update('message').digest();
    expect((brut as Uint8Array).byteLength).toBe(32);
  });

  it('refuse ce qu’il ne sait pas faire', () => {
    expect(() => createHmac('sha1', 'cle')).toThrow(/sha256/);
    expect(() => createHmac('sha256', 'cle').update('a').digest('base64')).toThrow(/hex/);
  });
});
