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
  type DiagnoseContext,
  type Diagnostic,
  type DiagnosticKind,
  type ErrorBlock,
  type ExtractResult,
  type FailedTestCase,
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

export interface DiagnosisApi {
  diagnose(ctx: DiagnoseContext): Diagnostic;
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

/** A commit of the dataset, with the moment it was seen. */
interface CommitInfo {
  at: string;
  commit: CandidateCommit;
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

/** Index of the commits of the dataset, with the moment they were seen. */
function buildCommitIndex(occurrences: SampleOccurrence[]): CommitInfo[] {
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

/** Count the diagnostics per kind, every kind being present. */
function countByKind(outcomes: OccurrenceOutcome[]): Record<DiagnosticKind, number> {
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

/** Extract the error blocks of a failure; never returns an empty list. */
function extractBlocks(sample: SampleOccurrence, engine: ReplayEngine): ErrorBlock[] {
  const result = engine.extraction.extractErrorBlocks({
    stepLog: sample.log,
    testCases: sample.testCases,
  });
  return result.blocks.length > 0 ? result.blocks : [syntheticBlock(sample)];
}

/** Block used when the extractor found nothing at all. */
function syntheticBlock(sample: SampleOccurrence): ErrorBlock {
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

/** Create or refresh the signature of a block, then apply a known resolution. */
async function upsertSignature(
  sample: SampleOccurrence,
  block: ErrorBlock,
  ctx: ReplayContext,
): Promise<Signature> {
  const signatureId = ctx.engine.signing.signatureOf(block);
  const familyId = ctx.engine.signing.familyOf(block);
  const existing = await ctx.store.getSignature(signatureId);
  const signature: Signature = existing
    ? {
        ...existing,
        occurrences: existing.occurrences + 1,
        lastSeen: existing.lastSeen < sample.at ? sample.at : existing.lastSeen,
      }
    : {
        id: signatureId,
        familyId,
        category: block.category,
        errorType: block.errorType,
        template: block.message,
        frames: block.frames,
        status: 'new',
        firstSeen: sample.at,
        lastSeen: sample.at,
        occurrences: 1,
        testName: block.testName ?? sample.testCases?.[0]?.name,
      };
  await ctx.store.saveSignature(signature);
  await applyKnownResolution(signature, sample, ctx);
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
): Promise<void> {
  const match = ctx.resolutions.find((r) => matchesResolution(r, signature));
  if (!match) return;
  if (await ctx.store.getResolution(signature.id)) return;
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
}

/** Build the occurrence row of a block. */
function buildOccurrence(
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

/** Process one failure: store, diagnose and plan the tickets. */
async function processFailure(
  sample: SampleOccurrence,
  ctx: ReplayContext,
): Promise<OccurrenceOutcome[]> {
  const blocks = extractBlocks(sample, ctx.engine);
  const outcomes: OccurrenceOutcome[] = [];
  for (const [index, block] of blocks.entries()) {
    const signature = await upsertSignature(sample, block, ctx);
    const occurrence = buildOccurrence(sample, index, signature, block);
    await ctx.store.saveOccurrence(occurrence);
    ctx.occurrences.push(occurrence);
    outcomes.push(await diagnoseOccurrence(occurrence, signature, ctx));
  }
  return outcomes;
}

/** Occurrences of the same signature, at or before the given one. */
async function priorOccurrences(ctx: ReplayContext, occurrence: Occurrence): Promise<Occurrence[]> {
  const all = await ctx.store.listOccurrences(occurrence.signatureId);
  return all.filter((o) => o.id !== occurrence.id && o.occurredAt <= occurrence.occurredAt);
}

/** Diagnose one occurrence and plan the ticket actions it implies. */
async function diagnoseOccurrence(
  occurrence: Occurrence,
  signature: Signature,
  ctx: ReplayContext,
): Promise<OccurrenceOutcome> {
  const history = await priorOccurrences(ctx, occurrence);
  const familyAll = await ctx.store.listFamilyOccurrences(occurrence.familyId);
  const familyHistory = familyAll.filter(
    (o) => o.id !== occurrence.id && o.occurredAt <= occurrence.occurredAt,
  );
  const resolution = await ctx.store.getResolution(signature.id);
  const outbreak = await ctx.store.findOutbreak(signature.familyId);
  const diagnostic = ctx.engine.diagnosis.diagnose({
    occurrence,
    history,
    familyHistory,
    resolution,
    branchContainsResolution: false,
    outbreak,
    changedFiles: occurrence.changedFiles,
    settings: ctx.settings,
  });
  const verdict = ctx.engine.flakiness.assessFlakiness([...history, occurrence], {
    settings: ctx.settings,
    now: ctx.now,
  });
  const tickets = ctx.engine.tickets.planTicketActions({
    signature,
    occurrences: [...history, occurrence],
    verdict,
    existingIssueKey: signature.issueKey,
    now: ctx.now,
    settings: ctx.settings,
  });
  return { occurrence, diagnostic, tickets };
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
  outcomes[index] = await diagnoseOccurrence(occurrence, signature, ctx);
}

/** Deduce a candidate resolution from the commits seen between failure and success. */
async function deduceResolution(
  failure: Occurrence,
  sample: SampleOccurrence,
  ctx: ReplayContext,
): Promise<void> {
  const existing = await ctx.store.getResolution(failure.signatureId);
  if (existing?.confirmedBy) return;
  const history = await priorOccurrences(ctx, failure);
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
  if (candidate) await ctx.store.saveResolution(candidate);
}
