/**
 * Outbreak detection (§ 10.3).
 *
 * An outbreak is the infrastructure-side twin of flakiness: the very same
 * family of failures shows up in at least `outbreakRepos` distinct
 * repositories within `outbreakWindowMin` minutes. That pattern is a broken
 * dependency or a flaky service, never the developer's pull request.
 *
 * Only the given occurrences are considered: the caller decides the scope
 * (typically the recent failures of a workspace).
 */

import { resolveSettings } from './flaky.js';
import type { Occurrence, Outbreak, Settings } from './types.js';

export interface OutbreakOptions {
  settings?: Partial<Settings>;
  now?: Date;
}

const MINUTE_MS = 60 * 1000;

/**
 * Detect an outbreak among the given occurrences.
 *
 * Returns the strongest outbreak found (most repositories, earliest start on
 * ties), or `undefined` when no family reaches the thresholds.
 */
export function detectOutbreak(occs: Occurrence[], opts?: OutbreakOptions): Outbreak | undefined {
  const settings = resolveSettings(opts?.settings);
  const windowMs = settings.outbreakWindowMin * MINUTE_MS;
  const byFamily = groupByFamily(occs);

  let strongest: Outbreak | undefined;
  for (const [familyId, familyOccs] of byFamily) {
    const outbreak = outbreakForFamily(familyId, familyOccs, windowMs, settings.outbreakRepos);
    if (!outbreak) continue;
    if (!strongest || isStronger(outbreak, strongest)) strongest = outbreak;
  }
  return strongest;
}

/** Group occurrences by family, keeping chronological order inside a family. */
function groupByFamily(occs: Occurrence[]): Map<string, Occurrence[]> {
  const byFamily = new Map<string, Occurrence[]>();
  for (const occ of occs) {
    const list = byFamily.get(occ.familyId);
    if (list) list.push(occ);
    else byFamily.set(occ.familyId, [occ]);
  }
  for (const list of byFamily.values()) {
    list.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }
  return byFamily;
}

/**
 * Slide a window of `windowMs` over the occurrences of one family and keep the
 * widest set of distinct repositories it covers.
 */
function outbreakForFamily(
  familyId: string,
  occs: Occurrence[],
  windowMs: number,
  minRepos: number,
): Outbreak | undefined {
  const timed = occs
    .map((occ) => ({ occ, at: Date.parse(occ.occurredAt) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at);

  let best: Outbreak | undefined;
  for (let start = 0; start < timed.length; start += 1) {
    const repos = new Set<string>();
    let end = start;
    while (end < timed.length && timed[end].at - timed[start].at <= windowMs) {
      repos.add(timed[end].occ.repo);
      end += 1;
    }
    if (repos.size < minRepos) continue;

    const candidate: Outbreak = {
      id: outbreakId(familyId, timed[start].at),
      familyId,
      startedAt: new Date(timed[start].at).toISOString(),
      repos: [...repos].sort(),
    };
    if (!best || isStronger(candidate, best)) best = candidate;
  }
  return best;
}

/** More repositories wins; on a tie, the earlier outbreak wins. */
function isStronger(candidate: Outbreak, current: Outbreak): boolean {
  if (candidate.repos.length !== current.repos.length) {
    return candidate.repos.length > current.repos.length;
  }
  return Date.parse(candidate.startedAt) < Date.parse(current.startedAt);
}

/** Stable identifier, derived from the family and the start instant. */
function outbreakId(familyId: string, startedAtMs: number): string {
  const suffix = Math.abs(Math.trunc(startedAtMs)).toString(36);
  return `ob-${familyId.slice(0, 8)}-${suffix}`;
}
