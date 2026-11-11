import { describe, expect, it } from 'vitest';
import { categorize, detectErrorType } from '../src/categorize.js';

describe('categorize', () => {
  it('returns dependency for a package download error', () => {
    const raw = 'npm ERR! code E404\nnpm ERR! 404 Failed to download package @acme/utils from registry';
    expect(categorize({ rawText: raw, source: 'log' })).toBe('dependency');
  });

  it('returns infrastructure for a network cut, even inside a test', () => {
    const raw = 'FAIL src/api.test.ts\nError: connect ECONNREFUSED 127.0.0.1:5432';
    expect(categorize({ rawText: raw, source: 'report', testName: 'api fetches rows' })).toBe(
      'infrastructure',
    );
  });

  it('returns timeout for an interrupted step', () => {
    const raw = 'Timeout - Async callback was not invoked within the 5000 ms timeout';
    expect(categorize({ rawText: raw, source: 'log' })).toBe('timeout');
  });

  it('returns compile for a TypeScript compiler error', () => {
    const raw = "src/index.ts(12,5): error TS2304: Cannot find name 'foo'.";
    expect(categorize({ rawText: raw, source: 'log' })).toBe('compile');
  });

  it('returns style for a linter failure', () => {
    const raw = 'eslint found 3 problems in src/app.ts';
    expect(categorize({ rawText: raw, source: 'log' })).toBe('style');
  });

  it('returns config for a missing environment variable', () => {
    const raw = 'Error: environment variable DATABASE_URL is not set';
    expect(categorize({ rawText: raw, source: 'log' })).toBe('config');
  });

  it('returns test for an assertion failure', () => {
    const raw = 'AssertionError: expected 4 to equal 5';
    expect(categorize({ rawText: raw, source: 'log' })).toBe('test');
  });

  it('falls back to test when the source is a report', () => {
    const category = categorize({ rawText: 'nothing known here', source: 'report', testName: 'my test' });
    expect(category).toBe('test');
  });

  it('falls back to the canonical error type when the text has no pattern', () => {
    const category = categorize({ rawText: 'weird output', source: 'log', errorType: 'OutOfMemory' });
    expect(category).toBe('infrastructure');
  });

  it('returns unknown for a log without any known pattern', () => {
    expect(categorize({ rawText: 'Step 3/5: packaging assets\nProcess exited', source: 'tail' })).toBe(
      'unknown',
    );
  });
});

describe('detectErrorType', () => {
  it('detects canonical types from the table', () => {
    expect(detectErrorType('connect ECONNREFUSED 10.0.0.1:80')).toBe('NetworkError');
    expect(detectErrorType('JavaScript heap out of memory')).toBe('OutOfMemory');
    expect(detectErrorType('No matching distribution found for requests')).toBe('DependencyResolution');
    expect(detectErrorType('error[E0308]: mismatched types')).toBe('CompileError');
    expect(detectErrorType('AssertionError: expected true to be false')).toBe('AssertionError');
  });

  it('falls back to the first exception-like name in the text', () => {
    expect(detectErrorType('TypeError: undefined is not a function')).toBe('TypeError');
    expect(detectErrorType('java.lang.NullPointerException at Foo.bar')).toBe('NullPointerException');
  });

  it('returns UnknownError when nothing is recognized', () => {
    expect(detectErrorType('something odd happened')).toBe('UnknownError');
  });
});
