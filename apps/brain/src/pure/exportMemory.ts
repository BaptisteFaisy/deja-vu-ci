/**
 * Export of the CI memory (§ 14, "Export" panel).
 *
 * The operator can take the memory out of the app: the signatures, their
 * occurrences and their resolutions, as CSV or as JSON. Both documents are
 * produced **here**, on the resolver side — the browser only receives a ready
 * file and a timestamped name, so the export of a large memory never depends
 * on what the UI Kit can render.
 *
 * The CSV is one tidy table: a leading `type` column tells a signature from an
 * occurrence or a resolution, and every entity keeps its own columns (blank for
 * the others). One file, one header, readable by a spreadsheet and by a script.
 *
 * Pure module: no `@forge/*` import, no network. Sorting is total, so two
 * exports of the same memory are byte-identical.
 */

import type { Occurrence, Resolution, Signature } from '@dejavu/core';

/** The two formats the panel offers. */
export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** What the resolver hands to the exporter. */
export interface MemoryExportBundle {
  signatures: Signature[];
  occurrences: Occurrence[];
  resolutions: Resolution[];
}

/** The document the browser downloads. */
export interface MemoryExport {
  format: ExportFormat;
  /** Timestamped file name, e.g. `deja-vu-memory-20261112T101500Z.csv`. */
  filename: string;
  contentType: string;
  content: string;
  counts: { signatures: number; occurrences: number; resolutions: number };
}

/** Type guard for the format asked by the panel (the payload is unknown). */
export function isExportFormat(value: unknown): value is ExportFormat {
  return value === 'csv' || value === 'json';
}

/** The CSV columns, in order. */
export const CSV_HEADER: readonly string[] = [
  'type',
  'id',
  'signature_id',
  'family_id',
  'status',
  'category',
  'error_type',
  'template',
  'test_name',
  'first_seen',
  'last_seen',
  'occurrences',
  'issue_key',
  'repo',
  'branch',
  'commit',
  'author',
  'step_name',
  'duration_s',
  'occurred_at',
  'passed_on_retry',
  'resolution_commit',
  'resolution_author',
  'resolution_files',
  'resolution_note',
  'resolution_confidence',
  'resolution_confirmed_by',
  'resolution_confirmed_at',
];

/** One CSV cell: quoted and doubled when it holds a comma, a quote or a newline. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line. */
export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

/**
 * The cells of one entity, keyed by column name.
 *
 * Keying by name (rather than by position) is what keeps the three kinds
 * aligned with the single header: a column added to `CSV_HEADER` shows up empty
 * for the kinds that do not carry it, and never shifts the others.
 */
export type CsvCells = Record<string, unknown>;

/** The signature cells. */
export function signatureCells(signature: Signature): CsvCells {
  return {
    type: 'signature',
    id: signature.id,
    family_id: signature.familyId,
    status: signature.status,
    category: signature.category,
    error_type: signature.errorType,
    template: signature.template,
    test_name: signature.testName,
    first_seen: signature.firstSeen,
    last_seen: signature.lastSeen,
    occurrences: signature.occurrences,
    issue_key: signature.issueKey,
  };
}

/** The occurrence cells. */
export function occurrenceCells(occurrence: Occurrence): CsvCells {
  return {
    type: 'occurrence',
    id: occurrence.id,
    signature_id: occurrence.signatureId,
    family_id: occurrence.familyId,
    test_name: occurrence.testName,
    repo: occurrence.repo,
    branch: occurrence.branch,
    commit: occurrence.commit,
    author: occurrence.author,
    step_name: occurrence.stepName,
    duration_s: occurrence.durationS,
    occurred_at: occurrence.occurredAt,
    passed_on_retry: occurrence.passedOnRetry ? 1 : 0,
  };
}

/** The resolution cells. */
export function resolutionCells(resolution: Resolution): CsvCells {
  return {
    type: 'resolution',
    id: resolution.id,
    signature_id: resolution.signatureId,
    resolution_commit: resolution.commit,
    resolution_author: resolution.author,
    resolution_files: resolution.files.join('|'),
    resolution_note: resolution.note,
    resolution_confidence: resolution.confidence,
    resolution_confirmed_by: resolution.confirmedBy,
    resolution_confirmed_at: resolution.confirmedAt,
  };
}

/** One entity as one CSV line, in the order of the header. */
export function csvLine(cells: CsvCells): string {
  return csvRow(CSV_HEADER.map((column) => cells[column]));
}

/** Deterministic order: signatures by id, occurrences by time then id. */
export function sortedBundle(bundle: MemoryExportBundle): MemoryExportBundle {
  return {
    signatures: [...bundle.signatures].sort((a, b) => a.id.localeCompare(b.id)),
    occurrences: [...bundle.occurrences].sort(
      (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    ),
    resolutions: [...bundle.resolutions].sort((a, b) => a.signatureId.localeCompare(b.signatureId)),
  };
}

/** The whole memory as one CSV document. */
export function toCsvExport(bundle: MemoryExportBundle): string {
  const sorted = sortedBundle(bundle);
  const lines = [csvRow([...CSV_HEADER])];
  for (const signature of sorted.signatures) lines.push(csvLine(signatureCells(signature)));
  for (const occurrence of sorted.occurrences) lines.push(csvLine(occurrenceCells(occurrence)));
  for (const resolution of sorted.resolutions) lines.push(csvLine(resolutionCells(resolution)));
  return `${lines.join('\r\n')}\r\n`;
}

/** The whole memory as one JSON document. */
export function toJsonExport(bundle: MemoryExportBundle, generatedAt: Date): string {
  const sorted = sortedBundle(bundle);
  return JSON.stringify(
    {
      generatedAt: generatedAt.toISOString(),
      counts: {
        signatures: sorted.signatures.length,
        occurrences: sorted.occurrences.length,
        resolutions: sorted.resolutions.length,
      },
      ...sorted,
    },
    null,
    2,
  );
}

/** A file name that carries the instant of the export (file-system safe). */
export function exportFileName(format: ExportFormat, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `deja-vu-memory-${stamp}.${format}`;
}

/** Content type of one format. */
export function contentTypeOf(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json';
}

/** Builds the document the panel downloads. */
export function buildExport(
  bundle: MemoryExportBundle,
  format: ExportFormat,
  now: Date,
): MemoryExport {
  const content =
    format === 'csv' ? toCsvExport(bundle) : toJsonExport(bundle, now);
  return {
    format,
    filename: exportFileName(format, now),
    contentType: contentTypeOf(format),
    content,
    counts: {
      signatures: bundle.signatures.length,
      occurrences: bundle.occurrences.length,
      resolutions: bundle.resolutions.length,
    },
  };
}
