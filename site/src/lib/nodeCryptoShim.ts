/**
 * Le module que le bundle substitue à `node:crypto`.
 *
 * Quatre primitives, celles que le produit utilise réellement : `createHash` et
 * `createHmac` (signatures et pont), `timingSafeEqual` (comparaison de
 * signatures) et `randomBytes` (nonces). Toute autre demande lève une erreur
 * explicite plutôt que de rendre un résultat faux.
 */

export { createHash, createHmac, type Hash } from './nodeCrypto';
export { timingSafeEqual, randomBytes } from './nodeGlobals';
