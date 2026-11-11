/**
 * Deterministic replay of the sample dataset (CI-11).
 *
 * A replay walks the sample occurrences in chronological order and pushes
 * every failure through the same chain as the live pipeline: extraction,
 * signature, diagnosis and ticket plan. The result is stored in a
 * `MemoryStore`, so the sample dataset is replayable without Bitbucket.
 *
 * The engine parts live in the other modules of the package. They are loaded
 * lazily from their own file, which keeps this module independent from their
 * build order and lets the tests inject local doubles.
 */

import {
  DEFAULT_SETTINGS,
  type Category,
  type DiagnoseContext,
  type Diagnostic,
  type DiagnosticKind,
  type ErrorBlock,
  type ExtractResult,
  type FailedTestCase,
  type Frame,
  type FlakyVerdict,
  type Occurrence,
  type ReplayResult,
  type Resolution,
  type SampleDataset,
  type SampleOccurrence,
  type SampleResolution,
  type Settings,
  type Signature,
  type TicketAction,
} from './types.js';
import { MemoryStore, type Store } from './store.js';
import {
  TicketLedger,
  attachIssueKey,
  branchHasFix,
  buildCommitIndex,
  buildOccurrence,
  countByKind,
  extractBlocks,
  markFlaky,
  markResolved,
  priorOccurrences,
  statusAfterOccurrence,
  syntheticBlock,
  type CommitInfo,
} from './replay-state.js';

/**
 * The engine parts the replay needs: each one is the contract of the module
 * that owns it (A: extraction and signature, B: diagnosis and flakiness,
 * C: tickets and resolutions).
 */
export interface ExtractionApi {
  extractErrorBlocks(input: {
    stepLog?: string;
    testCases?: FailedTestCase[];
    maxTotalBytes?: number;
  }): ExtractResult;
}

export interface SigningApi {
  signatureOf(block: ErrorBlock): string;
  familyOf(block: ErrorBlock): string;
}

/** Hints the diagnosis accepts on top of the frozen context (§ 10). */
export type DiagnosisHints = {
  now?: Date;
  category?: Category;
  frames?: Frame[];
  signature?: Signature;
};

export interface DiagnosisApi {
  diagnose(ctx: DiagnoseContext & DiagnosisHints): Diagnostic;
}

export interface FlakinessApi {
  assessFlakiness(
    occs: Occurrence[],
    opts?: { settings?: Partial<Settings>; now?: Date },
  ): FlakyVerdict;
}

export interface TicketApi {
  planTicketActions(input: {
    signature: Signature;
    occurrences: Occurrence[];
    verdict?: FlakyVerdict;
    existingIssueKey?: string;
    lastCommentAt?: string;
    now?: Date;
    settings?: Partial<Settings>;
  }): TicketAction[];
}

/** A commit proposed as a fix (module C). */
export interface CandidateCommit {
  sha: string;
  author: string;
  files: string[];
  message: string;
}

export interface ResolutionApi {
  inferCandidateResolution(input: {
    signatureId: string;
    history: Occurrence[];
    commitsBetween: CandidateCommit[];
    linkedIssueKey?: string;
    now?: Date;
  }): Resolution | undefined;
}

/** Every engine part the replay needs. */
export interface ReplayEngine {
  extraction: ExtractionApi;
  signing: SigningApi;
  diagnosis: DiagnosisApi;
  flakiness: FlakinessApi;
  tickets: TicketApi;
  resolutions: ResolutionApi;
}

/** Load one sibling module and check that it exports the expected functions. */
async function loadModule<T>(name: string, exports: string[]): Promise<T> {
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(/* @vite-ignore */ `./${name}.js`)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Replay engine module "${name}" is unavailable: ${(error as Error).message}`);
  }
  for (const field of exports) {
    if (typeof loaded[field] !== 'function') {
      throw new Error(`Replay engine module "${name}" does not export "${field}"`);
    }
  }
  return loaded as T;
}

/**
 * Load the whole engine from the sibling modules of the package.
 *
 * The masking module is not needed here: the replay works on texts that are
 * already masked.
 */
export async function loadEngine(): Promise<ReplayEngine> {
  const [extraction, signing, diagnosis, flakiness, tickets, resolutions] = await Promise.all([
    loadModule<ExtractionApi>('extract', ['extractErrorBlocks']),
    loadModule<SigningApi>('sign', ['signatureOf', 'familyOf']),
    loadModule<DiagnosisApi>('diagnose', ['diagnose']),
    loadModule<FlakinessApi>('flaky', ['assessFlakiness']),
    loadModule<TicketApi>('tickets', ['planTicketActions']),
    loadModule<ResolutionApi>('resolutions', ['inferCandidateResolution']),
  ]);
  return { extraction, signing, diagnosis, flakiness, tickets, resolutions };
}

/** Check that an injected engine exposes every part the replay needs. */
export function assertEngine(engine: ReplayEngine): void {
  const parts: Array<[string, unknown]> = [
    ['extraction', engine.extraction],
    ['signing', engine.signing],
    ['diagnosis', engine.diagnosis],
    ['flakiness', engine.flakiness],
    ['tickets', engine.tickets],
    ['resolutions', engine.resolutions],
  ];
  for (const [name, part] of parts) {
    if (!part || typeof part !== 'object') {
      throw new Error(`Replay engine is incomplete: "${name}" is missing`);
    }
  }
}

/** Options of a replay. */
export interface ReplayOptions {
  settings?: Partial<Settings>;
  now?: Date;
}

/** Options of a replay driven by an explicit engine. */
export interface ReplayWithEngineOptions extends ReplayOptions {
  /** Store to fill; a fresh `MemoryStore` is used when omitted. */
  store?: Store;
}

/** Internal context of a replay. */
interface ReplayContext {
  engine: ReplayEngine;
  store: Store;
  settings: Settings;
  now: Date;
  commits: CommitInfo[];
  resolutions: SampleResolution[];
  occurrences: Occurrence[];
  /** Commits each occurrence's branch already contains (ancestry, § 10.2). */
  contains: Map<string, string[]>;
  /** Simulated Jira side: issue keys and last comment of each family. */
  ledger: TicketLedger;
}

/** A diagnostic produced for one occurrence, with the tickets it produced. */
interface OccurrenceOutcome {
  occurrence: Occurrence;
  diagnostic: Diagnostic;
  tickets: TicketAction[];
}

/** Replay the sample dataset with the engine modules of the package. */
export async function replay(dataset: SampleDataset, opts?: ReplayOptions): Promise<ReplayResult> {
  const engine = await loadEngine();
  return replayWithEngine(dataset, engine, opts);
}

/** Replay the sample dataset with an explicit engine (tests and tools). */
export async function replayWithEngine(
  dataset: SampleDataset,
  engine: ReplayEngine,
  opts?: ReplayWithEngineOptions,
): Promise<ReplayResult> {
  assertEngine(engine);
  const started = Date.now();
  const context: ReplayContext = {
    engine,
    store: opts?.store ?? new MemoryStore(),
    settings: { ...DEFAULT_SETTINGS, ...opts?.settings },
    now: opts?.now ?? new Date(),
    commits: buildCommitIndex(dataset.occurrences),
    resolutions: dataset.resolutions ?? [],
    occurrences: [],
    contains: new Map<string, string[]>(),
    ledger: new TicketLedger(),
  };
  const ordered = [...dataset.occurrences].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const outcomes: OccurrenceOutcome[] = [];
  let failures = 0;
  for (const sample of ordered) {
    if (sample.outcome === 'failure') {
      failures += 1;
      outcomes.push(...(await processFailure(sample, context)));
    } else {
      await processSuccess(sample, context, outcomes);
    }
  }
  return {
    datasetName: dataset.name,
    occurrences: failures,
    signatures: await context.store.listSignatures(),
    diagnostics: outcomes.map((o) => ({ occurrence: o.occurrence, diagnostic: o.diagnostic })),
    tickets: outcomes.flatMap((o) => o.tickets),
    byKind: countByKind(outcomes),
    elapsedMs: Date.now() - started,
  };
}

/** Create or refresh the signature of a block, then apply a known resolution. */
async function upsertSignature(
  sample: SampleOccurrence,
  block: ErrorBlock,
  ctx: ReplayContext,
): Promise<Signature> {
  const signatureId = ctx.engine.signing.signatureOf(block);
  const familyId = ctx.engine.signing.familyOf(block);
  const existing = await ctx.store.getSignature(signatureId);
  const resolution = await ctx.store.getResolution(signatureId);
  const status = statusAfterOccurrence(existing?.status, resolution, branchHasFix(sample, resolution?.commit ?? ''));
  const signature: Signature = existing
    ? {
        ...existing,
        occurrences: existing.occurrences + 1,
        lastSeen: existing.lastSeen < sample.at ? sample.at : existing.lastSeen,
        status,
      }
    : {
        id: signatureId,
        familyId,
        category: block.category,
        errorType: block.errorType,
        template: block.message,
        frames: block.frames,
        status,
        firstSeen: sample.at,
        lastSeen: sample.at,
        occurrences: 1,
        testName: block.testName ?? sample.testCases?.[0]?.name,
      };
  await ctx.store.saveSignature(signature);
  if (await applyKnownResolution(signature, sample, ctx)) await markResolved(ctx.store, signature);
  return signature;
}

/** True when a resolution of the dataset targets this signature. */
function matchesResolution(resolution: SampleResolution, signature: Signature): boolean {
  const wanted = resolution.match;
  if (wanted.testName !== undefined) return wanted.testName === signature.testName;
  if (wanted.contains !== undefined) return signature.template.includes(wanted.contains);
  return false;
}

/** Save the resolution the dataset already knows about, if any. */
async function applyKnownResolution(
  signature: Signature,
  sample: SampleOccurrence,
  ctx: ReplayContext,
): Promise<boolean> {
  const match = ctx.resolutions.find((r) => matchesResolution(r, signature));
  if (!match) return false;
  if (await ctx.store.getResolution(signature.id)) return false;
  const resolution: Resolution = {
    id: `res-${signature.id}`,
    signatureId: signature.id,
    commit: match.commit,
    author: match.author,
    files: match.files,
    note: match.note,
    confidence: match.confirmed ? 0.9 : 0.4,
    confirmedBy: match.confirmed ? 'sample-dataset' : undefined,
    confirmedAt: match.confirmed ? sample.at : undefined,
  };
  await ctx.store.saveResolution(resolution);
  return true;
}

/** Process one failure: store, diagnose and plan the tickets. */
async function processFailure(
  sample: SampleOccurrence,
  ctx: ReplayContext,
): Promise<OccurrenceOutcome[]> {
  const blocks = extractBlocks(sample, ctx.engine.extraction);
  const outcomes: OccurrenceOutcome[] = [];
  for (const [index, block] of blocks.entries()) {
    const signature = await upsertSignature(sample, block, ctx);
    const occurrence = buildOccurrence(sample, index, signature, block);
    ctx.contains.set(occurrence.id, sample.containsCommits ?? []);
    await ctx.store.saveOccurrence(occurrence);
    ctx.occurrences.push(occurrence);
    const diagnostic = await diagnoseOnly(occurrence, signature, ctx);
    const tickets = await planTicketsFor(occurrence, signature, ctx);
    outcomes.push({ occurrence, diagnostic, tickets });
  }
  return outcomes;
}

/** Compute the diagnostic of one occurrence; no side effect on the ledger. */
async function diagnoseOnly(
  occurrence: Occurrence,
  signature: Signature,
  ctx: ReplayContext,
): Promise<Diagnostic> {
  const history = await priorOccurrences(ctx.store, occurrence);
  const familyAll = await ctx.store.listFamilyOccurrences(occurrence.familyId);
  const familyHistory = familyAll.filter(
    (o) => o.id !== occurrence.id && o.occurredAt <= occurrence.occurredAt,
  );
  const resolution = await ctx.store.getResolution(signature.id);
  const outbreak = await ctx.store.findOutbreak(signature.familyId);
  return ctx.engine.diagnosis.diagnose({
    occurrence,
    history,
    familyHistory,
    resolution,
    branchContainsResolution: containsResolution(ctx, occurrence, resolution),
    outbreak,
    changedFiles: occurrence.changedFiles,
    settings: ctx.settings,
    now: new Date(occurrence.occurredAt),
    category: signature.category,
    frames: signature.frames,
    signature,
  });
}

/**
 * Plan the ticket actions of one occurrence and record them in the ledger.
 *
 * Kept apart from the diagnostic: a later success at the same commit refines
 * the diagnostic, but the ticket decisions were already taken (and a second
 * planning would open a second ticket or repeat the comment of the day).
 */
async function planTicketsFor(
  occurrence: Occurrence,
  signature: Signature,
  ctx: ReplayContext,
): Promise<TicketAction[]> {
  const history = await priorOccurrences(ctx.store, occurrence);
  const asOf = new Date(occurrence.occurredAt);
  const verdict = ctx.engine.flakiness.assessFlakiness([...history, occurrence], {
    settings: ctx.settings,
    now: asOf,
  });
  await markFlaky(ctx.store, signature, verdict);
  const familyId = signature.familyId;
  const tickets = ctx.engine.tickets.planTicketActions({
    signature,
    occurrences: [...history, occurrence],
    verdict,
    existingIssueKey: ctx.ledger.keyFor(familyId),
    lastCommentAt: ctx.ledger.lastCommentFor(familyId),
    now: asOf,
    settings: ctx.settings,
  });
  ctx.ledger.record(familyId, tickets, occurrence.occurredAt);
  await attachIssueKey(ctx.store, ctx.ledger, signature);
  return tickets;
}

/** True when the branch of the occurrence already contains the fixing commit. */
function containsResolution(
  ctx: ReplayContext,
  occurrence: Occurrence,
  resolution: Resolution | undefined,
): boolean {
  if (!resolution) return false;
  return (ctx.contains.get(occurrence.id) ?? []).includes(resolution.commit);
}

/**
 * A success marks the previous failure of the same step and commit as "passed
 * on retry", refines its diagnostic and feeds the resolution candidates.
 */
async function processSuccess(
  sample: SampleOccurrence,
  ctx: ReplayContext,
  outcomes: OccurrenceOutcome[],
): Promise<void> {
  const matching = ctx.occurrences.filter(
    (o) => o.repo === sample.repo && o.commit === sample.commit && o.stepName === sample.step,
  );
  const failure = matching[matching.length - 1];
  if (!failure) return;
  failure.passedOnRetry = true;
  await ctx.store.saveOccurrence(failure);
  await refineOutcome(failure, ctx, outcomes);
  await deduceResolution(failure, sample, ctx);
}

/** Recompute the diagnostic of an occurrence whose history just changed. */
async function refineOutcome(
  occurrence: Occurrence,
  ctx: ReplayContext,
  outcomes: OccurrenceOutcome[],
): Promise<void> {
  const index = outcomes.findIndex((o) => o.occurrence.id === occurrence.id);
  if (index < 0) return;
  const signature = await ctx.store.getSignature(occurrence.signatureId);
  if (!signature) return;
  const previous = outcomes[index];
  const diagnostic = await diagnoseOnly(occurrence, signature, ctx);
  // A success can be what makes a signature unstable: while the family has no
  // ticket yet, nothing has been decided, so the plan is re-evaluated. Once a
  // ticket exists, the earlier decisions stand (the ledger already enforces
  // "one ticket per family" and "one comment per day").
  const tickets = ctx.ledger.keyFor(occurrence.familyId) === undefined
    ? await planTicketsFor(occurrence, signature, ctx)
    : previous.tickets;
  outcomes[index] = { ...previous, diagnostic, tickets };
}

/** Deduce a candidate resolution from the commits seen between failure and success. */
async function deduceResolution(
  failure: Occurrence,
  sample: SampleOccurrence,
  ctx: ReplayContext,
): Promise<void> {
  const existing = await ctx.store.getResolution(failure.signatureId);
  if (existing?.confirmedBy) return;
  const history = await priorOccurrences(ctx.store, failure);
  const commitsBetween = ctx.commits
    .filter((c) => c.at > failure.occurredAt && c.at <= sample.at)
    .map((c) => c.commit);
  if (commitsBetween.length === 0) return;
  const candidate = ctx.engine.resolutions.inferCandidateResolution({
    signatureId: failure.signatureId,
    history,
    commitsBetween,
    now: ctx.now,
  });
  if (!candidate) return;
  await ctx.store.saveResolution(candidate);
  const signature = await ctx.store.getSignature(failure.signatureId);
  if (signature) await markResolved(ctx.store, signature);
}
