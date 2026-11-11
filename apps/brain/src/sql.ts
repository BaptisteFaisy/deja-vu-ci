/**
 * Forge SQL adapter — the Brain's memory (§ 16).
 *
 * Two responsibilities:
 *  1. `ensureSchema`: run the engine's `SQL_SCHEMA` once per cold start,
 *     statement by statement, ignoring "already exists" answers — the
 *     migration is idempotent, like everything else here.
 *  2. `createSqlStore`: implement the core `Store` interface on top of
 *     Forge SQL, with statements built by `pure/sqlQueries.ts` and rows
 *     mapped by `pure/sqlRows.ts`. No SQL string is composed elsewhere.
 *
 * Platform limits: 1 GiB per installation, 5 s per SELECT — every read here
 * hits an indexed column (`signature.family_id`,
 * `occurrence(signature_id, occurred_at)`) or the single settings row.
 */

import { sql } from '@forge/sql';
import {
  SQL_SCHEMA,
  type Occurrence,
  type Outbreak,
  type Pairing,
  type RawExcerpt,
  type Resolution,
  type Settings,
  type Signature,
  type Store,
  type TestStats,
} from '@dejavu/core';
import * as queries from './pure/sqlQueries.js';
import {
  mapOccurrence,
  mapOutbreak,
  mapPairing,
  mapResolution,
  mapSettings,
  mapSignature,
  mapTestStats,
  type SqlRow,
} from './pure/sqlRows.js';
import { DEFAULT_SETTINGS } from './pure/defaults.js';

/** The client the pure builders target: text with `?` placeholders. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlRow[]>;
}

/**
 * Wraps `@forge/sql` behind the placeholder interface.
 *
 * The Forge client exposes a tagged-template `query`; a tag function is an
 * ordinary function, so a dynamic statement is passed by splitting it on its
 * placeholders (values stay parameters — never interpolated).
 */
export function forgeSqlClient(): SqlClient {
  return {
    async query(text: string, params: unknown[] = []): Promise<SqlRow[]> {
      const parts = text.split('?');
      const strings = Object.assign([...parts], { raw: [...parts] }) as TemplateStringsArray;
      const rows = await sql.query(strings, ...params);
      return (rows ?? []) as SqlRow[];
    },
  };
}

/**
 * Idempotent migration: every statement of `SQL_SCHEMA` is run; "already
 * exists" answers are expected on every start after the first and ignored.
 */
export async function ensureSchema(client: SqlClient = forgeSqlClient()): Promise<void> {
  for (const statement of queries.splitSchema(SQL_SCHEMA)) {
    try {
      await client.query(statement);
    } catch (error) {
      if (!queries.isAlreadyExists(error)) throw error;
    }
  }
}

async function run(client: SqlClient, statement: queries.SqlStatement): Promise<void> {
  await client.query(statement.text, statement.params);
}

async function read(client: SqlClient, statement: queries.SqlStatement): Promise<SqlRow[]> {
  return client.query(statement.text, statement.params);
}

/** Extra read used by the `/query` route, beyond the core `Store`. */
export interface BrainSqlStore extends Store {
  latestOccurrence(repo: string, branch: string, commit?: string): Promise<Occurrence | undefined>;
  pendingResolutions(): Promise<Resolution[]>;
  pairing(workspace: string): Promise<Pairing | undefined>;
  savePairing(pairing: Pairing): Promise<void>;
}

/** Signature and occurrence halves of the store. */
function memoryMethods(client: SqlClient) {
  return {
    async saveSignature(s: Signature): Promise<void> {
      await run(client, queries.upsertSignature(s));
    },
    async getSignature(id: string): Promise<Signature | undefined> {
      const rows = await read(client, queries.selectSignature(id));
      return rows[0] ? mapSignature(rows[0]) : undefined;
    },
    async listSignatures(): Promise<Signature[]> {
      return (await read(client, queries.selectAllSignatures())).map(mapSignature);
    },
    async findSignaturesByFamily(familyId: string): Promise<Signature[]> {
      return (await read(client, queries.selectSignaturesByFamily(familyId))).map(mapSignature);
    },
    async saveOccurrence(o: Occurrence): Promise<void> {
      await run(client, queries.upsertOccurrence(o));
    },
    async listOccurrences(signatureId: string): Promise<Occurrence[]> {
      return (await read(client, queries.selectOccurrencesBySignature(signatureId))).map(mapOccurrence);
    },
    async listFamilyOccurrences(familyId: string): Promise<Occurrence[]> {
      return (await read(client, queries.selectOccurrencesByFamily(familyId))).map(mapOccurrence);
    },
  };
}

/** Resolution, excerpt, stats, outbreak and settings halves of the store. */
function housekeepingMethods(client: SqlClient) {
  return {
    async saveResolution(r: Resolution): Promise<void> {
      await run(client, queries.upsertResolution(r));
    },
    async getResolution(signatureId: string): Promise<Resolution | undefined> {
      const rows = await read(client, queries.selectResolution(signatureId));
      return rows[0] ? mapResolution(rows[0]) : undefined;
    },
    async saveRawExcerpt(e: RawExcerpt): Promise<void> {
      await run(client, queries.upsertRawExcerpt(e));
    },
    async purgeExpired(now: Date): Promise<number> {
      const rows = await read(client, queries.selectExpiredExcerpts(now.toISOString()));
      const ids = rows.map((row) => String(row.occurrence_id ?? '')).filter((id) => id !== '');
      if (ids.length === 0) return 0;
      await run(client, queries.deleteExcerpts(ids));
      return ids.length;
    },
    async getSettings(): Promise<Settings> {
      const rows = await read(client, queries.selectSettings());
      return rows[0] ? mapSettings(rows[0]) : { ...DEFAULT_SETTINGS };
    },
    async saveSettings(s: Settings): Promise<void> {
      await run(client, queries.upsertSettings(s, new Date().toISOString()));
    },
    async listTestStats(repo?: string): Promise<TestStats[]> {
      return (await read(client, queries.selectTestStats(repo))).map(mapTestStats);
    },
    async saveTestStats(t: TestStats): Promise<void> {
      await run(client, queries.upsertTestStats(t));
    },
    async saveOutbreak(o: Outbreak): Promise<void> {
      await run(client, queries.upsertOutbreak(o));
    },
    async findOutbreak(familyId: string): Promise<Outbreak | undefined> {
      const rows = await read(client, queries.selectOutbreakByFamily(familyId));
      return rows[0] ? mapOutbreak(rows[0]) : undefined;
    },
  };
}

/** Reads beyond the core `Store`, used by the routes and the screens. */
function brainReadMethods(client: SqlClient) {
  return {
    async latestOccurrence(repo: string, branch: string, commit?: string): Promise<Occurrence | undefined> {
      const rows = await read(client, queries.selectLatestOccurrence(repo, branch, commit));
      return rows[0] ? mapOccurrence(rows[0]) : undefined;
    },
    async pendingResolutions(): Promise<Resolution[]> {
      return (await read(client, queries.selectPendingResolutions())).map(mapResolution);
    },
    async pairing(workspace: string): Promise<Pairing | undefined> {
      const rows = await read(client, queries.selectPairing(workspace));
      return rows[0] ? mapPairing(rows[0]) : undefined;
    },
    async savePairing(pairing: Pairing): Promise<void> {
      await run(client, queries.upsertPairing(pairing));
    },
  };
}

/** Builds the memory store on top of a SQL client. */
export function createSqlStore(client: SqlClient = forgeSqlClient()): BrainSqlStore {
  return {
    ...memoryMethods(client),
    ...housekeepingMethods(client),
    ...brainReadMethods(client),
  };
}

let shared: BrainSqlStore | undefined;

/**
 * Process-wide store singleton: every resolver of the Brain shares one
 * client (the Forge SQL connection is managed by the platform, the object
 * itself is cheap — the singleton only avoids rebuilding the wrappers).
 */
export function brainStore(): BrainSqlStore {
  if (!shared) shared = createSqlStore();
  return shared;
}

let migration: Promise<void> | undefined;

/**
 * Runs the idempotent migration once per warm instance. Every handler
 * awaits this before touching the store: the first call migrates, the
 * next ones reuse the same promise (and a failure is retried on the next
 * invocation rather than cached).
 */
export function migrateOnce(client: SqlClient = forgeSqlClient()): Promise<void> {
  if (!migration) {
    migration = ensureSchema(client).catch((error) => {
      migration = undefined;
      throw error;
    });
  }
  return migration;
}
