#!/usr/bin/env node
// Deterministic offline benchmark of the Déjà-vu CI engine (CI-05).
//
// Measures, on the sample dataset (40 failures) and on generated synthetic
// corpora (1 000 and 10 000 failures):
//   - ingestion of one failure (extraction + signature + diagnosis), p50/p95/max;
//   - a full replay of a dataset;
//   - one `search-failures` query (same sequence as the Jira action);
//   - one cost report (CI-14);
//   - approximate heap growth and store queries per operation.
//
// Deterministic inputs: fixed seed, fixed repetitions (5 per measurement, the
// first discarded as warm-up), no network, no clock-dependent data. Timings
// themselves obviously vary with the machine load — read docs/BENCHMARK.md.
//
// Like the other tools, the engine is loaded from `packages/core/dist`:
//   npm run build --silent && node tools/bench.mjs
// Flags:
//   --quick            small corpora, for the vitest suite (tools/bench.test.mjs)
//   --json             print the JSON report on stdout instead of the table
//   --json-out <file>  also write the JSON report to <file>
//
// Exit codes: 0 ok, 2 engine not built.

import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLog } from './lib/logs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Fixed seed of the synthetic corpora (deterministic generation). */
export const SEED = 42;
/** Repetitions per measurement, and how many are kept (first = warm-up). */
export const REPETITIONS = 5;
export const KEPT = REPETITIONS - 1;
/** Corpus sizes: full bench, and the reduced one used by the vitest suite. */
const FULL_SIZES = [1000, 10000];
const QUICK_SIZES = [150];
/** Log kinds used by the synthetic corpus (renderers of tools/lib/logs.mjs). */
const KINDS = ['junit', 'pytest', 'jest', 'go', 'gradle', 'npm', 'db', 'eslint', 'tsc', 'docker', 'unknown'];
/** First instant of the synthetic corpora. */
const DAY0 = Date.parse('2026-11-01T00:00:00Z');

// ---------------------------------------------------------------------------
// Synthetic corpus (deterministic, fixed seed)
// ---------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32) — same corpus on every run. */
export function mulberry32(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One synthetic failure, log rendered by the shared corpus renderers. */
function syntheticFailure(rnd, index) {
  const kind = KINDS[Math.floor(rnd() * KINDS.length)];
  const at = new Date(DAY0 + index * 60_000).toISOString();
  const commit = 'c' + index.toString(16).padStart(7, '0');
  return {
    at,
    repo: 'repo-' + (index % 7),
    branch: 'feature/f' + (index % 23),
    commit,
    author: 'dev-' + (index % 9),
    step: 'test',
    durationS: 60 + Math.floor(rnd() * 200),
    outcome: 'failure',
    log: buildLog({
      kind, ts: at,
      file: 'src/mod' + (index % 40) + '.ts',
      test: 'test_' + (index % 60),
      classname: 'com.acme.Cls' + (index % 30),
      message: 'expected ' + (index % 5) + ' to be ' + (index % 7),
      line: 10 + (index % 90),
      uuid: 'u-' + index,
      pkg: 'pkg-' + (index % 12),
      version: '1.' + (index % 4) + '.0',
      code: 'E404',
      url: 'https://registry.npmjs.org/pkg-' + (index % 12),
      image: 'img:' + (index % 8),
      reason: 'manifest unknown',
      seconds: 300,
    }),
  };
}

/**
 * A synthetic `SampleDataset` of `n` failures (plus ~10 % same-commit
 * successes, so a replay also walks its success/refine path).
 */
export function syntheticCorpus(n, seed = SEED) {
  const rnd = mulberry32(seed);
  const occurrences = [];
  for (let index = 0; index < n; index += 1) {
    const failure = syntheticFailure(rnd, index);
    occurrences.push(failure);
    if (index % 10 === 3) {
      occurrences.push({
        at: new Date(DAY0 + index * 60_000 + 30_000).toISOString(),
        repo: failure.repo, branch: failure.branch, commit: failure.commit,
        author: failure.author, step: failure.step, durationS: 90,
        outcome: 'success',
      });
    }
  }
  return {
    name: `synth-${n}`,
    description: `Synthetic corpus of ${n} failures (seed ${seed}).`,
    repository: 'repo-0',
    days: Math.ceil((n * 60_000) / 86_400_000) + 1,
    occurrences,
  };
}

/** The tracked sample dataset (40 failures). */
export function sampleDataset() {
  return JSON.parse(readFileSync(path.join(repoRoot, 'data', 'sample', 'occurrences.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// Instrumentation helpers
// ---------------------------------------------------------------------------

/** Wrap a `Store` and count every method call (queries per operation). */
export function countingStore(store) {
  const counts = new Map();
  const wrapper = {
    counts,
    total: () => [...counts.values()].reduce((a, b) => a + b, 0),
    reset: () => counts.clear(),
  };
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(store))) {
    if (key === 'constructor' || typeof store[key] !== 'function') continue;
    wrapper[key] = async (...args) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return store[key](...args);
    };
  }
  return wrapper;
}

/** Best-effort heap snapshot in MiB (forces a GC when node was started with --expose-gc). */
export function heapUsedMb() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return process.memoryUsage().heapUsed / 1048576;
}

/** Nearest-rank percentile of a sorted-able list of numbers. */
function percentile(sorted, p) {
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/** p50/p95/max/mean of a list of durations (ms), rounded to 3 decimals. */
export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (x) => Math.round(x * 1000) / 1000;
  return {
    samples: sorted.length,
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    maxMs: round(sorted[sorted.length - 1]),
    meanMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

// ---------------------------------------------------------------------------
// Measured operations
// ---------------------------------------------------------------------------

/** Signature upsert of one block (same bookkeeping as the replay, untimed). */
async function upsertSignature(bundle, store, block, at) {
  const signatureId = bundle.signatureOf(block);
  const familyId = bundle.familyOf(block);
  const existing = await store.getSignature(signatureId);
  const resolution = await store.getResolution(signatureId);
  const status = bundle.statusAfterOccurrence(existing?.status, resolution, false);
  const signature = existing
    ? { ...existing, occurrences: existing.occurrences + 1, lastSeen: existing.lastSeen < at ? at : existing.lastSeen, status }
    : {
        id: signatureId, familyId, category: block.category, errorType: block.errorType,
        template: block.message, frames: block.frames, status,
        firstSeen: at, lastSeen: at, occurrences: 1, testName: block.testName,
      };
  await store.saveSignature(signature);
  return signature;
}

/**
 * Ingest one failure: extraction + signature + diagnosis, timed.
 *
 * The store calls (memory here, Forge SQL in production) are deliberately
 * **not** part of the measured time: they are counted instead, and the two
 * numbers are reported side by side.
 */
async function ingestFailure(bundle, store, sample) {
  let ms = 0;
  let t = performance.now();
  const blocks = bundle.extractBlocks(sample, { extractErrorBlocks: bundle.extractErrorBlocks });
  ms += performance.now() - t;
  for (const [index, block] of blocks.entries()) {
    t = performance.now();
    const signatureId = bundle.signatureOf(block);
    ms += performance.now() - t;
    const signature = await upsertSignature(bundle, store, block, sample.at);
    const occurrence = bundle.buildOccurrence(sample, index, signature, block);
    await store.saveOccurrence(occurrence);
    const history = await bundle.priorOccurrences(store, occurrence);
    const familyAll = await store.listFamilyOccurrences(occurrence.familyId);
    const familyHistory = familyAll.filter((o) => o.id !== occurrence.id && o.occurredAt <= occurrence.occurredAt);
    const resolution = await store.getResolution(signatureId);
    t = performance.now();
    bundle.diagnose({
      occurrence, history, familyHistory, resolution,
      branchContainsResolution: false,
      changedFiles: sample.changedFiles,
      settings: bundle.DEFAULT_SETTINGS,
      now: new Date(sample.at),
      category: signature.category, frames: signature.frames, signature,
    });
    ms += performance.now() - t;
  }
  return ms;
}

/** Fill a fresh store with a whole dataset (untimed preparation). */
async function buildStore(bundle, dataset) {
  const store = countingStore(new bundle.MemoryStore());
  for (const sample of dataset.occurrences) {
    if (sample.outcome === 'failure') await ingestFailure(bundle, store, sample);
  }
  return store;
}

/** Ingestion of every failure of a dataset, `REPETITIONS` times. */
export async function measureIngest(bundle, dataset) {
  const failures = dataset.occurrences.filter((s) => s.outcome === 'failure');
  const heapBefore = heapUsedMb();
  const perRep = [];
  let queries = 0;
  for (let rep = 0; rep < REPETITIONS; rep += 1) {
    const store = countingStore(new bundle.MemoryStore());
    const samples = [];
    for (const sample of failures) samples.push(await ingestFailure(bundle, store, sample));
    queries = store.total();
    if (rep > 0) perRep.push(...samples); // first repetition = warm-up
  }
  return { phase: 'ingest', perRep, queries, ops: failures.length, heapBefore, heapAfter: heapUsedMb() };
}

/** Full replay of a dataset, `REPETITIONS` times. */
export async function measureReplay(bundle, dataset) {
  const heapBefore = heapUsedMb();
  const perRep = [];
  let queries = 0;
  let diagnostics = 0;
  for (let rep = 0; rep < REPETITIONS; rep += 1) {
    const store = countingStore(new bundle.MemoryStore());
    const t = performance.now();
    const result = await bundle.replayWithEngine(dataset, bundle.staticReplayEngine(), { store });
    const ms = performance.now() - t;
    queries = store.total();
    diagnostics = result.diagnostics.length;
    if (rep > 0) perRep.push(ms);
  }
  return { phase: 'replay', perRep, queries, ops: 1, heapBefore, heapAfter: heapUsedMb(), diagnostics };
}

/**
 * One `search-failures` query: same sequence as the Jira action
 * (`apps/brain/src/actions/search-failures.ts`), with the app's own
 * similarity module — extract + sign the text, list every signature and its
 * occurrences, then score exact/family/near matches.
 */
export async function searchFailures(bundle, store, text) {
  const block = bundle.extractErrorBlocks({ stepLog: text }).blocks[0];
  if (!block) return { matches: 0, examined: 0 };
  const keys = bundle.signatureKeys(block);
  const signatures = await store.listSignatures();
  await Promise.all(signatures.map((s) => store.listOccurrences(s.id)));
  const matches = [];
  for (const signature of signatures) {
    const kind = signature.id === keys.signature ? 'exact' : signature.familyId === keys.family ? 'family' : undefined;
    if (kind) {
      matches.push({ id: signature.id, score: bundle.scoreMatch(kind, 0) });
      continue;
    }
    const similarity = bundle.messageSimilarity(block.message, signature.template);
    if (similarity >= 0.2) matches.push({ id: signature.id, score: bundle.scoreMatch('near', similarity) });
  }
  matches.sort((a, b) => b.score - a.score);
  return { matches: matches.length, examined: signatures.length };
}

/** Search over a prepared store: 5 fixed queries × `REPETITIONS`. */
export async function measureSearch(bundle, store, queries) {
  const heapBefore = heapUsedMb();
  const perRep = [];
  let count = 0;
  for (let rep = 0; rep < REPETITIONS; rep += 1) {
    store.reset();
    for (const text of queries) {
      const t = performance.now();
      await searchFailures(bundle, store, text);
      const ms = performance.now() - t;
      if (rep > 0) perRep.push(ms);
    }
    count = store.total();
  }
  return { phase: 'search', perRep, queries: count, ops: queries.length, heapBefore, heapAfter: heapUsedMb() };
}

/** One cost report (CI-14) over every occurrence of a prepared store. */
export async function measureCost(bundle, occurrences, signatures, now) {
  const heapBefore = heapUsedMb();
  const perRep = [];
  for (let rep = 0; rep < REPETITIONS; rep += 1) {
    const t = performance.now();
    bundle.computeCost(occurrences, { signatures, windowDays: 30, now });
    if (rep > 0) perRep.push(performance.now() - t);
  }
  return { phase: 'cost', perRep, queries: 0, ops: 1, heapBefore, heapAfter: heapUsedMb() };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

/** Turn a measurement into one report row. */
function toRow(metric, corpus, failures, measured, unitOps) {
  return {
    metric,
    corpus,
    failures,
    unit: 'ms',
    ...summarize(measured.perRep),
    storeQueries: measured.queries,
    storeQueriesPerOp: Math.round((measured.queries / unitOps) * 10) / 10,
    heapDeltaMb: Math.round((measured.heapAfter - measured.heapBefore) * 10) / 10,
  };
}

/** The 5 fixed search queries of a corpus (deterministic picks). */
function searchQueries(dataset) {
  const failures = dataset.occurrences.filter((s) => s.outcome === 'failure' && s.log);
  const n = failures.length;
  return [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => failures[Math.min(n - 1, Math.floor(n * f))].log);
}

/** Every occurrence/signature of a prepared store, for the cost report. */
async function drainStore(store) {
  const signatures = await store.listSignatures();
  const occurrences = [];
  for (const signature of signatures) occurrences.push(...(await store.listOccurrences(signature.id)));
  return { signatures, occurrences };
}

/**
 * Run the whole bench. `options.quick` selects the reduced corpora used by
 * the vitest suite; `options.sizes` overrides the synthetic corpus sizes.
 */
export async function runBench(bundle, options = {}) {
  const sizes = options.sizes ?? (options.quick ? QUICK_SIZES : FULL_SIZES);
  const corpora = [
    { name: 'sample-40', dataset: sampleDataset() },
    ...sizes.map((n) => ({ name: `synth-${n}`, dataset: syntheticCorpus(n) })),
  ];
  const phases = [];
  for (const { name, dataset } of corpora) {
    const failures = dataset.occurrences.filter((s) => s.outcome === 'failure').length;
    const ingest = await measureIngest(bundle, dataset);
    phases.push(toRow('ingest-failure', name, failures, ingest, ingest.ops));
    const replay = await measureReplay(bundle, dataset);
    phases.push(toRow('replay-full', name, failures, replay, 1));
    const store = await buildStore(bundle, dataset);
    const search = await measureSearch(bundle, store, searchQueries(dataset));
    phases.push(toRow('search-failures', name, failures, search, search.ops));
    const { signatures, occurrences } = await drainStore(store);
    const last = dataset.occurrences[dataset.occurrences.length - 1].at;
    const cost = await measureCost(bundle, occurrences, signatures, new Date(Date.parse(last) + 86_400_000));
    phases.push(toRow('cost-report', name, failures, cost, 1));
  }
  return {
    bench: 'deja-vu-ci/ci-05',
    generatedAt: new Date().toISOString(),
    mode: options.quick ? 'quick' : 'full',
    environment: {
      node: process.version,
      platform: `${os.platform()}/${os.arch()}`,
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model?.trim() ?? 'unknown',
      loadavg: os.loadavg().map((x) => Math.round(x * 10) / 10),
    },
    config: { seed: SEED, repetitions: REPETITIONS, kept: KEPT, corpora: corpora.map((c) => c.name) },
    phases,
    memoryMb: { heapUsed: Math.round(heapUsedMb() * 10) / 10, rss: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10 },
  };
}

/** The JSON report, exactly as printed by `--json`. */
export function toJson(report) {
  return JSON.stringify(report, null, 2);
}

/** Human-readable table of a report. */
export function renderTable(report) {
  const widths = [16, 12, 9, 10, 10, 10, 10, 12, 9];
  const row = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ');
  const lines = [
    `Déjà-vu CI bench (${report.mode}) — node ${report.environment.node}, ${report.environment.cpus} CPUs, load ${report.environment.loadavg.join('/')}`,
    `seed ${report.config.seed}, ${report.config.repetitions} repetitions (first discarded), p95 = nearest-rank over ${report.config.kept} kept runs`,
    '',
    row(['metric', 'corpus', 'failures', 'p50 ms', 'p95 ms', 'max ms', 'mean ms', 'queries/op', 'heap MB']),
  ];
  for (const p of report.phases) {
    lines.push(row([p.metric, p.corpus, p.failures, p.p50Ms, p.p95Ms, p.maxMs, p.meanMs, p.storeQueriesPerOp, p.heapDeltaMb]));
  }
  lines.push('', `heap at end: ${report.memoryMb.heapUsed} MiB, rss: ${report.memoryMb.rss} MiB`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Engine bundle loaded from packages/core/dist + the app's similarity module. */
async function loadBundle() {
  const dist = path.join(repoRoot, 'packages', 'core', 'dist');
  const core = await import(pathToFileURL(path.join(dist, 'index.js')).href).catch(() => undefined);
  const state = await import(pathToFileURL(path.join(dist, 'replay-state.js')).href).catch(() => undefined);
  if (!core || !state) {
    throw new Error('engine not built — run `npm run build` first (packages/core/dist is missing)');
  }
  const similarity = await import(pathToFileURL(path.join(repoRoot, 'apps', 'brain', 'src', 'actions', 'similarity.ts')).href);
  return { ...core, ...state, messageSimilarity: similarity.messageSimilarity, scoreMatch: similarity.scoreMatch };
}

/** Parse the CLI flags. */
function parseArgs(argv) {
  const options = { quick: false, json: false, jsonOut: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--quick') options.quick = true;
    else if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--json-out') options.jsonOut = argv[++i];
    else throw new Error(`unknown flag: ${argv[i]}`);
  }
  return options;
}

/** Entry point of `node tools/bench.mjs`. */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const bundle = await loadBundle();
  const report = await runBench(bundle, options);
  const json = toJson(report);
  if (options.jsonOut) writeFileSync(options.jsonOut, json + '\n', 'utf8');
  console.log(options.json ? json : renderTable(report));
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`bench failed: ${error.message}`);
    process.exit(2);
  });
}
