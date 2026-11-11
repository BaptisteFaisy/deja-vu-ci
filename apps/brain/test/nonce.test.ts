/**
 * Tests of the anti-replay nonce cache (`src/pure/nonce.ts`): a nonce is
 * remembered once, refuses a replay inside the TTL, expires after it, and
 * the cache stays bounded.
 */

import { describe, expect, it } from 'vitest';
import { createNonceCache } from '../src/pure/nonce';

describe('createNonceCache', () => {
  it('answers false the first time and true on replay', () => {
    const cache = createNonceCache({ now: () => 1000 });
    expect(cache.seen('abc')).toBe(false);
    expect(cache.seen('abc')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('forgets a nonce after its TTL', () => {
    let clock = 0;
    const cache = createNonceCache({ ttlMs: 500, now: () => clock });
    expect(cache.seen('abc')).toBe(false);
    clock = 400;
    expect(cache.seen('abc')).toBe(true);
    clock = 600;
    expect(cache.seen('abc')).toBe(false); // expired, accepted again
  });

  it('stays bounded and evicts the oldest entries', () => {
    let clock = 0;
    const cache = createNonceCache({ maxEntries: 3, ttlMs: 10_000, now: () => clock });
    cache.seen('n1');
    clock += 1;
    cache.seen('n2');
    clock += 1;
    cache.seen('n3');
    clock += 1;
    cache.seen('n4');
    expect(cache.size).toBeLessThanOrEqual(3);
    expect(cache.seen('n4')).toBe(true);
    expect(cache.seen('n1')).toBe(false); // n1 was evicted, so it looks new
  });
});
