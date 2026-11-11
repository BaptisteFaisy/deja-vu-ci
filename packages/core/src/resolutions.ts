/**
 * Candidate resolution inference (§ 10.5) and regression detection (§ 8.4).
 *
 * A resolution candidate is a commit that plausibly made a failure
 * disappear. The caller (the Capteur) supplies the window: the commits
 * between the last failing occurrence and the first successful run. We only
 * rank that window, deterministically.
 *
 * Confidence stays low (< 0.6) until a human confirms the candidate (§ 10.5).
 */
import type { Occurrence, Resolution, Signature } from './types.js';

/** A commit that could be the fix of a failure. */
export interface CandidateCommit {
  sha: string;
  author: string;
  files: string[];
  message: string;
}

/** Everything needed to rank the candidate commits of one signature. */
export interface CandidateInput {
  signatureId: string;
  /** Known occurrences of the signature, oldest first (any order is fine). */
  history: Occurrence[];
  /** Commits between the last failure and the first success. */
  commitsBetween: CandidateCommit[];
  /** Issue key linked to the branch, when there is one. */
  linkedIssueKey?: string;
  now?: Date;
}

/** Base confidence of an unconfirmed candidate. */
const BASE_CONFIDENCE = 0.3;
/** Bonus when the commit touches a file involved in the failure. */
const FILE_BONUS = 0.15;
/** Bonus when the commit message cites the linked issue. */
const ISSUE_BONUS = 0.1;
/** Hard ceiling: a candidate is never "confident" before a human says so. */
const MAX_CONFIDENCE = 0.55;
/** Maximum length of the human-readable note kept on the resolution. */
const NOTE_MAX_CHARS = 120;

/** Flatten a commit message and cut it on a word boundary. */
function truncateNote(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  if (flat.length <= NOTE_MAX_CHARS) return flat;
  const cut = flat.slice(0, NOTE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace > NOTE_MAX_CHARS / 2 ? cut.slice(0, lastSpace) : cut;
  return `${head.trimEnd()}...`;
}

/**
 * Files involved in the failure.
 *
 * Occurrences do not carry a stack trace, so the changed files reported by
 * the pull request are the closest available hint of the failing area.
 */
function involvedFiles(history: Occurrence[]): Set<string> {
  const files = new Set<string>();
  for (const occurrence of history) {
    for (const file of occurrence.changedFiles ?? []) files.add(file);
  }
  return files;
}

/** True when the commit message cites the linked issue key. */
function citesIssue(commit: CandidateCommit, linkedIssueKey?: string): boolean {
  if (!linkedIssueKey) return false;
  return commit.message.includes(linkedIssueKey);
}

/** Score one candidate commit. Higher is better. */
function scoreCommit(
  commit: CandidateCommit,
  files: Set<string>,
  linkedIssueKey?: string,
): number {
  const touchesFile = commit.files.some((file) => files.has(file));
  const mentionsIssue = citesIssue(commit, linkedIssueKey);
  let score = BASE_CONFIDENCE;
  if (touchesFile) score += FILE_BONUS;
  if (mentionsIssue) score += ISSUE_BONUS;
  return score;
}

/**
 * Best candidate resolution for a signature, or `undefined` when the window
 * holds no usable commit.
 */
export function inferCandidateResolution(input: CandidateInput): Resolution | undefined {
  const candidates = input.commitsBetween.filter((commit) => commit.sha.length > 0);
  if (candidates.length === 0) return undefined;

  const files = involvedFiles(input.history);
  const failingCommits = new Set(input.history.map((occurrence) => occurrence.commit));

  let best: CandidateCommit | undefined;
  let bestScore = -1;
  for (const commit of candidates) {
    if (failingCommits.has(commit.sha)) continue;
    const score = scoreCommit(commit, files, input.linkedIssueKey);
    if (score > bestScore) {
      best = commit;
      bestScore = score;
    }
  }
  if (!best) return undefined;

  return {
    id: `res-${input.signatureId}-${best.sha.slice(0, 7)}`,
    signatureId: input.signatureId,
    commit: best.sha,
    author: best.author,
    files: [...best.files],
    note: truncateNote(best.message),
    confidence: Math.min(bestScore, MAX_CONFIDENCE),
  };
}

/**
 * True when a signature that was resolved reappears (§ 8.4).
 *
 * The reference date is the confirmation date of the resolution when known,
 * otherwise the last time the signature was seen.
 */
export function detectRegression(
  signature: Signature,
  occurrence: Occurrence,
  resolution?: Resolution,
): boolean {
  if (signature.status !== 'resolved' && signature.status !== 'regression') return false;
  if (occurrence.signatureId !== signature.id) return false;
  const reference = resolution?.confirmedAt ?? signature.lastSeen;
  if (!reference) return false;
  const seenAt = Date.parse(occurrence.occurredAt);
  if (Number.isNaN(seenAt)) return false;
  return seenAt >= Date.parse(reference);
}
