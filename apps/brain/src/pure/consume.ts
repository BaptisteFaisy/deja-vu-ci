/**
 * Idempotent core of the consumer (§ 8.1 steps 4–5, § 15 step 5).
 *
 * One queued message = one `IngestPayload`. The flow mirrors the engine's
 * own replay wiring: extract → sign → store → diagnose → plan tickets →
 * apply. Every engine function arrives by injection (`ConsumerEngine`), the
 * memory by injection (`ConsumerStore`, structurally a subset of the core
 * `Store`) and the Jira side by injection (`TicketApplier`): this module
 * stays pure and testable, and never reimplements engine logic.
 *
 * Idempotency: the occurrence id is a deterministic digest of the payload
 * identity (workspace, repo, branch, commit, step, failure time, block
 * index). A replayed message produces the same ids; an id already in the
 * store skips its block, so replaying changes nothing.
 *
 * Pure module: type-only imports from `@dejavu/core`, `node:crypto` only.
 */

import { createHash } from 'node:crypto';
import type {
  Diagnostic,
  ErrorBlock,
  ExtractResult,
  FailedTestCase,
  FlakyVerdict,
  Occurrence,
  Outbreak,
  Resolution,
  Settings,
  Signature,
  SignatureKey,
  TestStats,
  TicketAction,
} from '@dejavu/core';
import type { IngestPayload } from '@dejavu/core';
import type { DiagnoseHints } from '@dejavu/core';
import type { DiagnoseContext } from '@dejavu/core';
import type { TicketPlanInput } from '@dejavu/core';
import { branchContainsResolution } from '../actions/context.js';

/** Memory subset the consumer needs — the core `Store` satisfies it. */
export interface ConsumerStore {
  getSignature(id: string): Promise<Signature | undefined>;
  saveSignature(s: Signature): Promise<void>;
  saveOccurrence(o: Occurrence): Promise<void>;
  listOccurrences(signatureId: string): Promise<Occurrence[]>;
  listFamilyOccurrences(familyId: string): Promise<Occurrence[]>;
  getResolution(signatureId: string): Promise<Resolution | undefined>;
  saveRawExcerpt(e: { occurrenceId: string; text: string; expiresAt: string }): Promise<void>;
  saveTestStats(t: TestStats): Promise<void>;
  saveOutbreak(o: Outbreak): Promise<void>;
  findOutbreak(familyId: string): Promise<Outbreak | undefined>;
  getSettings(): Promise<Settings>;
}

/** Engine functions used by the consumer — signatures of the contract. */
export interface ConsumerEngine {
  extractErrorBlocks(input: {
    stepLog?: string;
    testCases?: FailedTestCase[];
    maxTotalBytes?: number;
  }): ExtractResult;
  signatureKeys(block: ErrorBlock): SignatureKey;
  diagnose(ctx: DiagnoseContext & DiagnoseHints): Diagnostic;
  assessFlakiness(occs: Occurrence[], opts?: { settings?: Partial<Settings>; now?: Date }): FlakyVerdict;
  planTicketActions(input: TicketPlanInput): TicketAction[];
  detectOutbreak(occs: Occurrence[], opts?: { settings?: Partial<Settings>; now?: Date }): Outbreak | undefined;
  testStats(occs: Occurrence[], testName: string): TestStats;
  detectRegression(signature: Signature, occurrence: Occurrence, resolution?: Resolution): boolean;
}

/** Result of applying one ticket action on the Jira side. */
export interface AppliedTicket {
  /** Key of the issue the action targeted or created. */
  issueKey?: string;
}

/** The Jira side, injected: the pure core never calls the platform. */
export interface TicketApplier {
  /** ISO date of the last synthesis comment posted by the app, if any. */
  lastCommentAt?(issueKey: string, signatureId: string): Promise<string | undefined>;
  apply(action: TicketAction, signature: Signature): Promise<AppliedTicket>;
}

/** Everything the consumer core needs, injected. */
export interface ConsumerDeps {
  store: ConsumerStore;
  engine: ConsumerEngine;
  tickets: TicketApplier;
  now(): Date;
}

/** One processed error block, with what it produced. */
export interface ConsumedBlock {
  occurrenceId: string;
  signatureId: string;
  diagnostic: Diagnostic;
  ticketActions: TicketAction[];
}

/** Outcome of one message: processed blocks, or an explicit skip/error. */
export type ConsumeResult =
  | { ok: true; processed: ConsumedBlock[]; replays: number; skipped?: string }
  | { ok: false; error: string };

/** Deterministic occurrence id: same message, same ids (idempotency). */
export function occurrenceIdFor(payload: IngestPayload, blockIndex: number): string {
  const identity = [
    payload.workspace,
    payload.repository,
    payload.branch,
    payload.commit,
    payload.stepName,
    payload.failedAt,
    String(blockIndex),
  ].join('|');
  return createHash('sha256').update(identity).digest('hex').slice(0, 40);
}

/** ISO date `days` after `from`. */
export function plusDaysIso(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

/** The occurrence row of one block (§ 16). */
export function buildOccurrence(
  payload: IngestPayload,
  blockIndex: number,
  keys: SignatureKey,
  block: ErrorBlock,
): Occurrence {
  return {
    id: occurrenceIdFor(payload, blockIndex),
    signatureId: keys.signature,
    familyId: keys.family,
    workspace: payload.workspace,
    repo: payload.repository,
    branch: payload.branch,
    commit: payload.commit,
    author: payload.author,
    ...(payload.prId !== undefined ? { prId: payload.prId } : {}),
    stepName: payload.stepName,
    durationS: payload.durationS,
    ...(payload.buildUrl !== undefined ? { buildUrl: payload.buildUrl } : {}),
    occurredAt: payload.failedAt,
    passedOnRetry: false,
    ...(block.testName !== undefined ? { testName: block.testName } : {}),
    ...(payload.changedFiles !== undefined ? { changedFiles: payload.changedFiles } : {}),
  };
}

/** Status transitions of a signature (§ 8.2, § 8.3, § 8.4). */
export function nextStatus(
  existing: Signature | undefined,
  regression: boolean,
  verdict: FlakyVerdict,
): Signature['status'] {
  if (regression) return 'regression';
  if (existing === undefined) return 'new';
  if (verdict.flaky) return 'flaky';
  if (existing.status === 'new') return 'known';
  return existing.status;
}

/** Creates or refreshes the signature of a block, like the engine replay. */
export async function upsertSignature(
  deps: ConsumerDeps,
  block: ErrorBlock,
  keys: SignatureKey,
  occurrence: Occurrence,
  verdict: FlakyVerdict,
): Promise<Signature> {
  const existing = await deps.store.getSignature(keys.signature);
  const resolution = existing ? await deps.store.getResolution(existing.id) : undefined;
  const regression = existing
    ? deps.engine.detectRegression(existing, occurrence, resolution)
    : false;
  const at = occurrence.occurredAt;
  const signature: Signature = existing
    ? {
        ...existing,
        occurrences: existing.occurrences + 1,
        lastSeen: existing.lastSeen < at ? at : existing.lastSeen,
        status: nextStatus(existing, regression, verdict),
      }
    : {
        id: keys.signature,
        familyId: keys.family,
        category: block.category,
        errorType: block.errorType,
        template: block.message,
        frames: block.frames,
        status: nextStatus(undefined, regression, verdict),
        firstSeen: at,
        lastSeen: at,
        occurrences: 1,
        ...(block.testName !== undefined ? { testName: block.testName } : {}),
      };
  await deps.store.saveSignature(signature);
  return signature;
}

/** Diagnosis of one stored occurrence, through the single engine function. */
export async function diagnoseOccurrence(
  deps: ConsumerDeps,
  payload: IngestPayload,
  occurrence: Occurrence,
  block: ErrorBlock,
  settings: Settings,
): Promise<Diagnostic> {
  const [history, familyAll, resolution, outbreak] = await Promise.all([
    deps.store.listOccurrences(occurrence.signatureId),
    deps.store.listFamilyOccurrences(occurrence.familyId),
    deps.store.getResolution(occurrence.signatureId),
    deps.store.findOutbreak(occurrence.familyId),
  ]);
  const contains = payload.containsResolution?.contains
    ?? branchContainsResolution(occurrence, resolution);
  return deps.engine.diagnose({
    occurrence,
    history: history.filter((o) => o.id !== occurrence.id),
    familyHistory: familyAll.filter((o) => o.id !== occurrence.id),
    ...(resolution ? { resolution } : {}),
    branchContainsResolution: contains,
    ...(outbreak ? { outbreak } : {}),
    ...(occurrence.changedFiles ? { changedFiles: occurrence.changedFiles } : {}),
    settings,
    category: block.category,
    frames: block.frames,
    errorText: block.rawText,
  });
}

/** Plans the ticket actions of a signature and applies them on Jira. */
export async function planAndApplyTickets(
  deps: ConsumerDeps,
  signature: Signature,
  occurrences: Occurrence[],
  verdict: FlakyVerdict,
  settings: Settings,
): Promise<{ actions: TicketAction[]; signature: Signature }> {
  let lastCommentAt: string | undefined;
  if (signature.issueKey && deps.tickets.lastCommentAt) {
    lastCommentAt = await deps.tickets.lastCommentAt(signature.issueKey, signature.id);
  }
  const actions = deps.engine.planTicketActions({
    signature,
    occurrences,
    verdict,
    ...(signature.issueKey ? { existingIssueKey: signature.issueKey } : {}),
    ...(lastCommentAt ? { lastCommentAt } : {}),
    now: deps.now(),
    settings,
  });
  let current = signature;
  for (const action of actions) {
    const applied = await deps.tickets.apply(action, current);
    if (applied.issueKey && current.issueKey !== applied.issueKey) {
      current = { ...current, issueKey: applied.issueKey };
      await deps.store.saveSignature(current);
    }
  }
  return { actions, signature: current };
}

/** Processes one error block end to end. */
async function consumeBlock(
  deps: ConsumerDeps,
  payload: IngestPayload,
  block: ErrorBlock,
  blockIndex: number,
  settings: Settings,
): Promise<ConsumedBlock> {
  const keys = deps.engine.signatureKeys(block);
  const occurrence = buildOccurrence(payload, blockIndex, keys, block);
  const prior = await deps.store.listOccurrences(keys.signature);
  const verdict = deps.engine.assessFlakiness([...prior, occurrence], { settings, now: deps.now() });
  const signature = await upsertSignature(deps, block, keys, occurrence, verdict);
  await deps.store.saveOccurrence(occurrence);
  await deps.store.saveRawExcerpt({
    occurrenceId: occurrence.id,
    text: block.rawText,
    expiresAt: plusDaysIso(deps.now(), settings.rawRetentionDays),
  });
  if (signature.testName) {
    await deps.store.saveTestStats(deps.engine.testStats([...prior, occurrence], signature.testName));
  }
  const family = await deps.store.listFamilyOccurrences(keys.family);
  const outbreak = deps.engine.detectOutbreak([...family, occurrence], { settings, now: deps.now() });
  if (outbreak) await deps.store.saveOutbreak(outbreak);
  const diagnostic = await diagnoseOccurrence(deps, payload, occurrence, block, settings);
  const planned = await planAndApplyTickets(
    deps, signature, [...prior, occurrence], verdict, settings,
  );
  return {
    occurrenceId: occurrence.id,
    signatureId: signature.id,
    diagnostic,
    ticketActions: planned.actions,
  };
}

/**
 * Consumes one ingested payload. Never throws: an engine or Jira failure
 * becomes `{ ok: false, error }` and the platform may retry the message.
 */
export async function consumeIngest(
  payload: IngestPayload,
  deps: ConsumerDeps,
): Promise<ConsumeResult> {
  try {
    const settings = await deps.store.getSettings();
    const extracted = deps.engine.extractErrorBlocks({
      stepLog: payload.errorBlocks.join('\n\n'),
      ...(payload.testCases ? { testCases: payload.testCases } : {}),
    });
    if (extracted.blocks.length === 0) {
      return { ok: true, processed: [], replays: 0, skipped: 'no error block in the payload' };
    }
    const processed: ConsumedBlock[] = [];
    let replays = 0;
    for (const [index, block] of extracted.blocks.entries()) {
      const id = occurrenceIdFor(payload, index);
      const known = await deps.store.listOccurrences(deps.engine.signatureKeys(block).signature);
      if (known.some((o) => o.id === id)) {
        replays += 1;
        continue;
      }
      processed.push(await consumeBlock(deps, payload, block, index, settings));
    }
    return { ok: true, processed, replays };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
