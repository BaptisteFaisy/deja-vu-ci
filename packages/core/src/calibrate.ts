/**
 * Threshold calibration (proposal only — nothing is ever applied).
 *
 * The four thresholds of § 10 and § 18 (`flakyMinOccurrences`,
 * `flakyMinBranches`, `flakyWindowDays`, `minConfidenceNotYourFault`) decide
 * what the app dares to say. They are guesses until the data contradicts them:
 * too high and every real flakiness stays "uncertain", too low and every
 * genuine defect is excused as "retry".
 *
 * This module measures the effect of each threshold on the observed history and
 * proposes a value, with the number of diagnostics that would change. It never
 * writes anything — same spirit as `quarantine.ts`: the operator decides.
 *
 * The evidence used is the one the occurrences carry: a signature that failed
 * **and then passed at the very same commit** is genuinely unstable; one that
 * never passed again is a real defect. The calibration looks for the threshold
 * values that classify the history accordingly, and prefers the candidate
 * closest to today's setting when several fit equally well.
 */

import { diagnose, type DiagnoseInput } from './diagnose.js';
import { resolveSettings } from './flaky.js';
import type { DiagnosticKind, Occurrence, Settings } from './types.js';

/** The thresholds this module calibrates. */
export type ThresholdKey =
  | 'flakyMinOccurrences'
  | 'flakyMinBranches'
  | 'flakyWindowDays'
  | 'minConfidenceNotYourFault';

/** One proposed value, with the measured effect. */
export interface ThresholdSuggestion {
  key: ThresholdKey;
  /** Value in use today. */
  current: number;
  /** Value this module proposes. */
  proposed: number;
  /** Occurrences whose diagnostic would change kind. */
  changes: number;
  /** Occurrences that would become "flaky". */
  gained: number;
  /** Occurrences that would stop being "flaky". */
  lost: number;
  /** Why this value is proposed, in one sentence. */
  reason: string;
}

/** The whole calibration: one suggestion per threshold. */
export interface ThresholdCalibration {
  suggestions: ThresholdSuggestion[];
  /** Occurrences the measurement is based on. */
  sampleSize: number;
  /** Diagnostics that are "flaky" under the current settings. */
  flakyDiagnostics: number;
}

/** Options of the measurement. */
export interface CalibrationOptions {
  /** Reference instant of the sliding windows (defaults to the latest failure). */
  now?: Date;
}

/** Ladders of plausible values for the thresholds that have no natural units. */
const WINDOW_LADDER = [1, 3, 7, 14, 21, 30, 60, 90];
const CONFIDENCE_LADDER = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

/** The four thresholds, in the order the report lists them. */
const THRESHOLDS: ThresholdKey[] = [
  'flakyMinOccurrences',
  'flakyMinBranches',
  'flakyWindowDays',
  'minConfidenceNotYourFault',
];

/** Diagnostic context of one occurrence, rebuilt from the history itself. */
function contextFor(occ: Occurrence, all: Occurrence[]): DiagnoseInput {
  const before = all.filter((o) => o.occurredAt <= occ.occurredAt && o.id !== occ.id);
  return {
    occurrence: occ,
    history: before.filter((o) => o.signatureId === occ.signatureId),
    familyHistory: before.filter((o) => o.familyId === occ.familyId),
    branchContainsResolution: true,
    changedFiles: occ.changedFiles,
    category: 'test',
  };
}

/** Diagnostic kind of every occurrence under one set of settings. */
function kindsUnder(
  occurrences: Occurrence[],
  settings: Settings,
  now: Date,
): Map<string, DiagnosticKind> {
  const kinds = new Map<string, DiagnosticKind>();
  for (const occ of occurrences) {
    const diagnostic = diagnose({ ...contextFor(occ, occurrences), settings, now });
    kinds.set(occ.id, diagnostic.kind);
  }
  return kinds;
}

/** Signatures that really are unstable: they passed again at the same commit. */
function unstableSignatures(occurrences: Occurrence[]): Set<string> {
  const unstable = new Set<string>();
  for (const occ of occurrences) {
    if (occ.passedOnRetry) unstable.add(occ.signatureId);
  }
  return unstable;
}

/** Signature of each occurrence, by occurrence id. */
function signatureOfEach(occurrences: Occurrence[]): Map<string, string> {
  return new Map(occurrences.map((o) => [o.id, o.signatureId]));
}

/**
 * Score of a set of diagnostics: one point per genuine flakiness recognized,
 * minus one per real defect wrongly excused.
 */
function scoreOf(
  kinds: Map<string, DiagnosticKind>,
  signatures: Map<string, string>,
  unstable: Set<string>,
): number {
  let score = 0;
  for (const [occId, kind] of kinds) {
    if (kind !== 'flaky') continue;
    score += unstable.has(signatures.get(occId) ?? '') ? 1 : -1;
  }
  return score;
}

/** Occurrence counts and branch counts per signature. */
function signatureCounts(occurrences: Occurrence[]): { counts: number[]; branches: number[] } {
  const bySignature = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const list = bySignature.get(occ.signatureId);
    if (list) list.push(occ);
    else bySignature.set(occ.signatureId, [occ]);
  }
  const counts: number[] = [];
  const branches: number[] = [];
  for (const list of bySignature.values()) {
    counts.push(list.length);
    branches.push(new Set(list.map((o) => o.branch)).size);
  }
  return { counts, branches };
}

/** Sorted unique numbers, always containing the current value. */
function candidates(values: number[], current: number, floor: number, round = true): number[] {
  const unique = new Set<number>([current]);
  for (const value of values) {
    if (!Number.isFinite(value) || value < floor) continue;
    unique.add(round ? Math.round(value) : value);
  }
  return [...unique].sort((a, b) => a - b);
}

/** Candidate values for one threshold. */
function candidateValues(key: ThresholdKey, occurrences: Occurrence[], current: number): number[] {
  const { counts, branches } = signatureCounts(occurrences);
  if (key === 'flakyMinOccurrences') return candidates(counts, current, 1);
  if (key === 'flakyMinBranches') return candidates(branches, current, 1);
  if (key === 'flakyWindowDays') return candidates(WINDOW_LADDER, current, 1);
  // A confidence is a ratio: never round it, 0.8 and 1 are different thresholds.
  return candidates(CONFIDENCE_LADDER, current, 0, false);
}

/** Apply one candidate value to the settings. */
function withCandidate(settings: Settings, key: ThresholdKey, value: number): Settings {
  return { ...settings, [key]: value };
}

/** How many diagnostics change kind between two runs. */
function difference(
  baseline: Map<string, DiagnosticKind>,
  candidate: Map<string, DiagnosticKind>,
): { changes: number; gained: number; lost: number } {
  let changes = 0;
  let gained = 0;
  let lost = 0;
  for (const [occId, kind] of candidate) {
    const before = baseline.get(occId);
    if (before === kind) continue;
    changes += 1;
    if (kind === 'flaky') gained += 1;
    if (before === 'flaky') lost += 1;
  }
  return { changes, gained, lost };
}

/** Outcome of one candidate measurement. */
interface Measurement {
  value: number;
  score: number;
  changes: number;
  gained: number;
  lost: number;
}

/** Measure one candidate value against the baseline. */
function measure(
  value: number,
  key: ThresholdKey,
  occurrences: Occurrence[],
  settings: Settings,
  now: Date,
  baseline: Map<string, DiagnosticKind>,
  signatures: Map<string, string>,
  unstable: Set<string>,
): Measurement {
  const candidate = kindsUnder(occurrences, withCandidate(settings, key, value), now);
  const diff = difference(baseline, candidate);
  return { value, score: scoreOf(candidate, signatures, unstable), ...diff };
}

/**
 * Best candidate for one threshold: the one that recognizes the most genuine
 * flakiness without excusing real defects; ties go to the value closest to the
 * current setting, then to the one that changes the fewest diagnostics.
 */
function bestMeasurement(measurements: Measurement[], current: number): Measurement {
  return measurements.reduce((best, m) => {
    if (m.score !== best.score) return m.score > best.score ? m : best;
    const distance = Math.abs(m.value - current);
    const bestDistance = Math.abs(best.value - current);
    if (distance !== bestDistance) return distance < bestDistance ? m : best;
    return m.changes < best.changes ? m : best;
  });
}

/** One sentence explaining the proposal. */
function reasonFor(key: ThresholdKey, current: number, best: Measurement): string {
  if (best.value === current) {
    return `${key} = ${current} already fits the observed history (${best.changes} diagnostic change(s)).`;
  }
  const direction = best.value > current ? 'raise' : 'lower';
  return (
    `${direction} ${key} from ${current} to ${best.value}: ` +
    `${best.gained} diagnostic(s) become flaky, ${best.lost} stop being flaky ` +
    `(${best.changes} change(s) in total).`
  );
}

/** Calibrate one threshold and describe the proposal. */
function suggestOne(
  key: ThresholdKey,
  occurrences: Occurrence[],
  settings: Settings,
  now: Date,
  baseline: Map<string, DiagnosticKind>,
  signatures: Map<string, string>,
  unstable: Set<string>,
): ThresholdSuggestion {
  const current = settings[key];
  const measurements = candidateValues(key, occurrences, current).map((value) =>
    measure(value, key, occurrences, settings, now, baseline, signatures, unstable),
  );
  const best = bestMeasurement(measurements, current);
  return {
    key,
    current,
    proposed: best.value,
    changes: best.changes,
    gained: best.gained,
    lost: best.lost,
    reason: reasonFor(key, current, best),
  };
}

/**
 * Measure the effect of the four thresholds on the given history and propose
 * values.
 *
 * Nothing is applied: the result is a set of proposals with their measured
 * effect, for the operator to accept or refuse.
 */
export function suggestThresholds(
  occurrences: Occurrence[],
  current?: Partial<Settings>,
  opts?: CalibrationOptions,
): ThresholdCalibration {
  const settings = resolveSettings(current);
  const now = opts?.now ?? latestInstant(occurrences);
  const baseline = kindsUnder(occurrences, settings, now);
  const signatures = signatureOfEach(occurrences);
  const unstable = unstableSignatures(occurrences);

  const suggestions = THRESHOLDS.map((key) =>
    suggestOne(key, occurrences, settings, now, baseline, signatures, unstable),
  );

  return {
    suggestions,
    sampleSize: occurrences.length,
    flakyDiagnostics: [...baseline.values()].filter((kind) => kind === 'flaky').length,
  };
}

/** Latest instant among the occurrences, used as the window reference. */
function latestInstant(occurrences: Occurrence[]): Date {
  const times = occurrences.map((o) => Date.parse(o.occurredAt)).filter((t) => Number.isFinite(t));
  return new Date(times.length > 0 ? Math.max(...times) : Date.now());
}
