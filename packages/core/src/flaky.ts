/**
 * Flakiness assessment (§ 10.1).
 *
 * A test signature becomes flaky when, over a sliding window of
 * `flakyWindowDays` days, it failed at least `flakyMinOccurrences` times on at
 * least `flakyMinBranches` distinct branches, AND at least once the very same
 * step passed at the very same commit after having failed.
 *
 * The last condition is what keeps a genuinely broken test on `main` out of
 * the flaky bucket: many occurrences, but never a success at the same commit.
 *
 * `flakyIndex` is a ranking hint only (0..1): the share of failures that came
 * without any relevant change.
 */

import { DEFAULT_SETTINGS } from './types.js';
import type { FlakyVerdict, Occurrence, Settings, TestStats } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FlakyOptions {
  settings?: Partial<Settings>;
  now?: Date;
}

/** Merge the caller settings over the defaults. */
export function resolveSettings(settings?: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

/** True when the occurrence happened inside the window that ends at `now`. */
export function inWindow(occurrence: Occurrence, sinceMs: number): boolean {
  const at = Date.parse(occurrence.occurredAt);
  return Number.isFinite(at) && at >= sinceMs;
}

/** Keep the occurrences that happened inside the sliding window. */
export function windowOccurrences(
  occs: Occurrence[],
  days: number,
  now: Date,
): { kept: Occurrence[]; dropped: number } {
  const since = now.getTime() - days * DAY_MS;
  const kept = occs.filter((occ) => inWindow(occ, since));
  return { kept, dropped: occs.length - kept.length };
}

/**
 * Assess whether a set of occurrences (same signature, any branch) proves
 * flakiness.
 *
 * `occs` is expected to hold occurrences of one signature; the caller is
 * responsible for the grouping.
 */
export function assessFlakiness(occs: Occurrence[], opts?: FlakyOptions): FlakyVerdict {
  const settings = resolveSettings(opts?.settings);
  const now = opts?.now ?? new Date();
  const { kept, dropped } = windowOccurrences(occs, settings.flakyWindowDays, now);

  const branches = new Set(kept.map((occ) => occ.branch));
  const sameCommitPass = kept.some((occ) => occ.passedOnRetry);
  const occurrencesOk = kept.length >= settings.flakyMinOccurrences;
  const branchesOk = branches.size >= settings.flakyMinBranches;

  const reasons: string[] = [
    `${kept.length} occurrence(s) on ${branches.size} branch(es) in the last ${settings.flakyWindowDays} days ` +
      `(threshold: ${settings.flakyMinOccurrences} on ${settings.flakyMinBranches}): ${occurrencesOk && branchesOk ? 'met' : 'not met'}`,
    `passed at the same commit after a failure (threshold: at least 1): ${sameCommitPass ? 'yes' : 'no'}`,
  ];
  if (dropped > 0) {
    reasons.push(`${dropped} occurrence(s) ignored: older than ${settings.flakyWindowDays} days`);
  }

  return {
    flaky: occurrencesOk && branchesOk && sameCommitPass,
    reasons,
    occurrences: kept.length,
    branches: branches.size,
    sameCommitPass,
    flakyIndex: flakyIndex(kept),
  };
}

/**
 * Share (0..1) of failures that happened without any relevant change.
 *
 * A failure counts as "no relevant change" when its commit already failed on
 * another branch, or when the step passed at that very same commit.
 */
export function flakyIndex(occs: Occurrence[]): number {
  if (occs.length === 0) return 0;

  const branchesByCommit = new Map<string, Set<string>>();
  for (const occ of occs) {
    const seen = branchesByCommit.get(occ.commit) ?? new Set<string>();
    seen.add(occ.branch);
    branchesByCommit.set(occ.commit, seen);
  }

  let withoutChange = 0;
  for (const occ of occs) {
    if (occ.passedOnRetry) {
      withoutChange += 1;
      continue;
    }
    const others = [...(branchesByCommit.get(occ.commit) ?? [])].filter((b) => b !== occ.branch);
    if (others.length > 0) withoutChange += 1;
  }

  return round4(withoutChange / occs.length);
}

/**
 * Per-test statistics (rows of the `test_stats` table).
 *
 * `runsFailed` counts the failed runs observed for that test, and
 * `runsPassedSameCommit` counts those failures that were followed by a success
 * at the very same commit.
 */
export function testStats(occs: Occurrence[], testName: string): TestStats {
  const matching = occs.filter((occ) => occ.testName === testName);
  const branches = new Set(matching.map((occ) => occ.branch));
  const runsPassedSameCommit = matching.filter((occ) => occ.passedOnRetry).length;
  const updatedAt = matching.reduce<string>(
    (latest, occ) => (occ.occurredAt > latest ? occ.occurredAt : latest),
    '',
  );

  return {
    repo: matching[0]?.repo ?? '',
    testName,
    runsFailed: matching.length,
    runsPassedSameCommit,
    branches: branches.size,
    flakyIndex: flakyIndex(matching),
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
