/**
 * Threshold calibration: a proposal, never an action.
 *
 * The measurement is one-at-a-time: each threshold is varied alone, the others
 * stay at their current value, so the reported effect belongs to that threshold
 * and to nothing else.
 */

import { describe, expect, it } from 'vitest';

import { suggestThresholds } from '../src/calibrate.js';
import type { Occurrence } from '../src/types.js';
import { makeOccurrence } from './fakes/lot-b-fixtures.js';

/** One signature with `count` occurrences spread over the given branches. */
function history(
  signatureId: string,
  count: number,
  branches: string[],
  passedOnRetryAt?: number,
): Occurrence[] {
  return Array.from({ length: count }, (_, index) =>
    makeOccurrence({
      id: `${signatureId}-${index}`,
      signatureId,
      familyId: `fam-${signatureId}`,
      repo: 'payments',
      branch: branches[index % branches.length],
      commit: `commit-${index}`,
      occurredAt: `2026-11-1${(index % 8) + 1}T10:00:00.000Z`,
      passedOnRetry: index === passedOnRetryAt,
    }),
  );
}

/** The suggestion of one threshold, by key. */
function suggestionOf(result: ReturnType<typeof suggestThresholds>, key: string) {
  const found = result.suggestions.find((s) => s.key === key);
  expect(found).toBeDefined();
  return found!;
}

describe('suggestThresholds', () => {
  it('proposes nothing on an empty history', () => {
    const result = suggestThresholds([]);

    expect(result.sampleSize).toBe(0);
    expect(result.flakyDiagnostics).toBe(0);
    for (const suggestion of result.suggestions) {
      expect(suggestion.proposed).toBe(suggestion.current);
      expect(suggestion.changes).toBe(0);
    }
  });

  it('proposes one suggestion per calibrated threshold', () => {
    const result = suggestThresholds(history('sig-a', 3, ['main', 'feature']));

    expect(result.suggestions.map((s) => s.key)).toEqual([
      'flakyMinOccurrences',
      'flakyMinBranches',
      'flakyWindowDays',
      'minConfidenceNotYourFault',
    ]);
  });

  it('lowers the occurrence threshold when a real flakiness is missed', () => {
    // Two occurrences, two branches, and a success at the same commit: the
    // signature is genuinely unstable, but the default threshold wants three.
    const occs = history('sig-a', 2, ['main', 'feature'], 1);

    const result = suggestThresholds(occs);
    const suggestion = suggestionOf(result, 'flakyMinOccurrences');

    expect(suggestion.current).toBe(3);
    expect(suggestion.proposed).toBe(2);
    expect(suggestion.gained).toBe(1);
    expect(suggestion.lost).toBe(0);
    expect(suggestion.changes).toBe(1);
    expect(suggestion.reason).toContain('flakyMinOccurrences');
  });

  it('keeps the thresholds that already fit the history', () => {
    const occs = history('sig-a', 4, ['main', 'feature'], 1);

    const result = suggestThresholds(occs);

    for (const suggestion of result.suggestions) {
      expect(suggestion.proposed).toBe(suggestion.current);
      expect(suggestion.changes).toBe(0);
    }
    expect(result.flakyDiagnostics).toBeGreaterThan(0);
  });

  it('lowers the confidence floor that silences every flaky verdict', () => {
    const occs = history('sig-a', 4, ['main', 'feature'], 1);

    const result = suggestThresholds(occs, { minConfidenceNotYourFault: 0.95 });
    const suggestion = suggestionOf(result, 'minConfidenceNotYourFault');

    expect(suggestion.current).toBe(0.95);
    expect(suggestion.proposed).toBeLessThan(0.95);
    expect(suggestion.gained).toBeGreaterThan(0);
    expect(suggestion.changes).toBe(suggestion.gained + suggestion.lost);
  });

  it('never excuses a genuine defect', () => {
    // Five occurrences, five branches, but never a success at the same commit.
    const occs = history('sig-b', 5, ['a', 'b', 'c', 'd', 'e']);

    const result = suggestThresholds(occs);

    expect(result.flakyDiagnostics).toBe(0);
    for (const suggestion of result.suggestions) {
      expect(suggestion.gained).toBe(0);
    }
  });

  it('never mutates the history it measures', () => {
    const occs = history('sig-a', 3, ['main', 'feature'], 1);
    const before = JSON.stringify(occs);

    suggestThresholds(occs);

    expect(JSON.stringify(occs)).toBe(before);
  });

  it('measures against the given reference instant', () => {
    const occs = history('sig-a', 2, ['main', 'feature'], 1);

    const result = suggestThresholds(occs, {}, { now: new Date('2026-11-30T00:00:00.000Z') });

    expect(result.sampleSize).toBe(2);
  });
});
