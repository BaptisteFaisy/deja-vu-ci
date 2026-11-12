/**
 * Signature versioning and migration (§ 9.3, CI "pérennité des signatures").
 *
 * A signature id is a truncated SHA-256 of the normalized error. If the
 * normalization ever changes, every memorized id becomes orphaned: Jira tickets
 * would point at fingerprints that no longer reproduce. This module pins the
 * algorithm version, lets the caller compute an id for a given version, and
 * provides a deterministic, idempotent migration from one version to another.
 *
 * The migration is a pure plan (`planSignatureMigration`) plus an effectful
 * application against a `Store` (`applySignatureMigration`). The golden test in
 * `test/signature-golden.test.ts` is the lock: it breaks before any accidental
 * normalization change reaches production, which is exactly when a migration is
 * needed.
 */

import { signatureOf } from './sign.js';
import type { ErrorBlock, Signature, SignatureStatus } from './types.js';
import type { Store } from './store.js';

/**
 * The version currently produced by {@link signatureIdOf}.
 *
 * v1 is, bit for bit, the behaviour of {@link signatureOf}: the same payload
 * `category | errorType | message | frames`, the same 16-hex truncation. The
 * golden test guarantees that nothing shifts by accident.
 */
export const SIGNATURE_ALGORITHM = {
  name: 'deja-vu-normalized-v1',
  version: 1,
} as const;

export type SignatureAlgorithm = typeof SIGNATURE_ALGORITHM;

/**
 * Signature id for a given algorithm version.
 *
 * The default version is {@link SIGNATURE_ALGORITHM}. Asking for an unknown
 * version throws rather than silently guessing: a migration must never be
 * planned against an algorithm this build cannot reproduce.
 */
export function signatureIdOf(block: ErrorBlock, version?: number): string {
  const requested = version ?? SIGNATURE_ALGORITHM.version;
  if (requested !== SIGNATURE_ALGORITHM.version) {
    throw new Error(
      `Unknown signature algorithm version: ${requested} (this build implements ${SIGNATURE_ALGORITHM.version})`,
    );
  }
  return signatureOf(block);
}

// ---------------------------------------------------------------------------
// Migration plan (pure)
// ---------------------------------------------------------------------------

/** One relocation: move the signature `from` onto the id `to`. */
export interface SignatureMove {
  from: string;
  to: string;
  /** Occurrence count carried by the source signature at plan time. */
  occurrences: number;
  /** Ticket key of the source, kept for reporting and for the merge. */
  issueKey?: string;
}

/** The full plan, including the fusions it detects. */
export interface SignatureMigrationPlan {
  /** Target algorithm version of the plan. */
  algorithm: SignatureAlgorithm;
  /** Every relocation, in the order the signatures were given. */
  moves: SignatureMove[];
  /**
   * Groups of moves that share the same target id (two or more old signatures
   * recomputed onto one new id). Each group is a fusion: one ticket, one
   * signature after the migration.
   */
  merges: SignatureMove[][];
}

/**
 * Plan the migration of memorized signatures toward a new id space.
 *
 * `recompute` maps a stored signature to its id under the target algorithm
 * (typically a block rebuilt from the signature's normalized template, run
 * through the new normalizer). Signatures whose id does not move are dropped
 * from the plan; the rest become {@link SignatureMove} entries.
 *
 * Fusions are detected by grouping the moves on their target id: whenever two
 * or more sources land on one target, the plan reports that group so the caller
 * can anticipate the merges {@link applySignatureMigration} will perform.
 */
export function planSignatureMigration(
  signatures: Signature[],
  recompute: (signature: Signature) => string,
  target: SignatureAlgorithm = SIGNATURE_ALGORITHM,
): SignatureMigrationPlan {
  const moves: SignatureMove[] = [];
  for (const signature of signatures) {
    const to = recompute(signature);
    if (to === signature.id) continue;
    moves.push({
      from: signature.id,
      to,
      occurrences: signature.occurrences,
      ...(signature.issueKey !== undefined ? { issueKey: signature.issueKey } : {}),
    });
  }
  return { algorithm: target, moves, merges: groupFusions(moves) };
}

/** Groups of moves sharing one target id, with at least two members. */
function groupFusions(moves: SignatureMove[]): SignatureMove[][] {
  const byTarget = new Map<string, SignatureMove[]>();
  for (const move of moves) {
    const group = byTarget.get(move.to);
    if (group) group.push(move);
    else byTarget.set(move.to, [move]);
  }
  return [...byTarget.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([to, group]) => [...group].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)))
    .sort((a, b) => (a[0].to < b[0].to ? -1 : a[0].to > b[0].to ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Migration application (effectful, idempotent)
// ---------------------------------------------------------------------------

/**
 * Status precedence, mirrored from the curation contract (§ 11): a merge never
 * loses a regression nor a flaky verdict. Lower rank wins.
 */
const STATUS_PRECEDENCE: SignatureStatus[] = ['regression', 'flaky', 'resolved', 'known', 'new'];

function rank(status: SignatureStatus): number {
  const index = STATUS_PRECEDENCE.indexOf(status);
  return index === -1 ? STATUS_PRECEDENCE.length : index;
}

function strongestStatus(a: SignatureStatus, b: SignatureStatus): SignatureStatus {
  return rank(a) <= rank(b) ? a : b;
}

/** Earliest of two ISO-8601 UTC instants (lexicographic order is chronological). */
function earliest(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Latest of two ISO-8601 UTC instants. */
function latest(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Build the target signature of one move.
 *
 * - Brand-new target (`to` unknown): the source identity carries over, with the
 *   new id; its counters, firstSeen, status and ticket are kept as is.
 * - Existing target: fold the source into it — occurrences summed, firstSeen
 *   earliest, lastSeen latest, status the strongest of the two, ticket key the
 *   one already present on the target else the source's.
 *
 * The target's `familyId` is the one already stored on the target, or the
 * source's when the target is new. Family migration is out of scope here: it
 * would need a second recompute function for the family fingerprint.
 */
function mergeTarget(to: string, from: Signature, existing?: Signature): Signature {
  if (!existing) {
    return { ...from, id: to };
  }
  const merged: Signature = {
    ...existing,
    firstSeen: earliest(existing.firstSeen, from.firstSeen),
    lastSeen: latest(existing.lastSeen, from.lastSeen),
    occurrences: existing.occurrences + from.occurrences,
    status: strongestStatus(existing.status, from.status),
  };
  const issueKey = existing.issueKey ?? from.issueKey;
  if (issueKey !== undefined) merged.issueKey = issueKey;
  const testName = existing.testName ?? from.testName;
  if (testName !== undefined) merged.testName = testName;
  return merged;
}

/**
 * Apply a migration plan to a store.
 *
 * For every move the source occurrences are reassigned to the target id, the
 * counters are merged into the target signature, and the source is drained to
 * zero occurrences. `Store` exposes no delete, so the drained source row stays
 * until the caller (or the Forge SQL adapter) prunes empty signatures — the
 * migration itself never invents or drops occurrence rows.
 *
 * Idempotent: a move is skipped as soon as its source holds no occurrences, so
 * replaying an applied plan is a no-op. This is what makes a migration safe to
 * run twice after a crash or a partial run.
 */
export async function applySignatureMigration(
  store: Store,
  plan: SignatureMigrationPlan,
): Promise<void> {
  for (const move of plan.moves) {
    const source = await store.getSignature(move.from);
    if (!source) continue; // already gone
    const occurrences = await store.listOccurrences(move.from);
    if (occurrences.length === 0) continue; // already applied — idempotent guard

    const target = await store.getSignature(move.to);
    await store.saveSignature(mergeTarget(move.to, source, target));

    for (const occurrence of occurrences) {
      occurrence.signatureId = move.to;
      await store.saveOccurrence(occurrence);
    }

    // Drain the source: occurrences moved away, counter back to zero.
    await store.saveSignature({ ...source, occurrences: 0 });
  }
}