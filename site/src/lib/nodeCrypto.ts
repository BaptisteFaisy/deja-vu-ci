/**
 * Substitut navigateur de `node:crypto` — exactement ce que le moteur utilise.
 *
 * `packages/core` hache avec `createHash('sha256').update(texte).digest('hex')`
 * (identifiants de signatures dans `sign.ts`, clés de cache dans `llm.ts`). Le
 * bundle du site public remplace `node:crypto` par ce module (alias esbuild
 * dans `tools/build-site.mjs`) : même API, même résultat, aucune dépendance.
 *
 * Rien d'autre n'est imité : pas de `randomBytes`, pas de HMAC — le site ne
 * signe rien, il rejoue une mémoire. Tout algorithme demandé hors `sha256`
 * lève une erreur explicite plutôt que de rendre un hachage faux.
 */

import { sha256, sha256Hex } from './sha256';

/** Ce que le moteur appelle : `update` puis `digest`. */
export interface Hash {
  update(data: string | Uint8Array, encoding?: string): Hash;
  digest(encoding?: string): string | Uint8Array;
}

const encoder = new TextEncoder();

/** Met bout à bout les morceaux passés à `update`. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** SHA-256 incrémental, compatible avec les appels du moteur. */
class Sha256Hash implements Hash {
  private readonly chunks: Uint8Array[] = [];

  update(data: string | Uint8Array, encoding?: string): Hash {
    if (typeof data !== 'string') {
      this.chunks.push(data);
      return this;
    }
    if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'utf-8') {
      throw new Error(`site public : encodage « ${encoding} » non pris en charge (utf8 seulement)`);
    }
    this.chunks.push(encoder.encode(data));
    return this;
  }

  digest(encoding?: string): string | Uint8Array {
    const bytes = concat(this.chunks);
    if (encoding === undefined) return sha256(bytes);
    if (encoding === 'hex') return sha256Hex(bytes);
    throw new Error(`site public : rendu « ${encoding} » non pris en charge (hex seulement)`);
  }
}

/** Point d'entrée du substitut : seul `sha256` est accepté. */
export function createHash(algorithm: string): Hash {
  const normalise = algorithm.toLowerCase().replace(/-/g, '');
  if (normalise !== 'sha256') {
    throw new Error(`site public : algorithme « ${algorithm} » non pris en charge (sha256 seulement)`);
  }
  return new Sha256Hash();
}
