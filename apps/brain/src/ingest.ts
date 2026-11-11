/**
 * Web trigger `/ingest` — the signed entry of the Sensor (§ 8.1, § 15).
 *
 * A web trigger has 55 s and must stay trivial: verify the bridge signature,
 * guard the replay (nonce), validate the shape, queue the message, answer.
 * The diagnosis itself runs in the consumer (900 s, retryable). Nothing here
 * throws: every failure becomes a JSON answer with an explicit status.
 *
 * The bridge secret is read from the Forge secret storage (never from code,
 * never logged). The nonce memory is the warm-instance cache of
 * `pure/nonce.ts`; the timestamp window of the bridge (±300 s) bounds the
 * replay risk across cold starts.
 */

import { kvs as storage } from '@forge/kvs';
import { Queue } from '@forge/events';
import { verifyRequest } from '@dejavu/bridge';
import type { IngestPayload } from '@dejavu/core';
import { createNonceCache } from './pure/nonce';
import { validateIngestPayload } from './pure/validate';
import { brainStore } from './sql';

/** Storage key of the bridge secret (set at pairing time). */
export const BRIDGE_SECRET_KEY = 'dejavu-bridge-secret';

/** Queue name — must match the `consumer` module of the manifest. */
export const INGEST_QUEUE = 'deja-vu-ingest-queue';

/** Warm-instance replay guard. */
const nonces = createNonceCache();

/** A JSON answer of the web trigger. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Reads one secret of the Forge secret storage, or undefined. */
async function readSecret(secretId: string): Promise<string | undefined> {
  try {
    const secret = await storage.getSecret(secretId);
    return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the workspace out of the (still untrusted) body to pick the pairing
 * secret: the HMAC check that follows is what authenticates the value. The
 * app-level `BRIDGE_SECRET_KEY` is the fallback of a single-pairing install.
 */
export async function readBridgeSecret(body: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(body) as { payload?: { workspace?: unknown } };
    const workspace = parsed?.payload?.workspace;
    if (typeof workspace === 'string' && workspace !== '') {
      const pairing = await brainStore().pairing(workspace);
      if (pairing) {
        const secret = await readSecret(pairing.secretId);
        if (secret) return secret;
      }
    }
  } catch {
    // Unreadable body: fall through to the app-level secret; the HMAC check
    // of `verifyRequest` refuses it anyway.
  }
  return readSecret(BRIDGE_SECRET_KEY);
}

/** Flattens the request headers for `verifyRequest` (case-insensitive there). */
export function headersOf(request: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/** Queues a validated payload for the consumer; never throws. */
export async function enqueue(payload: IngestPayload): Promise<void> {
  // Real SDK (`@forge/events` v3): `Queue` replaces the former `Producer`
  // draft. `push` takes event bodies as plain objects, never JSON strings:
  // the consumer receives the payload structurally identical to this one.
  const queue = new Queue({ key: INGEST_QUEUE });
  const body: Record<string, unknown> = { ...payload };
  await queue.push({ body });
}

/** Outcome of the bridge verification: the payload, or the answer to send. */
export type SignedRequestCheck =
  | { ok: true; payload: unknown }
  | { ok: false; response: Response };

/**
 * Verifies the bridge of one signed request (`/ingest` and `/query` share
 * this path): secret lookup, HMAC + timestamp + nonce check (§ 15).
 */
export async function verifySignedRequest(request: Request): Promise<SignedRequestCheck> {
  const body = await request.text();
  const secret = await readBridgeSecret(body);
  if (!secret) {
    return { ok: false, response: jsonResponse(503, { ok: false, error: 'the Brain is not paired yet' }) };
  }
  const verified = verifyRequest(headersOf(request), body, secret, {
    seenNonce: (nonce) => nonces.seen(nonce),
  });
  if (!verified.ok) {
    return { ok: false, response: jsonResponse(401, { ok: false, error: verified.reason }) };
  }
  return { ok: true, payload: verified.payload };
}

/**
 * Verifies and queues one signed payload. Shared by `/ingest` and, after
 * conversion, by `/universal`: the queue and the consumer are the same.
 */
export async function verifyAndQueue(request: Request): Promise<Response> {
  const verified = await verifySignedRequest(request);
  if (!verified.ok) return verified.response;

  const payload = validateIngestPayload(verified.payload);
  if (!payload.ok) return jsonResponse(400, { ok: false, error: payload.error });

  await enqueue(payload.value);
  return jsonResponse(202, { ok: true, queued: true });
}

/** Handler of the `/ingest` web trigger. */
export async function ingest(request: Request): Promise<Response> {
  try {
    return await verifyAndQueue(request);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
