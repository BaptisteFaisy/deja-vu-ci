/**
 * Tests of the memory health report (`src/pure/memoryHealth.ts`).
 *
 * The platform gives one installation 1 GiB and exposes no byte accounting, so
 * the report is an estimate: one conservative average row size per table, times
 * the row count. What is verified here is the arithmetic, the readable sizes,
 * the age of the oldest failure, the date of the last purge — and that the table
 * list really is the schema's, so a new table cannot go unreported.
 */

import { describe, expect, it } from 'vitest';
import { SQL_SCHEMA } from '@dejavu/core';
import { APP_SCHEMA } from '../src/pure/appSchema';
import {
  MEMORY_TABLES,
  PLATFORM_LIMIT_BYTES,
  TABLE_ROW_BYTES,
  ageInDays,
  buildMemoryHealth,
  formatOccupancy,
  tableHealth,
  usedPercent,
} from '../src/pure/memoryHealth';

const NOW = new Date('2026-11-12T10:00:00.000Z');

/** Every table the migration declares: the engine's schema, then the app's. */
function schemaTables(): string[] {
  return [...`${SQL_SCHEMA}\n${APP_SCHEMA}`.matchAll(/CREATE TABLE (\w+)/g)].map(
    (match) => match[1],
  );
}

describe('the table list', () => {
  it('covers every table of the schema, and nothing else', () => {
    expect([...MEMORY_TABLES].sort()).toEqual(schemaTables().sort());
  });

  it('gives every table a positive average row size', () => {
    for (const table of MEMORY_TABLES) {
      expect(TABLE_ROW_BYTES[table]).toBeGreaterThan(0);
    }
  });
});

describe('buildMemoryHealth', () => {
  it('estimates the occupancy from the row counts', () => {
    const health = buildMemoryHealth({
      rows: { signature: 10, occurrence: 40, raw_excerpt: 40 },
      now: NOW,
    });
    expect(health.totalRows).toBe(90);
    expect(health.estimatedBytes).toBe(10 * 700 + 40 * 500 + 40 * 8192);
    expect(health.limitBytes).toBe(PLATFORM_LIMIT_BYTES);
    expect(health.usedRatio).toBeCloseTo(health.estimatedBytes / PLATFORM_LIMIT_BYTES, 10);
  });

  it('counts a table the resolver did not report as empty', () => {
    const health = buildMemoryHealth({ rows: { signature: 3 }, now: NOW });
    expect(health.tables).toHaveLength(MEMORY_TABLES.length);
    expect(health.tables.find((table) => table.table === 'outbreak')?.rows).toBe(0);
  });

  it('lists the tables biggest estimate first', () => {
    const health = buildMemoryHealth({
      rows: { signature: 10, occurrence: 40, raw_excerpt: 40 },
      now: NOW,
    });
    expect(health.tables[0].table).toBe('raw_excerpt');
    const estimates = health.tables.map((table) => table.estimatedBytes);
    expect(estimates).toEqual([...estimates].sort((a, b) => b - a));
  });

  it('reports an empty memory as empty', () => {
    const health = buildMemoryHealth({ rows: {}, now: NOW });
    expect(health.totalRows).toBe(0);
    expect(health.estimatedBytes).toBe(0);
    expect(health.usedRatio).toBe(0);
    expect(health.oldestOccurrenceDays).toBeUndefined();
    expect(health.lastPurgeAt).toBeUndefined();
  });

  it('ages the oldest occurrence and carries the last purge', () => {
    const health = buildMemoryHealth({
      rows: { occurrence: 1 },
      oldestOccurrenceAt: '2026-11-02T10:00:00.000Z',
      lastPurgeAt: '2026-11-12T03:00:00.000Z',
      now: NOW,
    });
    expect(health.oldestOccurrenceDays).toBe(10);
    expect(health.lastPurgeAt).toBe('2026-11-12T03:00:00.000Z');
  });
});

describe('tableHealth', () => {
  it('multiplies the rows by the average row size', () => {
    expect(tableHealth('signature', 700, 3)).toEqual({
      table: 'signature',
      rows: 3,
      estimatedBytes: 2100,
    });
  });
});

describe('ageInDays', () => {
  it('counts whole days, and never a negative age', () => {
    expect(ageInDays('2026-11-12T09:00:00.000Z', NOW)).toBe(0);
    expect(ageInDays('2026-11-11T10:00:00.000Z', NOW)).toBe(1);
    expect(ageInDays('2026-11-20T10:00:00.000Z', NOW)).toBe(0);
  });

  it('answers undefined on a missing or unreadable instant', () => {
    expect(ageInDays(undefined, NOW)).toBeUndefined();
    expect(ageInDays('not-a-date', NOW)).toBeUndefined();
  });
});

describe('formatOccupancy', () => {
  it('reads bytes, KiB, MiB and GiB', () => {
    expect(formatOccupancy(512)).toBe('512 B');
    expect(formatOccupancy(2048)).toBe('2 KiB');
    expect(formatOccupancy(5 * 1024 * 1024)).toBe('5 MiB');
    expect(formatOccupancy(1024 * 1024 * 1024)).toBe('1 GiB');
    expect(formatOccupancy(-1)).toBe('0 KiB');
    expect(formatOccupancy(Number.NaN)).toBe('0 KiB');
  });
});

describe('usedPercent', () => {
  it('measures the share of the platform limit', () => {
    expect(usedPercent(PLATFORM_LIMIT_BYTES)).toBe(100);
    expect(usedPercent(PLATFORM_LIMIT_BYTES / 2)).toBe(50);
    expect(usedPercent(0)).toBe(0);
    expect(usedPercent(PLATFORM_LIMIT_BYTES / 1000)).toBe(0.1);
  });
});
