#!/usr/bin/env node
// Regenerates the golden memory snapshot (`data/golden/`, CI-11 guard).
//
// The sample dataset (`data/sample/occurrences.json`) is replayed through the
// **real compiled engine** (`packages/core/dist`, built from the same sources
// the vitest test uses), then reduced to metadata: signatures, diagnostic
// spread, ticket plan and the four cost counters. No raw log excerpt enters
// the snapshot (`findRawLogLeaks` rejects the generation if one does).
//
// Usage:
//   npm run build                     # compile packages/core into dist/
//   node tools/gen/golden.mjs         # regenerate data/golden/*.json
//   node tools/gen/golden.mjs --check # compare without writing; exit 1 on drift
//
// Exit codes: 0 ok, 1 drift (or raw log leak), 2 engine not built / dataset
// unreadable. Never hand-edit the JSON files: they are generated, sorted and
// byte-stable (same replay = same bytes). See docs/GOLDEN.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { coreDist, loadEngine, missingEntryPoints, repoRoot } from '../lib/engine.mjs';
import {
  GOLDEN_DIR,
  GOLDEN_FILES,
  REGEN_COMMAND,
  buildGoldenSnapshot,
  describeDrift,
  findRawLogLeaks,
  referenceNow,
  serialize,
  sha256Hex,
} from '../lib/golden.mjs';

const DATASET = path.join(repoRoot, 'data', 'sample', 'occurrences.json');
const OUT_DIR = path.join(repoRoot, ...GOLDEN_DIR.split('/'));
const CHECK = process.argv.includes('--check');

/** Read the sample dataset, or exit like `tools/replay.mjs` does. */
function readDataset() {
  try {
    return { bytes: readFileSync(DATASET), dataset: JSON.parse(readFileSync(DATASET, 'utf8')) };
  } catch (error) {
    console.error(`sample dataset unreadable (${DATASET}): ${error.message}`);
    console.error('regenerate it: node tools/gen/sample.mjs');
    process.exit(2);
  }
}

/** Load the compiled engine and check the entry points this tool needs. */
async function readyEngine() {
  const engine = await loadEngine();
  const missing = missingEntryPoints(engine);
  if (missing.length > 0 || typeof engine.barrel.computeCost !== 'function') {
    console.error(`engine incomplete in ${coreDist}: rebuild it first (npm run build)`);
    process.exit(2);
  }
  return engine;
}

/** Replay the dataset and compute the cost report at the reference instant. */
async function replayAndCost(engine, dataset) {
  const now = new Date(referenceNow(dataset));
  const result = await engine.replay(dataset, { now });
  const occurrences = result.diagnostics.map((entry) => entry.occurrence);
  const cost = engine.barrel.computeCost(occurrences, {
    now,
    signatures: result.signatures,
  });
  return { result, cost };
}

/** Fail (exit 1) when a raw log line leaked into the serialized snapshot. */
function guardLeaks(dataset, texts) {
  const leaked = findRawLogLeaks(dataset, texts);
  if (leaked.length > 0) {
    console.error(`raw log excerpt(s) in the snapshot — refusing to write:`);
    for (const line of leaked) console.error(`  - ${line.slice(0, 80)}`);
    process.exit(1);
  }
}

/** Compare the fresh snapshot with the committed files; report every drift. */
function check(snapshot) {
  const problems = [];
  for (const file of GOLDEN_FILES) {
    const target = path.join(OUT_DIR, file);
    let committed;
    try {
      committed = readFileSync(target, 'utf8');
    } catch {
      problems.push(`${file}: missing (run: ${REGEN_COMMAND})`);
      continue;
    }
    if (committed !== serialize(snapshot[file])) {
      const drift = describeDrift({ [file]: JSON.parse(committed) }, { [file]: snapshot[file] });
      problems.push(`${file}: drift\n    ${drift.join('\n    ') || '(serialization differs)'}`);
    }
  }
  if (problems.length > 0) {
    console.error(`GOLDEN DRIFT (${problems.length} file(s)):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`\nIf the change is intended, regenerate: ${REGEN_COMMAND}`);
    console.error('Otherwise this is a regression of the memory engine.');
    process.exit(1);
  }
  console.log(`golden snapshot up to date (${GOLDEN_FILES.length} files in ${GOLDEN_DIR}/).`);
}

/** Write the snapshot files (never by hand: they are generated). */
function write(snapshot) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of GOLDEN_FILES) writeFileSync(path.join(OUT_DIR, file), serialize(snapshot[file]));
  console.log(`golden snapshot written to ${GOLDEN_DIR}/ (${GOLDEN_FILES.length} files).`);
}

const { bytes, dataset } = readDataset();
const engine = await readyEngine();
const { result, cost } = await replayAndCost(engine, dataset);
const snapshot = buildGoldenSnapshot({ dataset, datasetSha256: sha256Hex(bytes), result, cost });
guardLeaks(dataset, GOLDEN_FILES.map((file) => serialize(snapshot[file])));

if (CHECK) check(snapshot);
else write(snapshot);

const counters = snapshot['cost.json'];
console.log(
  `${result.occurrences} failures, ${result.signatures.length} signatures, ` +
    `${result.tickets.length} ticket actions; cost: ` +
    `${counters.redBuilds} red builds, ${counters.ciMinutesLost} CI minutes lost, ` +
    `${counters.peopleAffected} people affected, ${counters.retries} retries.`,
);
