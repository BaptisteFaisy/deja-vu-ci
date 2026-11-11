// Idempotent payload builder for the Déjà-vu universal entry.
//
// The Brain's universal route accepts (and today ignores) an extra
// `idempotencyKey` field. We stamp every payload with a stable SHA-256
// fingerprint of the exact content we send, so that retrying the same report
// produces the same key — a replay can never create two occurrences once the
// Brain deduplicates on it.

import { createHash } from 'node:crypto';

/** Stable key order: build the raw payload deterministically. */
export function canonicalPayload(opts) {
  const payload = {
    projectKey: opts.key,
    repository: opts.repository,
    branch: opts.branch,
  };
  if (opts.commit) payload.commit = opts.commit;
  if (opts.author) payload.author = opts.author;
  if (opts.step) payload.step = opts.step;
  payload.log = opts.log;
  if (opts.failedAt) payload.failedAt = opts.failedAt;
  if (opts.testCases && opts.testCases.length > 0) payload.testCases = opts.testCases;
  return payload;
}

/** SHA-256 hex fingerprint of the content (without the idempotency key). */
export function idempotencyKey(raw) {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}

/** Raw payload plus its stable idempotency key. */
export function buildPayload(opts) {
  const raw = canonicalPayload(opts);
  return { ...raw, idempotencyKey: idempotencyKey(raw) };
}