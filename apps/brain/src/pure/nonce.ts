/**
 * Anti-replay nonce memory (§ 15).
 *
 * `verifyRequest` of `@dejavu/bridge` takes a `seenNonce` callback: it must
 * answer `true` when the nonce was already consumed. The bridge already
 * bounds the timestamp window (±300 s), so a nonce only needs to be
 * remembered for that window. This cache is a bounded TTL map: entries
 * expire after `ttlMs` and the map evicts the oldest entries when it grows
 * past `maxEntries`, so a hostile sender cannot exhaust the memory.
 *
 * The cache lives in the warm instance of the Forge function. It is a
 * best-effort replay guard on top of the signature and timestamp checks:
 * a cold start forgets the nonces, but a replayed request still needs a
 * valid signature inside the timestamp window.
 */

/** Options of the cache; the clock is injectable for the tests. */
export interface NonceCacheOptions {
  /** Time-to-live of a nonce, in milliseconds (default: twice the skew window). */
  ttlMs?: number;
  /** Maximum number of remembered nonces before eviction (default: 100 000). */
  maxEntries?: number;
  /** Injectable clock, in milliseconds. */
  now?: () => number;
}

export interface NonceCache {
  /** True when the nonce was already seen and is not expired (a replay). */
  seen(nonce: string): boolean;
  /** Number of nonces currently remembered. */
  readonly size: number;
}

/** The bridge refuses timestamps outside ±300 s; remember nonces twice as long. */
export const DEFAULT_NONCE_TTL_MS = 600_000;
export const DEFAULT_MAX_NONCES = 100_000;

/** Creates a bounded TTL nonce cache. */
export function createNonceCache(options: NonceCacheOptions = {}): NonceCache {
  const ttlMs = options.ttlMs ?? DEFAULT_NONCE_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_NONCES;
  const clock = options.now ?? (() => Date.now());
  const entries = new Map<string, number>();

  function prune(now: number): void {
    for (const [nonce, expiry] of entries) {
      if (expiry <= now) entries.delete(nonce);
    }
  }

  return {
    seen(nonce: string): boolean {
      const now = clock();
      const expiry = entries.get(nonce);
      if (expiry !== undefined && expiry > now) return true;
      if (expiry !== undefined) entries.delete(nonce);
      if (entries.size >= maxEntries) prune(now);
      // A Map keeps insertion order: evicting the first key removes the oldest.
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      entries.set(nonce, now + ttlMs);
      return false;
    },
    get size(): number {
      return entries.size;
    },
  };
}
