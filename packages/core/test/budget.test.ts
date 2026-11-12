/**
 * Performance budget of the engine (CI-05).
 *
 * CI-05 promises one of the four diagnostics, with its confidence and its
 * facts, **in less than 30 seconds** after the failure. The guards below
 * check that promise with a wide but real margin, and they compare **orders
 * of magnitude**, never exact milliseconds: a unit diagnosis must come back
 * in well under a second even on a loaded workstation, and a full replay of
 * the sample dataset in well under 30 seconds.
 *
 * The numbers measured on this repository are in `docs/BENCHMARK.md`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnose.js';
import { staticReplayEngine } from '../src/engine.js';
import { replayWithEngine } from '../src/replay.js';
import { MemoryStore } from '../src/store.js';
import { DEFAULT_SETTINGS, type Occurrence, type SampleDataset } from '../src/types.js';

/** The tracked sample dataset: 40 failures over 14 days (CI-11). */
const DATASET_URL = new URL('../../../data/sample/occurrences.json', import.meta.url);
const dataset = JSON.parse(readFileSync(DATASET_URL, 'utf8')) as SampleDataset;

/** Budget of one unit diagnosis: far below the 30 s of CI-05, wide margin. */
const DIAGNOSE_BUDGET_MS = 1_000;

/** Budget of a full replay of the sample dataset (the CI-05 promise itself). */
const REPLAY_BUDGET_MS = 30_000;

/** The five kinds a diagnosis may carry (§ 5 and the cautious "uncertain"). */
const KINDS = ['flaky', 'already-fixed', 'new', 'infrastructure', 'uncertain'];

/** One occurrence of the fake signature used by the diagnosis benchmark. */
function makeOccurrence(index: number): Occurrence {
  return {
    id: `occ-${index}`,
    signatureId: 'sig-0000bench',
    familyId: 'fam-0000bench',
    workspace: 'acme',
    repo: 'acme/api',
    branch: 'feature/payments',
    commit: `commit${index}`,
    author: `dev-${index % 5}`,
    stepName: 'test',
    durationS: 90,
    occurredAt: new Date(Date.parse('2026-11-01T00:00:00Z') + index * 60_000).toISOString(),
    passedOnRetry: index % 3 === 0,
    testName: 'spec/payment.spec.ts pays',
  };
}

/** A history of 200 occurrences of the same signature — a busy signature. */
const history: Occurrence[] = Array.from({ length: 200 }, (_, index) => makeOccurrence(index));

describe('budget de performance (CI-05)', () => {
  it('rend un diagnostic unitaire en moins d’une seconde sur une machine chargée', () => {
    const occurrence = makeOccurrence(500);
    const context = {
      occurrence,
      history,
      familyHistory: history,
      branchContainsResolution: false,
      changedFiles: ['src/payment.ts'],
      settings: DEFAULT_SETTINGS,
      now: new Date(occurrence.occurredAt),
    };

    // Warm-up: the first call pays the JIT, it is not part of the measure.
    diagnose(context);

    const samples: number[] = [];
    let last = diagnose(context);
    for (let run = 0; run < 20; run += 1) {
      const started = performance.now();
      last = diagnose(context);
      samples.push(performance.now() - started);
    }

    // The measurement must be of a real diagnosis, not of a no-op.
    expect(KINDS).toContain(last.kind);
    expect(last.facts.length).toBeGreaterThan(0);
    expect(last.confidence).toBeGreaterThanOrEqual(0);
    expect(last.confidence).toBeLessThanOrEqual(1);

    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeLessThan(DIAGNOSE_BUDGET_MS);
    expect(sorted[sorted.length - 1]).toBeLessThan(DIAGNOSE_BUDGET_MS);
  });

  it('rejoue le jeu d’exemple complet en moins de 30 secondes', async () => {
    const started = performance.now();
    const result = await replayWithEngine(dataset, staticReplayEngine(), { store: new MemoryStore() });
    const elapsed = performance.now() - started;

    // The replay really ran: the 40 failures produced 40 diagnostics and the
    // four expected kinds are there.
    expect(result.diagnostics.length).toBe(40);
    expect(result.byKind.flaky).toBeGreaterThan(0);
    expect(result.byKind['already-fixed']).toBeGreaterThan(0);
    expect(result.byKind.new).toBeGreaterThan(0);
    expect(result.byKind.infrastructure).toBeGreaterThan(0);

    expect(elapsed).toBeLessThan(REPLAY_BUDGET_MS);
  });
});
