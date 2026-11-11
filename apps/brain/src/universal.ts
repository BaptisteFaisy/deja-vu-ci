/**
 * Web trigger `/universal` — the entry of every other CI (§ 15, CI-16).
 *
 * A one-line command at the end of any pipeline (GitHub Actions, GitLab CI,
 * Jenkins…) posts a log excerpt here. There is no HMAC bridge: the route is
 * protected by the project key (`settings.universalKey`), compared with the
 * payload's `projectKey`. The excerpt is parsed, bounded (50 Ko) and masked
 * by the engine (`parseUniversalPayload` + `universalToIngest`), then it
 * follows the very same path as the Sensor: validate, queue, answer.
 *
 * Fail-closed rules: without a configured universal key the route refuses
 * everything; without the masking engine it refuses to ingest an unmasked
 * log. No exception escapes — the answer is always JSON.
 */

import {
  initUniversal,
  parseUniversalPayload,
  universalToIngest,
  type IngestPayload,
} from '@dejavu/core';
import { enqueue, jsonResponse } from './ingest';
import { validateIngestPayload } from './pure/validate';
import { loadSettings } from './settings';
import { migrateOnce, type BrainSqlStore } from './sql';

/** Converts one universal payload, or explains why it is refused. */
export async function convertUniversal(
  body: unknown,
  store: BrainSqlStore,
  now: Date,
): Promise<
  | { ok: true; payload: IngestPayload }
  | { ok: false; status: number; error: string }
> {
  const settings = await loadSettings(store);
  if (!settings.universalKey) {
    return { ok: false, status: 404, error: 'the universal entry is not enabled on this Brain' };
  }

  const parsed = parseUniversalPayload(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  if (!(await initUniversal())) {
    return { ok: false, status: 503, error: 'the masking engine is unavailable' };
  }

  try {
    const payload = universalToIngest(parsed.payload, { settings, now });
    return { ok: true, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('invalid universal key') ? 401 : 400;
    return { ok: false, status, error: message };
  }
}

/** Handler factory of the `/universal` web trigger. */
export function createUniversalHandler(store: BrainSqlStore) {
  return async function universal(request: Request): Promise<Response> {
    try {
      await migrateOnce();
      const body: unknown = JSON.parse(await request.text());
      const converted = await convertUniversal(body, store, new Date());
      if (!converted.ok) {
        return jsonResponse(converted.status, { ok: false, error: converted.error });
      }

      const payload = validateIngestPayload(converted.payload);
      if (!payload.ok) return jsonResponse(400, { ok: false, error: payload.error });

      await enqueue(payload.value);
      return jsonResponse(202, { ok: true, queued: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('JSON') ? 400 : 500;
      return jsonResponse(status, { ok: false, error: message });
    }
  };
}
