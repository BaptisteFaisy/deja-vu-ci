// Minimal HTTP transport for the CLI: POST JSON with timeout and retries on
// transient errors. Node built-ins only (no npm dependency), local-only by
// design — the tests run against an ephemeral loopback server.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const BACKOFF_MS = [500, 1000, 2000];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One POST attempt; resolves with status and body, rejects on transport error. */
function postOnce(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? httpsRequest : httpRequest;
    const target = new URL(url);
    const req = lib(
      target,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function isRetryable(reason, status) {
  if (reason) return true; // network error, timeout, connection reset
  return status >= 500; // server-side blip (e.g. masked engine unavailable)
}

/**
 * POST with backoff. Retries only transient failures; a definitive 4xx
 * answer is returned as-is so the caller reports it without hammering the
 * Brain.
 */
export async function postWithRetry(url, body, { retries = 3, timeoutMs = 20000 } = {}) {
  let lastError = new Error('no attempt made');
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const { status, body: respBody } = await postOnce(url, body, timeoutMs);
      lastStatus = status;
      lastBody = respBody;
      if (!isRetryable(null, status)) return { status, body: respBody, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await wait(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
  }
  return { status: lastStatus, body: lastBody, attempts: retries, error: lastError?.message };
}