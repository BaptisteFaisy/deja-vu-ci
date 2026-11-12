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

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

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

/**
 * A set of shared secrets for key rotation without downtime.
 *
 * The **first** key is the active one: it signs new messages. The rest are
 * retired keys accepted only on verify, during the overlap window during
 * which in-flight messages signed before the rotation are still arriving.
 * `verifyRequest` accepts a single string for backward compatibility (the
 * original single-key call keeps behaving exactly as before).
 */
export interface SecretSet {
  secrets: string[];
}

/** A bridge secret: one key (legacy) or a rotation set. */
export type BridgeSecret = string | SecretSet;

/** Normalizes a bridge secret to its ordered key list. */
function secretsOf(secret: BridgeSecret): string[] {
  return typeof secret === 'string' ? [secret] : secret.secrets;
}

/**
 * Rotates a key pair: the new key becomes active (it signs) while the
 * previous active key is kept so that verify still accepts both during the
 * overlap period (double acceptance). Pure — no clock, no storage.
 */
export function rotateSecret(current: BridgeSecret, nextSecret: string): SecretSet {
  if (!nextSecret) throw new Error('nouveau secret vide');
  const secrets = secretsOf(current);
  const active = secrets[0];
  if (!active) return { secrets: [nextSecret] };
  if (active === nextSecret) return { secrets };
  return { secrets: [nextSecret, active, ...secrets.slice(1)] };
}

/** Whether an HTTP `content-type` carries a JSON payload. */
function isJsonContentType(value: string): boolean {
  const mediaType = value.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType === 'text/json' || mediaType.endsWith('+json');
}

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
  secret: BridgeSecret,
  opts: SignOptions = {},
): { body: string; headers: Record<string, string> } {
  const active = secretsOf(secret)[0];
  if (!active) throw new Error('secret du pont vide');
  const ts = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const nonce = opts.nonce ?? newNonce();
  const envelope: BridgeEnvelope = { v: 1, nonce, ts, payload };
  const body = JSON.stringify(envelope);
  const signature = hmac(active, ts, nonce, body);
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
 * Constant-time check of a signature against every key of the set: the active
 * key or any retired key still in the overlap window matches. The reason a
 * check fails is never exposed — only a boolean comes back.
 */
function signatureMatches(
  secrets: string[],
  signature: string,
  ts: number,
  nonce: string,
  body: string,
): boolean {
  const given = Buffer.from(signature, 'hex');
  for (const key of secrets) {
    const want = Buffer.from(hmac(key, ts, nonce, body), 'hex');
    if (given.length === want.length && timingSafeEqual(given, want)) return true;
  }
  return false;
}

/** Parses the envelope and checks it agrees with the signed headers. */
function readEnvelope(
  body: string,
  nonce: string,
  ts: number,
): { envelope: BridgeEnvelope } | { reason: string } {
  let envelope: BridgeEnvelope;
  try {
    envelope = JSON.parse(body) as BridgeEnvelope;
  } catch {
    return { reason: 'corps JSON illisible' };
  }
  if (!envelope || envelope.v !== 1 || envelope.nonce !== nonce || envelope.ts !== ts) {
    return { reason: 'enveloppe incohérente avec les en-têtes' };
  }
  return { envelope };
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
  secret: BridgeSecret,
  opts: VerifyOptions = {},
): VerifyResult {
  const secrets = secretsOf(secret);
  if (secrets.length === 0 || secrets.some((s) => !s)) {
    return { ok: false, reason: 'secret du pont vide' };
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, reason: 'corps trop gros' };
  }
  const signature = header(headers, BRIDGE_HEADERS.signature);
  const tsRaw = header(headers, BRIDGE_HEADERS.timestamp);
  const nonce = header(headers, BRIDGE_HEADERS.nonce);
  if (!signature || !tsRaw || !nonce) {
    return { ok: false, reason: 'en-tête de signature incomplet' };
  }

  const contentType = header(headers, 'content-type');
  if (contentType && !isJsonContentType(contentType)) {
    return { ok: false, reason: 'type de contenu inattendu' };
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

  // Accept the active key or any retired key in the set (overlap window).
  if (!signatureMatches(secrets, signature, ts, nonce, body)) {
    return { ok: false, reason: 'signature invalide' };
  }

  if (opts.seenNonce?.(nonce)) {
    return { ok: false, reason: 'nonce déjà consommé (rejeu)' };
  }

  const parsed = readEnvelope(body, nonce, ts);
  if ('reason' in parsed) return { ok: false, reason: parsed.reason };
  return { ok: true, payload: parsed.envelope.payload, envelope: parsed.envelope };
}
