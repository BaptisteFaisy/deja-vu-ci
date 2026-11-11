/**
 * Statement builders of the Forge SQL store (§ 16).
 *
 * Every builder returns the statement text with `?` placeholders and the
 * matching parameter list: the adapter (`src/sql.ts`) never concatenates a
 * value into a statement. Domain values are converted to what the schema
 * stores (snake_case columns, ratios as per mille, lists as JSON text).
 *
 * Pure module: type-only imports from `@dejavu/core`, no `@forge/*`.
 */

import type {
  Occurrence,
  Outbreak,
  Pairing,
  RawExcerpt,
  Resolution,
  Settings,
  Signature,
  TestStats,
} from '@dejavu/core';

/** A statement and its parameters. */
export interface SqlStatement {
  text: string;
  params: unknown[];
}

/** Ratio 0..1 → per mille (BIGINT column). */
export function toPerMille(ratio: number): number {
  return Math.round(ratio * 1000);
}

/** List or object → JSON text column. */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Settings live in a single row, keyed by this constant. */
export const SETTINGS_KEY = 'default';

/** INSERT … ON CONFLICT: Forge SQL upserts a primary key this way. */
function upsert(table: string, columns: string[], values: unknown[], conflict: string[]): SqlStatement {
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((column) => !conflict.includes(column))
    .map((column) => `${column} = ?`)
    .join(', ');
  const updateValues = values.filter((_, index) => !conflict.includes(columns[index]));
  return {
    text: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET ${updates}`,
    params: [...values, ...updateValues],
  };
}

/** Upsert of a `signature` row. */
export function upsertSignature(s: Signature): SqlStatement {
  return upsert(
    'signature',
    ['id', 'family_id', 'category', 'error_type', 'template', 'frames_json', 'status', 'first_seen', 'last_seen', 'occurrences', 'issue_key', 'test_name'],
    [s.id, s.familyId, s.category, s.errorType, s.template, toJson(s.frames), s.status, s.firstSeen, s.lastSeen, s.occurrences, s.issueKey ?? null, s.testName ?? null],
    ['id'],
  );
}

/** Upsert of an `occurrence` row. */
export function upsertOccurrence(o: Occurrence): SqlStatement {
  return upsert(
    'occurrence',
    ['id', 'signature_id', 'family_id', 'workspace', 'repo', 'branch', 'commit_sha', 'author', 'pr_id', 'step_name', 'duration_s', 'build_url', 'occurred_at', 'passed_on_retry', 'test_name', 'changed_files_json'],
    [o.id, o.signatureId, o.familyId, o.workspace, o.repo, o.branch, o.commit, o.author, o.prId ?? null, o.stepName, o.durationS, o.buildUrl ?? null, o.occurredAt, o.passedOnRetry ? 1 : 0, o.testName ?? null, o.changedFiles === undefined ? null : toJson(o.changedFiles)],
    ['id'],
  );
}

/** Upsert of a `resolution` row. */
export function upsertResolution(r: Resolution): SqlStatement {
  return upsert(
    'resolution',
    ['id', 'signature_id', 'commit_sha', 'author', 'files_json', 'note', 'confidence', 'confirmed_by', 'confirmed_at'],
    [r.id, r.signatureId, r.commit, r.author, toJson(r.files), r.note ?? null, toPerMille(r.confidence), r.confirmedBy ?? null, r.confirmedAt ?? null],
    ['id'],
  );
}

/** Upsert of a `test_stats` row. */
export function upsertTestStats(t: TestStats): SqlStatement {
  return upsert(
    'test_stats',
    ['repo', 'test_name', 'runs_failed', 'runs_passed_same_commit', 'branches', 'flaky_index', 'updated_at'],
    [t.repo, t.testName, t.runsFailed, t.runsPassedSameCommit, t.branches, toPerMille(t.flakyIndex), t.updatedAt],
    ['repo', 'test_name'],
  );
}

/** Upsert of a `raw_excerpt` row. */
export function upsertRawExcerpt(e: RawExcerpt): SqlStatement {
  return upsert('raw_excerpt', ['occurrence_id', 'text', 'expires_at'], [e.occurrenceId, e.text, e.expiresAt], ['occurrence_id']);
}

/** Upsert of an `outbreak` row. */
export function upsertOutbreak(o: Outbreak): SqlStatement {
  return upsert(
    'outbreak',
    ['id', 'family_id', 'started_at', 'repos_json', 'incident_key'],
    [o.id, o.familyId, o.startedAt, toJson(o.repos), o.incidentKey ?? null],
    ['id'],
  );
}

/** Upsert of the `pairing` row of a workspace. */
export function upsertPairing(p: Pairing): SqlStatement {
  return upsert(
    'pairing',
    ['workspace', 'secret_id', 'paired_at', 'paired_by'],
    [p.workspace, p.secretId, p.pairedAt, p.pairedBy],
    ['workspace'],
  );
}

/** Upsert of the single `settings` row. */
export function upsertSettings(s: Settings, updatedAt: string): SqlStatement {
  return upsert(
    'settings',
    ['project_key', 'issue_project_key', 'flaky_min_occurrences', 'flaky_min_branches', 'flaky_window_days', 'outbreak_repos', 'outbreak_window_min', 'raw_retention_days', 'min_confidence_not_your_fault', 'universal_key', 'updated_at'],
    [SETTINGS_KEY, s.issueProjectKey, s.flakyMinOccurrences, s.flakyMinBranches, s.flakyWindowDays, s.outbreakRepos, s.outbreakWindowMin, s.rawRetentionDays, toPerMille(s.minConfidenceNotYourFault), s.universalKey ?? null, updatedAt],
    ['project_key'],
  );
}

/** One signature by id. */
export function selectSignature(id: string): SqlStatement {
  return { text: 'SELECT * FROM signature WHERE id = ?', params: [id] };
}

/** Every signature. */
export function selectAllSignatures(): SqlStatement {
  return { text: 'SELECT * FROM signature', params: [] };
}

/** The signatures of one family (indexed on `signature.family_id`). */
export function selectSignaturesByFamily(familyId: string): SqlStatement {
  return { text: 'SELECT * FROM signature WHERE family_id = ?', params: [familyId] };
}

/** The occurrences of one signature (indexed on `signature_id, occurred_at`). */
export function selectOccurrencesBySignature(signatureId: string): SqlStatement {
  return { text: 'SELECT * FROM occurrence WHERE signature_id = ?', params: [signatureId] };
}

/** The occurrences of one family. */
export function selectOccurrencesByFamily(familyId: string): SqlStatement {
  return { text: 'SELECT * FROM occurrence WHERE family_id = ?', params: [familyId] };
}

/** The latest known occurrence of a branch, optionally of one commit. */
export function selectLatestOccurrence(repo: string, branch: string, commit?: string): SqlStatement {
  if (commit === undefined) {
    return {
      text: 'SELECT * FROM occurrence WHERE repo = ? AND branch = ? ORDER BY occurred_at DESC',
      params: [repo, branch],
    };
  }
  return {
    text: 'SELECT * FROM occurrence WHERE repo = ? AND branch = ? AND commit_sha = ? ORDER BY occurred_at DESC',
    params: [repo, branch, commit],
  };
}

/** The resolution of one signature. */
export function selectResolution(signatureId: string): SqlStatement {
  return { text: 'SELECT * FROM resolution WHERE signature_id = ?', params: [signatureId] };
}

/** The resolutions not confirmed yet (settings screen, pending tab). */
export function selectPendingResolutions(): SqlStatement {
  return { text: 'SELECT * FROM resolution WHERE confirmed_at IS NULL', params: [] };
}

/** Test statistics, optionally of one repository. */
export function selectTestStats(repo?: string): SqlStatement {
  if (repo === undefined) return { text: 'SELECT * FROM test_stats', params: [] };
  return { text: 'SELECT * FROM test_stats WHERE repo = ?', params: [repo] };
}

/** The outbreak of one family, if any. */
export function selectOutbreakByFamily(familyId: string): SqlStatement {
  return { text: 'SELECT * FROM outbreak WHERE family_id = ?', params: [familyId] };
}

/** The single settings row. */
export function selectSettings(): SqlStatement {
  return { text: 'SELECT * FROM settings WHERE project_key = ?', params: [SETTINGS_KEY] };
}

/** The pairing row of a workspace. */
export function selectPairing(workspace: string): SqlStatement {
  return { text: 'SELECT * FROM pairing WHERE workspace = ?', params: [workspace] };
}

/** The raw excerpts whose retention has expired. */
export function selectExpiredExcerpts(nowIso: string): SqlStatement {
  return { text: 'SELECT occurrence_id FROM raw_excerpt WHERE expires_at <= ?', params: [nowIso] };
}

/** Deletes the expired raw excerpts by id. */
export function deleteExcerpts(ids: string[]): SqlStatement {
  const placeholders = ids.map(() => '?').join(', ');
  return { text: `DELETE FROM raw_excerpt WHERE occurrence_id IN (${placeholders})`, params: [...ids] };
}
