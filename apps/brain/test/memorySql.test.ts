/**
 * Tests of the SQL side of the new panels: the journal, the app policy and the
 * health reads (`src/pure/sqlQueries.ts`, `src/pure/sqlRows.ts`).
 *
 * The rules verified are the store's own: every value is bound as a `?`
 * placeholder, the one identifier placed in the statement text comes from a
 * literal union of this app, and the new tables arrive through the schema the
 * migration already runs statement by statement — so they are created once and
 * ignored on every later start.
 */

import { describe, expect, it } from 'vitest';
import { SQL_SCHEMA } from '@dejavu/core';
import { APP_SCHEMA, APP_TABLES } from '../src/pure/appSchema';
import {
  selectAllOccurrences,
  selectAllResolutions,
  selectAppPolicy,
  selectAuditEntries,
  selectOldestOccurrence,
  selectRowCount,
  splitSchema,
  upsertAppPolicy,
  upsertAuditEntry,
} from '../src/pure/sqlQueries';
import {
  mapAppPolicy,
  mapAuditLine,
  oldestOccurredAt,
  rowCount,
} from '../src/pure/sqlRows';
import { auditEntry } from '../src/pure/auditLog';
import { MEMORY_TABLES } from '../src/pure/memoryHealth';

const AT = new Date('2026-11-12T10:00:00.000Z');

describe('the journal statements', () => {
  it('inserts an entry with every value bound', () => {
    const entry = auditEntry({
      action: 'ticket-created',
      signatureId: 'sig-1',
      issueKey: 'CI-7',
      detail: 'Flaky test',
      at: AT,
    });
    const statement = upsertAuditEntry(entry);
    expect(statement.text).toContain('INSERT INTO audit_log');
    expect(statement.text).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(statement.params).toEqual([
      entry.id,
      'ticket-created',
      'sig-1',
      'CI-7',
      'Flaky test',
      '2026-11-12T10:00:00.000Z',
      'ticket-created',
      'sig-1',
      'CI-7',
      'Flaky test',
      '2026-11-12T10:00:00.000Z',
    ]);
    expect(statement.text).not.toContain('sig-1');
    expect(statement.text).not.toContain('CI-7');
  });

  it('binds the absent columns as NULL', () => {
    const statement = upsertAuditEntry(auditEntry({ action: 'excerpts-purged', at: AT }));
    expect(statement.params[2]).toBeNull();
    expect(statement.params[3]).toBeNull();
    expect(statement.params[4]).toBeNull();
  });

  it('bounds the read with a placeholder, newest first', () => {
    const statement = selectAuditEntries(25);
    expect(statement.text).toBe('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?');
    expect(statement.params).toEqual([25]);
  });

  it('maps a row back to a journal line, keeping an unknown action readable', () => {
    const line = mapAuditLine({
      id: 'a1',
      action_kind: 'signature-merged',
      signature_id: 'sig-1',
      issue_key: null,
      detail: 'absorbed sig-2',
      created_at: '2026-11-12T10:00:00.000Z',
    });
    expect(line).toEqual({
      id: 'a1',
      action: 'signature-merged',
      signatureId: 'sig-1',
      detail: 'absorbed sig-2',
      createdAt: '2026-11-12T10:00:00.000Z',
    });
    expect('issueKey' in line).toBe(false);

    const future = mapAuditLine({ id: 'a2', action_kind: 'from-a-later-build', created_at: AT });
    expect(future.action).toBe('from-a-later-build');
  });
});

describe('the app policy statements', () => {
  it('reads the single row of the installation', () => {
    const statement = selectAppPolicy();
    expect(statement.text).toContain('FROM app_policy WHERE project_key = ?');
    expect(statement.params).toHaveLength(1);
  });

  it('writes the policy and the date of the last purge together', () => {
    const statement = upsertAppPolicy('hash-only', '2026-11-12T03:00:00.000Z', '2026-11-12T10:00:00.000Z');
    expect(statement.text).toContain('INSERT INTO app_policy');
    expect(statement.params[1]).toBe('hash-only');
    expect(statement.params[2]).toBe('2026-11-12T03:00:00.000Z');
  });

  it('accepts a memory that never purged', () => {
    const statement = upsertAppPolicy('full', undefined, '2026-11-12T10:00:00.000Z');
    expect(statement.params[2]).toBeNull();
  });

  it('maps the row, and degrades an unreadable policy to the default', () => {
    const policy = mapAppPolicy({
      project_key: 'default',
      excerpt_policy: 'masked-snippet',
      last_purge_at: '2026-11-12T03:00:00.000Z',
      updated_at: '2026-11-12T10:00:00.000Z',
    });
    expect(policy).toEqual({
      excerptPolicy: 'masked-snippet',
      lastPurgeAt: '2026-11-12T03:00:00.000Z',
      updatedAt: '2026-11-12T10:00:00.000Z',
    });

    const unknown = mapAppPolicy({ excerpt_policy: 'everything', updated_at: AT });
    expect(unknown.excerptPolicy).toBe('full');
    expect(unknown.lastPurgeAt).toBeUndefined();
  });
});

describe('the health reads', () => {
  it('counts every table the health panel reports', () => {
    for (const table of MEMORY_TABLES) {
      const statement = selectRowCount(table);
      expect(statement.text).toBe(`SELECT COUNT(*) AS row_count FROM ${table}`);
      expect(statement.params).toEqual([]);
    }
  });

  it('reads the count and the oldest occurrence', () => {
    expect(rowCount({ row_count: 42 })).toBe(42);
    expect(rowCount({ row_count: '42' })).toBe(42);
    expect(rowCount({})).toBe(0);
    expect(oldestOccurredAt({ oldest_at: '2026-11-02T10:00:00.000Z' })).toBe('2026-11-02T10:00:00.000Z');
    expect(oldestOccurredAt({ oldest_at: null })).toBeUndefined();
    expect(selectOldestOccurrence().text).toContain('MIN(occurred_at)');
  });
});

describe('the export reads', () => {
  it('reads the whole memory in two statements', () => {
    expect(selectAllOccurrences().text).toBe('SELECT * FROM occurrence');
    expect(selectAllResolutions().text).toBe('SELECT * FROM resolution');
  });
});

describe('the schema the migration runs', () => {
  it('declares the two app tables, additively', () => {
    const appStatements = splitSchema(APP_SCHEMA);
    expect(appStatements.some((s) => s.startsWith('CREATE TABLE IF NOT EXISTS audit_log'))).toBe(true);
    expect(appStatements.some((s) => s.startsWith('CREATE TABLE IF NOT EXISTS app_policy'))).toBe(true);
    expect(appStatements.some((s) => s.startsWith('CREATE INDEX audit_log_created_at'))).toBe(true);
    expect([...APP_TABLES]).toEqual(['audit_log', 'app_policy']);
  });

  it('leaves the engine schema untouched and adds exactly two tables', () => {
    const engine = splitSchema(SQL_SCHEMA).filter((s) => s.startsWith('CREATE TABLE'));
    const added = splitSchema(APP_SCHEMA).filter((s) => s.startsWith('CREATE TABLE'));
    expect(engine).toHaveLength(9);
    expect(added).toHaveLength(2);
  });

  it('keeps the new columns in the types Forge SQL accepts', () => {
    const added = splitSchema(APP_SCHEMA).join('\n').toUpperCase();
    for (const forbidden of ['BOOLEAN', 'DOUBLE', 'FLOAT', 'NUMERIC', 'DECIMAL', 'SERIAL', 'BLOB']) {
      expect(added).not.toContain(forbidden);
    }
    expect(added).not.toMatch(/FOREIGN\s+KEY/);
    expect(added).not.toContain('REFERENCES');
  });
});
