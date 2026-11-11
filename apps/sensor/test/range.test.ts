/**
 * Partial-request helpers — specification § 19: "a log of tens of
 * megabytes: only the end is read".
 */

import { describe, expect, it } from 'vitest';
import {
  byteRangeHeader,
  DEFAULT_TAIL_BYTES,
  keepTail,
  parseContentRangeTotal,
  tailRangeHeader,
} from '../src/pure/range';

describe('tailRangeHeader', () => {
  it('asks for the last bytes of the resource (suffix range)', () => {
    expect(tailRangeHeader(64 * 1024)).toBe('bytes=-65536');
  });

  it('uses 64 KiB by default', () => {
    expect(DEFAULT_TAIL_BYTES).toBe(65536);
    expect(tailRangeHeader()).toBe('bytes=-65536');
  });

  it('never asks for a non-positive number of bytes', () => {
    expect(tailRangeHeader(0)).toBe('bytes=-1');
    expect(tailRangeHeader(-10)).toBe('bytes=-1');
    expect(tailRangeHeader(10.7)).toBe('bytes=-10');
  });
});

describe('byteRangeHeader', () => {
  it('asks for an inclusive window', () => {
    expect(byteRangeHeader(0, 1023)).toBe('bytes=0-1023');
    expect(byteRangeHeader(4096, 8191)).toBe('bytes=4096-8191');
  });

  it('clamps a negative start and an inverted window', () => {
    expect(byteRangeHeader(-5, 10)).toBe('bytes=0-10');
    expect(byteRangeHeader(10, 3)).toBe('bytes=10-10');
  });
});

describe('parseContentRangeTotal', () => {
  it('reads the total size of the resource', () => {
    expect(parseContentRangeTotal('bytes 0-1023/20480')).toBe(20480);
  });

  it('returns undefined when the size is unknown or the header absent', () => {
    expect(parseContentRangeTotal('bytes 0-1023/*')).toBeUndefined();
    expect(parseContentRangeTotal(undefined)).toBeUndefined();
    expect(parseContentRangeTotal('')).toBeUndefined();
  });
});

describe('keepTail', () => {
  it('keeps the whole body when it fits', () => {
    expect(keepTail('hello', 100)).toBe('hello');
  });

  it('keeps only the last bytes when the body is too big', () => {
    const body = 'a'.repeat(10) + 'b'.repeat(20);
    expect(keepTail(body, 20)).toBe('b'.repeat(20));
  });

  it('does not cut a multi-byte character in half', () => {
    const body = 'ok' + 'é'.repeat(10);
    const tail = keepTail(body, 5);
    expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(5);
    expect(tail).toBe('éé');
  });
});
