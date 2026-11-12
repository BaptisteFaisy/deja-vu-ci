/**
 * Golden memory snapshot (`data/golden/`) — the drift guard of CI-11.
 *
 * The sample dataset is replayed through the **real** engine (the same
 * `replay()` the CLI tool and the "Replay sample game" button use), and the
 * whole snapshot is compared with the committed files: signatures, diagnostic
 * spread, ticket plan and the four cost counters. The slightest drift — one
 * identifier, one status, one occurrence count, one diagnostic — fails here.
 *
 * The snapshot is built by the shared generator (`tools/lib/golden.mjs`), so
 * this test and `tools/gen/golden.mjs` cannot disagree on the shape. When the
 * change is intended, regenerate: `npm run build && node tools/gen/golden.mjs`
 * (see `docs/GOLDEN.md`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeCost } from '../src/cost.js';
import { replay } from '../src/replay.js';
import type { ReplayResult, SampleDataset } from '../src/types.js';
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
} from '../../../tools/lib/golden.mjs';

const root = new URL('../../../', import.meta.url);
const goldenDir = new URL(`${GOLDEN_DIR}/`, root);
const datasetBytes = readFileSync(new URL('data/sample/occurrences.json', root));
const dataset = JSON.parse(datasetBytes.toString('utf8')) as SampleDataset;

/** Replay the sample set with the real engine, at the dataset's own instant. */
async function replaySample(): Promise<ReplayResult> {
  return replay(dataset, { now: new Date(referenceNow(dataset)) });
}

/** Fresh snapshot, built exactly like the generator builds it. */
async function freshSnapshot(): Promise<Record<string, unknown>> {
  const result = await replaySample();
  const cost = computeCost(
    result.diagnostics.map((entry) => entry.occurrence),
    { now: new Date(referenceNow(dataset)), signatures: result.signatures },
  );
  return buildGoldenSnapshot({ dataset, datasetSha256: sha256Hex(datasetBytes), result, cost });
}

/** Committed text of one snapshot file. */
function committedText(file: string): string {
  return readFileSync(new URL(file, goldenDir), 'utf8');
}

/** One replay, shared by the tests (the snapshot must not depend on the run). */
const snapshot = await freshSnapshot();
const freshTexts = new Map(GOLDEN_FILES.map((file) => [file, serialize(snapshot[file])]));

/** Failure message: what moved, and the command that regenerates it. */
function driftHint(file: string): string {
  const committed = JSON.parse(committedText(file)) as unknown;
  const drift = describeDrift({ [file]: committed }, { [file]: snapshot[file] }) as string[];
  return [
    `golden memory drift in ${GOLDEN_DIR}/${file}:`,
    ...(drift.length > 0 ? drift.map((line) => `  - ${line}`) : ['  - (serialization differs)']),
    `intended change? regenerate with: ${REGEN_COMMAND}`,
    'otherwise this is a regression of the memory engine — see docs/GOLDEN.md.',
  ].join('\n');
}

describe('golden memory snapshot (data/golden/)', () => {
  it('matches a fresh replay of the sample dataset through the real engine', () => {
    for (const file of GOLDEN_FILES) {
      expect(freshTexts.get(file), driftHint(file)).toBe(committedText(file));
    }
  });

  it('holds exactly the five generated files, nothing stale', () => {
    expect(readdirSync(fileURLToPath(goldenDir)).sort()).toEqual([...GOLDEN_FILES].sort());
  });

  it('is deterministic: a second replay gives the same bytes', async () => {
    const second = await freshSnapshot();
    for (const file of GOLDEN_FILES) {
      expect(serialize(second[file]), `${file} is not byte-stable across runs`).toBe(
        freshTexts.get(file),
      );
    }
  });

  it('holds no raw log excerpt (metadata only)', () => {
    const leaked = findRawLogLeaks(dataset, GOLDEN_FILES.map((file) => freshTexts.get(file))) as string[];
    expect(leaked, `raw log lines leaked into the snapshot: ${leaked.join(' | ')}`).toEqual([]);
  });

  it('covers the whole memory of the sample game (recipe of § 20)', () => {
    const meta = snapshot['meta.json'] as Record<string, number>;
    expect(meta.failures).toBeGreaterThan(0);
    expect(meta.signatures).toBeGreaterThan(0);
    const byKind = (snapshot['diagnostics.json'] as { byKind: Record<string, number> }).byKind;
    for (const kind of ['flaky', 'already-fixed', 'new', 'infrastructure']) {
      expect(byKind[kind], `the sample game must produce a "${kind}" diagnostic`).toBeGreaterThan(0);
    }
    const plan = snapshot['tickets.json'] as Array<{ kind: string }>;
    expect(plan.filter((action) => action.kind === 'create')).toHaveLength(1);
  });
});
