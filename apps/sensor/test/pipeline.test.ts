/**
 * Reading of the Bitbucket Pipelines payloads — specification § 8.1 step 2
 * and § 17 (the API shapes are a point to confirm with a prototype, so the
 * readers are tolerant).
 */

import { describe, expect, it } from 'vitest';
import {
  findFailedStep,
  findPipelineForCommit,
  listSteps,
  parseCommitHashes,
  parseDiffstatPaths,
  parseFailedTestCases,
  readDurationS,
  splitLogBlocks,
} from '../src/pure/pipeline';

const COMMIT = 'a'.repeat(40);

const PIPELINES = {
  values: [
    { uuid: '{old}', build_number: 11, commit: { hash: COMMIT }, created_on: '2026-11-10T08:00:00Z' },
    { uuid: '{new}', build_number: 12, commit: { hash: COMMIT }, created_on: '2026-11-11T08:00:00Z' },
    { uuid: '{other}', build_number: 13, commit: { hash: 'b'.repeat(40) } },
  ],
};

const STEPS = {
  values: [
    { uuid: '{s1}', name: 'Build', state: { name: 'COMPLETED', result: 'SUCCESSFUL' } },
    {
      uuid: '{s2}',
      name: 'Test',
      state: { name: 'COMPLETED', result: 'FAILED' },
      started_on: '2026-11-11T08:00:00Z',
      completed_on: '2026-11-11T08:00:42Z',
    },
    { uuid: '{s3}', name: 'Manual', state: { name: 'STOPPED' } },
  ],
};

describe('findPipelineForCommit', () => {
  it('picks the most recent pipeline of the commit', () => {
    const pipeline = findPipelineForCommit(PIPELINES, COMMIT);
    expect(pipeline?.uuid).toBe('{new}');
    expect(pipeline?.number).toBe(12);
  });

  it('returns undefined when no pipeline ran that commit', () => {
    expect(findPipelineForCommit(PIPELINES, 'c'.repeat(40))).toBeUndefined();
  });

  it('returns undefined on an unexpected shape', () => {
    expect(findPipelineForCommit(undefined, COMMIT)).toBeUndefined();
    expect(findPipelineForCommit({ values: 'nope' }, COMMIT)).toBeUndefined();
  });
});

describe('listSteps', () => {
  it('reads the name, the result and the duration of each step', () => {
    const steps = listSteps(STEPS);
    expect(steps).toHaveLength(3);
    expect(steps[1]).toMatchObject({ uuid: '{s2}', name: 'Test', result: 'FAILED' });
    expect(steps[1].durationS).toBe(42);
  });

  it('falls back on the uuid when a step has no name', () => {
    const steps = listSteps({ values: [{ uuid: '{x}' }] });
    expect(steps[0].name).toBe('{x}');
  });
});

describe('findFailedStep', () => {
  it('returns the first failed step', () => {
    expect(findFailedStep(listSteps(STEPS))?.uuid).toBe('{s2}');
  });

  it('ignores a step stopped by hand (§ 19)', () => {
    const steps = listSteps({ values: [{ uuid: '{m}', name: 'Manual', state: { result: 'STOPPED' } }] });
    expect(findFailedStep(steps)).toBeUndefined();
  });
});

describe('readDurationS', () => {
  it('reads an explicit duration', () => {
    expect(readDurationS({ duration: 12.4 })).toBe(12);
  });

  it('computes the duration from the timestamps', () => {
    expect(
      readDurationS({ started_on: '2026-11-11T08:00:00Z', completed_on: '2026-11-11T08:01:30Z' }),
    ).toBe(90);
  });

  it('returns undefined when the timestamps are missing or inconsistent', () => {
    expect(readDurationS({})).toBeUndefined();
    expect(
      readDurationS({ started_on: '2026-11-11T08:01:00Z', completed_on: '2026-11-11T08:00:00Z' }),
    ).toBeUndefined();
  });
});

describe('parseFailedTestCases', () => {
  it('reads the name, the message and the stack of a failed case', () => {
    const cases = parseFailedTestCases({
      values: [
        {
          name: 'test_payment_refused',
          status: 'FAILED',
          classname: 'TestPayment',
          duration: 15,
          reason: { message: 'expected 200, got 500' },
          stack_trace: 'at pay.ts:12',
        },
        { name: 'test_ok', status: 'PASSED' },
      ],
    });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toEqual({
      name: 'test_payment_refused',
      message: 'expected 200, got 500',
      stack: 'at pay.ts:12',
      classname: 'TestPayment',
      durationMs: 15,
    });
  });

  it('keeps a case with no status and defaults its message', () => {
    const cases = parseFailedTestCases({ values: [{ name: 'test_x' }] });
    expect(cases[0].message).toBe('test failed');
  });

  it('returns an empty list on an unexpected shape', () => {
    expect(parseFailedTestCases(undefined)).toEqual([]);
    expect(parseFailedTestCases({ values: [{}] })).toEqual([]);
  });
});

describe('parseCommitHashes', () => {
  it('reads the hashes of a branch, most recent first', () => {
    expect(parseCommitHashes({ values: [{ hash: 'h1' }, { hash: 'h2' }] })).toEqual(['h1', 'h2']);
  });

  it('skips the entries without a hash', () => {
    expect(parseCommitHashes({ values: [{ hash: 'h1' }, {}] })).toEqual(['h1']);
  });
});

describe('parseDiffstatPaths', () => {
  it('reads the paths touched by a pull request', () => {
    expect(
      parseDiffstatPaths({ values: [{ new: { path: 'src/a.ts' } }, { old: { path: 'src/b.ts' } }] }),
    ).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('splitLogBlocks', () => {
  it('keeps the last blocks of the log, most recent first', () => {
    const log = 'first\n\nsecond\n\nthird\n\nfourth';
    expect(splitLogBlocks(log, 2)).toEqual(['fourth', 'third']);
  });

  it('returns an empty list for an empty log', () => {
    expect(splitLogBlocks('   \n\n  ')).toEqual([]);
  });
});
