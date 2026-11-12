/**
 * The daily cost trend, computed with the engine (§ 14, CI-14).
 *
 * Split out of `costTrend.ts` on purpose: this module imports a **runtime
 * value** of `@dejavu/core` (`computeCost`), which drags the whole engine —
 * including `crypto` — into whatever bundle imports it. The Forge bundler
 * compiles the UI Kit entry (`src/frontend.tsx`) with a web target where Node
 * built-ins are disabled (`resolve.fallback: { crypto: false }`), so a UI file
 * reaching this module breaks `forge deploy` with "Can't resolve 'crypto'".
 *
 * Rule: the screens import `costTrend.ts` (types, bars, buckets — no engine);
 * only the backend (`src/query.ts`) imports this file.
 */

import { computeCost, type Occurrence, type Signature } from '@dejavu/core';
import {
  bucketByDay,
  daysOf,
  deltaPct,
  type CostTrend,
  type CostTrendOptions,
  type CostTrendPoint,
  type CostTrendTotals,
} from './costTrend';

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** Default window of the cost report (§ 14): 30 days. */
const DEFAULT_WINDOW_DAYS = 30;

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
