/**
 * Pont signé Capteur (Bitbucket) → Cerveau (Jira) — CONTRAT GELÉ.
 *
 * Cahier des charges § 15 : « empreinte HMAC-SHA256 du corps, horodatage,
 * numéro unique, secret partagé établi au jumelage et rangé dans le stockage
 * de secrets de Forge ».
 *
 * Le corps transporté est une enveloppe JSON :
 *   { "v": 1, "nonce": "<hex 16>", "ts": 1762737600, "payload": { … } }
 * où `payload` est un `IngestPayload` (ou une `QueryRequest`).
 *
 * Les en-têtes portent la signature et les métadonnées de rejeu :
 *   x-dejavu-signature : HMAC-SHA256(secret, "<ts>.<nonce>.<body>") en hex
 *   x-dejavu-timestamp : ts (secondes Unix)
 *   x-dejavu-nonce     : nonce (hex 16)
 *
 * Signer l'horodatage et le nonce *avec* le corps empêche de rejouer une
 * signature sur un autre corps ou de vieillir un horodatage sans casser le
 * HMAC. Aucun secret n'est journalisé ; les comparaisons sont à temps
 * constant.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** En-têtes du pont (noms exacts, minuscules : HTTP est insensible à la casse). */
export const BRIDGE_HEADERS = {
  signature: 'x-dejavu-signature',
  timestamp: 'x-dejavu-timestamp',
  nonce: 'x-dejavu-nonce',
} as const;

/** Taille maximale du corps acceptée (charge utile Forge : 5 Mo, § 17). */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Fenêtre de tolérance d'horodatage par défaut, en secondes. */
export const DEFAULT_MAX_SKEW_S = 300;

export interface BridgeEnvelope {
  v: 1;
  nonce: string;
  ts: number;
  payload: unknown;
}

export interface SignOptions {
  /** Horloge injectable (tests). */
  now?: Date;
  /** Nonce imposé (tests) ; sinon 16 octets aléatoires. */
  nonce?: string;
}

export interface VerifyOptions {
  now?: Date;
  maxSkewS?: number;
  /**
   * Mémoire des nonces déjà vus. Rend `true` si le nonce a déjà été consommé.
   * Fourni par l'appelant (le Cerveau le tient dans son stockage).
   */
  seenNonce?: (nonce: string) => boolean;
}

export type VerifyResult =
  | { ok: true; payload: unknown; envelope: BridgeEnvelope }
  | { ok: false; reason: string };

function hmac(secret: string, ts: number, nonce: string, body: string): string {
  return createHmac('sha256', secret).update(`${ts}.${nonce}.${body}`).digest('hex');
}

function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Signe une charge utile et rend le corps et les en-têtes prêts à l'envoi.
 */
export function signPayload(
  payload: unknown,
  secret: string,
  opts: SignOptions = {},
): { body: string; headers: Record<string, string> } {
  if (!secret) throw new Error('secret du pont vide');
  const ts = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const nonce = opts.nonce ?? newNonce();
  const envelope: BridgeEnvelope = { v: 1, nonce, ts, payload };
  const body = JSON.stringify(envelope);
  const signature = hmac(secret, ts, nonce, body);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      [BRIDGE_HEADERS.signature]: signature,
      [BRIDGE_HEADERS.timestamp]: String(ts),
      [BRIDGE_HEADERS.nonce]: nonce,
    },
  };
}

/** Lit un en-tête sans dépendre de la casse (les proxies ne la préservent pas). */
function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * Vérifie une requête entrante.
 *
 * Refus (raison explicite) : corps trop gros, en-tête manquant, signature
 * invalide, horodatage hors fenêtre, nonce déjà consommé, enveloppe illisible.
 * Un refus ne lève jamais : l'appelant répond 401 et continue.
 */
export function verifyRequest(
  headers: Record<string, string | undefined>,
  body: string,
  secret: string,
  opts: VerifyOptions = {},
): VerifyResult {
  if (!secret) return { ok: false, reason: 'secret du pont vide' };
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, reason: 'corps trop gros' };
  }

  const signature = header(headers, BRIDGE_HEADERS.signature);
  const tsRaw = header(headers, BRIDGE_HEADERS.timestamp);
  const nonce = header(headers, BRIDGE_HEADERS.nonce);
  if (!signature || !tsRaw || !nonce) {
    return { ok: false, reason: 'en-tête de signature incomplet' };
  }

  const ts = Number.parseInt(tsRaw, 10);
  if (!Number.isFinite(ts) || String(ts) !== tsRaw.trim()) {
    return { ok: false, reason: 'horodatage illisible' };
  }

  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const maxSkew = opts.maxSkewS ?? DEFAULT_MAX_SKEW_S;
  if (Math.abs(nowS - ts) > maxSkew) {
    return { ok: false, reason: `horodatage hors fenêtre (±${maxSkew} s)` };
  }

  const expected = hmac(secret, ts, nonce, body);
  const given = Buffer.from(signature, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'signature invalide' };
  }

  if (opts.seenNonce?.(nonce)) {
    return { ok: false, reason: 'nonce déjà consommé (rejeu)' };
  }

  let envelope: BridgeEnvelope;
  try {
    envelope = JSON.parse(body) as BridgeEnvelope;
  } catch {
    return { ok: false, reason: 'corps JSON illisible' };
  }
  if (!envelope || envelope.v !== 1 || envelope.nonce !== nonce || envelope.ts !== ts) {
    return { ok: false, reason: 'enveloppe incohérente avec les en-têtes' };
  }
  return { ok: true, payload: envelope.payload, envelope };
}
