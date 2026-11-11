/**
 * Runtime validation of the payloads that reach the Brain (§ 8.1, § 14).
 *
 * The bridge guarantees authenticity and freshness; this module guarantees
 * shape. A malformed payload is refused with an explicit reason and never
 * reaches the queue: the consumer must be able to trust its messages.
 *
 * Pure module: types only from `@dejavu/core` (erased at runtime), no
 * `@forge/*` import.
 */

import type { FailedTestCase, IngestPayload, QueryRequest } from '@dejavu/core';

/** Result of a validation: the value, or an explicit refusal. */
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): Validation<T> {
  return { ok: true, value };
}

function bad<T>(error: string): Validation<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string): Validation<string> {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    return bad(`field "${field}" must be a non-empty string`);
  }
  return ok(value);
}

function optionalString(record: Record<string, unknown>, field: string): Validation<string | undefined> {
  const value = record[field];
  if (value === undefined || value === null) return ok(undefined);
  if (typeof value !== 'string') return bad(`field "${field}" must be a string`);
  return ok(value);
}

function optionalNumber(record: Record<string, unknown>, field: string): Validation<number | undefined> {
  const value = record[field];
  if (value === undefined || value === null) return ok(undefined);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return bad(`field "${field}" must be a finite number`);
  }
  return ok(value);
}

function requireIsoDate(record: Record<string, unknown>, field: string): Validation<string> {
  const text = requireString(record, field);
  if (!text.ok) return text;
  if (Number.isNaN(Date.parse(text.value))) return bad(`field "${field}" must be an ISO-8601 date`);
  return text;
}

/** Validates one failed test case of the payload. */
export function validateTestCase(value: unknown, index: number): Validation<FailedTestCase> {
  if (!isRecord(value)) return bad(`testCases[${index}] must be an object`);
  const name = requireString(value, 'name');
  if (!name.ok) return bad(`testCases[${index}]: ${name.error}`);
  const message = requireString(value, 'message');
  if (!message.ok) return bad(`testCases[${index}]: ${message.error}`);
  const stack = optionalString(value, 'stack');
  if (!stack.ok) return bad(`testCases[${index}]: ${stack.error}`);
  const classname = optionalString(value, 'classname');
  if (!classname.ok) return bad(`testCases[${index}]: ${classname.error}`);
  const durationMs = optionalNumber(value, 'durationMs');
  if (!durationMs.ok) return bad(`testCases[${index}]: ${durationMs.error}`);
  return ok({
    name: name.value,
    message: message.value,
    ...(stack.value !== undefined ? { stack: stack.value } : {}),
    ...(classname.value !== undefined ? { classname: classname.value } : {}),
    ...(durationMs.value !== undefined ? { durationMs: durationMs.value } : {}),
  });
}

function validateTestCases(value: unknown): Validation<FailedTestCase[] | undefined> {
  if (value === undefined || value === null) return ok(undefined);
  if (!Array.isArray(value)) return bad('field "testCases" must be an array');
  const cases: FailedTestCase[] = [];
  for (const [index, item] of value.entries()) {
    const validated = validateTestCase(item, index);
    if (!validated.ok) return validated;
    cases.push(validated.value);
  }
  return ok(cases);
}

function validateStringArray(value: unknown, field: string): Validation<string[] | undefined> {
  if (value === undefined || value === null) return ok(undefined);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return bad(`field "${field}" must be an array of strings`);
  }
  return ok(value as string[]);
}

/** The optional fields of an ingest payload, validated as a partial patch. */
function validateOptionalFields(body: Record<string, unknown>): Validation<Partial<IngestPayload>> {
  const prId = optionalNumber(body, 'prId');
  if (!prId.ok) return prId;
  const stepUuid = optionalString(body, 'stepUuid');
  if (!stepUuid.ok) return stepUuid;
  const buildUrl = optionalString(body, 'buildUrl');
  if (!buildUrl.ok) return buildUrl;
  const buildNumber = optionalNumber(body, 'buildNumber');
  if (!buildNumber.ok) return buildNumber;
  const testCases = validateTestCases(body.testCases);
  if (!testCases.ok) return testCases;
  const branchHistory = validateStringArray(body.branchHistory, 'branchHistory');
  if (!branchHistory.ok) return branchHistory;
  const changedFiles = validateStringArray(body.changedFiles, 'changedFiles');
  if (!changedFiles.ok) return changedFiles;
  const linkedIssueKey = optionalString(body, 'linkedIssueKey');
  if (!linkedIssueKey.ok) return linkedIssueKey;

  if (!isRecord(body.containsResolution) && body.containsResolution !== undefined) {
    return bad('field "containsResolution" must be an object');
  }
  const contains = body.containsResolution as Record<string, unknown> | undefined;
  if (contains && (typeof contains.commit !== 'string' || typeof contains.contains !== 'boolean')) {
    return bad('field "containsResolution" must carry a commit and a boolean');
  }

  return ok({
    ...(prId.value !== undefined ? { prId: prId.value } : {}),
    ...(stepUuid.value !== undefined ? { stepUuid: stepUuid.value } : {}),
    ...(buildUrl.value !== undefined ? { buildUrl: buildUrl.value } : {}),
    ...(buildNumber.value !== undefined ? { buildNumber: buildNumber.value } : {}),
    ...(testCases.value !== undefined ? { testCases: testCases.value } : {}),
    ...(branchHistory.value !== undefined ? { branchHistory: branchHistory.value } : {}),
    ...(contains ? { containsResolution: { commit: contains.commit as string, contains: contains.contains } } : {}),
    ...(changedFiles.value !== undefined ? { changedFiles: changedFiles.value } : {}),
    ...(linkedIssueKey.value !== undefined ? { linkedIssueKey: linkedIssueKey.value } : {}),
  });
}

/** The mandatory fields of an ingest payload (§ 8.1). */
function validateRequiredFields(body: Record<string, unknown>): Validation<IngestPayload> {
  const workspace = requireString(body, 'workspace');
  if (!workspace.ok) return workspace;
  const repository = requireString(body, 'repository');
  if (!repository.ok) return repository;
  const branch = requireString(body, 'branch');
  if (!branch.ok) return branch;
  const commit = requireString(body, 'commit');
  if (!commit.ok) return commit;
  const author = requireString(body, 'author');
  if (!author.ok) return author;
  const stepName = requireString(body, 'stepName');
  if (!stepName.ok) return stepName;
  const failedAt = requireIsoDate(body, 'failedAt');
  if (!failedAt.ok) return failedAt;

  if (typeof body.durationS !== 'number' || !Number.isFinite(body.durationS) || body.durationS < 0) {
    return bad('field "durationS" must be a non-negative number');
  }
  if (!Array.isArray(body.errorBlocks) || body.errorBlocks.some((b) => typeof b !== 'string')) {
    return bad('field "errorBlocks" must be an array of strings');
  }
  return ok({
    version: 1,
    workspace: workspace.value,
    repository: repository.value,
    branch: branch.value,
    commit: commit.value,
    author: author.value,
    stepName: stepName.value,
    durationS: body.durationS,
    failedAt: failedAt.value,
    errorBlocks: body.errorBlocks as string[],
  });
}

/** Validates the payload the Sensor sends over the signed bridge (§ 8.1). */
export function validateIngestPayload(body: unknown): Validation<IngestPayload> {
  if (!isRecord(body)) return bad('payload must be an object');
  if (body.version !== 1) return bad('payload.version must be 1');
  const required = validateRequiredFields(body);
  if (!required.ok) return required;
  const optional = validateOptionalFields(body);
  if (!optional.ok) return optional;
  return ok({ ...required.value, ...optional.value });
}

/** Validates the `pr-card` request of the Sensor (§ 14, screen 1). */
export function validateQueryRequest(body: unknown): Validation<QueryRequest> {
  if (!isRecord(body)) return bad('payload must be an object');
  if (body.kind !== 'pr-card') return bad('payload.kind must be "pr-card"');
  const repository = requireString(body, 'repository');
  if (!repository.ok) return repository;
  const branch = requireString(body, 'branch');
  if (!branch.ok) return branch;
  const commit = optionalString(body, 'commit');
  if (!commit.ok) return commit;
  return ok({
    kind: 'pr-card',
    repository: repository.value,
    branch: branch.value,
    ...(commit.value !== undefined ? { commit: commit.value } : {}),
  });
}
