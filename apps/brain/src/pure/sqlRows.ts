/**
 * Mapping between Forge SQL rows and the engine types (§ 16).
 *
 * The schema stores what Forge SQL supports: snake_case columns, ratios as
 * BIGINT per mille, lists and frames as JSON text, timestamps as TIMESTAMP.
 * This module is the single place that knows the column names: the store
 * adapter (`src/sql.ts`) builds statements with `sqlQueries.ts` and maps the
 * answers with these functions.
 *
 * Pure module: type-only imports from `@dejavu/core`, no `@forge/*`.
 */

import type {
  Category,
  Frame,
  LlmTemplateCacheEntry,
  Occurrence,
  Outbreak,
  Pairing,
  RawExcerpt,
  Resolution,
  Settings,
  Signature,
  SignatureStatus,
  TestStats,
} from '@dejavu/core';
import { DEFAULT_SETTINGS } from './defaults';

/** A row as Forge SQL returns it: column names to scalar values. */
export type SqlRow = Record<string, string | number | boolean | null | undefined>;

/** Value of a column, as a string, or undefined when NULL. */
export function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  return String(value);
}

/** Value of a column, as a number, or the fallback when NULL/unreadable. */
export function number(row: SqlRow, column: string, fallback = 0): number {
  const value = row[column];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

/** Value of a column, as a boolean (stored as INT 0/1). */
export function boolean(row: SqlRow, column: string): boolean {
  const value = row[column];
  if (typeof value === 'boolean') return value;
  return number(row, column) !== 0;
}

/**
 * Value of a TIMESTAMP column, normalized to an ISO-8601 UTC string.
 * Forge SQL may answer a string, epoch milliseconds or a Date-like object.
 */
export function iso(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** Parses a JSON text column; an unreadable cell degrades to the fallback. */
export function json<T>(row: SqlRow, column: string, fallback: T): T {
  const raw = text(row, column);
  if (raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Per mille (BIGINT) → ratio 0..1. */
export function fromPerMille(row: SqlRow, column: string): number {
  return number(row, column) / 1000;
}

/** `signature` row → engine type. */
export function mapSignature(row: SqlRow): Signature {
  const signature: Signature = {
    id: text(row, 'id') ?? '',
    familyId: text(row, 'family_id') ?? '',
    category: (text(row, 'category') ?? 'unknown') as Category,
    errorType: text(row, 'error_type') ?? 'UnknownError',
    template: text(row, 'template') ?? '',
    frames: json<Frame[]>(row, 'frames_json', []),
    status: (text(row, 'status') ?? 'new') as SignatureStatus,
    firstSeen: iso(row, 'first_seen'),
    lastSeen: iso(row, 'last_seen'),
    occurrences: number(row, 'occurrences'),
  };
  const issueKey = text(row, 'issue_key');
  const testName = text(row, 'test_name');
  if (issueKey !== undefined) signature.issueKey = issueKey;
  if (testName !== undefined) signature.testName = testName;
  return signature;
}

/** `occurrence` row → engine type. */
export function mapOccurrence(row: SqlRow): Occurrence {
  const occurrence: Occurrence = {
    id: text(row, 'id') ?? '',
    signatureId: text(row, 'signature_id') ?? '',
    familyId: text(row, 'family_id') ?? '',
    workspace: text(row, 'workspace') ?? '',
    repo: text(row, 'repo') ?? '',
    branch: text(row, 'branch') ?? '',
    commit: text(row, 'commit_sha') ?? '',
    author: text(row, 'author') ?? '',
    stepName: text(row, 'step_name') ?? '',
    durationS: number(row, 'duration_s'),
    occurredAt: iso(row, 'occurred_at'),
    passedOnRetry: boolean(row, 'passed_on_retry'),
  };
  const prId = row.pr_id;
  const buildUrl = text(row, 'build_url');
  const testName = text(row, 'test_name');
  if (prId !== null && prId !== undefined) occurrence.prId = number(row, 'pr_id');
  if (buildUrl !== undefined) occurrence.buildUrl = buildUrl;
  if (testName !== undefined) occurrence.testName = testName;
  const changedFiles = json<string[] | undefined>(row, 'changed_files_json', undefined);
  if (changedFiles !== undefined) occurrence.changedFiles = changedFiles;
  return occurrence;
}

/** `resolution` row → engine type. */
export function mapResolution(row: SqlRow): Resolution {
  const resolution: Resolution = {
    id: text(row, 'id') ?? '',
    signatureId: text(row, 'signature_id') ?? '',
    commit: text(row, 'commit_sha') ?? '',
    author: text(row, 'author') ?? '',
    files: json<string[]>(row, 'files_json', []),
    confidence: fromPerMille(row, 'confidence'),
  };
  const note = text(row, 'note');
  const confirmedBy = text(row, 'confirmed_by');
  if (note !== undefined) resolution.note = note;
  if (confirmedBy !== undefined) resolution.confirmedBy = confirmedBy;
  if (row.confirmed_at !== null && row.confirmed_at !== undefined) {
    resolution.confirmedAt = iso(row, 'confirmed_at');
  }
  return resolution;
}

/** `test_stats` row → engine type. */
export function mapTestStats(row: SqlRow): TestStats {
  return {
    repo: text(row, 'repo') ?? '',
    testName: text(row, 'test_name') ?? '',
    runsFailed: number(row, 'runs_failed'),
    runsPassedSameCommit: number(row, 'runs_passed_same_commit'),
    branches: number(row, 'branches'),
    flakyIndex: fromPerMille(row, 'flaky_index'),
    updatedAt: iso(row, 'updated_at'),
  };
}

/** `raw_excerpt` row → engine type. */
export function mapRawExcerpt(row: SqlRow): RawExcerpt {
  return {
    occurrenceId: text(row, 'occurrence_id') ?? '',
    text: text(row, 'text') ?? '',
    expiresAt: iso(row, 'expires_at'),
  };
}

/** `outbreak` row → engine type. */
export function mapOutbreak(row: SqlRow): Outbreak {
  const outbreak: Outbreak = {
    id: text(row, 'id') ?? '',
    familyId: text(row, 'family_id') ?? '',
    startedAt: iso(row, 'started_at'),
    repos: json<string[]>(row, 'repos_json', []),
  };
  const incidentKey = text(row, 'incident_key');
  if (incidentKey !== undefined) outbreak.incidentKey = incidentKey;
  return outbreak;
}

/** `llm_template_cache` row → engine type. */
export function mapTemplateEntry(row: SqlRow): LlmTemplateCacheEntry {
  return {
    normalizedHash: text(row, 'normalized_hash') ?? '',
    template: text(row, 'template') ?? '',
    category: (text(row, 'category') ?? 'unknown') as Category,
  };
}

/** `pairing` row → engine type. */
export function mapPairing(row: SqlRow): Pairing {
  return {
    workspace: text(row, 'workspace') ?? '',
    secretId: text(row, 'secret_id') ?? '',
    pairedAt: iso(row, 'paired_at'),
    pairedBy: text(row, 'paired_by') ?? '',
  };
}

/** `settings` row → engine type, missing columns falling back to defaults. */
export function mapSettings(row: SqlRow): Settings {
  const settings: Settings = {
    issueProjectKey: text(row, 'issue_project_key') ?? DEFAULT_SETTINGS.issueProjectKey,
    flakyMinOccurrences: number(row, 'flaky_min_occurrences', DEFAULT_SETTINGS.flakyMinOccurrences),
    flakyMinBranches: number(row, 'flaky_min_branches', DEFAULT_SETTINGS.flakyMinBranches),
    flakyWindowDays: number(row, 'flaky_window_days', DEFAULT_SETTINGS.flakyWindowDays),
    outbreakRepos: number(row, 'outbreak_repos', DEFAULT_SETTINGS.outbreakRepos),
    outbreakWindowMin: number(row, 'outbreak_window_min', DEFAULT_SETTINGS.outbreakWindowMin),
    rawRetentionDays: number(row, 'raw_retention_days', DEFAULT_SETTINGS.rawRetentionDays),
    minConfidenceNotYourFault:
      row.min_confidence_not_your_fault === null || row.min_confidence_not_your_fault === undefined
        ? DEFAULT_SETTINGS.minConfidenceNotYourFault
        : fromPerMille(row, 'min_confidence_not_your_fault'),
  };
  const universalKey = text(row, 'universal_key');
  if (universalKey !== undefined) settings.universalKey = universalKey;
  return settings;
}
