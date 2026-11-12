/**
 * Test of the nightly report generator (tools/nightly-report.mjs).
 *
 * Everything here is offline: the report is a pure function of the JSON
 * files the nightly workflow collects, and the collectors are exercised with
 * a local double of the engine — no network, no built engine, no Atlassian.
 */

import { describe, expect, it } from 'vitest';
import {
  collectChecks,
  collectMeasurement,
  collectReplay,
  findProblems,
  parseArgs,
  renderReport,
  summarizeVitest,
} from './nightly-report.mjs';

/** A double of the engine: the replay result and the signature of a failure. */
const fakeEngine = {
  replay: async () => ({
    datasetName: 'fake-dataset',
    occurrences: 3,
    elapsedMs: 12.5,
    signatures: [{ category: 'test' }, { category: 'compile' }],
    diagnostics: [
      { diagnostic: { kind: 'new' } },
      { diagnostic: { kind: 'flaky' } },
      { diagnostic: { kind: 'new' } },
    ],
    tickets: [{ kind: 'create' }, { kind: 'update' }],
  }),
  extractErrorBlocks: () => ({ blocks: [{ category: 'test' }] }),
  signatureOf: () => 'sig-1',
  familyOf: () => 'fam-1',
  assessFlakiness: () => ({ flaky: false }),
};

/** Two labelled failures of the same group: the grouping is perfect. */
const fakeCorpus = {
  name: 'fake-corpus',
  failures: [
    { id: 'f1', log: 'boom', branch: 'main', expectedGroup: 'g1', expectedCategory: 'test' },
    { id: 'f2', log: 'boom', branch: 'main', expectedGroup: 'g1', expectedCategory: 'test' },
  ],
};

/** The JSON files of a green run. */
function greenInputs() {
  return {
    replay: {
      dataset: 'fake-dataset',
      description: 'a fake dataset',
      occurrences: 40,
      elapsedMs: 18,
      signatures: 15,
      tickets: { create: 1, update: 14 },
      byKind: { new: 12, flaky: 15 },
      byCategory: { test: 7 },
    },
    measurement: {
      corpus: 'fake-labelled',
      failures: 100,
      groups: 27,
      signatures: 26,
      groupingAccuracy: 1,
      falseFlakyRate: 0,
      categoryAccuracy: 1,
      breaches: [],
    },
    tests: { total: 687, passed: 687, failed: 0, files: 71, durationMs: 2500 },
    checks: { checks: [{ id: 'sbom', label: 'SBOM up to date', ok: true, detail: 'matches' }] },
    meta: { date: '2026-11-12', commit: 'abc1234', runUrl: 'https://example.invalid/run/1', runId: '1' },
  };
}

describe('nightly report rendering', () => {
  it('publishes the real numbers of the run', () => {
    const report = renderReport(greenInputs());
    expect(report).toContain('**PASS**');
    expect(report).toContain('687 passed / 687 total');
    expect(report).toContain('40');
    expect(report).toContain('18 ms');
    expect(report).toContain('100.0 %');
    expect(report).toContain('≥ 90.0 %');
    expect(report).toContain('new (12)');
    expect(report).toContain('SBOM up to date');
    expect(report).toContain('2026-11-12');
    expect(report).toContain('abc1234');
  });

  it('is deterministic: the same inputs give the same report', () => {
    expect(renderReport(greenInputs())).toBe(renderReport(greenInputs()));
  });

  it('names the problems instead of hiding them', () => {
    const inputs = greenInputs();
    inputs.tests.failed = 3;
    inputs.measurement.breaches = ['regroupement sous le seuil'];
    inputs.checks.checks.push({ id: 'site', label: 'Site bundle', ok: false, detail: 'outdated' });
    const report = renderReport(inputs);
    expect(report).toContain('**FAIL**');
    expect(report).toContain('3 failing test(s)');
    expect(report).toContain('regroupement sous le seuil');
    expect(report).toContain('Site bundle — outdated');
    expect(findProblems(inputs)).toHaveLength(3);
  });

  it('never publishes a date older than the freeze', () => {
    const pattern = new RegExp(['2026-10-2', '[0-5]'].join(''));
    expect(pattern.test(renderReport(greenInputs()))).toBe(false);
  });

  it('says what the proof does not cover', () => {
    const report = renderReport(greenInputs());
    expect(report).toContain('What this report does not prove');
    expect(report).toContain('No Bitbucket call, no Jira call and no LLM call');
    expect(report).toContain('docs/NIGHTLY.md');
  });
});

describe('nightly report collection', () => {
  it('turns a replay into the published payload', async () => {
    const payload = await collectReplay(fakeEngine, { name: 'fake-dataset', description: 'a fake dataset' });
    expect(payload.dataset).toBe('fake-dataset');
    expect(payload.occurrences).toBe(3);
    expect(payload.signatures).toBe(2);
    expect(payload.tickets.create).toBe(1);
    expect(payload.byKind.new).toBe(2);
    expect(payload.byKind.flaky).toBe(1);
    expect(payload.byCategory.test).toBe(1);
  });

  it('turns a corpus measurement into the published payload', () => {
    const payload = collectMeasurement(fakeEngine, fakeCorpus);
    expect(payload.corpus).toBe('fake-corpus');
    expect(payload.failures).toBe(2);
    expect(payload.groupingAccuracy).toBe(1);
    expect(payload.falseFlakyRate).toBe(0);
    expect(payload.categoryAccuracy).toBe(1);
    expect(payload.breaches).toEqual([]);
  });

  it('reports a grouping below the threshold', () => {
    // The two failures of the same labelled group get two different
    // signatures: the grouping accuracy drops to 50 %, under the 90 % target.
    let calls = 0;
    const engine = { ...fakeEngine, signatureOf: () => `sig-${(calls += 1)}` };
    const payload = collectMeasurement(engine, fakeCorpus);
    expect(payload.groupingAccuracy).toBe(0.5);
    expect(payload.breaches).toContain('regroupement sous le seuil');
    expect(findProblems({ measurement: payload, tests: { total: 1, passed: 1, failed: 0 } })).toHaveLength(1);
  });

  it('normalises the JSON report of Vitest', () => {
    const summary = summarizeVitest({
      numTotalTests: 10,
      numPassedTests: 9,
      numFailedTests: 1,
      numPendingTests: 0,
      numTotalTestSuites: 3,
      testResults: [
        { startTime: 1000, endTime: 1500 },
        { startTime: 1100, endTime: 2000 },
      ],
    });
    expect(summary).toEqual({
      total: 10,
      passed: 9,
      failed: 1,
      pending: 0,
      files: 2,
      suites: 3,
      durationMs: 1000,
    });
  });

  it('describes every integrity check of the repository', async () => {
    const payload = await collectChecks();
    const ids = payload.checks.map((check) => check.id).sort();
    expect(ids).toEqual(['manifests', 'sbom', 'site-bundle']);
    for (const check of payload.checks) {
      expect(typeof check.ok).toBe('boolean');
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('nightly report command line', () => {
  it('parses the flags it is given', () => {
    expect(parseArgs(['--out-dir', '/tmp/x', '--verbose'])).toEqual({ 'out-dir': '/tmp/x', verbose: true });
    expect(parseArgs(['--inputs', '/tmp/in', '--out', '/tmp/report.md'])).toEqual({
      inputs: '/tmp/in',
      out: '/tmp/report.md',
    });
  });
});
