/**
 * Collecting one failing build and turning it into an `IngestPayload`.
 *
 * This is the wiring layer: every decision lives in the pure modules
 * (`pure/payload.ts`, `pure/pipeline.ts`, `pure/range.ts`) and every I/O
 * goes through an injected dependency, so the flow can be rehearsed without
 * Bitbucket and without Forge.
 *
 * Fallbacks (§ 17): a step log that cannot be read is not an error — the
 * Sensor falls back on the test reports, and when neither is available it
 * says so, and the Brain answers "uncertain" instead of losing the build.
 */

import type { IngestPayload, QueryRequest, QueryResponse } from '@dejavu/core';
import { buildIngestPayload, type Masker, type SensorInputs } from './pure/payload';
import { parseBuildStatusEvent, type BuildStatusEvent } from './pure/event';
import {
  commitReader,
  readBranchHistory,
  readChangedFiles,
  readFailingStep,
  type BitbucketReader,
  type StepContext,
} from './pipelines';
import { containsCommit, toContainsResolution } from './ancestry';
import type { StoragePort } from './settings';

/** The three routes of the Brain's web trigger (§ 15). */
export type BrainRoute = 'ingest' | 'query' | 'universal';

/** Answer of a signed call to the Brain. */
export type BrainAnswer =
  | { ok: true; status?: number; body?: unknown }
  | { ok: false; status?: number; error: string };

/**
 * The signed transport to the Brain.
 *
 * `send.ts` provides the Forge implementation (`@dejavu/bridge` + the
 * external fetch); the tests provide a local double.
 */
export interface BrainTransport {
  post(baseUrl: string, route: BrainRoute, secret: string, payload: unknown): Promise<BrainAnswer>;
}

/** Everything the composition needs, injected by the resolver. */
export interface SensorDeps {
  /** Reads the Bitbucket API. */
  read: BitbucketReader;
  /** Forge application storage. */
  storage: StoragePort;
  /** Returns the masking engine; rejects when it is unavailable. */
  masker: () => Promise<Masker>;
  /** Signs and posts to the Brain. */
  transport: BrainTransport;
}

/** Outcome of the collection. */
export interface BuiltPayload {
  /** The payload to send, when there is something worth sending. */
  payload?: IngestPayload;
  /** Why nothing was built, when that is the case. */
  reason?: string;
  /** What could not be read, kept for the app logs. */
  notes: string[];
}

/** A build-status event with its workspace resolved. */
export type ResolvedEvent = BuildStatusEvent & { workspace: string; repository: string; commit: string };

/** Reads the event and resolves the workspace from the Forge context. */
export function resolveEvent(payload: unknown, contextWorkspace?: string): ResolvedEvent | undefined {
  const event = parseBuildStatusEvent(payload);
  const workspace = event.workspace ?? contextWorkspace ?? '';
  const repository = event.repository ?? '';
  const commit = event.commit ?? '';
  if (!workspace || !repository || !commit) return undefined;
  return { ...event, workspace, repository, commit };
}

/** Reads the branch history and the files touched by the pull request. */
async function readContext(
  deps: SensorDeps,
  event: ResolvedEvent,
  notes: string[],
): Promise<{ branchHistory?: string[]; changedFiles?: string[] }> {
  let branchHistory: string[] | undefined;
  try {
    branchHistory = await readBranchHistory(deps.read, event.workspace, event.repository, event.branch ?? '');
  } catch (error) {
    notes.push(`branch history unavailable: ${describe(error)}`);
  }
  if (event.prId === undefined) return { branchHistory };
  try {
    const changedFiles = await readChangedFiles(deps.read, event.workspace, event.repository, event.prId);
    return { branchHistory, changedFiles };
  } catch (error) {
    notes.push(`pull-request diffstat unavailable: ${describe(error)}`);
    return { branchHistory };
  }
}

/** Turns what was read into the inputs of the pure payload builder. */
function toInputs(event: ResolvedEvent, context: StepContext, extra: {
  branchHistory?: string[];
  changedFiles?: string[];
}): SensorInputs {
  return {
    workspace: event.workspace,
    repository: event.repository,
    branch: event.branch ?? 'unknown',
    commit: event.commit,
    author: event.author ?? 'unknown',
    ...(event.prId !== undefined ? { prId: event.prId } : {}),
    stepName: context.step.name,
    stepUuid: context.step.uuid,
    ...(event.buildUrl ? { buildUrl: event.buildUrl } : {}),
    buildNumber: event.buildNumber ?? context.pipeline?.number,
    durationS: context.step.durationS ?? 0,
    failedAt: context.step.completedAt ?? new Date().toISOString(),
    logTail: context.material.logTail,
    testCases: context.material.testCases,
    branchHistory: extra.branchHistory,
    changedFiles: extra.changedFiles,
  };
}

/**
 * Collects one failing build and builds the payload.
 *
 * The masking engine is awaited first: when it is unavailable nothing is
 * built, because an unmasked excerpt must never leave Bitbucket (§ 18).
 */
export async function collectAndBuildPayload(
  event: ResolvedEvent,
  deps: SensorDeps,
  tailBytes?: number,
): Promise<BuiltPayload> {
  const notes: string[] = [];
  const mask = await deps.masker();

  let context: StepContext | undefined;
  try {
    context = await readFailingStep(deps.read, event.workspace, event.repository, event.commit, tailBytes);
  } catch (error) {
    notes.push(`pipeline unreadable: ${describe(error)}`);
  }
  if (!context) return { reason: 'no failed step could be read', notes };
  notes.push(...context.material.notes);

  const extra = await readContext(deps, event, notes);
  return { payload: buildIngestPayload(toInputs(event, context, extra), mask), notes };
}

/**
 * Asks the Brain for the commit that fixed the signature of this branch.
 *
 * The Brain owns the memory, the Sensor owns Bitbucket: the verdict of
 * § 10.2 needs both. A missing or unreadable answer is not an error, the
 * payload is simply sent without the verdict.
 */
export async function askResolutionCommit(
  deps: SensorDeps,
  brainUrl: string,
  secret: string,
  event: ResolvedEvent,
): Promise<string | undefined> {
  const request: QueryRequest = {
    kind: 'pr-card',
    repository: `${event.workspace}/${event.repository}`,
    branch: event.branch ?? '',
    commit: event.commit,
  };
  try {
    const answer = await deps.transport.post(brainUrl, 'query', secret, request);
    if (!answer.ok || !answer.body) return undefined;
    const commit = (answer.body as QueryResponse).diagnostic?.resolution?.commit;
    return typeof commit === 'string' && commit.length > 0 ? commit : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adds the ancestor verdict of § 10.2 to a payload.
 *
 * An inconclusive comparison leaves the field out: a missing verdict is
 * never read as a negative verdict by the Brain.
 */
export async function attachResolutionVerdict(
  deps: SensorDeps,
  payload: IngestPayload,
  resolutionCommit: string,
): Promise<IngestPayload> {
  const verdict = await containsCommit(
    payload.commit,
    resolutionCommit,
    commitReader(deps.read, payload.workspace, payload.repository),
  );
  const contains = toContainsResolution(verdict);
  return contains ? { ...payload, containsResolution: contains } : payload;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
