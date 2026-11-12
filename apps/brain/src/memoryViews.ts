/**
 * The read paths behind the project page's panels (lot brain-views).
 *
 * Three resolvers live here — the journal of what the app did, the export of
 * the memory, and its health. Each one answers `{ ok: false, error }` instead
 * of throwing, so a screen always renders: an unreadable journal shows its
 * empty state, not a broken page.
 *
 * Everything is read through the store of `src/sql.ts`; the shaping (CSV, JSON,
 * occupancy estimate) is in `src/pure/`, where it is unit-tested.
 */

import {
  buildExport,
  isExportFormat,
  type ExportFormat,
  type MemoryExport,
} from './pure/exportMemory';
import { sortAuditEntries, type AuditLine } from './pure/auditLog';
import { buildMemoryHealth, MEMORY_TABLES, type MemoryHealth } from './pure/memoryHealth';
import { migrateOnce, type BrainSqlStore } from './sql';

/** How many journal lines the tab reads (the journal itself is unbounded). */
export const AUDIT_LIMIT = 100;

/** Answer of a resolver: never a thrown error. */
export type ViewAnswer<T> = { ok: true; data: T } | { ok: false; error: string };

/** One error message, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolver `audit-log`: the last actions the app took, newest first. */
export async function auditLogData(
  store: BrainSqlStore,
  limit: number = AUDIT_LIMIT,
): Promise<ViewAnswer<AuditLine[]>> {
  try {
    await migrateOnce();
    const entries = await store.listAuditEntries(limit);
    return { ok: true, data: sortAuditEntries(entries) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Resolver `memory-export`: the memory as one CSV or JSON document. */
export async function memoryExportData(
  store: BrainSqlStore,
  rawFormat: unknown,
  now: Date,
): Promise<ViewAnswer<MemoryExport>> {
  try {
    const format: ExportFormat = isExportFormat(rawFormat) ? rawFormat : 'csv';
    await migrateOnce();
    const [signatures, occurrences, resolutions] = await Promise.all([
      store.listSignatures(),
      store.listAllOccurrences(),
      store.listResolutions(),
    ]);
    return {
      ok: true,
      data: buildExport({ signatures, occurrences, resolutions }, format, now),
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Resolver `memory-health`: occupancy, oldest occurrence, last purge. */
export async function memoryHealthData(
  store: BrainSqlStore,
  now: Date,
): Promise<ViewAnswer<MemoryHealth>> {
  try {
    await migrateOnce();
    const [counts, oldestAt, policy] = await Promise.all([
      Promise.all(MEMORY_TABLES.map((table) => store.countRows(table))),
      store.oldestOccurrenceAt(),
      store.getAppPolicy(),
    ]);
    const rows: Record<string, number> = {};
    MEMORY_TABLES.forEach((table, index) => {
      rows[table] = counts[index];
    });
    return {
      ok: true,
      data: buildMemoryHealth({
        rows,
        ...(oldestAt ? { oldestOccurrenceAt: oldestAt } : {}),
        ...(policy?.lastPurgeAt ? { lastPurgeAt: policy.lastPurgeAt } : {}),
        now,
      }),
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/**
 * The retention policy of the project (§ 18, CI-18) lives in `src/settings.ts`,
 * next to the settings it complements: the frozen `Settings` type cannot carry
 * it, so the app keeps it in its own `app_policy` row.
 */