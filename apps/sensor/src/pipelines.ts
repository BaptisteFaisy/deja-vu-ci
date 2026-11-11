/**
 * Reading the Bitbucket Pipelines API — the Forge layer of the Sensor.
 *
 * Specification § 15, step 2: "the Sensor finds the pipeline from the
 * address contained in the status, lists its steps, reads the end of the
 * log by partial request, then the test reports".
 *
 * Fallbacks (§ 17 and the E brief): a step log that cannot be read is not
 * an error — the Sensor falls back on the test reports, and when neither
 * is available the occurrence is still sent with no material, so the Brain
 * can answer "uncertain" instead of losing the build entirely.
 *
 * The paths below follow the Bitbucket Cloud REST API. The exact segment
 * names of the test-report endpoints are one of the points to confirm with
 * a prototype; they are isolated in `testReportPath` and `testCasePath` so
 * that a single edit fixes them all.
 */

import { DEFAULT_TAIL_BYTES, keepTail, tailRangeHeader } from './pure/range.js';
import type { CommitReader } from './ancestry.js';
import {
  findFailedStep,
  findPipelineForCommit,
  listSteps,
  parseCommitHashes,
  parseDiffstatPaths,
  parseFailedTestCases,
  type PipelineSummary,
  type StepSummary,
} from './pure/pipeline.js';
import type { FailedTestCase } from '@dejavu/core';

/** Answer of the Bitbucket API, reduced to what the Sensor reads. */
export interface ApiAnswer {
  ok: boolean;
  status: number;
  contentRange?: string;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

/** The Bitbucket reader, injected so that nothing here needs the network. */
export type BitbucketReader = (path: string, init?: { headers?: Record<string, string> }) => Promise<ApiAnswer>;

/** Where the error material of a step comes from. */
export type MaterialSource = 'log' | 'test-reports' | 'none';

/** The error material read for one step. */
export interface StepMaterial {
  logTail?: string;
  testCases?: FailedTestCase[];
  source: MaterialSource;
  /** What could not be read, kept for the app logs (never shown raw). */
  notes: string[];
}

/** Everything the Sensor read about one failing step. */
export interface StepContext {
  pipeline?: PipelineSummary;
  step: StepSummary;
  material: StepMaterial;
}

const API = '/2.0';

function encode(value: string): string {
  return encodeURIComponent(value);
}

/** Base path of a repository: `/2.0/repositories/{ws}/{repo}`. */
export function repoPath(workspace: string, repository: string): string {
  return `${API}/repositories/${encode(workspace)}/${encode(repository)}`;
}

/** Path of a step log. */
export function stepLogPath(base: string, pipelineUuid: string, stepUuid: string): string {
  return `${base}/pipelines/${encode(pipelineUuid)}/steps/${encode(stepUuid)}/log`;
}

/** Path of the test reports of a step. */
export function testReportPath(base: string, pipelineUuid: string, stepUuid: string): string {
  return `${base}/pipelines/${encode(pipelineUuid)}/steps/${encode(stepUuid)}/testReports`;
}

/** Path of the failed test cases of a report. */
export function testCasePath(base: string, reportUuid: string): string {
  return `${base}/testReports/${encode(reportUuid)}/test-cases?status=FAILED`;
}

/** The pipelines that ran a commit. */
export async function findPipeline(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  commit: string,
): Promise<PipelineSummary | undefined> {
  const path = `${repoPath(workspace, repository)}/pipelines/?commit=${encode(commit)}`;
  return findPipelineForCommit(await readJson(read, path), commit);
}

/** The steps of a pipeline. */
export async function readSteps(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  pipelineUuid: string,
): Promise<StepSummary[]> {
  const path = `${repoPath(workspace, repository)}/pipelines/${encode(pipelineUuid)}/steps/`;
  return listSteps(await readJson(read, path));
}

async function readJson(read: BitbucketReader, path: string): Promise<unknown> {
  const answer = await read(path);
  if (!answer.ok) throw new Error(`Bitbucket answered ${answer.status}`);
  return answer.json();
}

/**
 * Reads the tail of a step log with a partial request.
 *
 * The `Range` header asks for the last bytes only: a step log can weigh
 * tens of megabytes (§ 19). When the endpoint ignores the header and
 * answers the whole body, the tail is cut locally.
 */
export async function readStepLogTail(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  pipelineUuid: string,
  stepUuid: string,
  tailBytes: number = DEFAULT_TAIL_BYTES,
): Promise<string> {
  const path = stepLogPath(repoPath(workspace, repository), pipelineUuid, stepUuid);
  const answer = await read(path, { headers: { Range: tailRangeHeader(tailBytes) } });
  if (!answer.ok) throw new Error(`the step log answered ${answer.status}`);
  const text = await answer.text();
  return answer.status === 206 ? text : keepTail(text, tailBytes);
}

/** Reads the failed test cases of a step, through its test reports. */
export async function readFailedTestCases(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  pipelineUuid: string,
  stepUuid: string,
): Promise<FailedTestCase[]> {
  const base = repoPath(workspace, repository);
  const reports = await readJson(read, testReportPath(base, pipelineUuid, stepUuid));
  const collected: FailedTestCase[] = [];
  for (const uuid of reportUuids(reports)) {
    collected.push(...parseFailedTestCases(await readJson(read, testCasePath(base, uuid))));
  }
  return collected;
}

/** Reads the uuids of the test reports of a step. */
export function reportUuids(body: unknown): string[] {
  const values = Array.isArray((body as { values?: unknown })?.values)
    ? ((body as { values: unknown[] }).values)
    : [];
  const uuids: string[] = [];
  for (const value of values) {
    const uuid = (value as { uuid?: unknown })?.uuid;
    if (typeof uuid === 'string' && uuid.length > 0) uuids.push(uuid);
  }
  return uuids;
}

/**
 * Reads the error material of a step: the test reports first, then the log.
 *
 * A failure of either source is a note, never an exception: the Sensor
 * still sends what it has (§ 19: a build without an accessible log is
 * recorded with the status key alone and diagnosed as "uncertain").
 */
export async function readStepMaterial(
  read: BitbucketReader,
  ref: { workspace: string; repository: string; pipelineUuid: string; stepUuid: string },
  tailBytes: number,
): Promise<StepMaterial> {
  const notes: string[] = [];
  let testCases: FailedTestCase[] | undefined;
  try {
    testCases = await readFailedTestCases(
      read, ref.workspace, ref.repository, ref.pipelineUuid, ref.stepUuid,
    );
  } catch (error) {
    notes.push(`test reports unavailable: ${describe(error)}`);
  }

  let logTail: string | undefined;
  try {
    logTail = await readStepLogTail(
      read, ref.workspace, ref.repository, ref.pipelineUuid, ref.stepUuid, tailBytes,
    );
  } catch (error) {
    notes.push(`step log unavailable: ${describe(error)}`);
  }

  const source: MaterialSource =
    testCases && testCases.length > 0 ? 'test-reports' : logTail ? 'log' : 'none';
  return { logTail, testCases, source, notes };
}

/**
 * Reads the failing step of the pipeline that ran a commit, with its error
 * material attached.
 */
export async function readFailingStep(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  commit: string,
  tailBytes: number = DEFAULT_TAIL_BYTES,
): Promise<StepContext | undefined> {
  const pipeline = await findPipeline(read, workspace, repository, commit);
  if (!pipeline) return undefined;
  const steps = await readSteps(read, workspace, repository, pipeline.uuid);
  const step = findFailedStep(steps);
  if (!step) return undefined;
  const material = await readStepMaterial(
    read,
    { workspace, repository, pipelineUuid: pipeline.uuid, stepUuid: step.uuid },
    tailBytes,
  );
  return { pipeline, step, material };
}

/** Commit hashes of a branch, most recent first (100 at most). */
export async function readBranchHistory(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  branch: string,
): Promise<string[]> {
  const path = `${repoPath(workspace, repository)}/commits?sha=${encode(branch)}&pagelen=100`;
  return parseCommitHashes(await readJson(read, path));
}

/** Files touched by a pull request. */
export async function readChangedFiles(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  prId: number,
): Promise<string[]> {
  const path = `${repoPath(workspace, repository)}/pullrequests/${prId}/diffstat`;
  return parseDiffstatPaths(await readJson(read, path));
}

/**
 * Builds the commit reader injected into the ancestor comparison
 * (`ancestry.ts`): the pure logic walks the history, this closure reads it.
 */
export function commitReader(
  read: BitbucketReader,
  workspace: string,
  repository: string,
): CommitReader {
  return async (sha: string) => readCommitParents(read, workspace, repository, sha);
}

/** Parents of a commit, used by the ancestor comparison (§ 10.2). */
export async function readCommitParents(
  read: BitbucketReader,
  workspace: string,
  repository: string,
  sha: string,
): Promise<{ parents: string[] } | undefined> {
  const path = `${repoPath(workspace, repository)}/commit/${encode(sha)}`;
  const answer = await read(path);
  if (answer.status === 404) return undefined;
  if (!answer.ok) throw new Error(`the commit answered ${answer.status}`);
  const body = (await answer.json()) as { parents?: Array<{ hash?: unknown }> };
  const parents = Array.isArray(body.parents)
    ? body.parents
        .map((parent) => parent?.hash)
        .filter((hash): hash is string => typeof hash === 'string')
    : [];
  return { parents };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
