/**
 * Les primitifs Node qu'un navigateur n'a pas — et que le produit utilise.
 *
 * Le moteur est écrit pour le runtime Node de Forge : il compte des octets avec
 * `Buffer.byteLength`, tronque sans couper un caractère UTF-8 avec
 * `Buffer.from(...).subarray(...)`, et le pont compare des signatures avec
 * `timingSafeEqual` et tire des nonces avec `randomBytes`. Le site public fait
 * tourner **ce même code** dans un navigateur : ces trois primitifs y sont donc
 * fournis, avec exactement la même sémantique (vérifiée contre Node par
 * `site/test/node-globals.test.ts`).
 *
 * Rien d'autre n'est imité : si le produit se met à utiliser un autre API Node,
 * la garde `site/test/browser-compat.test.mjs` le signale au lieu de laisser le
 * site mourir en silence chez le visiteur.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** Décode une chaîne hexadécimale en octets (comme `Buffer.from(x, 'hex')`). */
function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : hex.slice(0, hex.length - 1);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Encode des octets en hexadécimal minuscule (comme `toString('hex')`). */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Un `Buffer` de navigateur : un `Uint8Array` avec les méthodes utilisées par le
 * produit (`toString` utf8/hex, `equals`) — `length`, `byteLength`, l'indexation
 * et `subarray` viennent de `Uint8Array`, et `subarray` rend bien un `BufferImpl`
 * (espèce de la sous-classe), donc `.toString('utf8')` reste juste après troncature.
 */
class BufferImpl extends Uint8Array {
  /** Le texte (utf8) ou l'hexadécimal des octets. */
  override toString(encoding: string = 'utf8'): string {
    return encoding === 'hex' ? toHex(this) : decoder.decode(this);
  }

  /** Comparaison octet à octet. */
  equals(other: Uint8Array): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i += 1) if (this[i] !== other[i]) return false;
    return true;
  }
}

/**
 * Les statiques de `Buffer`, ajoutées à la classe sans se battre avec les
 * surcharges héritées de `Uint8Array` (aucune n'accepte une chaîne : la
 * résolution de surcharge tombe donc sur celles-ci).
 */
const statiques = {
  /** Construit depuis du texte (utf8 par défaut) ou de l'hexadécimal. */
  from(value: string | Uint8Array | number[], encoding: string = 'utf8'): BufferImpl {
    const bytes =
      typeof value === 'string'
        ? encoding === 'hex'
          ? fromHex(value)
          : encoder.encode(value)
        : value;
    const out = new BufferImpl(bytes.length);
    out.set(bytes as ArrayLike<number>);
    return out;
  },

  /** Longueur en octets d'un texte, sans le matérialiser. */
  byteLength(value: string, encoding: string = 'utf8'): number {
    if (encoding === 'hex') return Math.floor(value.length / 2);
    return encoder.encode(value).length;
  },

  /** `Buffer.isBuffer`, pour les gardes du produit. */
  isBuffer(value: unknown): boolean {
    return value instanceof BufferImpl;
  },
};

/** Le `Buffer` du site : la classe et ses statiques. */
export const BufferShim = Object.assign(BufferImpl, statiques);

/** Le nom injecté par esbuild à la place du global `Buffer`. */
export const Buffer = BufferShim;

/**
 * Comparaison à temps constant : la durée ne dépend pas de la position de la
 * première différence (comme `crypto.timingSafeEqual` de Node).
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('les longueurs diffèrent');
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Des octets aléatoires, tirés par le générateur du navigateur. */
export function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < size; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}
