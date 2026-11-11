/**
 * Manual curation of signatures (CI-17, § 19).
 *
 * A volatile datum the normalizer does not recognize (a command id, a build
 * number, a container suffix…) makes one error look like two: two signatures
 * are born from the same template. The operator fixes it by hand:
 *
 *   1. `mergeSignatures` folds the absorbed signature into the kept one — one
 *      ticket, one status, the occurrence counters added up — and reports the
 *      occurrences that moved;
 *   2. `suggestNormalizationRule` isolates what differentiated the two
 *      templates and proposes a regex pattern to add to the normalizer, so the
 *      same error does not split again;
 *   3. `splitSignature` does the opposite gesture when a family turns out to
 *      hide several problems: it distributes the occurrences by criterion.
 *
 * Everything here is deterministic and side-effect free, except the single
 * documented reassignment performed by `mergeSignatures` (see its doc).
 */

import type { ErrorBlock, Occurrence, Signature, SignatureStatus } from './types.js';
import { normalizeMessage } from './normalize.js';
import { familyOf, signatureOf } from './sign.js';

// ---------------------------------------------------------------------------
// Merge (CI-17)
// ---------------------------------------------------------------------------

/** Outcome of a manual merge: what to save, what to delete, and the rule. */
export interface MergeResult {
  /** Target signature, with occurrences and history reunited. */
  merged: Signature;
  /** Absorbed signature: the caller deletes it from the store. */
  retired: Signature;
  /** How many occurrences were reattached to the kept signature. */
  movedOccurrences: number;
  /** Normalization rule to add so the split does not happen again. */
  rule?: NormalizationRuleSuggestion;
}

/** Status precedence of a merge: never lose a regression nor a flaky (§ 11). */
const STATUS_PRECEDENCE: SignatureStatus[] = ['regression', 'flaky', 'resolved', 'known', 'new'];

/** Lower rank wins: `regression` (0) beats `flaky` (1), and so on. */
function rank(status: SignatureStatus): number {
  const index = STATUS_PRECEDENCE.indexOf(status);
  return index === -1 ? STATUS_PRECEDENCE.length : index;
}

/** The strongest of two statuses, by contract precedence. */
function strongestStatus(a: SignatureStatus, b: SignatureStatus): SignatureStatus {
  return rank(a) <= rank(b) ? a : b;
}

/** Earliest of two ISO-8601 UTC instants (lexicographic order is chronological). */
function earliest(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Latest of two ISO-8601 UTC instants (lexicographic order is chronological). */
function latest(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Build the merged signature: kept identity, added history, one ticket. */
function buildMerged(kept: Signature, dropped: Signature): Signature {
  const merged: Signature = {
    ...kept,
    firstSeen: earliest(kept.firstSeen, dropped.firstSeen),
    lastSeen: latest(kept.lastSeen, dropped.lastSeen),
    occurrences: kept.occurrences + dropped.occurrences,
    status: strongestStatus(kept.status, dropped.status),
  };
  // One ticket per family (§ 11): the kept key wins, else the absorbed one.
  const issueKey = kept.issueKey ?? dropped.issueKey;
  if (issueKey !== undefined) merged.issueKey = issueKey;
  const testName = kept.testName ?? dropped.testName;
  if (testName !== undefined) merged.testName = testName;
  return merged;
}

/**
 * Merge two signatures that describe the same error.
 *
 * The kept signature provides identity (`id`, `familyId`, category, type,
 * template, frames); its history is unioned with the absorbed one
 * (`firstSeen` oldest, `lastSeen` newest, `occurrences` summed), the status
 * follows the precedence `regression > flaky > resolved > known > new`, and the
 * ticket key is the kept one, else the absorbed one — never two tickets.
 *
 * Documented effect: the occurrences of the absorbed signature found in
 * `occurrences` are reassigned in place to the kept signature (`signatureId`
 * and `familyId`), so the caller can persist them as they are. Everything
 * returned is a fresh object; the two signatures are never mutated.
 */
export function mergeSignatures(
  kept: Signature,
  dropped: Signature,
  occurrences: Occurrence[],
): MergeResult {
  const moved = occurrences.filter((o) => o.signatureId === dropped.id);
  for (const occurrence of moved) {
    occurrence.signatureId = kept.id;
    occurrence.familyId = kept.familyId;
  }
  const merged = buildMerged(kept, dropped);
  const rule = suggestNormalizationRule(kept.template, dropped.template);
  const retired: Signature = { ...dropped };
  return rule
    ? { merged, retired, movedOccurrences: moved.length, rule }
    : { merged, retired, movedOccurrences: moved.length };
}

// ---------------------------------------------------------------------------
// Split (CI-17, the opposite gesture)
// ---------------------------------------------------------------------------

/** How to distribute the occurrences of a signature into several ones. */
export type SplitCriterion = 'test-name' | 'branch' | 'repository' | ((o: Occurrence) => string);

/** One signature per group, each with strictly its own occurrences. */
export interface SplitResult {
  groups: Array<{ signature: Signature; occurrences: Occurrence[] }>;
}

/** Value used when an occurrence carries no test name at all. */
const NO_VALUE = '(none)';

/** Human label of the discriminator, reused in the derived template. */
function labelOf(by: SplitCriterion): string {
  if (typeof by === 'function') return 'criterion';
  return by === 'test-name' ? 'test' : by;
}

/** The discriminator value of one occurrence for the given criterion. */
function discriminator(o: Occurrence, by: SplitCriterion, fallbackTestName?: string): string {
  if (typeof by === 'function') return by(o);
  if (by === 'test-name') return o.testName ?? fallbackTestName ?? NO_VALUE;
  if (by === 'branch') return o.branch;
  return o.repo;
}

/** Chronological span of a non-empty group of occurrences. */
function spanOf(occs: Occurrence[]): { firstSeen: string; lastSeen: string } {
  let firstSeen = occs[0].occurredAt;
  let lastSeen = occs[0].occurredAt;
  for (const o of occs) {
    firstSeen = earliest(firstSeen, o.occurredAt);
    lastSeen = latest(lastSeen, o.occurredAt);
  }
  return { firstSeen, lastSeen };
}

/** Error block rebuilt from a signature, to recompute its fingerprints. */
function blockOf(sig: Signature, message: string): ErrorBlock {
  return {
    category: sig.category,
    errorType: sig.errorType,
    message,
    rawMessage: message,
    frames: sig.frames,
    source: 'report',
    rawText: message,
  };
}

/** Template of a non-majority group: the discriminator is made explicit. */
function annotate(template: string, label: string, value: string): string {
  return `${template} [${label}: ${value}]`;
}

/**
 * Signature of one group.
 *
 * The majority group keeps the original signature (identity, ticket, status):
 * only its counters are narrowed to its occurrences. A minority group gets a
 * new fingerprint, recomputed from the annotated template, because it is by
 * definition a different problem — the operator decides which ticket it gets.
 */
function groupSignature(
  sig: Signature,
  label: string,
  value: string,
  occs: Occurrence[],
  major: boolean,
  testName?: string,
): Signature {
  const span = spanOf(occs);
  const base: Signature = {
    ...sig,
    occurrences: occs.length,
    firstSeen: span.firstSeen,
    lastSeen: span.lastSeen,
  };
  if (testName !== undefined && testName !== NO_VALUE) base.testName = testName;
  if (major) return base;
  const message = annotate(sig.template, label, value);
  const block = blockOf(sig, message);
  const derived: Signature = {
    ...base,
    id: signatureOf(block),
    familyId: familyOf(block),
    template: message,
  };
  delete derived.issueKey;
  return derived;
}

/**
 * Group occurrences by their discriminator, biggest group first (ties broken by
 * value for determinism), each group sorted chronologically.
 */
function bucketBy(
  occurrences: Occurrence[],
  by: SplitCriterion,
  fallbackTestName?: string,
): Array<{ value: string; occurrences: Occurrence[] }> {
  const buckets = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const key = discriminator(o, by, fallbackTestName);
    const list = buckets.get(key);
    if (list) list.push(o);
    else buckets.set(key, [o]);
  }
  return [...buckets.entries()]
    .map(([value, occs]) => ({
      value,
      occurrences: [...occs].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1)),
    }))
    .sort((a, b) => b.occurrences.length - a.occurrences.length || a.value.localeCompare(b.value));
}

/**
 * Split a signature into several ones, one per group of occurrences.
 *
 * Groups are ordered by size (biggest first, ties broken by value) so the
 * majority group is always `groups[0]` and keeps the original signature.
 * Occurrences are sorted chronologically inside each group, and no occurrence
 * is ever invented: the concatenation of the groups is exactly the input.
 *
 * Documented effect: each occurrence is reassigned in place to its group
 * signature (`signatureId`, `familyId`) — a no-op for the majority group, which
 * keeps the original fingerprint — so the caller can persist the split as is.
 */
export function splitSignature(
  signature: Signature,
  occurrences: Occurrence[],
  by: SplitCriterion,
): SplitResult {
  const label = labelOf(by);
  const ordered = bucketBy(occurrences, by, signature.testName);
  const groups = ordered.map((group, index) => {
    const major = index === 0;
    const sig = groupSignature(
      signature,
      label,
      group.value,
      group.occurrences,
      major,
      by === 'test-name' ? group.value : undefined,
    );
    for (const occurrence of group.occurrences) {
      occurrence.signatureId = sig.id;
      occurrence.familyId = sig.familyId;
    }
    return { signature: sig, occurrences: group.occurrences };
  });
  return { groups };
}

// ---------------------------------------------------------------------------
// Normalization rule suggestion (CI-17, second half)
// ---------------------------------------------------------------------------

/** A rule to append to the normalization table of `normalize.ts` (§ 9.2). */
export interface NormalizationRuleSuggestion {
  /** What differentiated the two templates (the motif to neutralize). */
  token: string;
  /** Proposed regex source, ready to be added to the normalization table. */
  pattern: string;
  /** Proposed neutral token (same vocabulary as `normalize.ts`: <NUM>, <UUID>…). */
  replacement: string;
  /** True when the existing table already covers the difference. */
  alreadyCovered: boolean;
  /** 0..1 — how sure we are that this token is the volatile one. */
  confidence: number;
}

/** Whitespace words of a template. */
function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/** First word index where the two templates differ, with that word. */
function firstDifference(a: string[], b: string[]): { index: number; token: string } | undefined {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i += 1) {
    if (a[i] !== b[i]) return { index: i, token: a[i] };
  }
  if (a.length === b.length) return undefined;
  const longer = a.length > b.length ? a : b;
  return { index: common, token: longer.slice(common).join(' ') };
}

/** Shape of a token: the regex to add and the neutral token it becomes. */
interface TokenShape {
  pattern: string;
  replacement: string;
  confidence: number;
}

const UUID_TOKEN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SHA_TOKEN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const LONG_HEX_TOKEN = /^[0-9a-fA-F]{8,39}$/;
const SHORT_HEX_TOKEN = /^(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{4,7}$/;
const NUMBER_TOKEN = /^-?\d+(?:\.\d+)?$/;

/** Classify the differing token into an existing neutral token vocabulary. */
function shapeOf(token: string): TokenShape {
  if (NUMBER_TOKEN.test(token)) {
    return { pattern: '\\b-?\\d+(?:\\.\\d+)?\\b', replacement: '<NUM>', confidence: 0.9 };
  }
  if (UUID_TOKEN.test(token)) {
    return {
      pattern:
        '\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b',
      replacement: '<UUID>',
      confidence: 0.95,
    };
  }
  if (SHA_TOKEN.test(token)) {
    return {
      pattern: '\\b[0-9a-fA-F]{40}\\b|\\b[0-9a-fA-F]{64}\\b',
      replacement: '<SHA>',
      confidence: 0.95,
    };
  }
  if (LONG_HEX_TOKEN.test(token)) {
    return { pattern: '\\b[0-9a-fA-F]{8,39}\\b', replacement: '<HEX>', confidence: 0.75 };
  }
  if (SHORT_HEX_TOKEN.test(token)) {
    return { pattern: '\\b[0-9a-fA-F]{4,7}\\b', replacement: '<HEX>', confidence: 0.6 };
  }
  // Bounded fallback: an identifier holding a digit, never a plain word.
  return {
    pattern: '\\b(?=[A-Za-z0-9_-]*\\d)[A-Za-z0-9_-]{3,64}\\b',
    replacement: '<NUM>',
    confidence: 0.35,
  };
}

/**
 * Suggest the normalization rule that would have kept two templates together.
 *
 * The templates are compared word by word; the first differing word is
 * isolated, classified (number, UUID, commit hash, hex run, opaque identifier)
 * and turned into a regex source plus a neutral token. `alreadyCovered` is not
 * a guess: `normalizeMessage` is really called on both templates, and the
 * difference is declared covered when the existing table already makes them
 * identical. Returns `undefined` when there is nothing to suggest.
 */
export function suggestNormalizationRule(
  templateA: string,
  templateB: string,
): NormalizationRuleSuggestion | undefined {
  if (templateA === templateB) return undefined;
  const diff = firstDifference(words(templateA), words(templateB));
  if (!diff) return undefined;
  const shape = shapeOf(diff.token);
  const alreadyCovered = normalizeMessage(templateA) === normalizeMessage(templateB);
  return {
    token: diff.token,
    pattern: shape.pattern,
    replacement: shape.replacement,
    alreadyCovered,
    confidence: alreadyCovered ? Math.max(shape.confidence, 0.95) : shape.confidence,
  };
}
