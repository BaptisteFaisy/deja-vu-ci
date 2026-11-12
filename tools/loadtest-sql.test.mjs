/**
 * Tests of the Forge SQL load bench (`tools/loadtest-sql.mjs`).
 *
 * The bench is the evidence behind `docs/FORGE-SQL-LIMITS.md`: it has to be
 * deterministic (two runs, one report), it has to read the indexed columns
 * from the engine's own DDL rather than from a copy, and it has to name
 * exactly which reads walk a whole table. Those three properties are what
 * these tests pin down.
 *
 * The full-volume report is computed **once** for the whole file: the bench
 * replays 10 000 occurrences, and the CI has a five-minute budget for the
 * entire suite. No network, no disk, no `@forge/*` — the client is the fake.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { SQL_SCHEMA } from '../packages/core/src/store.ts';
import {
  DEFAULT_VOLUME,
  FakeSqlClient,
  INSTALLATION_LIMIT_BYTES,
  SELECT_LIMIT_MS,
  buildTables,
  indexedColumns,
  inspectStatement,
  makeOccurrences,
  makeRandom,
  makeSignatures,
  rowBytes,
  runLoadTest,
  usesIndex,
} from './loadtest-sql.mjs';

/** The reads that walk a whole table, as the bench reports them. */
const EXPECTED_FULL_SCANS = [
  'SELECT * FROM llm_template_cache',
  'SELECT * FROM occurrence WHERE family_id = ?',
  'SELECT * FROM occurrence WHERE repo = ? AND branch = ? AND commit_sha = ? ORDER BY occurred_at DESC',
  'SELECT * FROM occurrence WHERE repo = ? AND branch = ? ORDER BY occurred_at DESC',
  'SELECT * FROM outbreak WHERE family_id = ?',
  'SELECT * FROM resolution WHERE confirmed_at IS NULL',
  'SELECT * FROM resolution WHERE signature_id = ?',
  'SELECT * FROM signature',
  'SELECT * FROM test_stats',
  'SELECT occurrence_id FROM raw_excerpt WHERE expires_at <= ?',
];

/** The reads that go through an index, as the bench reports them. */
const EXPECTED_INDEXED = [
  'SELECT * FROM occurrence WHERE signature_id = ?',
  'SELECT * FROM pairing WHERE workspace = ?',
  'SELECT * FROM settings WHERE project_key = ?',
  'SELECT * FROM test_stats WHERE repo = ?',
];

/** The one full-volume report every measurement test reads. */
let report;

beforeAll(async () => {
  report = await runLoadTest();
});

/** Finds one screen in the shared report. */
function screen(name) {
  return report.screens.find((entry) => entry.name === name);
}

describe('the bench is deterministic', () => {
  it('two runs on the same volume give the same report', async () => {
    expect(await runLoadTest()).toEqual(await runLoadTest());
  });

  it('the generated history depends only on its seed', () => {
    const signatures = makeSignatures(20, 4, makeRandom(7));
    expect(makeSignatures(20, 4, makeRandom(7))).toEqual(signatures);
    expect(makeSignatures(20, 4, makeRandom(8))[0].firstSeen).not.toBe(signatures[0].firstSeen);
  });
});

describe('the indexed columns come from the engine DDL', () => {
  const indexes = indexedColumns(SQL_SCHEMA);

  it('reads an inline primary key', () => {
    expect(indexes.get('signature')).toEqual([['id'], ['family_id']]);
    expect(indexes.get('settings')).toEqual([['project_key']]);
  });

  it('reads a table-level composite primary key', () => {
    expect(indexes.get('test_stats')).toEqual([['repo', 'test_name']]);
  });

  it('reads the two explicit indexes of § 16', () => {
    expect(indexes.get('occurrence')).toEqual([['id'], ['signature_id', 'occurred_at']]);
  });

  it('accepts the leftmost prefix of a composite index only', () => {
    expect(usesIndex(indexes, 'occurrence', ['signature_id'])).toBe(true);
    expect(usesIndex(indexes, 'occurrence', ['signature_id', 'occurred_at'])).toBe(true);
    expect(usesIndex(indexes, 'occurrence', ['occurred_at'])).toBe(false);
    expect(usesIndex(indexes, 'occurrence', ['family_id'])).toBe(false);
    expect(usesIndex(indexes, 'occurrence', [])).toBe(false);
  });
});

describe('statement inspection', () => {
  it('classifies the three kinds of statement', () => {
    expect(inspectStatement('SELECT * FROM signature WHERE id = ?').kind).toBe('read');
    expect(inspectStatement('INSERT INTO signature (id) VALUES (?) ON CONFLICT (id) DO UPDATE SET id = ?').kind).toBe('write');
    expect(inspectStatement('CREATE TABLE signature (id VARCHAR(64) PRIMARY KEY)').kind).toBe('ddl');
    expect(inspectStatement('DELETE FROM raw_excerpt WHERE occurrence_id IN (?, ?)').kind).toBe('write');
  });

  it('names the table and the filtered columns, ignoring ORDER BY', () => {
    const info = inspectStatement('SELECT * FROM occurrence WHERE repo = ? AND branch = ? ORDER BY occurred_at DESC');
    expect(info.table).toBe('occurrence');
    expect(info.equality).toEqual(['repo', 'branch']);
  });

  it('sees a NULL test as a filter, not as an equality', () => {
    const info = inspectStatement('SELECT * FROM resolution WHERE confirmed_at IS NULL');
    expect(info.equality).toEqual([]);
    expect(info.nullChecked).toEqual(['confirmed_at']);
  });
});

describe('the replayed volume', () => {
  it('replays the announced volume', () => {
    expect(report.volume).toEqual(DEFAULT_VOLUME);
    expect(DEFAULT_VOLUME).toEqual({ signatures: 500, occurrences: 10000 });
  });

  it('stores one row per signature and per occurrence, plus the settings', () => {
    expect(report.totals.ingestWrites).toBe(500 + 10000 + 1);
    expect(report.totals.ddl).toBe(11); // nine tables and two indexes
    expect(report.totals.writes).toBe(report.totals.ingestWrites + 1); // the purge deletes
  });

  it('spreads the generated history over every signature', () => {
    const signatures = makeSignatures(50, 5, makeRandom(3));
    const occurrences = makeOccurrences(500, signatures, makeRandom(3));
    expect(occurrences).toHaveLength(500);
    expect(signatures[0].occurrences).toBe(10);
    expect(new Set(occurrences.map((entry) => entry.signatureId)).size).toBe(50);
  });
});

describe('the screens', () => {
  it('the PR card is the costliest read path: seven reads, five full scans', () => {
    expect(screen('pr-card').reads).toBe(7);
    expect(screen('pr-card').fullScans).toBe(5);
    expect(screen('pr-card').rowsTouched).toBe(30153);
  });

  it('the project page carries the N+1 of allOccurrences', () => {
    // Two listSignatures, one listOccurrences per signature, one pending read.
    expect(screen('project-page').reads).toBe(2 + 500 + 1);
  });

  it('the settings and pairing screens read a single row', () => {
    expect(screen('settings-page').rowsTouched).toBe(2);
    expect(screen('settings-page').fullScans).toBe(0);
    expect(screen('pairing-lookup').fullScans).toBe(0);
  });

  it('the indexed hot path reads only the rows of one signature', () => {
    const history = report.shapes.find((shape) => shape.shape === 'SELECT * FROM occurrence WHERE signature_id = ?');
    expect(history.indexed).toBe(true);
    expect(history.rowsTouched / history.count).toBe(21); // one probe, twenty rows
  });
});

describe('the index audit', () => {
  it('names exactly the reads that walk a whole table', () => {
    expect(report.unindexedReads).toEqual(EXPECTED_FULL_SCANS);
  });

  it('names exactly the reads that go through an index', () => {
    expect(report.indexedReads).toEqual(EXPECTED_INDEXED);
  });

  it('classifies every read, none is left out', () => {
    const classified = new Set([...report.unindexedReads, ...report.indexedReads]);
    for (const shape of report.shapes) {
      if (shape.kind === 'read') expect(classified.has(shape.shape), shape.shape).toBe(true);
    }
  });
});

describe('the stored volume and the breaking point', () => {
  it('stays far below the 1 GiB installation limit', () => {
    expect(report.stored.total).toBeGreaterThan(0);
    expect(report.stored.total).toBeLessThan(INSTALLATION_LIMIT_BYTES / 10);
  });

  it('measures one occurrence, then derives the storage limit from it', () => {
    const point = report.breakingPoint;
    expect(point.bytesPerOccurrence).toBeGreaterThan(200);
    expect(point.bytesPerOccurrence).toBeLessThan(1000);
    expect(point.occurrencesAtStorageLimit).toBe(Math.floor(INSTALLATION_LIMIT_BYTES / point.bytesPerOccurrence));
    expect(point.occurrencesAtStorageLimit).toBeGreaterThan(DEFAULT_VOLUME.occurrences);
  });

  it('names the PR card as the first screen to reach the SELECT limit', () => {
    expect(report.breakingPoint.screen).toBe('pr-card');
    expect(report.breakingPoint.selectLimitMs).toBe(SELECT_LIMIT_MS);
    // About three rows touched per stored occurrence: linear, not bounded.
    expect(report.breakingPoint.rowsPerStoredOccurrence).toBeGreaterThan(2);
    expect(report.breakingPoint.rowsPerStoredOccurrence).toBeLessThan(5);
  });

  it('sizes a row from the values it stores', () => {
    const signatures = makeSignatures(1, 1, makeRandom(11));
    expect(rowBytes(signatures[0])).toBeGreaterThan(100);
    expect(rowBytes(signatures[0])).toBe(rowBytes(signatures[0])); // stable
  });
});

describe('the fake client', () => {
  /** A small client, so these tests stay fast. */
  function smallClient() {
    const signatures = makeSignatures(4, 2, makeRandom(5));
    const occurrences = makeOccurrences(40, signatures, makeRandom(5));
    return new FakeSqlClient(buildTables(signatures, occurrences));
  }

  it('counts a read without an index as the whole table', async () => {
    const client = smallClient();
    await client.query('SELECT * FROM occurrence WHERE family_id = ?', ['fam-000']);
    expect(client.queries[0].indexed).toBe(false);
    expect(client.queries[0].rows).toBe(40);
  });

  it('counts an indexed read as one probe plus the matches', async () => {
    const client = smallClient();
    await client.query('SELECT * FROM occurrence WHERE signature_id = ?', ['sig-0000']);
    expect(client.queries[0].indexed).toBe(true);
    expect(client.queries[0].rows).toBe(11); // one probe, ten occurrences
  });

  it('records the DDL without executing it', async () => {
    const client = smallClient();
    await client.ddl('CREATE TABLE signature (id VARCHAR(64) PRIMARY KEY)');
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0].kind).toBe('ddl');
    expect(client.rowsTouched).toBe(0);
  });
});
