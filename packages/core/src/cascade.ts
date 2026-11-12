/**
 * Cascade detection (§ 10.3 extension).
 *
 * A single infrastructure event (a broken dependency, a flaky service, a bad
 * base image) rarely fails one family: it fails the compile step in three repos,
 * the tests in two others, the docker build somewhere else. Each of those is a
 * distinct family with a distinct signature, but they are one event. Without a
 * cascade view the app would open one ticket per family for a single incident.
 *
 * A cascade groups the families that fail together inside the outbreak window of
 * a **root** family — the one that is itself a genuine outbreak (spans
 * `outbreakRepos` repos within `outbreakWindowMin`, decided by `detectOutbreak`).
 * The root is the common ancestor: every other family in the group is a twin
 * that fell inside the same short window across several repositories.
 *
 * This module reuses {@link detectOutbreak} for the heavy sliding-window work
 * instead of reimplementing it; only the "which other families co-failed in
 * that window" step is cascade-specific.
 */

import { detectOutbreak } from './outbreak.js';
import { resolveSettings } from './flaky.js';
import type { Occurrence, Settings } from './types.js';

export interface CascadeOptions {
  settings?: Partial<Settings>;
  now?: Date;
}

/** A family must span at least this many repos inside the window to join a cascade. */
export const CASCADE_MIN_REPOS = 2;

/** One cascade: the families that fell together, and the root that started it. */
export interface CascadeGroup {
  /** Distinct family ids of the group, sorted for determinism (root included). */
  familyIds: string[];
  /** Number of distinct repositories touched by the whole group. */
  repoCount: number;
  /** Observed span of the group, in whole minutes (at least 1). */
  windowMinutes: number;
  /** The common ancestor: the family whose outbreak defines the window. */
  rootFamilyId: string;
}

const MINUTE_MS = 60 * 1000;

/** Group occurrences by family id. */
function groupByFamily(occs: Occurrence[]): Map<string, Occurrence[]> {
  const byFamily = new Map<string, Occurrence[]>();
  for (const occ of occs) {
    const list = byFamily.get(occ.familyId);
    if (list) list.push(occ);
    else byFamily.set(occ.familyId, [occ]);
  }
  return byFamily;
}

/** Repos a family spans, from its occurrences. */
function reposOf(occs: Occurrence[]): Set<string> {
  return new Set(occs.map((o) => o.repo));
}

/**
 * Detect a cascade among the given occurrences.
 *
 * Returns `undefined` when no family reaches the outbreak thresholds — there is
 * then no common ancestor to group around, and the caller handles each family on
 * its own. Otherwise returns the group of families that failed together inside
 * the root's window, with the root family named.
 */
export function detectCascade(
  occurrences: Occurrence[],
  opts?: CascadeOptions,
): CascadeGroup | undefined {
  const settings = resolveSettings(opts?.settings);
  const root = detectOutbreak(occurrences, opts);
  if (!root) return undefined;

  const since = Date.parse(root.startedAt);
  const until = since + settings.outbreakWindowMin * MINUTE_MS;
  const inWindow = occurrences.filter((o) => {
    const at = Date.parse(o.occurredAt);
    return Number.isFinite(at) && at >= since && at <= until;
  });

  const families: string[] = [];
  const repos = new Set<string>();
  let minAt = Infinity;
  let maxAt = -Infinity;

  for (const [familyId, familyOccs] of groupByFamily(inWindow)) {
    if (reposOf(familyOccs).size < CASCADE_MIN_REPOS) continue;
    families.push(familyId);
    for (const occ of familyOccs) {
      repos.add(occ.repo);
      const at = Date.parse(occ.occurredAt);
      if (Number.isFinite(at)) {
        if (at < minAt) minAt = at;
        if (at > maxAt) maxAt = at;
      }
    }
  }

  if (families.length === 0) return undefined;

  const spanMinutes = Math.max(1, Math.ceil((maxAt - minAt) / MINUTE_MS));
  return {
    familyIds: families.sort(),
    repoCount: repos.size,
    windowMinutes: spanMinutes,
    rootFamilyId: root.familyId,
  };
}