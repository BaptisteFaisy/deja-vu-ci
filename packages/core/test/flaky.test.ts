import { describe, expect, it } from 'vitest';

import { assessFlakiness, flakyIndex, testStats } from '../src/flaky.js';
import { makeOccurrence } from './fakes/lot-b-fixtures.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('assessFlakiness', () => {
  it('declares a test flaky after three branches failed then passed at the same commit', () => {
    const occs = [
      makeOccurrence({ id: 'o1', branch: 'feature/a', commit: 'aaa1111', passedOnRetry: true, occurredAt: '2026-11-08T09:00:00.000Z' }),
      makeOccurrence({ id: 'o2', branch: 'feature/b', commit: 'bbb2222', passedOnRetry: true, occurredAt: '2026-11-08T11:00:00.000Z' }),
      makeOccurrence({ id: 'o3', branch: 'feature/c', commit: 'ccc3333', passedOnRetry: true, occurredAt: '2026-11-09T08:00:00.000Z' }),
    ];

    const verdict = assessFlakiness(occs, { now: NOW });

    expect(verdict.flaky).toBe(true);
    expect(verdict.occurrences).toBe(3);
    expect(verdict.branches).toBe(3);
    expect(verdict.sameCommitPass).toBe(true);
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(2);
    expect(verdict.reasons.join(' ')).toContain('3 occurrence(s) on 3 branch(es)');
    expect(verdict.reasons.join(' ')).toContain('passed at the same commit after a failure');
  });

  it('never declares a test broken everywhere on main flaky', () => {
    const occs = Array.from({ length: 12 }, (_, index) =>
      makeOccurrence({
        id: `broken-${index}`,
        branch: 'main',
        commit: `dead${index}`,
        passedOnRetry: false,
        occurredAt: `2026-11-0${(index % 9) + 1}T10:00:00.000Z`,
      }),
    );

    const verdict = assessFlakiness(occs, { now: NOW });

    expect(verdict.flaky).toBe(false);
    expect(verdict.sameCommitPass).toBe(false);
    expect(verdict.occurrences).toBe(12);
  });

  it('ignores occurrences older than the sliding window', () => {
    const occs = [
      makeOccurrence({ id: 'old-1', branch: 'a', commit: 'old1', passedOnRetry: true, occurredAt: '2026-09-01T10:00:00.000Z' }),
      makeOccurrence({ id: 'old-2', branch: 'b', commit: 'old2', passedOnRetry: true, occurredAt: '2026-09-02T10:00:00.000Z' }),
      makeOccurrence({ id: 'old-3', branch: 'c', commit: 'old3', passedOnRetry: true, occurredAt: '2026-09-03T10:00:00.000Z' }),
    ];

    const verdict = assessFlakiness(occs, { now: NOW });

    expect(verdict.flaky).toBe(false);
    expect(verdict.occurrences).toBe(0);
    expect(verdict.reasons.join(' ')).toContain('older than 14 days');
  });

  it('needs both the occurrence count and the branch count', () => {
    const single = [
      makeOccurrence({ id: 's1', branch: 'main', commit: 'x1', passedOnRetry: true, occurredAt: '2026-11-09T10:00:00.000Z' }),
      makeOccurrence({ id: 's2', branch: 'main', commit: 'x2', passedOnRetry: true, occurredAt: '2026-11-09T11:00:00.000Z' }),
      makeOccurrence({ id: 's3', branch: 'main', commit: 'x3', passedOnRetry: true, occurredAt: '2026-11-09T12:00:00.000Z' }),
    ];

    const verdict = assessFlakiness(single, { now: NOW });

    expect(verdict.flaky).toBe(false);
    expect(verdict.branches).toBe(1);
  });

  it('honours custom settings', () => {
    const occs = [
      makeOccurrence({ id: 'c1', branch: 'a', commit: 'y1', passedOnRetry: true, occurredAt: '2026-11-09T10:00:00.000Z' }),
      makeOccurrence({ id: 'c2', branch: 'b', commit: 'y2', passedOnRetry: true, occurredAt: '2026-11-09T11:00:00.000Z' }),
    ];

    const verdict = assessFlakiness(occs, {
      now: NOW,
      settings: { flakyMinOccurrences: 2, flakyMinBranches: 2 },
    });

    expect(verdict.flaky).toBe(true);
  });
});

describe('flakyIndex', () => {
  it('counts failures without any relevant change', () => {
    const occs = [
      makeOccurrence({ id: 'i1', branch: 'a', commit: 'same', passedOnRetry: false, occurredAt: '2026-11-08T10:00:00.000Z' }),
      makeOccurrence({ id: 'i2', branch: 'b', commit: 'same', passedOnRetry: false, occurredAt: '2026-11-08T10:30:00.000Z' }),
      makeOccurrence({ id: 'i3', branch: 'c', commit: 'other', passedOnRetry: false, occurredAt: '2026-11-08T11:00:00.000Z' }),
    ];

    expect(flakyIndex(occs)).toBeCloseTo(2 / 3, 4);
  });

  it('counts a same-commit retry as a failure without relevant change', () => {
    const occs = [
      makeOccurrence({ id: 'i4', branch: 'a', commit: 'z', passedOnRetry: true, occurredAt: '2026-11-08T10:00:00.000Z' }),
    ];

    expect(flakyIndex(occs)).toBe(1);
  });

  it('is zero when there is no occurrence', () => {
    expect(flakyIndex([])).toBe(0);
  });
});

describe('testStats', () => {
  it('summarises one test across branches', () => {
    const occs = [
      makeOccurrence({ id: 't1', testName: 'CartTest.total', branch: 'main', commit: 'm1', passedOnRetry: false, occurredAt: '2026-11-08T10:00:00.000Z' }),
      makeOccurrence({ id: 't2', testName: 'CartTest.total', branch: 'feature/x', commit: 'm2', passedOnRetry: true, occurredAt: '2026-11-09T10:00:00.000Z' }),
      makeOccurrence({ id: 't3', testName: 'OtherTest', branch: 'feature/y', commit: 'm3', passedOnRetry: true, occurredAt: '2026-11-09T11:00:00.000Z' }),
    ];

    const stats = testStats(occs, 'CartTest.total');

    expect(stats.repo).toBe('payments');
    expect(stats.testName).toBe('CartTest.total');
    expect(stats.runsFailed).toBe(2);
    expect(stats.runsPassedSameCommit).toBe(1);
    expect(stats.branches).toBe(2);
    expect(stats.flakyIndex).toBeGreaterThan(0);
    expect(stats.updatedAt).toBe('2026-11-09T10:00:00.000Z');
  });

  it('returns an empty summary for an unknown test', () => {
    const stats = testStats([], 'Nope');

    expect(stats.runsFailed).toBe(0);
    expect(stats.branches).toBe(0);
    expect(stats.flakyIndex).toBe(0);
  });
});
