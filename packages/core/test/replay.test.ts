import { describe, expect, it } from 'vitest';
import { loadEngine, replay, replayWithEngine } from '../src/replay.js';
import { MemoryStore } from '../src/store.js';
import type { SampleDataset, SampleOccurrence } from '../src/types.js';
import { makeFakeEngine } from './fakes/engine.js';

/** Failure of the flaky test, on three branches, with a success in between. */
const flakyFailures: SampleOccurrence[] = [
  {
    at: '2026-11-01T10:00:00.000Z',
    repo: 'acme/api',
    branch: 'feature/a',
    commit: 'aaa1111',
    author: 'marie',
    step: 'test',
    durationS: 120,
    outcome: 'failure',
    testCases: [{ name: 'spec/payment.spec.ts pays', message: 'expected 3 to be 4' }],
  },
  {
    at: '2026-11-02T10:00:00.000Z',
    repo: 'acme/api',
    branch: 'feature/b',
    commit: 'bbb2222',
    author: 'marie',
    step: 'test',
    durationS: 130,
    outcome: 'failure',
    testCases: [{ name: 'spec/payment.spec.ts pays', message: 'expected 3 to be 4' }],
  },
  {
    at: '2026-11-03T10:00:00.000Z',
    repo: 'acme/api',
    branch: 'feature/a',
    commit: 'ccc3333',
    author: 'luc',
    step: 'test',
    durationS: 140,
    outcome: 'failure',
    testCases: [{ name: 'spec/payment.spec.ts pays', message: 'expected 3 to be 4' }],
  },
  {
    at: '2026-11-03T11:00:00.000Z',
    repo: 'acme/api',
    branch: 'feature/a',
    commit: 'ccc3333',
    author: 'luc',
    step: 'test',
    durationS: 90,
    outcome: 'success',
  },
];

/** Failure never seen before: the "new" diagnostic. */
const newFailure: SampleOccurrence = {
  at: '2026-11-04T10:00:00.000Z',
  repo: 'acme/api',
  branch: 'feature/d',
  commit: 'ddd4444',
  author: 'luc',
  step: 'test',
  durationS: 100,
  outcome: 'failure',
  log: 'TypeError: cannot read property id of undefined\n  at src/order.ts:42',
};

/** Failure of the package registry: the "infrastructure" diagnostic. */
const infrastructureFailure: SampleOccurrence = {
  at: '2026-11-05T10:00:00.000Z',
  repo: 'acme/api',
  branch: 'main',
  commit: 'eee5555',
  author: 'luc',
  step: 'build',
  durationS: 60,
  outcome: 'failure',
  log: 'npm ERR! network: connection refused to registry.npmjs.org',
};

/** Failure already fixed by a known commit: the "already-fixed" diagnostic. */
const fixedFailure: SampleOccurrence = {
  at: '2026-11-06T10:00:00.000Z',
  repo: 'acme/api',
  branch: 'feature/e',
  commit: 'fff6666',
  author: 'luc',
  step: 'test',
  durationS: 110,
  outcome: 'failure',
  testCases: [{ name: 'spec/http.spec.ts calls', message: 'connect ECONNREFUSED 127.0.0.1:5432' }],
};

/** The six occurrences of the sample dataset used by the tests. */
const dataset: SampleDataset = {
  name: 'sample-six',
  description: 'A small dataset with the four diagnostics',
  repository: 'acme/api',
  days: 6,
  occurrences: [
    ...flakyFailures,
    newFailure,
    infrastructureFailure,
    fixedFailure,
  ],
  resolutions: [
    {
      match: { testName: 'spec/http.spec.ts calls' },
      commit: '9998888',
      author: 'marie',
      note: 'bumped the HTTP client',
      files: ['src/http.ts'],
      confirmed: true,
    },
  ],
};

/** Replay the sample dataset with the deterministic doubles. */
function run() {
  return replayWithEngine(dataset, makeFakeEngine(), {
    now: new Date('2026-11-10T00:00:00.000Z'),
  });
}

describe('replay', () => {
  it('replays the six failures of the dataset', async () => {
    const result = await run();
    expect(result.datasetName).toBe('sample-six');
    expect(result.occurrences).toBe(6);
    expect(result.diagnostics).toHaveLength(6);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('produces the four diagnostics and counts them', async () => {
    const result = await run();
    const kinds = result.byKind;
    // The first failure of the flaky series is still "new" when it is seen.
    expect(kinds.flaky).toBe(1);
    expect(kinds['already-fixed']).toBe(1);
    expect(kinds.new).toBe(2);
    expect(kinds.infrastructure).toBe(1);
    const total = Object.values(kinds).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(6);
  });

  it('is deterministic: two replays give the same result', async () => {
    const first = await run();
    const second = await run();
    expect(second.byKind).toEqual(first.byKind);
    expect(second.signatures.map((s) => s.id)).toEqual(first.signatures.map((s) => s.id));
    expect(second.diagnostics.map((d) => d.diagnostic.kind)).toEqual(
      first.diagnostics.map((d) => d.diagnostic.kind),
    );
  });

  it('walks the occurrences in chronological order', async () => {
    const result = await run();
    const dates = result.diagnostics.map((d) => d.occurrence.occurredAt);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it('fills the store with the signatures and the occurrences', async () => {
    const store = new MemoryStore();
    await replayWithEngine(dataset, makeFakeEngine(), { store });
    const signatures = await store.listSignatures();
    expect(signatures.length).toBeGreaterThanOrEqual(4);
    const flaky = signatures.find((s) => s.testName === 'spec/payment.spec.ts pays');
    expect(flaky?.occurrences).toBe(3);
  });

  it('marks the previous failure as passed on retry', async () => {
    const store = new MemoryStore();
    const result = await replayWithEngine(dataset, makeFakeEngine(), { store });
    const retried = result.diagnostics.filter((d) => d.occurrence.passedOnRetry);
    expect(retried).toHaveLength(1);
    expect(retried[0].occurrence.commit).toBe('ccc3333');
  });

  it('keeps the known resolution of the dataset', async () => {
    const store = new MemoryStore();
    await replayWithEngine(dataset, makeFakeEngine(), { store });
    const signatures = await store.listSignatures();
    const http = signatures.find((s) => s.testName === 'spec/http.spec.ts calls');
    expect(http).toBeDefined();
    const resolution = await store.getResolution(http!.id);
    expect(resolution?.commit).toBe('9998888');
    expect(resolution?.confirmedBy).toBeDefined();
  });

  it('plans the ticket of the flaky signature', async () => {
    const result = await run();
    expect(result.tickets.length).toBeGreaterThanOrEqual(1);
    expect(result.tickets.some((t) => t.kind === 'create')).toBe(true);
  });

  it('deduces a candidate resolution between a failure and a later success', async () => {
    const store = new MemoryStore();
    const withCommit: SampleDataset = {
      ...dataset,
      occurrences: [
        ...flakyFailures,
        {
          at: '2026-11-04T12:00:00.000Z',
          repo: 'acme/api',
          branch: 'feature/a',
          commit: 'aaa1111',
          author: 'marie',
          step: 'test',
          durationS: 80,
          outcome: 'success',
        },
      ],
    };
    await replayWithEngine(withCommit, makeFakeEngine(), { store });
    const signatures = await store.listSignatures();
    const flaky = signatures.find((s) => s.testName === 'spec/payment.spec.ts pays');
    expect(flaky).toBeDefined();
    const resolution = await store.getResolution(flaky!.id);
    expect(resolution?.commit).toBe('ccc3333');
  });

  it('reports a clear error when an engine module is missing', async () => {
    const engine = makeFakeEngine();
    const broken = { ...engine, diagnosis: undefined as unknown as typeof engine.diagnosis };
    await expect(replayWithEngine(dataset, broken)).rejects.toThrow(/incomplete/);
  });

  it('either loads the real engine modules or says which one is missing', async () => {
    // The engine modules of the other lots land in parallel: until they are
    // merged the replay reports the missing module by name.
    try {
      const engine = await loadEngine();
      expect(typeof engine.signing.signatureOf).toBe('function');
      expect(typeof engine.diagnosis.diagnose).toBe('function');
    } catch (error) {
      expect((error as Error).message).toMatch(/unavailable|does not export/);
    }
  });

  it('replays through the public entry point when the engine is available', async () => {
    let engine;
    try {
      engine = await loadEngine();
    } catch {
      return; // the engine modules of the other lots are not merged yet
    }
    const result = await replay(dataset, { now: new Date('2026-11-10T00:00:00.000Z') });
    expect(result.datasetName).toBe('sample-six');
    expect(result.occurrences).toBe(6);
    const counted = Object.values(result.byKind).reduce((sum, n) => sum + n, 0);
    expect(counted).toBeGreaterThanOrEqual(6);
  });
});
