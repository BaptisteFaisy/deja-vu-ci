/**
 * Tests of the memory export (`src/pure/exportMemory.ts`).
 *
 * The document the operator downloads is built here, on the resolver side: what
 * is verified is the CSV shape (one tidy table, a `type` column, RFC-4180
 * quoting), the JSON shape, the timestamped file name, and the determinism of
 * both — two exports of the same memory are byte-identical.
 */

import { describe, expect, it } from 'vitest';
import {
  CSV_HEADER,
  buildExport,
  csvCell,
  csvRow,
  exportFileName,
  isExportFormat,
  sortedBundle,
  toCsvExport,
  toJsonExport,
  type MemoryExportBundle,
} from '../src/pure/exportMemory';
import { FLAKY_OCCURRENCES, FLAKY_SIGNATURE, NEW_SIGNATURE, RESOLUTION } from './fakes/fixtures';

const NOW = new Date('2026-11-12T10:00:00.000Z');

const BUNDLE: MemoryExportBundle = {
  signatures: [FLAKY_SIGNATURE, NEW_SIGNATURE],
  occurrences: FLAKY_OCCURRENCES,
  resolutions: [RESOLUTION],
};

/** The lines of a CSV document (the exporter separates them with CRLF). */
function linesOf(csv: string): string[] {
  return csv.split('\r\n').filter((line) => line !== '');
}

describe('the CSV cells', () => {
  it('leaves a plain value untouched', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).toBe('');
  });

  it('quotes a value that holds a comma, a quote or a newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('joins a row with commas', () => {
    expect(csvRow(['a', 1, '', null])).toBe('a,1,,');
  });
});

describe('toCsvExport', () => {
  it('opens with the header and gives one line per entity', () => {
    const csv = toCsvExport(BUNDLE);
    const lines = linesOf(csv);
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    // 2 signatures + 3 occurrences + 1 resolution.
    expect(lines).toHaveLength(1 + 6);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('tells the three kinds apart with the leading column', () => {
    const kinds = linesOf(toCsvExport(BUNDLE)).slice(1).map((line) => line.split(',')[0]);
    expect(kinds).toEqual([
      'signature',
      'signature',
      'occurrence',
      'occurrence',
      'occurrence',
      'resolution',
    ]);
  });

  it('carries the columns of each kind', () => {
    const header = CSV_HEADER;
    const lines = linesOf(toCsvExport(BUNDLE)).slice(1);
    const signatureRow = lines[0].split(',');
    const at = (column: string): string => signatureRow[header.indexOf(column)];
    expect(at('id')).toBe(FLAKY_SIGNATURE.id);
    expect(at('status')).toBe('flaky');
    expect(at('issue_key')).toBe('PAY-88');
    expect(at('occurrences')).toBe('4');

    const resolutionRow = lines[5].split(',');
    const resolved = (column: string): string => resolutionRow[header.indexOf(column)];
    expect(resolved('signature_id')).toBe(RESOLUTION.signatureId);
    expect(resolved('resolution_commit')).toBe(RESOLUTION.commit);
    expect(resolved('resolution_confidence')).toBe('1');
  });

  it('quotes a template that holds a comma', () => {
    const tricky = {
      ...BUNDLE,
      signatures: [{ ...NEW_SIGNATURE, template: 'expected "a", got b' }],
      occurrences: [],
      resolutions: [],
    };
    const line = linesOf(toCsvExport(tricky))[1];
    expect(line).toContain('"expected ""a"", got b"');
  });

  it('is deterministic: the same memory exports twice the same bytes', () => {
    expect(toCsvExport(BUNDLE)).toBe(toCsvExport(BUNDLE));
    const shuffled = {
      signatures: [...BUNDLE.signatures].reverse(),
      occurrences: [...BUNDLE.occurrences].reverse(),
      resolutions: [...BUNDLE.resolutions],
    };
    expect(toCsvExport(shuffled)).toBe(toCsvExport(BUNDLE));
  });
});

describe('sortedBundle', () => {
  it('sorts the signatures by id and the occurrences by instant', () => {
    const sorted = sortedBundle(BUNDLE);
    expect(sorted.signatures.map((s) => s.id)).toEqual(
      [FLAKY_SIGNATURE.id, NEW_SIGNATURE.id].sort(),
    );
    const times = sorted.occurrences.map((o) => o.occurredAt);
    expect(times).toEqual([...times].sort());
  });
});

describe('toJsonExport', () => {
  it('carries the instant, the counts and the three collections', () => {
    const parsed = JSON.parse(toJsonExport(BUNDLE, NOW)) as {
      generatedAt: string;
      counts: { signatures: number; occurrences: number; resolutions: number };
      signatures: unknown[];
      occurrences: unknown[];
      resolutions: unknown[];
    };
    expect(parsed.generatedAt).toBe('2026-11-12T10:00:00.000Z');
    expect(parsed.counts).toEqual({ signatures: 2, occurrences: 3, resolutions: 1 });
    expect(parsed.signatures).toHaveLength(2);
    expect(parsed.occurrences).toHaveLength(3);
    expect(parsed.resolutions).toHaveLength(1);
  });

  it('is indented, so an operator can read it', () => {
    expect(toJsonExport(BUNDLE, NOW)).toContain('\n  "generatedAt"');
  });
});

describe('the file name and the document', () => {
  it('stamps the instant of the export, file-system safe', () => {
    expect(exportFileName('csv', NOW)).toBe('deja-vu-memory-20261112T100000Z.csv');
    expect(exportFileName('json', NOW)).toBe('deja-vu-memory-20261112T100000Z.json');
    // No colon, no slash: a name every file system accepts.
    expect(exportFileName('csv', NOW)).not.toMatch(/[:/\\]/);
    expect(exportFileName('csv', NOW).split('.')).toHaveLength(2);
  });

  it('builds the document the panel downloads', () => {
    const csv = buildExport(BUNDLE, 'csv', NOW);
    expect(csv.contentType).toBe('text/csv; charset=utf-8');
    expect(csv.filename).toBe('deja-vu-memory-20261112T100000Z.csv');
    expect(csv.counts).toEqual({ signatures: 2, occurrences: 3, resolutions: 1 });

    const json = buildExport(BUNDLE, 'json', NOW);
    expect(json.contentType).toBe('application/json');
    expect(json.content.startsWith('{')).toBe(true);
  });

  it('recognises the two formats', () => {
    expect(isExportFormat('csv')).toBe(true);
    expect(isExportFormat('json')).toBe(true);
    expect(isExportFormat('pdf')).toBe(false);
    expect(isExportFormat(undefined)).toBe(false);
  });
});
