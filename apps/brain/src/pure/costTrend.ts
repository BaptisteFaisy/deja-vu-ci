/**
 * The daily cost trend of the Cost tab (§ 14, CI-14).
 *
 * The tab already shows the engine's cost report (`computeCost`): red builds,
 * CI minutes lost, people affected. This module adds the **shape** of that cost
 * over the window — one point per day — and the variation against the previous
 * window of the same length.
 *
 * Every number comes from the engine's own `computeCost`: the totals of the
 * window, the totals of the previous window, and each day of the series (the
 * engine is called on that day's occurrences). Nothing is recomputed here, so
 * the trend can never disagree with the cost report next to it.
 *
 * The series buckets the window by UTC day; the totals keep the engine's
 * rolling window. Both are shown, and the difference is at most the partial
 * first day.
 *
 * Pure module: no `@forge/*` import, no network, no chart library — the bars
 * are text.
 */

import { computeCost, type Occurrence, type Signature } from '@dejavu/core';

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** Default window of the cost report (§ 14): 30 days. */
const DEFAULT_WINDOW_DAYS = 30;

/** One day of the series. */
export interface CostTrendPoint {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  /** Red builds of that day. */
  redBuilds: number;
  /** CI minutes lost that day. */
  ciMinutesLost: number;
}

/** The totals of one window. */
export interface CostTrendTotals {
  redBuilds: number;
  ciMinutesLost: number;
}

/** What the Cost tab draws. */
export interface CostTrend {
  windowDays: number;
  /** One point per UTC day of the window, oldest first. */
  points: CostTrendPoint[];
  current: CostTrendTotals;
  previous: CostTrendTotals;
  /** CI minutes of the window minus the CI minutes of the previous one. */
  minutesDelta: number;
  /** Same variation in percent, or null when the previous window cost nothing. */
  minutesDeltaPct: number | null;
  /** Red builds of the window minus the red builds of the previous one. */
  redBuildsDelta: number;
}

/** Options of the trend, mirroring the cost report's. */
export interface CostTrendOptions {
  windowDays?: number;
  signatures?: Signature[];
  now?: Date;
}

/** UTC day key (`2026-11-12`) of an instant. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The `windowDays` UTC days ending on `now`, oldest first. */
export function daysOf(windowDays: number, now: Date): string[] {
  const days: string[] = [];
  for (let index = windowDays - 1; index >= 0; index -= 1) {
    days.push(dayKey(new Date(now.getTime() - index * DAY_MS)));
  }
  return days;
}

/** Buckets the occurrences by UTC day. */
export function bucketByDay(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  const buckets = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const at = Date.parse(occurrence.occurredAt);
    if (!Number.isFinite(at)) continue;
    const day = dayKey(new Date(at));
    const bucket = buckets.get(day);
    if (bucket) bucket.push(occurrence);
    else buckets.set(day, [occurrence]);
  }
  return buckets;
}

/** The totals of one window, straight out of the engine's cost report. */
function totalsOf(
  occurrences: Occurrence[],
  windowDays: number,
  signatures: Signature[] | undefined,
  now: Date,
): CostTrendTotals {
  const report = computeCost(occurrences, {
    windowDays,
    now,
    ...(signatures ? { signatures } : {}),
  });
  return { redBuilds: report.redBuilds, ciMinutesLost: report.ciMinutesLost };
}

/**
 * The occurrences strictly before an instant.
 *
 * `computeCost` bounds a window from below only, so the previous window is
 * scoped here before the engine counts it: without this upper bound, the
 * failures of the current window would be counted twice.
 */
function before(occurrences: Occurrence[], at: Date): Occurrence[] {
  const limit = at.getTime();
  return occurrences.filter((occurrence) => {
    const time = Date.parse(occurrence.occurredAt);
    return Number.isFinite(time) && time < limit;
  });
}

/** One day of the series: the engine's cost report of that day's failures. */
function pointForDay(
  day: string,
  occurrences: Occurrence[],
  signatures: Signature[] | undefined,
): CostTrendPoint {
  // `now` is the last millisecond of the day, so the engine's one-day window
  // covers exactly `[day 00:00, day 23:59:59.999]`.
  const endOfDay = new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS - 1;
  const report = computeCost(occurrences, {
    windowDays: 1,
    now: new Date(endOfDay),
    ...(signatures ? { signatures } : {}),
  });
  return { day, redBuilds: report.redBuilds, ciMinutesLost: report.ciMinutesLost };
}

/** Percent variation, or null when the previous window cost nothing. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * The cost trend of the window: one point per UTC day, the totals of the
 * window and of the previous one, and the variation between them.
 */
export function computeCostTrend(
  occurrences: Occurrence[],
  opts: CostTrendOptions = {},
): CostTrend {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const signatures = opts.signatures;
  const buckets = bucketByDay(occurrences);

  const points = daysOf(windowDays, now).map((day) =>
    pointForDay(day, buckets.get(day) ?? [], signatures),
  );
  const previousNow = new Date(now.getTime() - windowDays * DAY_MS);
  const current = totalsOf(occurrences, windowDays, signatures, now);
  const previous = totalsOf(
    before(occurrences, previousNow),
    windowDays,
    signatures,
    previousNow,
  );

  return {
    windowDays,
    points,
    current,
    previous,
    minutesDelta: Math.round((current.ciMinutesLost - previous.ciMinutesLost) * 10) / 10,
    minutesDeltaPct: deltaPct(current.ciMinutesLost, previous.ciMinutesLost),
    redBuildsDelta: current.redBuilds - previous.redBuilds,
  };
}

/**
 * A text bar of `width` cells, scaled on `max`.
 *
 * The Cost tab draws its series with these bars: no chart library, no CSS
 * beyond what the UI Kit already provides. A non-zero value always shows at
 * least one filled cell, so a small day is still visible.
 */
export function textBar(value: number, max: number, width = 12): string {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) {
    return '░'.repeat(width);
  }
  const filled = Math.min(width, Math.max(1, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** The widest value of the series (the scale of the bars). */
export function trendMax(trend: CostTrend): number {
  return trend.points.reduce(
    (max, point) => Math.max(max, point.ciMinutesLost, point.redBuilds),
    0,
  );
}
