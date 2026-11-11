/**
 * Signed calls to the Brain — the Forge layer.
 *
 * Specification § 15: the bridge is signed with an HMAC-SHA256 of the body,
 * a timestamp and a nonce, using the shared secret established at pairing
 * time. The signing itself lives in `@dejavu/bridge` (frozen contract); this
 * file only posts the result to the Brain's web trigger, which is the only
 * external backend the manifest allows.
 */

import { fetch as externalFetch } from '@forge/api';
import { signPayload } from '@dejavu/bridge';
import type { BrainAnswer, BrainRoute, BrainTransport } from './buildPayload';

/** Builds the address of a route of the Brain. */
export function brainUrl(baseUrl: string, route: BrainRoute): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/${route}`;
}

/**
 * Signs a payload and posts it to the Brain.
 *
 * A transport error never escapes: the caller answers `{ ok: false }` and
 * the build event is simply lost for this attempt, which the Brain notices
 * as a missing occurrence rather than as a crash.
 */
async function postSigned(
  baseUrl: string,
  route: BrainRoute,
  secret: string,
  payload: unknown,
): Promise<BrainAnswer> {
  if (!secret) return { ok: false, error: 'the bridge secret is missing' };
  const { body, headers } = signPayload(payload, secret);
  try {
    const response = await externalFetch(brainUrl(baseUrl, route), {
      method: 'POST',
      headers,
      body,
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) {
      return { ok: false, status: response.status, error: `the Brain answered ${response.status}` };
    }
    return { ok: true, status: response.status, ...(parsed ? { body: parsed } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The signed transport used by the resolvers. */
export const brainTransport: BrainTransport = { post: postSigned };

/** Reads a JSON body, or returns undefined when it is not JSON. */
export function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
