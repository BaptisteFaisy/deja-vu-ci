/**
 * The bench runs in reduced mode inside the vitest suite.
 *
 * Two contracts are checked here:
 *   1. the reduced bench never adds more than ~20 s to the suite (CI budget:
 *      5 minutes per job, user rule);
 *   2. its JSON output stays a valid, complete report (this is what
 *      `node tools/bench.mjs --json` prints and what docs/BENCHMARK.md quotes).
 *
 * The engine is assembled from the TypeScript sources (vitest resolves them,
 * exactly like the core tests do), so this suite does not need
 * `packages/core/dist`. The CLI end-to-end check tolerates both states: with
 * the engine built it validates the real JSON output, without it it validates
 * the graceful "run npm run build" failure.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '@dejavu/core';
import * as similarity from '../apps/brain/src/actions/similarity.ts';
import * as replayState from '../packages/core/src/replay-state.ts';
import { KEPT, REPETITIONS, SEED, runBench, summarize, syntheticCorpus, toJson } from './bench.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distExists = existsSync(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js'));

/** The same bundle the CLI builds from `packages/core/dist`, here from sources. */
const bundle = {
  ...core,
  extractBlocks: replayState.extractBlocks,
  buildOccurrence: replayState.buildOccurrence,
  priorOccurrences: replayState.priorOccurrences,
  statusAfterOccurrence: replayState.statusAfterOccurrence,
  messageSimilarity: similarity.messageSimilarity,
  scoreMatch: similarity.scoreMatch,
};

/** Metrics the bench must always produce, per corpus. */
const METRICS = ['ingest-failure', 'replay-full', 'search-failures', 'cost-report'];

describe('banc de performance (tools/bench.mjs)', () => {
  it('tourne en mode réduit bien en dessous du budget de la CI', async () => {
    const started = performance.now();
    const report = await runBench(bundle, { quick: true });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(20_000);
    expect(report.mode).toBe('quick');
    expect(report.config.seed).toBe(SEED);
    expect(report.config.repetitions).toBe(REPETITIONS);
    expect(report.config.kept).toBe(KEPT);

    // Two corpora (sample-40 + the reduced synthetic one) × four metrics.
    expect(report.phases).toHaveLength(report.config.corpora.length * METRICS.length);
    for (const phase of report.phases) {
      expect(METRICS).toContain(phase.metric);
      expect(phase.unit).toBe('ms');
      expect(Number.isFinite(phase.p50Ms)).toBe(true);
      expect(phase.p50Ms).toBeGreaterThanOrEqual(0);
      expect(phase.p95Ms).toBeGreaterThanOrEqual(phase.p50Ms);
      expect(phase.maxMs).toBeGreaterThanOrEqual(phase.p95Ms);
      expect(phase.samples).toBeGreaterThan(0);
      expect(phase.storeQueriesPerOp).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(phase.heapDeltaMb)).toBe(true);
    }
    // The ingestion and the replay really hit the store; the cost report is pure.
    const byMetric = new Map(report.phases.map((p) => [`${p.metric}/${p.corpus}`, p]));
    for (const corpus of report.config.corpora) {
      expect(byMetric.get(`ingest-failure/${corpus}`).storeQueriesPerOp).toBeGreaterThan(0);
      expect(byMetric.get(`replay-full/${corpus}`).storeQueriesPerOp).toBeGreaterThan(0);
      expect(byMetric.get(`cost-report/${corpus}`).storeQueriesPerOp).toBe(0);
    }
  }, 30_000);

  it('produit un JSON valide, aller-retour sans perte', async () => {
    const report = await runBench(bundle, { quick: true, sizes: [50] });
    const parsed = JSON.parse(toJson(report));
    expect(parsed.bench).toBe('deja-vu-ci/ci-05');
    expect(parsed.phases).toHaveLength(report.phases.length);
    expect(parsed.environment.node).toBe(process.version);
    expect(parsed.memoryMb.heapUsed).toBeGreaterThan(0);
    for (const phase of parsed.phases) {
      expect(typeof phase.p50Ms).toBe('number');
      expect(typeof phase.p95Ms).toBe('number');
      expect(typeof phase.maxMs).toBe('number');
    }
  }, 30_000);

  it('génère un corpus synthétique déterministe (graine fixe)', () => {
    const first = syntheticCorpus(30);
    const second = syntheticCorpus(30);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.occurrences.filter((o) => o.outcome === 'failure')).toHaveLength(30);
    // ~10 % same-commit successes, so the replay walks its refine path too.
    expect(first.occurrences.filter((o) => o.outcome === 'success').length).toBeGreaterThan(0);
  });

  it('calcule des percentiles au rang le plus proche', () => {
    const stats = summarize([4, 1, 3, 2]);
    expect(stats.samples).toBe(4);
    expect(stats.p50Ms).toBe(2);
    expect(stats.p95Ms).toBe(4);
    expect(stats.maxMs).toBe(4);
    expect(stats.meanMs).toBe(2.5);
  });

  it('en ligne de commande : JSON complet, ou invitation à construire le moteur', () => {
    const run = spawnSync(process.execPath, [path.join(repoRoot, 'tools', 'bench.mjs'), '--quick', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (distExists) {
      expect(run.status).toBe(0);
      const report = JSON.parse(run.stdout);
      expect(report.bench).toBe('deja-vu-ci/ci-05');
      expect(report.mode).toBe('quick');
      expect(report.phases.length).toBeGreaterThan(0);
    } else {
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('npm run build');
    }
  }, 70_000);
});
