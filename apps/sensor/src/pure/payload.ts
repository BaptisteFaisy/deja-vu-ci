/**
 * Construction of the `IngestPayload` sent to the Brain — pure, no Forge
 * import and no `@dejavu/core` runtime import: the masking function is
 * injected, so the module can be unit-tested with a local double.
 *
 * Specification § 8.1: the Sensor reads the failing step, masks the
 * secrets, keeps the error blocks (50 KiB at most) and sends them to the
 * Brain, which computes the signature, stores the occurrence and answers
 * with a diagnostic.
 */

import type { FailedTestCase, IngestPayload } from '@dejavu/core';
import { MAX_TOTAL_BLOCK_BYTES, selectBlocks } from './blocks.js';
import { splitLogBlocks } from './pipeline.js';

/** Maximum number of commit hashes sent with an occurrence. */
export const MAX_BRANCH_HISTORY = 100;

/**
 * The masking contract of the engine, as the Sensor needs it.
 *
 * It matches `maskSecrets` from `@dejavu/core`; the type is repeated here
 * so that this pure module stays free of any runtime dependency.
 */
export interface Masker {
  (text: string): { text: string; masked: number; kinds: string[] };
}

/** Everything the Sensor collected for one failing step. */
export interface SensorInputs {
  workspace: string;
  repository: string;
  branch: string;
  commit: string;
  author: string;
  prId?: number;
  stepName: string;
  stepUuid?: string;
  buildUrl?: string;
  buildNumber?: number;
  durationS: number;
  /** ISO-8601, UTC. */
  failedAt: string;
  /** Tail of the step log, as read with a partial request. */
  logTail?: string;
  /** Failed test cases, when the pipeline produced reports. */
  testCases?: FailedTestCase[];
  /** Commit hashes of the branch, most recent first. */
  branchHistory?: string[];
  /** Files touched by the pull request. */
  changedFiles?: string[];
  /** Ancestor verdict, when the Sensor could compute it. */
  containsResolution?: { commit: string; contains: boolean };
  /** Jira ticket linked to the branch. */
  linkedIssueKey?: string;
}

/** Masks the candidate blocks of a log tail, then keeps what fits. */
export function maskedBlocks(logTail: string | undefined, mask: Masker): string[] {
  if (!logTail) return [];
  return splitLogBlocks(logTail).map((block) => mask(block).text);
}

/**
 * Masks the message and the stack of a failed test case.
 *
 * The name and the class name are kept as they are: they identify the test
 * and are needed to recognise it later (§ 10.1).
 */
export function maskTestCase(testCase: FailedTestCase, mask: Masker): FailedTestCase {
  return {
    ...testCase,
    message: mask(testCase.message).text,
    ...(testCase.stack ? { stack: mask(testCase.stack).text } : {}),
  };
}

/** Keeps at most 100 commit hashes, most recent first. */
export function boundHistory(history: readonly string[] | undefined): string[] | undefined {
  if (!history || history.length === 0) return undefined;
  return history.slice(0, MAX_BRANCH_HISTORY);
}

/**
 * Builds the payload sent to the Brain.
 *
 * The error blocks are masked and bounded to 50 KiB in total; the failed
 * test cases are masked too, because a report may embed a token.
 */
export function buildIngestPayload(inputs: SensorInputs, mask: Masker): IngestPayload {
  const { blocks } = selectBlocks(maskedBlocks(inputs.logTail, mask), MAX_TOTAL_BLOCK_BYTES);
  const testCases = inputs.testCases?.map((testCase) => maskTestCase(testCase, mask));
  return {
    version: 1,
    workspace: inputs.workspace,
    repository: inputs.repository,
    branch: inputs.branch,
    commit: inputs.commit,
    author: inputs.author,
    ...(inputs.prId !== undefined ? { prId: inputs.prId } : {}),
    stepName: inputs.stepName,
    ...(inputs.stepUuid ? { stepUuid: inputs.stepUuid } : {}),
    ...(inputs.buildUrl ? { buildUrl: inputs.buildUrl } : {}),
    ...(inputs.buildNumber !== undefined ? { buildNumber: inputs.buildNumber } : {}),
    durationS: inputs.durationS,
    failedAt: inputs.failedAt,
    errorBlocks: blocks,
    ...(testCases && testCases.length > 0 ? { testCases } : {}),
    ...(boundHistory(inputs.branchHistory)
      ? { branchHistory: boundHistory(inputs.branchHistory) }
      : {}),
    ...(inputs.containsResolution ? { containsResolution: inputs.containsResolution } : {}),
    ...(inputs.changedFiles && inputs.changedFiles.length > 0
      ? { changedFiles: inputs.changedFiles }
      : {}),
    ...(inputs.linkedIssueKey ? { linkedIssueKey: inputs.linkedIssueKey } : {}),
  };
}
