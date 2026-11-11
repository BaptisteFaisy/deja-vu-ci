/**
 * State of a replay: signature statuses, fix containment and ticket ledger.
 *
 * A replay is a simulation of the live pipeline, so it has to reproduce the
 * three things the Brain does against Jira and Forge SQL:
 *
 *  - the **status** of a signature moves along `new → known → flaky →
 *    resolved → regression` (§ 4, § 8.2, § 8.4);
 *  - a **resolution** only makes the branch "already fixed" when the branch
 *    really contains the fixing commit, otherwise the reappearance is a
 *    regression (§ 10.2, § 8.4);
 *  - a **ticket** is opened once per family and then updated, with at most one
 *    synthesis comment per day (§ 11). The replay has no Jira, so the ledger
 *    simulates the issue keys and remembers the last comment of each family.
 *
 * Kept apart from `replay.ts` so that both files stay under the 500-line rule.
 */

import type { CandidateCommit } from './resolutions.js';
import type { Store } from './store.js';
import type { ExtractionApi } from './replay.js';
import type {
  Diagnostic,
  DiagnosticKind,
  FlakyVerdict,
  ErrorBlock,
  Occurrence,
  Resolution,
  SampleOccurrence,
  Signature,
  SignatureStatus,
  TicketAction,
} from './types.js';

/** A commit of the dataset, with the moment it was first seen. */
export interface CommitInfo {
  at: string;
  commit: CandidateCommit;
}

/** Index the commits of a dataset, oldest appearance first. */
export function buildCommitIndex(occurrences: SampleOccurrence[]): CommitInfo[] {
  const seen = new Map<string, CommitInfo>();
  for (const occ of occurrences) {
    if (seen.has(occ.commit)) continue;
    seen.set(occ.commit, {
      at: occ.at,
      commit: {
        sha: occ.commit,
        author: occ.author,
        files: occ.changedFiles ?? [],
        message: `commit ${occ.commit.slice(0, 8)}`,
      },
    });
  }
  return [...seen.values()];
}

/** Block used when the extractor found nothing at all in a failure. */
export function syntheticBlock(sample: SampleOccurrence): ErrorBlock {
  const text = (sample.log ?? '').slice(0, 2000);
  const lines = text.trim().split('\n');
  return {
    category: 'unknown',
    errorType: 'UnknownError',
    message: lines[lines.length - 1] || 'unknown failure',
    rawMessage: text,
    frames: [],
    source: 'tail',
    rawText: text,
  };
}

/**
 * True when the branch of the occurrence contains the fixing commit.
 *
 * The dataset states it explicitly (`containsCommits`, filled by the sensor in
 * the live pipeline, which compares ancestors). Without that information the
 * replay is conservative: the branch is assumed **not** to contain the fix, so
 * the diagnostic stays "already fixed" instead of claiming a regression.
 */
export function branchHasFix(sample: SampleOccurrence, commit: string): boolean {
  return sample.containsCommits?.includes(commit) ?? false;
}

/**
 * Status of a signature after one more occurrence.
 *
 * - first occurrence → `new`;
 * - a resolution exists **and** the branch contains it → the problem came back
 *   where the fix lives: `regression` (§ 8.4);
 * - a resolution exists but the branch predates it → the status does not move
 *   (the occurrence is explained by "already fixed", § 10.2);
 * - `flaky` is sticky: a test declared unstable stays unstable;
 * - anything else that was already seen → `known`.
 */
export function statusAfterOccurrence(
  previous: SignatureStatus | undefined,
  resolution: Resolution | undefined,
  hasFix: boolean,
): SignatureStatus {
  if (previous === undefined) return 'new';
  if (resolution && hasFix) return 'regression';
  if (previous === 'flaky') return 'flaky';
  if (previous === 'resolved' || previous === 'regression') return previous;
  return 'known';
}

/**
 * The ticket side of a replay: one simulated issue key per family, and the
 * date of the last synthesis comment, so that the planner can honour "one
 * comment per day and per ticket" (§ 11) across a whole replay.
 */
export class TicketLedger {
  private readonly keys = new Map<string, string>();
  private readonly comments = new Map<string, string>();
  private nextNumber = 1;

  /** Issue key of a family, when the replay already opened one. */
  keyFor(familyId: string): string | undefined {
    return this.keys.get(familyId);
  }

  /** ISO date of the last comment published for a family. */
  lastCommentFor(familyId: string): string | undefined {
    return this.comments.get(familyId);
  }

  /**
   * Record what a plan implies: a `create` opens a ticket (and consumes the
   * comment slot of the day), a `comment` or a `reopen` publishes one.
   */
  record(familyId: string, actions: TicketAction[], occurredAt: string): void {
    for (const action of actions) {
      if (action.kind === 'create' && !this.keys.has(familyId)) {
        this.keys.set(familyId, `CI-${this.nextNumber}`);
        this.nextNumber += 1;
      }
      if (action.kind === 'create' || action.kind === 'comment' || action.kind === 'reopen') {
        this.comments.set(familyId, occurredAt);
      }
    }
  }
}

/** Count the diagnostics per kind, every kind being present. */
export function countByKind(outcomes: Array<{ diagnostic: Diagnostic }>): Record<DiagnosticKind, number> {
  const counts: Record<DiagnosticKind, number> = {
    flaky: 0,
    'already-fixed': 0,
    new: 0,
    infrastructure: 0,
    uncertain: 0,
  };
  for (const outcome of outcomes) counts[outcome.diagnostic.kind] += 1;
  return counts;
}

/** Build the occurrence row of a block. */
export function buildOccurrence(
  sample: SampleOccurrence,
  index: number,
  signature: Signature,
  block: ErrorBlock,
): Occurrence {
  return {
    id: `${sample.repo}-${sample.commit.slice(0, 8)}-${sample.step}-${index}`,
    signatureId: signature.id,
    familyId: signature.familyId,
    workspace: 'sample',
    repo: sample.repo,
    branch: sample.branch,
    commit: sample.commit,
    author: sample.author,
    prId: sample.prId,
    stepName: sample.step,
    durationS: sample.durationS,
    buildUrl: sample.buildUrl,
    occurredAt: sample.at,
    passedOnRetry: false,
    testName: block.testName ?? sample.testCases?.[0]?.name,
    changedFiles: sample.changedFiles,
  };
}

/** A resolution just recorded: the signature is resolved until it comes back. */
export async function markResolved(store: Store, signature: Signature): Promise<void> {
  if (signature.status === 'resolved') return;
  signature.status = 'resolved';
  await store.saveSignature(signature);
}

/** A test declared unstable keeps that status (§ 8.2). */
export async function markFlaky(
  store: Store,
  signature: Signature,
  verdict: FlakyVerdict,
): Promise<void> {
  if (!verdict.flaky || signature.status === 'flaky') return;
  if (signature.status === 'resolved' || signature.status === 'regression') return;
  signature.status = 'flaky';
  await store.saveSignature(signature);
}

/** The simulated issue key of the family is carried by the signature. */
export async function attachIssueKey(
  store: Store,
  ledger: TicketLedger,
  signature: Signature,
): Promise<void> {
  const key = ledger.keyFor(signature.familyId);
  if (!key || signature.issueKey === key) return;
  signature.issueKey = key;
  await store.saveSignature(signature);
}

/** Occurrences of the same signature, at or before the given one. */
export async function priorOccurrences(store: Store, occurrence: Occurrence): Promise<Occurrence[]> {
  const all = await store.listOccurrences(occurrence.signatureId);
  return all.filter((o) => o.id !== occurrence.id && o.occurredAt <= occurrence.occurredAt);
}

/** Extract the error blocks of a failure; never returns an empty list. */
export function extractBlocks(sample: SampleOccurrence, extraction: ExtractionApi): ErrorBlock[] {
  const result = extraction.extractErrorBlocks({
    stepLog: sample.log,
    testCases: sample.testCases,
  });
  return result.blocks.length > 0 ? result.blocks : [syntheticBlock(sample)];
}
