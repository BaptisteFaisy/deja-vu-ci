#!/usr/bin/env node
/**
 * Forge SQL load test — the limits of the Cerveau's memory, measured.
 *
 * The Cerveau keeps its memory in Forge SQL (§ 16). The platform has two
 * hard limits: **5 s per SELECT** and **1 GiB per installation**. This bench
 * replays a realistic volume — 10 000 occurrences, 500 signatures — against
 * a **fake SQL client** that counts the queries, their shapes and the columns
 * they filter on, then checks that every read goes through an indexed column.
 *
 * Nothing here is re-invented: the statements come from the app's own
 * builders (`apps/brain/src/pure/sqlQueries.ts`) and the indexed columns are
 * read from the engine's own DDL (`SQL_SCHEMA`). Change the schema or the
 * builders and this bench follows.
 *
 * Deterministic: the data comes from a seeded generator, the client never
 * touches the network, and two runs on the same volume give the same report.
 *
 * Usage: `node tools/loadtest-sql.mjs` (the report on stdout).
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SQL_SCHEMA } from '../packages/core/src/store.ts';
import { DEFAULT_SETTINGS } from '../packages/core/src/types.ts';
import * as q from '../apps/brain/src/pure/sqlQueries.ts';

/** Platform limits of Forge SQL, quoted in the documentation of § 16. */
export const SELECT_LIMIT_MS = 5000;
export const INSTALLATION_LIMIT_BYTES = 1024 * 1024 * 1024;

/** Volume replayed by the bench — one busy Jira site, several months. */
export const DEFAULT_VOLUME = { signatures: 500, occurrences: 10000 };

/** Per-row overhead of the store (row header, page overhead), in bytes. */
const ROW_OVERHEAD_BYTES = 48;

/**
 * Deterministic pseudo-random generator (xorshift32).
 *
 * `Math.random` would make two runs differ: the bench has to be
 * reproducible, so the seed is the only source of variation.
 */
export function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return function next() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** Splits the column list of a key definition. */
function splitColumns(list) {
  return list.split(',').map((column) => column.trim());
}

/**
 * The primary key of a `CREATE TABLE`: either a table-level constraint
 * (`PRIMARY KEY (repo, test_name)`) or an inline one on a single column
 * (`id VARCHAR(64) PRIMARY KEY`). Both forms appear in the schema.
 */
function primaryKeyColumns(statement) {
  const tableLevel = statement.match(/PRIMARY KEY \(([^)]+)\)/i);
  if (tableLevel) return [splitColumns(tableLevel[1])];
  const inline = statement.match(/^\s*(\w+)\s+[A-Za-z]+[^\n]*\bPRIMARY KEY\b/im);
  return inline ? [[inline[1]]] : [];
}

/** Indexed columns of the schema: `table -> [index columns]`. */
export function indexedColumns(schema) {
  const indexes = new Map();
  const add = (table, columns) => {
    const known = indexes.get(table) ?? [];
    known.push(columns);
    indexes.set(table, known);
  };
  for (const statement of q.splitSchema(schema)) {
    const table = statement.match(/^CREATE TABLE (\w+)/i);
    if (table) for (const columns of primaryKeyColumns(statement)) add(table[1], columns);
    const index = statement.match(/^CREATE INDEX \w+ ON (\w+) \(([^)]+)\)/i);
    if (index) add(index[1], splitColumns(index[2]));
  }
  return indexes;
}

/**
 * True when the equality columns of a read are the leftmost prefix of one
 * of the table's indexes — the only case where the store reads a few rows
 * instead of scanning the whole table.
 */
export function usesIndex(indexes, table, columns) {
  const known = indexes.get(table) ?? [];
  if (columns.length === 0) return false;
  return known.some((index) => columns.every((column, position) => index[position] === column));
}

/** Splits a statement into its kind, its table and its filtered columns. */
export function inspectStatement(text) {
  const head = text.trim().split(/\s+/)[0].toUpperCase();
  const kind = head === 'SELECT' ? 'read' : head === 'CREATE' || head === 'ALTER' || head === 'DROP' ? 'ddl' : 'write';
  const table = (text.match(/FROM (\w+)/i) ?? text.match(/INTO (\w+)/i) ?? text.match(/^UPDATE (\w+)/i) ?? [])[1];
  const where = (text.match(/\bWHERE\b(.*)$/i) ?? ['', ''])[1].replace(/\bORDER BY\b.*$/i, '');
  const equality = [...where.matchAll(/\b(\w+)\s*=\s*\?/gi)].map((match) => match[1]);
  const nullChecked = [...where.matchAll(/\b(\w+)\s+IS NULL/gi)].map((match) => match[1]);
  return { kind, table, equality, nullChecked };
}

/**
 * Fake SQL client: counts the queries, keeps their shape, and measures how
 * many rows each read has to touch.
 *
 * A read that uses an index touches the matching rows; a read without one
 * walks the whole table — that difference is exactly what the bench looks
 * for, because it is what the 5 s limit is about.
 */
export class FakeSqlClient {
  constructor(tables, indexes = indexedColumns(SQL_SCHEMA)) {
    this.tables = tables;
    this.indexes = indexes;
    this.queries = [];
    this.rowsTouched = 0;
  }

  /** Records one statement and returns no row (the bench never reads data). */
  async query(text, params = []) {
    const info = inspectStatement(text);
    const indexed = info.kind === 'read' && usesIndex(this.indexes, info.table, info.equality);
    const rows = this.rowsFor(info, indexed);
    this.rowsTouched += rows;
    this.queries.push({ text, params, shape: text, ...info, indexed, rows });
    return [];
  }

  /** DDL statements are counted, never executed. */
  async ddl(text) {
    this.queries.push({ text, params: [], shape: text, ...inspectStatement(text), indexed: false, rows: 0 });
  }

  /** Rows a read has to touch: the matches with an index, the table without. */
  rowsFor(info, indexed) {
    const size = this.tables.get(info.table)?.rows ?? 0;
    if (info.kind !== 'read') return 0;
    if (!indexed) return size;
    const matches = this.tables.get(info.table)?.matches?.[info.equality.join(',')] ?? size;
    return 1 + matches;
  }
}

/** Size of a row, from the values it stores. */
export function rowBytes(row) {
  let total = ROW_OVERHEAD_BYTES;
  for (const value of Object.values(row)) {
    if (typeof value === 'string') total += Buffer.byteLength(value, 'utf8');
    else if (typeof value === 'number') total += 8;
    else if (Array.isArray(value)) total += Buffer.byteLength(JSON.stringify(value), 'utf8');
    else if (value !== undefined && value !== null) total += 4;
  }
  return total;
}

/** The vocabulary of the generated site — fixed, so two runs match. */
const REPOS = ['acme/payments', 'acme/web', 'acme/api', 'acme/mobile', 'acme/data',
  'acme/infra', 'acme/docs', 'acme/cli', 'acme/sdk', 'acme/sandbox'];
const BRANCHES = ['main', 'develop', 'release/1.2', 'release/1.3', 'feature/auth',
  'feature/billing', 'feature/search', 'hotfix/login'];
const AUTHORS = ['marie', 'paul', 'amina', 'liu', 'sofia', 'tariq', 'elena', 'jonas',
  'priya', 'marc', 'yuki', 'omar', 'clara', 'hugo', 'nadia', 'felix', 'rosa', 'adam',
  'lea', 'noah'];
const STEPS = ['test', 'build', 'lint', 'integration', 'package', 'deploy-check'];
const CATEGORIES = ['test', 'compile', 'dependency', 'infrastructure', 'timeout', 'config'];
const ERROR_TYPES = ['AssertionError', 'CompileError', 'DependencyResolution',
  'NetworkError', 'Timeout', 'ConfigError', 'OutOfMemory'];
const TEST_NAMES = ['test_login', 'test_checkout', 'test_search_index', 'test_webhook',
  'test_migration', 'test_render', 'test_auth_token', 'test_export'];

/** Base date of the generated history: the 1st of the current month. */
const BASE_TIME = Date.UTC(2026, 10, 1);
const DAY_MS = 86400000;

/** One ISO timestamp inside the generated window. */
function at(random, spanDays) {
  return new Date(BASE_TIME + Math.floor(random() * spanDays * DAY_MS)).toISOString();
}

/** A 40-character commit sha, deterministic. */
function sha(random) {
  let out = '';
  for (let index = 0; index < 40; index += 1) out += '0123456789abcdef'[Math.floor(random() * 16)];
  return out;
}

/** Generates the signatures of the site, spread over the families. */
export function makeSignatures(count, families, random) {
  const signatures = [];
  for (let index = 0; index < count; index += 1) {
    const family = index % families;
    signatures.push({
      id: `sig-${String(index).padStart(4, '0')}`,
      familyId: `fam-${String(family).padStart(3, '0')}`,
      category: CATEGORIES[index % CATEGORIES.length],
      errorType: ERROR_TYPES[index % ERROR_TYPES.length],
      template: `expected <value> to equal <value> in ${TEST_NAMES[index % TEST_NAMES.length]}`,
      frames: [{ file: `src/module${index % 7}.ts`, fn: 'run', isProject: true }],
      status: index % 5 === 0 ? 'flaky' : 'known',
      firstSeen: at(random, 30),
      lastSeen: at(random, 30),
      occurrences: 0,
      issueKey: index % 4 === 0 ? `CI-${100 + index}` : undefined,
      testName: TEST_NAMES[index % TEST_NAMES.length],
    });
  }
  return signatures;
}

/** Generates the occurrences, distributed over the signatures. */
export function makeOccurrences(count, signatures, random) {
  const occurrences = [];
  for (let index = 0; index < count; index += 1) {
    const signature = signatures[index % signatures.length];
    signature.occurrences += 1;
    occurrences.push({
      id: `occ-${String(index).padStart(6, '0')}`,
      signatureId: signature.id,
      familyId: signature.familyId,
      workspace: 'acme',
      repo: REPOS[index % REPOS.length],
      branch: BRANCHES[index % BRANCHES.length],
      commit: sha(random),
      author: AUTHORS[index % AUTHORS.length],
      prId: 1000 + (index % 400),
      stepName: STEPS[index % STEPS.length],
      durationS: 30 + Math.floor(random() * 600),
      buildUrl: `https://ci.example.com/build/${index}`,
      occurredAt: at(random, 30),
      passedOnRetry: index % 7 === 0,
      testName: signature.testName,
      changedFiles: [`src/module${index % 7}.ts`, `src/util${index % 3}.ts`],
    });
  }
  return occurrences;
}

/** Sizes and lookup counts of the simulated tables. */
export function buildTables(signatures, occurrences) {
  const tables = new Map();
  const average = (rows, bytes) => (rows.length === 0 ? 0 : Math.round(bytes / rows.length));
  const signatureBytes = signatures.reduce((total, row) => total + rowBytes(row), 0);
  const occurrenceBytes = occurrences.reduce((total, row) => total + rowBytes(row), 0);
  const families = new Set(signatures.map((s) => s.familyId)).size;
  tables.set('signature', {
    rows: signatures.length,
    bytesEach: average(signatures, signatureBytes),
    matches: { id: 1, family_id: Math.max(1, Math.round(signatures.length / Math.max(1, families))) },
  });
  tables.set('occurrence', {
    rows: occurrences.length,
    bytesEach: average(occurrences, occurrenceBytes),
    matches: { id: 1, signature_id: Math.max(1, Math.round(occurrences.length / Math.max(1, signatures.length))) },
  });
  const resolutions = signatures.filter((s) => s.issueKey !== undefined).length;
  tables.set('resolution', { rows: resolutions, bytesEach: 220, matches: { id: 1, signature_id: 1 } });
  tables.set('test_stats', { rows: TEST_NAMES.length * REPOS.length, bytesEach: 140, matches: { 'repo,test_name': 1 } });
  tables.set('raw_excerpt', { rows: occurrences.length, bytesEach: 1200, matches: { occurrence_id: 1 } });
  tables.set('llm_template_cache', { rows: ERROR_TYPES.length * 4, bytesEach: 260, matches: { normalized_hash: 1 } });
  tables.set('outbreak', { rows: 5, bytesEach: 180, matches: { id: 1, family_id: 1 } });
  tables.set('pairing', { rows: 1, bytesEach: 120, matches: { workspace: 1 } });
  tables.set('settings', { rows: 1, bytesEach: 160, matches: { project_key: 1 } });
  return tables;
}

/** The five reads of one diagnosis (`buildDiagnoseContext`). */
function diagnoseReads(sample) {
  return [
    q.selectOccurrencesBySignature(sample.signatureId),
    q.selectOccurrencesByFamily(sample.familyId),
    q.selectResolution(sample.signatureId),
    q.selectSettings(),
    q.selectOutbreakByFamily(sample.familyId),
  ];
}

/**
 * The screens and routes of the Cerveau, with the statements each one
 * issues. The project page carries the N+1 of `allOccurrences`: one
 * `listSignatures`, then one `listOccurrences` per signature.
 */
export const SCREENS = [
  { name: 'pr-card', statements: (d) => [q.selectLatestOccurrence(d.repo, d.branch, d.commit), q.selectLatestOccurrence(d.repo, d.branch), ...diagnoseReads(d)] },
  { name: 'issue-context', statements: (d) => [q.selectAllSignatures(), q.selectOccurrencesBySignature(d.signatureId), ...diagnoseReads(d)] },
  { name: 'project-page', statements: (d) => [q.selectAllSignatures(), q.selectAllSignatures(), ...d.signatures.map((s) => q.selectOccurrencesBySignature(s.id)), q.selectPendingResolutions()] },
  { name: 'settings-page', statements: () => [q.selectSettings()] },
  { name: 'flaky-tests-tab', statements: (d) => [q.selectTestStats(), q.selectTestStats(d.repo)] },
  { name: 'pairing-lookup', statements: (d) => [q.selectPairing(d.workspace)] },
  { name: 'template-cache', statements: () => [q.selectAllTemplates()] },
  { name: 'purge-expired', statements: (d) => [q.selectExpiredExcerpts(d.now), q.deleteExcerpts(['occ-000001', 'occ-000002'])] },
];

/** Issues one statement and returns its record. */
async function issue(client, statement) {
  await client.query(statement.text, statement.params);
  return client.queries[client.queries.length - 1];
}

/** Runs one screen and returns the records of the statements it issued. */
async function runScreen(client, screen, data) {
  const started = client.queries.length;
  for (const statement of screen.statements(data)) await issue(client, statement);
  return client.queries.slice(started);
}

/** Replays the ingest path: every signature and every occurrence is stored. */
async function runIngest(client, signatures, occurrences) {
  for (const statement of q.splitSchema(SQL_SCHEMA)) await client.ddl(statement);
  for (const signature of signatures) await issue(client, q.upsertSignature(signature));
  for (const occurrence of occurrences) await issue(client, q.upsertOccurrence(occurrence));
  await issue(client, q.upsertSettings(DEFAULT_SETTINGS, new Date(BASE_TIME).toISOString()));
}

/** Groups the recorded queries by statement shape, most costly first. */
export function summarizeShapes(queries) {
  const byShape = new Map();
  for (const query of queries) {
    const entry = byShape.get(query.shape) ?? {
      shape: query.shape, kind: query.kind, table: query.table,
      columns: query.equality, indexed: query.indexed, count: 0, rowsTouched: 0,
    };
    entry.count += 1;
    entry.rowsTouched += query.rows;
    byShape.set(query.shape, entry);
  }
  return [...byShape.values()].sort(
    (a, b) => b.rowsTouched - a.rowsTouched || a.shape.localeCompare(b.shape),
  );
}

/** Stored volume of the installation, table by table. */
export function storedVolume(tables) {
  const perTable = [];
  let total = 0;
  for (const [name, table] of tables) {
    const bytes = table.rows * table.bytesEach;
    total += bytes;
    perTable.push({ table: name, rows: table.rows, bytesEach: table.bytesEach, bytes });
  }
  perTable.sort((a, b) => b.bytes - a.bytes);
  return { perTable, total };
}

/** The data one screen call reads: the first signature, the first build. */
function makeSample(signatures, occurrences) {
  return {
    signatures,
    signatureId: signatures[0].id,
    familyId: signatures[0].familyId,
    repo: occurrences[0].repo,
    branch: occurrences[0].branch,
    commit: occurrences[0].commit,
    workspace: 'acme',
    now: new Date(BASE_TIME + 31 * DAY_MS).toISOString(),
  };
}

/** Runs every screen once and returns the per-screen measurements. */
async function runScreens(client, sample) {
  const screens = [];
  for (const screen of SCREENS) {
    const records = await runScreen(client, screen, sample);
    const reads = records.filter((record) => record.kind === 'read');
    screens.push({
      name: screen.name,
      reads: reads.length,
      writes: records.length - reads.length,
      rowsTouched: records.reduce((total, record) => total + record.rows, 0),
      fullScans: reads.filter((record) => !record.indexed).length,
      unindexed: [...new Set(reads.filter((record) => !record.indexed).map((record) => record.shape))],
    });
  }
  return screens;
}

/** Runs the whole bench and returns its report. */
export async function runLoadTest(volume = DEFAULT_VOLUME, seed = 20261101) {
  const random = makeRandom(seed);
  const signatures = makeSignatures(volume.signatures, 50, random);
  const occurrences = makeOccurrences(volume.occurrences, signatures, random);
  const tables = buildTables(signatures, occurrences);
  const client = new FakeSqlClient(tables);

  const ingestStart = client.queries.length;
  await runIngest(client, signatures, occurrences);
  const ingest = client.queries.slice(ingestStart);
  const screens = await runScreens(client, makeSample(signatures, occurrences));

  const stored = storedVolume(tables);
  const reads = client.queries.filter((query) => query.kind === 'read');
  return {
    volume: { signatures: signatures.length, occurrences: occurrences.length },
    totals: {
      ddl: client.queries.filter((query) => query.kind === 'ddl').length,
      writes: client.queries.filter((query) => query.kind === 'write').length,
      reads: reads.length,
      queries: client.queries.length,
      ingestWrites: ingest.filter((query) => query.kind === 'write').length,
    },
    screens,
    shapes: summarizeShapes(client.queries),
    stored,
    unindexedReads: [...new Set(reads.filter((query) => !query.indexed).map((query) => query.shape))].sort(),
    indexedReads: [...new Set(reads.filter((query) => query.indexed).map((query) => query.shape))].sort(),
    breakingPoint: breakingPoint(screens, volume, stored),
  };
}

/**
 * The documented breaking point.
 *
 * The 5 s SELECT limit depends on a platform throughput Forge does not
 * publish, so the bench reports the deterministic quantity that drives it —
 * the rows one screen call has to touch — together with how fast it grows
 * with the stored memory. The 1 GiB limit needs no assumption: it is the
 * measured size of one occurrence.
 */
export function breakingPoint(screens, volume, stored) {
  const costliest = screens.reduce((worst, screen) => (screen.rowsTouched > worst.rowsTouched ? screen : worst), screens[0]);
  const perOccurrence = stored.perTable.find((entry) => entry.table === 'occurrence')?.bytesEach ?? 1;
  return {
    screen: costliest.name,
    rowsTouchedPerCall: costliest.rowsTouched,
    fullScansPerCall: costliest.fullScans,
    rowsPerStoredOccurrence: Number((costliest.rowsTouched / Math.max(1, volume.occurrences)).toFixed(2)),
    bytesPerOccurrence: perOccurrence,
    occurrencesAtStorageLimit: Math.floor(INSTALLATION_LIMIT_BYTES / Math.max(1, perOccurrence)),
    selectLimitMs: SELECT_LIMIT_MS,
  };
}

/** The report as text — what the CLI prints and what the doc quotes. */
export function formatReport(report) {
  const lines = [];
  lines.push(`Forge SQL load test — ${report.volume.signatures} signatures, ${report.volume.occurrences} occurrences`);
  lines.push(`queries: ${report.totals.queries} (${report.totals.ddl} ddl, ${report.totals.writes} writes, ${report.totals.reads} reads)`);
  lines.push(`stored: ${(report.stored.total / 1024 / 1024).toFixed(1)} MiB of 1024 MiB`);
  lines.push('');
  lines.push('screen            reads  writes  rows touched  full scans');
  for (const screen of report.screens) {
    lines.push(
      `${screen.name.padEnd(18)}${String(screen.reads).padStart(5)}${String(screen.writes).padStart(8)}` +
      `${String(screen.rowsTouched).padStart(14)}${String(screen.fullScans).padStart(12)}`,
    );
  }
  lines.push('');
  lines.push('reads that do NOT use an index (full scans):');
  for (const shape of report.unindexedReads) lines.push(`  - ${shape}`);
  lines.push('');
  lines.push('reads that DO use an index:');
  for (const shape of report.indexedReads) lines.push(`  - ${shape}`);
  lines.push('');
  const point = report.breakingPoint;
  lines.push(`breaking point: ${point.screen} touches ${point.rowsTouchedPerCall} rows per call`);
  lines.push(`  ${point.rowsPerStoredOccurrence} rows touched per stored occurrence, ${point.fullScansPerCall} full scan(s) per call`);
  lines.push(`  one occurrence stores ${point.bytesPerOccurrence} bytes`);
  lines.push(`  the 1 GiB installation limit is reached at about ${point.occurrencesAtStorageLimit} stored occurrences`);
  return lines.join('\n');
}

const invoked = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const report = await runLoadTest();
  process.stdout.write(`${formatReport(report)}\n`);
}
