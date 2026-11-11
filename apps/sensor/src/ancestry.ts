/**
 * Ancestor comparison — pure logic, no Forge import.
 *
 * Specification § 10.2: to tell "already seen, already fixed" from "new",
 * the Brain needs to know whether the current branch contains the commit
 * that fixed the signature. The comparison is done by the Sensor, which is
 * the only app that can read Bitbucket (§ 7), and the logic below takes
 * the commit reader as an injected function so that it can be tested
 * without the network.
 */

/** Maximum number of commits walked before the comparison gives up. */
export const MAX_ANCESTOR_DEPTH = 200;

/** What the reader must know about a commit. */
export interface CommitNode {
  /** Hashes of the parents of the commit. */
  parents: string[];
}

/**
 * Reads a commit and its parents.
 *
 * The Forge layer supplies the Bitbucket-backed implementation
 * (`commitReader` in `pipelines.ts`); the tests supply a local double.
 * `undefined` means "this commit could not be read".
 */
export type CommitReader = (sha: string) => Promise<CommitNode | undefined>;

/** Outcome of an ancestor comparison. */
export interface AncestorVerdict {
  /** The commit that was looked for. */
  commit: string;
  /** True when the branch contains that commit. */
  contains: boolean;
  /** True when the comparison could not be completed. */
  unknown: boolean;
}

/**
 * Tells whether `head` contains `target`.
 *
 * The walk is breadth-first over the parents and bounded: a history longer
 * than `maxDepth` commits stops the search, and the verdict is then
 * "unknown" rather than "false". The Sensor must never claim that a branch
 * is clean when it simply ran out of history (§ 18, "Prudence").
 */
export async function containsCommit(
  head: string,
  target: string,
  read: CommitReader,
  maxDepth: number = MAX_ANCESTOR_DEPTH,
): Promise<AncestorVerdict> {
  if (!head || !target) return { commit: target, contains: false, unknown: true };
  if (head === target) return { commit: target, contains: true, unknown: false };

  const seen = new Set<string>([head]);
  let frontier: string[] = [head];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const sha of frontier) {
      const node = await read(sha);
      if (!node) return { commit: target, contains: false, unknown: true };
      for (const parent of node.parents) {
        if (parent === target) return { commit: target, contains: true, unknown: false };
        if (!seen.has(parent)) {
          seen.add(parent);
          next.push(parent);
        }
      }
    }
    frontier = next;
  }
  return { commit: target, contains: false, unknown: frontier.length > 0 };
}

/**
 * Turns a verdict into the `containsResolution` field of the payload.
 *
 * The field is omitted when the comparison is inconclusive: a missing
 * verdict is never read as a negative verdict by the Brain.
 */
export function toContainsResolution(
  verdict: AncestorVerdict,
): { commit: string; contains: boolean } | undefined {
  if (verdict.unknown) return undefined;
  return { commit: verdict.commit, contains: verdict.contains };
}
