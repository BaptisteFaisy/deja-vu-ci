/**
 * Golden signatures — the lock on the normalization algorithm (§ 9.2, § 9.3).
 *
 * Every case below is a real-world error block, frozen with the signature and
 * family ids the current pipeline produces. The ids are **values observed from
 * the code**, not invented: the whole pipeline runs here (extract → mask →
 * categorize → normalize → sign), so a change in normalization, categorization
 * or signing breaks this file.
 *
 * That is the point. A broken golden test means existing memory is orphaned:
 * Jira tickets would point at ids that no longer reproduce. The fix is not to
 * update these numbers blindly — it is to ship a migration
 * (`planSignatureMigration` / `applySignatureMigration`) and record the new ids.
 */

import { describe, expect, it } from 'vitest';

import { extractErrorBlocks } from '../src/extract.js';
import { familyOf, signatureOf } from '../src/sign.js';
import type { Category } from '../src/types.js';

interface GoldenCase {
  /** Ecosystem or error kind this block represents. */
  name: string;
  /** Raw step log, as the sensor would send it (already free of secrets). */
  raw: string;
  category: Category;
  errorType: string;
  /** Frozen 16-hex signature id. */
  signature: string;
  /** Frozen 16-hex family id. */
  family: string;
}

const CASES: GoldenCase[] = [
  {
    name: 'java-maven',
    raw: [
      'java.lang.AssertionError: expected:<42> but was:<43>',
      '\tat com.acme.CalculatorTest.addFails(CalculatorTest.java:42)',
    ].join('\n'),
    category: 'test',
    errorType: 'AssertionError',
    signature: '4d827b41b2b8012e',
    family: 'c77c55de3d7ef711',
  },
  {
    name: 'pytest',
    raw: [
      "AssertionError: assert 'hello world' == 'hello worl'",
      'test_greeting.py:12 in test_greeting',
    ].join('\n'),
    category: 'test',
    errorType: 'AssertionError',
    signature: 'b0bd4932f8678c54',
    family: 'b46228aad8e86b1c',
  },
  {
    name: 'jest',
    raw: [
      'AssertionError: expect(received).toBe(expected) // Object.is equality',
      'Expected: 42',
      'Received: 43',
    ].join('\n'),
    category: 'test',
    errorType: 'AssertionError',
    signature: '7c2f6cc09086c185',
    family: '4c07bc5386c615b9',
  },
  {
    name: 'go',
    raw: ['--- FAIL: TestAdd (0.00s)', '    calc_test.go:10: got 42, want 43'].join('\n'),
    category: 'test',
    errorType: 'AssertionError',
    signature: 'c7c617c90ff3e830',
    family: 'c1b6c2963f3d1224',
  },
  {
    name: 'rust',
    raw: [
      'error[E0308]: mismatched types',
      ' --> src/main.rs:10:5',
      'expected u32, found &str',
    ].join('\n'),
    category: 'compile',
    errorType: 'CompileError',
    signature: 'f540184161aea19b',
    family: '4a5d01d61056184e',
  },
  {
    name: 'dotnet',
    raw: "Build FAILED: error CS0234: The type or namespace name 'Foo' does not exist in the namespace 'Bar'",
    category: 'compile',
    errorType: 'CompileError',
    signature: '38210dc144c6cf36',
    family: '5b8aec07962bc6d9',
  },
  {
    name: 'compile-typescript',
    raw:
      'src/index.ts(12,5): error TS2345: Argument of type string is not assignable to parameter of type number',
    category: 'compile',
    errorType: 'CompileError',
    signature: 'a9a05e295989cd3b',
    family: '36b936d93b553ef5',
  },
  {
    name: 'docker',
    raw:
      'ERROR: pull access denied for registry.example.com/app, repository does not exist or may require docker login',
    category: 'infrastructure',
    errorType: 'ImageNotFound',
    signature: 'cc80ed36f77148a4',
    family: 'f8e2a91df6e306a2',
  },
  {
    name: 'network',
    raw: 'npm ERR! network connect ETIMEDOUT registry.example.com:443',
    category: 'infrastructure',
    errorType: 'ETIMEDOUT',
    signature: 'e87c39f33894bd72',
    family: 'd8e631a5372f2c19',
  },
  {
    name: 'npm',
    raw: [
      'npm ERR! code ERESOLVE',
      'npm ERR! ERESOLVE could not resolve',
      'npm ERR! While resolving: foo@1.0.0',
    ].join('\n'),
    category: 'dependency',
    errorType: 'DependencyResolution',
    signature: '215a8328d8579b46',
    family: '01499a2837f81dd0',
  },
  {
    name: 'timeout',
    raw: 'TimeoutException: step timed out after 15 minutes (900 seconds)',
    category: 'timeout',
    errorType: 'Timeout',
    signature: '4ba7f1b1bafe6774',
    family: 'c1b44b37b36c03e2',
  },
  {
    name: 'out-of-memory',
    raw: ['Error: heap out of memory', 'at Object.<anonymous> (node:internal)'].join('\n'),
    category: 'infrastructure',
    errorType: 'OutOfMemory',
    signature: '19c90faaf8f413d8',
    family: 'af92bc841bfea0ba',
  },
  {
    name: 'config',
    raw: 'ENOENT: no such file or directory, open bitbucket-pipelines.yml',
    category: 'config',
    errorType: 'ConfigError',
    signature: 'fc4d9f149ec980c1',
    family: '3d20463a3aba9d4b',
  },
  {
    name: 'style',
    raw: 'eslint error: src/app.ts:3:1 no-unused-vars xyz is defined but never used',
    category: 'style',
    errorType: 'LintError',
    signature: 'fbd44fc392e7851d',
    family: '3b2a0df1827888f8',
  },
];

/** Run the real pipeline on a raw log and take the first block. */
function blockOf(raw: string) {
  const { blocks } = extractErrorBlocks({ stepLog: raw });
  return blocks[0];
}

describe('golden signatures', () => {
  it('covers every ecosystem of the brief', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12);
  });

  it('keeps every signature id distinct', () => {
    const signatures = CASES.map((c) => c.signature);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  for (const golden of CASES) {
    it(`freezes the ${golden.name} signature`, () => {
      const block = blockOf(golden.raw);
      expect(block).toBeDefined();
      expect(block.category).toBe(golden.category);
      expect(block.errorType).toBe(golden.errorType);
      expect(signatureOf(block)).toBe(golden.signature);
      expect(familyOf(block)).toBe(golden.family);
    });
  }
});