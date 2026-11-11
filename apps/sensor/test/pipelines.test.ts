/**
 * The reading of the Pipelines API and its fallbacks — specification § 17
 * and E brief: "a step log that cannot be read is NOT an error: the Sensor
 * falls back on the test reports, then on the universal entry".
 *
 * Every test drives `pipelines.ts` through a simulated `BitbucketReader`, so
 * the order of the fallbacks is checked without Forge and without network.
 */

import { describe, expect, it } from 'vitest';
import {
  readFailingStep,
  readStepLogTail,
  readStepMaterial,
  repoPath,
  stepLogPath,
  testCasePath,
  testReportPath,
  type ApiAnswer,
  type BitbucketReader,
} from '../src/pipelines';

const COMMIT = 'a'.repeat(40);
const BASE = repoPath('acme', 'payments');

function answer(body: unknown, status = 200, headers: Record<string, string> = {}): ApiAnswer {
  return {
    ok: status >= 200 && status < 300,
    status,
    contentRange: headers['content-range'],
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

/** A reader built from an ordered list of (matcher, answer) rules. */
function readerOf(rules: Array<[string, ApiAnswer]>): BitbucketReader {
  return async (path: string) => {
    for (const [needle, reply] of rules) {
      if (path.includes(needle)) return reply;
    }
    return answer({ error: 'not found' }, 404);
  };
}

const PIPELINE = { values: [{ uuid: '{p1}', build_number: 12, commit: { hash: COMMIT } }] };
const FAILED_STEP = { values: [{ uuid: '{s1}', name: 'Test', state: { result: 'FAILED' } }] };
const REPORT = { values: [{ uuid: '{r1}' }] };
const CASES = { values: [{ name: 'test_refused', status: 'FAILED', reason: { message: 'boom' } }] };

const LOG_PATH = stepLogPath(BASE, '{p1}', '{s1}');
const REPORT_PATH = testReportPath(BASE, '{p1}', '{s1}');
const CASE_PATH = testCasePath(BASE, '{r1}').split('?')[0];

describe('readStepLogTail', () => {
  it('asks for the tail with a partial request', async () => {
    let seen: Record<string, string> | undefined;
    const reader: BitbucketReader = async (_path, init) => {
      seen = init?.headers;
      return answer('the end of the log', 206);
    };
    const text = await readStepLogTail(reader, 'acme', 'payments', '{p1}', '{s1}', 4096);
    expect(text).toBe('the end of the log');
    expect(seen).toEqual({ Range: 'bytes=-4096' });
  });

  it('cuts the tail locally when the endpoint ignores the Range header', async () => {
    const reader = readerOf([['/log', answer('a'.repeat(2048) + 'tail', 200)]]);
    expect(await readStepLogTail(reader, 'acme', 'payments', '{p1}', '{s1}', 4)).toBe('tail');
  });

  it('throws when the log endpoint refuses', async () => {
    const reader = readerOf([['/log', answer('nope', 403)]]);
    await expect(readStepLogTail(reader, 'acme', 'payments', '{p1}', '{s1}', 64)).rejects.toThrow(/403/);
  });
});

describe('readStepMaterial', () => {
  const ref = { workspace: 'acme', repository: 'payments', pipelineUuid: '{p1}', stepUuid: '{s1}' };

  it('prefers the test reports and still attaches the log tail', async () => {
    const reader = readerOf([
      [CASE_PATH, answer(CASES)],
      [REPORT_PATH, answer(REPORT)],
      [LOG_PATH, answer('the log tail', 206)],
    ]);
    const material = await readStepMaterial(reader, ref, 1024);
    expect(material.source).toBe('test-reports');
    expect(material.testCases).toEqual([
      { name: 'test_refused', message: 'boom', stack: undefined, classname: undefined, durationMs: undefined },
    ]);
    expect(material.logTail).toBe('the log tail');
    expect(material.notes).toEqual([]);
  });

  it('falls back on the log when the test reports refuse', async () => {
    const reader = readerOf([
      [REPORT_PATH, answer({ error: 'forbidden' }, 403)],
      [LOG_PATH, answer('only the log', 206)],
    ]);
    const material = await readStepMaterial(reader, ref, 1024);
    expect(material.source).toBe('log');
    expect(material.testCases).toBeUndefined();
    expect(material.logTail).toBe('only the log');
    expect(material.notes.join(' ')).toContain('test reports unavailable');
  });

  it('falls back on the log when the reports exist but hold no failed case', async () => {
    const reader = readerOf([
      [CASE_PATH, answer({ values: [] })],
      [REPORT_PATH, answer(REPORT)],
      [LOG_PATH, answer('only the log', 206)],
    ]);
    const material = await readStepMaterial(reader, ref, 1024);
    expect(material.source).toBe('log');
  });

  it('reports "none" instead of failing when nothing can be read', async () => {
    const reader = readerOf([
      [REPORT_PATH, answer({ error: 'gone' }, 410)],
      [LOG_PATH, answer({ error: 'gone' }, 410)],
    ]);
    const material = await readStepMaterial(reader, ref, 1024);
    expect(material.source).toBe('none');
    expect(material.logTail).toBeUndefined();
    expect(material.testCases).toBeUndefined();
    expect(material.notes).toHaveLength(2);
  });
});

describe('readFailingStep', () => {
  it('finds the pipeline of the commit, then its failed step', async () => {
    const reader = readerOf([
      [CASE_PATH, answer(CASES)],
      [REPORT_PATH, answer(REPORT)],
      [LOG_PATH, answer('tail', 206)],
      ['/steps/', answer(FAILED_STEP)],
      ['/pipelines/?commit=', answer(PIPELINE)],
    ]);
    const context = await readFailingStep(reader, 'acme', 'payments', COMMIT, 1024);
    expect(context?.pipeline?.uuid).toBe('{p1}');
    expect(context?.pipeline?.number).toBe(12);
    expect(context?.step.name).toBe('Test');
    expect(context?.material.source).toBe('test-reports');
  });

  it('returns undefined when the commit has no pipeline', async () => {
    const reader = readerOf([['/pipelines/?commit=', answer({ values: [] })]]);
    expect(await readFailingStep(reader, 'acme', 'payments', COMMIT)).toBeUndefined();
  });

  it('returns undefined when no step failed (a step stopped by hand is ignored)', async () => {
    const reader = readerOf([
      ['/steps/', answer({ values: [{ uuid: '{m}', name: 'Deploy', state: { result: 'STOPPED' } }] })],
      ['/pipelines/?commit=', answer(PIPELINE)],
    ]);
    expect(await readFailingStep(reader, 'acme', 'payments', COMMIT)).toBeUndefined();
  });
});
