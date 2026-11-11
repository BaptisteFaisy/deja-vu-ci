/**
 * Tests of the SQL statement builders (`src/pure/sqlQueries.ts`): the
 * upserts carry their parameters twice (insert then update), the selects use
 * placeholders only, and the schema columns of § 16 are the only ones named.
 */

import { describe, expect, it } from 'vitest';
import type { Occurrence, Resolution, Settings, Signature } from '@dejavu/core';
import {
  deleteExcerpts,
  selectExpiredExcerpts,
  selectLatestOccurrence,
  selectSignaturesByFamily,
  toPerMille,
  upsertOccurrence,
  upsertResolution,
  upsertSettings,
  upsertSignature,
  SETTINGS_KEY,
  isAlreadyExists,
  splitSchema,
} from '../src/pure/sqlQueries.js';
import { DEFAULT_SETTINGS } from '../src/pure/defaults.js';

const signature: Signature = {
  id: 'sig1', familyId: 'fam1', category: 'test', errorType: 'AssertionError',
  template: 't', frames: [{ file: 'a.ts', isProject: true }], status: 'flaky',
  firstSeen: '2026-11-01T00:00:00.000Z', lastSeen: '2026-11-05T00:00:00.000Z',
  occurrences: 3, issueKey: 'CI-9', testName: 'test_login',
};

const occurrence: Occurrence = {
  id: 'occ1', signatureId: 'sig1', familyId: 'fam1', workspace: 'acme',
  repo: 'acme/payments', branch: 'main', commit: 'abc', author: 'marie',
  stepName: 'test', durationS: 60, occurredAt: '2026-11-05T00:00:00.000Z',
  passedOnRetry: true, changedFiles: ['src/a.ts'],
};

describe('upsert builders', () => {
  it('builds an ON CONFLICT upsert for a signature, parameters doubled', () => {
    const statement = upsertSignature(signature);
    expect(statement.text).toContain('INSERT INTO signature');
    expect(statement.text).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(statement.text).not.toContain('sig1'); // values only as parameters
    const placeholders = (statement.text.match(/\?/g) ?? []).length;
    const insertColumns = (statement.text.match(/VALUES \(([^)]*)\)/)?.[1] ?? '').split(',').length;
    expect(placeholders).toBe(statement.params.length);
    expect(placeholders).toBeGreaterThan(insertColumns); // doubled for the update
    expect(statement.params[0]).toBe('sig1');
    expect(statement.params).toContain(JSON.stringify(signature.frames));
  });

  it('stores a boolean occurrence flag as 0/1 and JSON lists as text', () => {
    const statement = upsertOccurrence(occurrence);
    expect(statement.params).toContain(1); // passed_on_retry
    expect(statement.params).toContain(JSON.stringify(['src/a.ts']));
    expect(statement.text).toContain('commit_sha');
  });

  it('stores ratios as per mille', () => {
    const resolution: Resolution = {
      id: 'r1', signatureId: 'sig1', commit: 'abc', author: 'marie',
      files: ['a.ts'], confidence: 0.75,
    };
    expect(toPerMille(0.75)).toBe(750);
    expect(upsertResolution(resolution).params).toContain(750);
    const settings: Settings = { ...DEFAULT_SETTINGS, minConfidenceNotYourFault: 0.8 };
    expect(upsertSettings(settings, '2026-11-05T00:00:00.000Z').params).toContain(800);
    expect(upsertSettings(settings, 'x').params[0]).toBe(SETTINGS_KEY);
  });
});

describe('select builders', () => {
  it('parameterises the family lookup (indexed column)', () => {
    const statement = selectSignaturesByFamily('fam1');
    expect(statement.text).toBe('SELECT * FROM signature WHERE family_id = ?');
    expect(statement.params).toEqual(['fam1']);
  });

  it('adds the commit filter only when given', () => {
    expect(selectLatestOccurrence('r', 'b').text).not.toContain('commit_sha');
    const withCommit = selectLatestOccurrence('r', 'b', 'abc');
    expect(withCommit.text).toContain('commit_sha = ?');
    expect(withCommit.params).toEqual(['r', 'b', 'abc']);
  });

  it('builds the expired-excerpt purge in two steps', () => {
    const select = selectExpiredExcerpts('2026-11-05T00:00:00.000Z');
    expect(select.text).toContain('expires_at <= ?');
    const remove = deleteExcerpts(['a', 'b']);
    expect(remove.text).toBe('DELETE FROM raw_excerpt WHERE occurrence_id IN (?, ?)');
    expect(remove.params).toEqual(['a', 'b']);
  });
});

describe('splitSchema', () => {
  const schema = [
    '-- a header comment;',
    '-- with a semicolon inside',
    'CREATE TABLE a (id VARCHAR(64) PRIMARY KEY);',
    '',
    'CREATE INDEX a_id ON a (id);',
    '-- trailing comment',
  ].join('\n');

  it('strips comments and yields one statement per creation', () => {
    const statements = splitSchema(schema);
    expect(statements).toEqual([
      'CREATE TABLE a (id VARCHAR(64) PRIMARY KEY)',
      'CREATE INDEX a_id ON a (id)',
    ]);
  });
});

describe('isAlreadyExists', () => {
  it('recognises the idempotent-migration answers', () => {
    expect(isAlreadyExists(new Error('relation "signature" already exists'))).toBe(true);
    expect(isAlreadyExists('Duplicate key')).toBe(true);
    expect(isAlreadyExists(new Error('connection lost'))).toBe(false);
  });
});

describe('splitSchema on the real engine DDL', () => {
  it('yields every table and index of § 16', async () => {
    const { SQL_SCHEMA } = await import('../../../packages/core/src/store.js');
    const statements = splitSchema(SQL_SCHEMA);
    const tables = statements.filter((s) => s.startsWith('CREATE TABLE'));
    const indexes = statements.filter((s) => s.startsWith('CREATE INDEX'));
    expect(tables).toHaveLength(9);
    expect(indexes).toHaveLength(2);
    for (const table of [
      'signature', 'occurrence', 'test_stats', 'resolution', 'raw_excerpt',
      'llm_template_cache', 'outbreak', 'pairing', 'settings',
    ]) {
      expect(statements.some((s) => s.startsWith(`CREATE TABLE ${table} `))).toBe(true);
    }
  });
});
