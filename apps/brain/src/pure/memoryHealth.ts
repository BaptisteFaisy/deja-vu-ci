/**
 * Health of the memory (§ 14, small panel of the project page).
 *
 * The platform gives one installation **1 GiB** of SQL storage. The panel
 * answers the operator's only real question about it: how full is the memory,
 * what fills it, how old is the oldest thing it holds, and when did the app
 * last purge the raw excerpts it no longer needs.
 *
 * The platform exposes no byte accounting, so the occupancy is an **estimate**:
 * one conservative average row size per table (documented below), times the
 * row count the resolver reads with `COUNT(*)`. The estimate is deliberately
 * on the high side — it is a warning light, not an invoice.
 *
 * Pure module: no `@forge/*` import, no network.
 */

/** The platform limit of one installation: 1 GiB (§ 16). */
export const PLATFORM_LIMIT_BYTES = 1_073_741_824;

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** The tables of the memory, in the order the health panel reads them. */
export const MEMORY_TABLES = [
  'signature',
  'occurrence',
  'test_stats',
  'resolution',
  'raw_excerpt',
  'llm_template_cache',
  'outbreak',
  'pairing',
  'settings',
  'app_policy',
  'audit_log',
] as const;

export type MemoryTable = (typeof MEMORY_TABLES)[number];

/**
 * Average row size per table, in bytes.
 *
 * Conservative: a `raw_excerpt` row is counted at 8 KiB even though an excerpt
 * is bounded by the 50 KiB total cap of one payload, and an `occurrence` row
 * carries the JSON of the changed files. The goal is to warn before the limit,
 * never to under-report it.
 */
export const TABLE_ROW_BYTES: Record<MemoryTable, number> = {
  signature: 700,
  occurrence: 500,
  test_stats: 200,
  resolution: 500,
  raw_excerpt: 8192,
  llm_template_cache: 1024,
  outbreak: 250,
  pairing: 250,
  settings: 250,
  app_policy: 200,
  audit_log: 300,
};

/** One table of the health report. */
export interface TableHealth {
  table: string;
  rows: number;
  estimatedBytes: number;
}

/** What the panel shows. */
export interface MemoryHealth {
  /** Every table, biggest estimate first. */
  tables: TableHealth[];
  totalRows: number;
  estimatedBytes: number;
  /** The platform limit, for the ratio the panel draws. */
  limitBytes: number;
  /** Share of the limit used, 0..1. */
  usedRatio: number;
  /** Age in days of the oldest occurrence, when the memory holds one. */
  oldestOccurrenceDays?: number;
  /** ISO instant of the last retention purge, when the app purged already. */
  lastPurgeAt?: string;
}

/** Age, in whole days, of an instant; undefined when it is unreadable. */
export function ageInDays(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

/** Estimated size of one table. */
export function tableHealth(table: string, bytesPerRow: number, rows: number): TableHealth {
  return { table, rows, estimatedBytes: rows * bytesPerRow };
}

/**
 * A readable size, up to the GiB scale the limit is expressed in.
 *
 * `@dejavu/present` formats bytes for the 50 KiB excerpt cap and stops at KiB;
 * the occupancy of a memory is read in MiB and GiB, hence this ladder.
 */
export function formatOccupancy(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KiB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
  }
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100} GiB`;
}

/** Share of the platform limit, as a percentage with one decimal. */
export function usedPercent(estimatedBytes: number): number {
  return Math.round((estimatedBytes / PLATFORM_LIMIT_BYTES) * 1000) / 10;
}

/** Builds the health report out of the row counts the resolver read. */
export function buildMemoryHealth(input: {
  /** Row count per table; a table absent from the map counts as empty. */
  rows: Record<string, number>;
  /** ISO instant of the oldest occurrence, when there is one. */
  oldestOccurrenceAt?: string;
  /** ISO instant of the last retention purge, when there was one. */
  lastPurgeAt?: string;
  now: Date;
}): MemoryHealth {
  const tables = MEMORY_TABLES.map((table) =>
    tableHealth(table, TABLE_ROW_BYTES[table], input.rows[table] ?? 0),
  ).sort((a, b) => b.estimatedBytes - a.estimatedBytes || a.table.localeCompare(b.table));

  const estimatedBytes = tables.reduce((total, table) => total + table.estimatedBytes, 0);
  const totalRows = tables.reduce((total, table) => total + table.rows, 0);
  const oldestOccurrenceDays = ageInDays(input.oldestOccurrenceAt, input.now);

  const health: MemoryHealth = {
    tables,
    totalRows,
    estimatedBytes,
    limitBytes: PLATFORM_LIMIT_BYTES,
    usedRatio: estimatedBytes / PLATFORM_LIMIT_BYTES,
  };
  if (oldestOccurrenceDays !== undefined) health.oldestOccurrenceDays = oldestOccurrenceDays;
  if (input.lastPurgeAt) health.lastPurgeAt = input.lastPurgeAt;
  return health;
}
