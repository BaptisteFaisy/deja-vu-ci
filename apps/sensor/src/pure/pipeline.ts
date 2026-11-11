/**
 * Interpretation of the Bitbucket Pipelines API payloads — pure, no Forge
 * import, so it can be unit-tested without the network.
 *
 * The shapes below are the ones documented for the Pipelines REST API:
 *   GET /2.0/repositories/{ws}/{repo}/pipelines/?commit=<sha>
 *   GET /2.0/repositories/{ws}/{repo}/pipelines/{uuid}/steps/
 *   GET /2.0/repositories/{ws}/{repo}/pipelines/{uuid}/steps/{step}/testReports
 *   GET /2.0/repositories/{ws}/{repo}/commits?sha=<branch>
 *   GET /2.0/repositories/{ws}/{repo}/pullrequests/{id}/diffstat
 *
 * Every reader is tolerant: a missing or renamed field yields `undefined`
 * instead of throwing, because the Sensor must never fail on a shape change
 * (§ 17 of the specification lists this as a point to confirm).
 */

import type { FailedTestCase } from '@dejavu/core';

/** A pipeline, reduced to what the Sensor needs. */
export interface PipelineSummary {
  uuid: string;
  number?: number;
  commit?: string;
  state?: string;
  createdAt?: string;
}

/** A step of a pipeline, reduced to what the Sensor needs. */
export interface StepSummary {
  uuid: string;
  name: string;
  result?: string;
  state?: string;
  startedAt?: string;
  completedAt?: string;
  durationS?: number;
}

/** Outcome of reading a step: where the material comes from. */
export type StepSource = 'log' | 'test-reports' | 'none';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads the `values` array of a Bitbucket paginated answer. */
export function readValues(body: unknown): unknown[] {
  const record = asRecord(body);
  if (!record) return [];
  return asArray(record.values);
}

/** Extracts the commit hash of a pipeline entry (several shapes in the wild). */
export function readCommitHash(entry: Record<string, unknown>): string | undefined {
  const commit = asRecord(entry.commit);
  return asString(commit?.hash) ?? asString(entry.commit);
}

/**
 * Finds the pipeline that ran a given commit.
 *
 * When several pipelines match, the most recent one wins: the last run is
 * the one the developer is looking at.
 */
export function findPipelineForCommit(body: unknown, commit: string): PipelineSummary | undefined {
  const entries = readValues(body);
  const matches: PipelineSummary[] = [];
  for (const raw of entries) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const uuid = asString(entry.uuid);
    if (!uuid) continue;
    if (readCommitHash(entry) !== commit) continue;
    matches.push({
      uuid,
      number: asNumber(entry.build_number) ?? asNumber(entry.number),
      commit,
      state: asString(asRecord(entry.state)?.result) ?? asString(entry.state),
      createdAt: asString(entry.created_on),
    });
  }
  return matches[matches.length - 1];
}

/** Reads the steps of a pipeline. */
export function listSteps(body: unknown): StepSummary[] {
  const steps: StepSummary[] = [];
  for (const raw of readValues(body)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const uuid = asString(entry.uuid);
    if (!uuid) continue;
    const state = asRecord(entry.state);
    steps.push({
      uuid,
      name: asString(entry.name) ?? uuid,
      result: asString(state?.result) ?? asString(state?.name),
      state: asString(state?.name),
      startedAt: asString(entry.started_on) ?? asString(entry.created_on),
      completedAt: asString(entry.completed_on),
      durationS: readDurationS(entry),
    });
  }
  return steps;
}

/** Duration of a step in seconds, computed from its timestamps when needed. */
export function readDurationS(entry: Record<string, unknown>): number | undefined {
  const direct = asNumber(entry.duration);
  if (direct !== undefined) return Math.max(0, Math.round(direct));
  const started = asString(entry.started_on) ?? asString(entry.created_on);
  const completed = asString(entry.completed_on);
  if (!started || !completed) return undefined;
  const delta = Date.parse(completed) - Date.parse(started);
  if (!Number.isFinite(delta) || delta < 0) return undefined;
  return Math.round(delta / 1000);
}

/**
 * Finds the step that failed. A step stopped by hand (`STOPPED`, `SKIPPED`)
 * is ignored, as required by § 19 ("étape arrêtée à la main : ignorée").
 */
export function findFailedStep(steps: readonly StepSummary[]): StepSummary | undefined {
  const failed = steps.filter((step) => (step.result ?? '').toUpperCase() === 'FAILED');
  return failed[0];
}

/**
 * Reads the failed test cases of a step.
 *
 * The test-case endpoint is the one documented as experimental; when it is
 * unavailable the caller falls back to the step log (§ 17).
 */
export function parseFailedTestCases(body: unknown): FailedTestCase[] {
  const cases: FailedTestCase[] = [];
  for (const raw of readValues(body)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const status = asString(entry.status);
    if (status && status.toUpperCase() !== 'FAILED') continue;
    const name = asString(entry.name) ?? asString(entry.test_name);
    if (!name) continue;
    const reason = asRecord(entry.reason);
    cases.push({
      name,
      message: asString(reason?.message) ?? asString(entry.message) ?? 'test failed',
      stack: asString(entry.stack_trace) ?? asString(entry.stack),
      classname: asString(entry.classname),
      durationMs: asNumber(entry.duration),
    });
  }
  return cases;
}

/** Reads the commit hashes of a branch, most recent first. */
export function parseCommitHashes(body: unknown): string[] {
  const hashes: string[] = [];
  for (const raw of readValues(body)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const hash = asString(entry.hash);
    if (hash) hashes.push(hash);
  }
  return hashes;
}

/** Reads the files touched by a pull request (diffstat). */
export function parseDiffstatPaths(body: unknown): string[] {
  const paths: string[] = [];
  for (const raw of readValues(body)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const next = asRecord(entry.new);
    const old = asRecord(entry.old);
    const path = asString(next?.path) ?? asString(old?.path);
    if (path) paths.push(path);
  }
  return paths;
}

/**
 * Splits a step log into candidate error blocks.
 *
 * The blocks are separated by blank lines; the last ones are kept first
 * because the end of a log is where the failure usually sits.
 */
export function splitLogBlocks(log: string, maxBlocks = 3): string[] {
  const chunks = log
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  return chunks.slice(Math.max(0, chunks.length - maxBlocks)).reverse();
}
