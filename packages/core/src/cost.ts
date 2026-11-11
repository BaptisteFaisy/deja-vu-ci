/**
 * Cost of failing builds (CI-14, § 14 "Cost" tab).
 *
 * The report answers three questions: how many red builds, how many CI
 * minutes were burned, and how many people were interrupted.
 *
 * Everything is computed from occurrences, so the same numbers can be shown
 * on the cost tab, quoted in a ticket description, or replayed offline.
 */
import type { CostReport, Occurrence, Signature, SignatureCost } from './types.js';

/** Default window of the cost report: 30 days (§ 14). */
const DEFAULT_WINDOW_DAYS = 30;
/** Minutes in one hour, used to convert durations. */
const MINUTES_PER_HOUR = 60;
/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** Options of the cost computation. */
export interface CostOptions {
  /** Size of the window in days, ending at `now`. Defaults to 30. */
  windowDays?: number;
  /** Known signatures, used to give a readable title per signature. */
  signatures?: Signature[];
  /** Reference date. Defaults to the current date. */
  now?: Date;
}

/**
 * Short human-readable identifier of a signature (`S-204`).
 *
 * Mirrors the format of the frozen contract; the extraction module owns the
 * canonical helper, this one keeps the cost report self-contained.
 */
export function shortSignatureId(signatureId: string): string {
  const hex = signatureId.replace(/[^0-9a-f]/gi, '');
  if (hex.length === 0) return 'S-000';
  const value = BigInt(`0x${hex}`) % 1000n;
  return `S-${value.toString().padStart(3, '0')}`;
}

/** Keep the occurrences that fall inside the window. */
function withinWindow(occs: Occurrence[], windowDays: number, now: Date): Occurrence[] {
  const limit = now.getTime() - windowDays * DAY_MS;
  return occs.filter((occ) => {
    const at = Date.parse(occ.occurredAt);
    return !Number.isNaN(at) && at >= limit;
  });
}

/** Number of CI runs spent on this occurrence: the failed one, plus retries. */
function runsFor(occurrence: Occurrence): number {
  return occurrence.passedOnRetry ? 2 : 1;
}

/** Minutes of CI burned by a list of occurrences. */
function minutesLost(occs: Occurrence[]): number {
  const seconds = occs.reduce(
    (total, occ) => total + occ.durationS * runsFor(occ),
    0,
  );
  return Math.round((seconds / 60) * 10) / 10;
}

/** Number of occurrences that were relaunched. */
function countRetries(occs: Occurrence[]): number {
  return occs.filter((occ) => occ.passedOnRetry).length;
}

/** Number of distinct authors (the people the failure interrupted). */
function countAuthors(occs: Occurrence[]): number {
  const authors = new Set<string>();
  for (const occ of occs) {
    if (occ.author) authors.add(occ.author);
  }
  return authors.size;
}

/** Readable title of a signature. */
function titleOf(signatureId: string, signatures: Signature[]): string {
  const known = signatures.find((sig) => sig.id === signatureId);
  if (!known) return signatureId;
  if (known.testName) return known.testName;
  if (known.errorType) return known.errorType;
  return known.template.split('\n')[0] ?? signatureId;
}

/** Cost of one signature inside the window. */
function costOfSignature(
  signatureId: string,
  occs: Occurrence[],
  signatures: Signature[],
): SignatureCost {
  return {
    signatureId,
    signatureShort: shortSignatureId(signatureId),
    title: titleOf(signatureId, signatures),
    occurrences: occs.length,
    ciMinutesLost: minutesLost(occs),
    peopleAffected: countAuthors(occs),
    retries: countRetries(occs),
  };
}

/** Group occurrences by signature. */
function groupBySignature(occs: Occurrence[]): Map<string, Occurrence[]> {
  const groups = new Map<string, Occurrence[]>();
  for (const occ of occs) {
    const bucket = groups.get(occ.signatureId);
    if (bucket) bucket.push(occ);
    else groups.set(occ.signatureId, [occ]);
  }
  return groups;
}

/**
 * Cost report of the failing builds of the window.
 *
 * The detail per signature is sorted by cost, most expensive first.
 */
export function computeCost(
  occs: Occurrence[],
  opts: CostOptions = {},
): CostReport {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const signatures = opts.signatures ?? [];
  const scoped = withinWindow(occs, windowDays, now);

  const perSignature = [...groupBySignature(scoped).entries()]
    .map(([signatureId, group]) => costOfSignature(signatureId, group, signatures))
    .sort((a, b) => b.ciMinutesLost - a.ciMinutesLost || b.occurrences - a.occurrences);

  return {
    redBuilds: scoped.length,
    ciMinutesLost: minutesLost(scoped),
    peopleAffected: countAuthors(scoped),
    retries: countRetries(scoped),
    windowDays,
    perSignature,
  };
}
