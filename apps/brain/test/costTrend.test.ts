/**
 * Tests of the daily cost trend (`src/pure/costTrend.ts` for the shapes and the
 * bars, `src/pure/costTrendCompute.ts` for the engine call — § 14, CI-14).
 *
 * The trend must never disagree with the cost report next to it: every number
 * comes from the engine's own `computeCost`, called once for the window, once
 * for the previous window, and once per day. What is verified here is the
 * bucketing, the variation, and the text bars the Cost tab draws.
 */

import { describe, expect, it } from 'vitest';
import type { Occurrence } from '@dejavu/core';
import {
  bucketByDay,
  daysOf,
  dayKey,
  deltaPct,
  textBar,
  trendMax,
} from '../src/pure/costTrend';
import { computeCostTrend } from '../src/pure/costTrendCompute';

const NOW = new Date('2026-11-12T10:00:00.000Z');

function occurrence(id: string, occurredAt: string, durationS: number, over: Partial<Occurrence> = {}): Occurrence {
  return {
    id,
    signatureId: 'sig-1',
    familyId: 'fam-1',
    workspace: 'acme',
    repo: 'payments',
    branch: 'main',
    commit: 'a'.repeat(40),
    author: 'marie',
    stepName: 'test',
    durationS,
    occurredAt,
    passedOnRetry: false,
    ...over,
  };
}

/** Three days inside the window, plus one failure in the previous window. */
const OCCURRENCES: Occurrence[] = [
  occurrence('o1', '2026-11-10T08:00:00.000Z', 600), // 10 min
  occurrence('o2', '2026-11-11T08:00:00.000Z', 1200), // 20 min
  occurrence('o3', '2026-11-12T08:00:00.000Z', 300, { passedOnRetry: true }), // 10 min, retry counted
  occurrence('p1', '2026-11-07T08:00:00.000Z', 600), // previous window: 10 min
];

describe('the day helpers', () => {
  it('keys an instant by its UTC day', () => {
    expect(dayKey(new Date('2026-11-12T23:59:00.000Z'))).toBe('2026-11-12');
    expect(dayKey(new Date('2026-11-12T00:00:00.000Z'))).toBe('2026-11-12');
  });

  it('lists the days of the window, oldest first, ending today', () => {
    expect(daysOf(3, NOW)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(daysOf(1, NOW)).toEqual(['2026-11-12']);
  });

  it('buckets the occurrences by day', () => {
    const buckets = bucketByDay(OCCURRENCES);
    expect([...buckets.keys()].sort()).toEqual(['2026-11-07', '2026-11-10', '2026-11-11', '2026-11-12']);
    expect(buckets.get('2026-11-10')?.map((o) => o.id)).toEqual(['o1']);
  });

  it('drops an occurrence with an unreadable instant', () => {
    expect(bucketByDay([occurrence('bad', 'not-a-date', 60)]).size).toBe(0);
  });
});

describe('computeCostTrend', () => {
  it('gives one point per day of the window, with the engine numbers', () => {
    const trend = computeCostTrend(OCCURRENCES, { windowDays: 3, now: NOW });
    expect(trend.windowDays).toBe(3);
    expect(trend.points).toEqual([
      { day: '2026-11-10', redBuilds: 1, ciMinutesLost: 10 },
      { day: '2026-11-11', redBuilds: 1, ciMinutesLost: 20 },
      { day: '2026-11-12', redBuilds: 1, ciMinutesLost: 10 },
    ]);
  });

  it('counts a retry the way the cost report does', () => {
    // `o3` lasted 300 s and was relaunched: the engine counts two runs.
    const trend = computeCostTrend(OCCURRENCES, { windowDays: 3, now: NOW });
    expect(trend.points[2].ciMinutesLost).toBe(10);
  });

  it('keeps a day without failure at zero', () => {
    const trend = computeCostTrend([OCCURRENCES[0]], { windowDays: 3, now: NOW });
    expect(trend.points.map((p) => p.redBuilds)).toEqual([1, 0, 0]);
    expect(trend.points.map((p) => p.ciMinutesLost)).toEqual([10, 0, 0]);
  });

  it('agrees with the totals of the window it draws', () => {
    const trend = computeCostTrend(OCCURRENCES, { windowDays: 3, now: NOW });
    const minutes = trend.points.reduce((total, p) => total + p.ciMinutesLost, 0);
    const builds = trend.points.reduce((total, p) => total + p.redBuilds, 0);
    expect(trend.current).toEqual({ redBuilds: builds, ciMinutesLost: minutes });
  });

  it('compares the window with the previous one of the same length', () => {
    const trend = computeCostTrend(OCCURRENCES, { windowDays: 3, now: NOW });
    expect(trend.current).toEqual({ redBuilds: 3, ciMinutesLost: 40 });
    expect(trend.previous).toEqual({ redBuilds: 1, ciMinutesLost: 10 });
    expect(trend.minutesDelta).toBe(30);
    expect(trend.minutesDeltaPct).toBe(300);
    expect(trend.redBuildsDelta).toBe(2);
  });

  it('reports a null variation when the previous window cost nothing', () => {
    const trend = computeCostTrend([OCCURRENCES[0]], { windowDays: 3, now: NOW });
    expect(trend.previous).toEqual({ redBuilds: 0, ciMinutesLost: 0 });
    expect(trend.minutesDeltaPct).toBeNull();
  });

  it('defaults to a 30-day window ending now', () => {
    const trend = computeCostTrend([], { now: NOW });
    expect(trend.windowDays).toBe(30);
    expect(trend.points).toHaveLength(30);
    expect(trend.points[29].day).toBe('2026-11-12');
  });
});

describe('deltaPct', () => {
  it('measures the variation in percent', () => {
    expect(deltaPct(15, 10)).toBe(50);
    expect(deltaPct(5, 10)).toBe(-50);
    expect(deltaPct(10, 10)).toBe(0);
  });

  it('answers null on an empty previous window', () => {
    expect(deltaPct(10, 0)).toBeNull();
  });
});

describe('textBar', () => {
  it('scales the value on the widest one', () => {
    expect(textBar(10, 10, 4)).toBe('████');
    expect(textBar(5, 10, 4)).toBe('██░░');
    expect(textBar(0, 10, 4)).toBe('░░░░');
  });

  it('keeps a small value visible', () => {
    expect(textBar(1, 1000, 4)).toBe('█░░░');
  });

  it('never overflows the width', () => {
    expect(textBar(50, 10, 4)).toBe('████');
    expect(textBar(50, 10, 4)).toHaveLength(4);
  });

  it('degrades on an unusable scale', () => {
    expect(textBar(5, 0, 4)).toBe('░░░░');
    expect(textBar(Number.NaN, 10, 4)).toBe('░░░░');
  });

  it('exposes the scale of a series', () => {
    const trend = computeCostTrend(OCCURRENCES, { windowDays: 3, now: NOW });
    expect(trendMax(trend)).toBe(20);
  });
});
