import { describe, expect, it } from 'vitest';
import { extractErrorBlocks, lastNonEmptyLines } from '../src/extract.js';
import { signatureOf } from '../src/sign.js';
import type { FailedTestCase } from '../src/types.js';

describe('lastNonEmptyLines', () => {
  it('returns the last n non-empty lines', () => {
    const text = 'line 1\n\nline 2\n   \nline 3\nline 4\n';
    expect(lastNonEmptyLines(text, 2)).toEqual(['line 3', 'line 4']);
  });

  it('handles empty text', () => {
    expect(lastNonEmptyLines('', 10)).toEqual([]);
  });
});

describe('extractErrorBlocks', () => {
  it('extracts from test cases first with source report and sets testName', () => {
    const testCases: FailedTestCase[] = [
      {
        name: 'com.acme.OrderTest#testPayment',
        message: 'AssertionError: expected status 200 but got 500',
        stack: 'at com.acme.OrderTest.testPayment(OrderTest.java:42)\nat org.junit.runner.JUnitCore.run(JUnitCore.java:10)',
      },
    ];
    const res = extractErrorBlocks({ testCases });
    expect(res.source).toBe('report');
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].testName).toBe('com.acme.OrderTest#testPayment');
    expect(res.blocks[0].category).toBe('test');
    expect(res.dropped).toBe(0);
  });

  it('extracts from log patterns with source log', () => {
    const log = `
      Step 1: build
      npm ERR! code E404
      npm ERR! 404 Not Found - GET https://registry.npmjs.org/@acme/foo - Not found
      npm ERR! A complete log can be found in: /tmp/npm-cache/log.txt
    `;
    const res = extractErrorBlocks({ stepLog: log });
    expect(res.source).toBe('log');
    expect(res.blocks.length).toBeGreaterThanOrEqual(1);
    expect(res.blocks[0].category).toBe('dependency');
  });

  it('falls back to tail when no pattern is found in the log', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 100; i++) {
      lines.push(`info step line ${i} finished successfully`);
    }
    const log = lines.join('\n');
    const res = extractErrorBlocks({ stepLog: log });
    expect(res.source).toBe('tail');
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].category).toBe('unknown');
    expect(res.blocks[0].rawText.split('\n')).toHaveLength(80);
  });

  it('caps at 3 distinct blocks and counts dropped blocks', () => {
    const testCases: FailedTestCase[] = [
      { name: 't1', message: 'AssertionError: fail 1' },
      { name: 't2', message: 'AssertionError: fail 2' },
      { name: 't3', message: 'AssertionError: fail 3' },
      { name: 't4', message: 'AssertionError: fail 4' },
      { name: 't5', message: 'AssertionError: fail 5' },
    ];
    const res = extractErrorBlocks({ testCases });
    expect(res.blocks).toHaveLength(3);
    expect(res.dropped).toBe(2);
  });

  it('masks secrets inside extracted blocks', () => {
    const token = 'npm_' + 'abc123def456ghi789jkl012mno345pqr';
    const log = `npm ERR! publish failed for author dev@example.com with token ${token}`;
    const res = extractErrorBlocks({ stepLog: log });
    expect(res.blocks[0].rawText).toContain('«[masqué:token]»');
    expect(res.blocks[0].rawText).toContain('«[masqué:email]»');
    expect(res.blocks[0].rawText).not.toContain(token);
    expect(res.blocks[0].rawText).not.toContain('dev@example.com');
  });

  it('enforces maxTotalBytes limit across blocks', () => {
    const longMessage = 'A'.repeat(1000);
    const testCases: FailedTestCase[] = [
      { name: 't1', message: `fail: ${longMessage}` },
      { name: 't2', message: `fail: ${longMessage}` },
    ];
    const res = extractErrorBlocks({ testCases, maxTotalBytes: 500 });
    const totalBytes = res.blocks.reduce((acc, b) => acc + b.rawText.length, 0);
    expect(totalBytes).toBeLessThanOrEqual(500);
  });

  it('produces the exact same signature for two logs differing only by timestamp and line number', () => {
    const log1 = `
      2026-11-11T01:00:00Z
      AssertionError: expected 1 to equal 2
          at run (src/calc.ts:42:10)
    `;
    const log2 = `
      2026-11-11T09:45:00Z
      AssertionError: expected 1 to equal 2
          at run (src/calc.ts:189:10)
    `;
    const res1 = extractErrorBlocks({ stepLog: log1 });
    const res2 = extractErrorBlocks({ stepLog: log2 });
    expect(res1.blocks.length).toBeGreaterThan(0);
    expect(res2.blocks.length).toBeGreaterThan(0);

    const sig1 = signatureOf(res1.blocks[0]);
    const sig2 = signatureOf(res2.blocks[0]);
    expect(sig1).toBe(sig2);
  });
});
