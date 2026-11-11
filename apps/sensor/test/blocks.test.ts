/**
 * Error-block selection — specification § 19: "several errors in one step:
 * the three first distinct signatures are kept" and 50 KiB in total.
 */

import { describe, expect, it } from 'vitest';
import { byteLength, MAX_TOTAL_BLOCK_BYTES, selectBlocks, truncateText } from '../src/pure/blocks';

describe('truncateText', () => {
  it('returns the text unchanged when it fits', () => {
    expect(truncateText('hello', 100)).toBe('hello');
  });

  it('cuts to the given number of bytes', () => {
    expect(truncateText('abcdefghij', 4)).toBe('abcd');
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateText('abcdefghij', 0)).toBe('');
  });

  it('never produces an invalid UTF-8 sequence', () => {
    const text = 'a'.repeat(3) + '€€€';
    const cut = truncateText(text, 6);
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(6);
    expect(cut.startsWith('aaa')).toBe(true);
  });
});

describe('selectBlocks', () => {
  it('keeps the blocks in order', () => {
    const { blocks, dropped, truncated } = selectBlocks(['one', 'two', 'three']);
    expect(blocks).toEqual(['one', 'two', 'three']);
    expect(dropped).toBe(0);
    expect(truncated).toBe(false);
  });

  it('keeps at most three blocks and counts the discarded ones', () => {
    const { blocks, dropped } = selectBlocks(['a', 'b', 'c', 'd', 'e']);
    expect(blocks).toEqual(['a', 'b', 'c']);
    expect(dropped).toBe(2);
  });

  it('ignores the empty candidates', () => {
    const { blocks, dropped } = selectBlocks(['', '   ', 'real']);
    expect(blocks).toEqual(['real']);
    expect(dropped).toBe(0);
  });

  it('cuts a block that does not fit in the remaining budget', () => {
    const { blocks, truncated } = selectBlocks(['x'.repeat(10), 'y'.repeat(50)], 30);
    expect(blocks[0]).toBe('x'.repeat(10));
    expect(blocks[1]).toBe('y'.repeat(20));
    expect(truncated).toBe(true);
  });

  it('drops what cannot fit at all', () => {
    const { blocks, dropped } = selectBlocks(['x'.repeat(10), 'y'.repeat(10)], 10);
    expect(blocks).toEqual(['x'.repeat(10)]);
    expect(dropped).toBe(1);
  });

  it('never exceeds the 50 KiB budget by default', () => {
    const big = Array.from({ length: 10 }, () => 'z'.repeat(20 * 1024));
    const { blocks } = selectBlocks(big);
    const total = blocks.reduce((sum, block) => sum + byteLength(block), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BLOCK_BYTES);
    expect(MAX_TOTAL_BLOCK_BYTES).toBe(51200);
  });
});
