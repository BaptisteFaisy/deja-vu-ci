/**
 * How a signature reads on the CI Memory page (§ 14, screen 3) — pure module.
 *
 * Rows, filters and sorts stay here because only this screen has them. The
 * labels and formatters both apps share (`statusLabel`, `categoryLabel`,
 * `formatDate`, `formatMinutes`, `shortCommit`) come from `@dejavu/present`:
 * they are written once and displayed identically on the Bitbucket card.
 *
 * No JSX, no `@forge/react` import, no network: the components `.tsx` only
 * place these values.
 */

import {
  categoryLabel,
  formatDate,
  formatMinutes,
  shortCommit,
  statusLabel,
  statusNeedsAttention,
  statusTone,
} from '@dejavu/present';
import type { Lang, Tone } from '@dejavu/present';
import type { Category, CostReport, Occurrence, Signature, SignatureStatus } from '@dejavu/core';

export { categoryLabel, formatDate, formatMinutes, shortCommit };
export type { Lang };

/** A status with its colour (Atlassian tokens, no CSS class). */
export interface StatusBadge {
  label: string;
  /** Colour token: `green`, `yellow`, `red`, `blue`, `grey`, `purple`. */
  tone: Tone;
  /** True when the signature asks the developer to do something. */
  attention: boolean;
}

/** Label and colour of a signature status. */
export function statusBadge(status: SignatureStatus, lang: Lang): StatusBadge {
  return {
    label: statusLabel(status, lang),
    tone: statusTone(status),
    attention: statusNeedsAttention(status),
  };
}

/** Filters of the CI Memory page. */
export interface SignatureFilter {
  status?: SignatureStatus;
  category?: Category;
  /** Free text over the template, the error type and the test name. */
  text?: string;
  repository?: string;
}

/** One row of the signature table. */
export interface SignatureRow {
  id: string;
  shortId: string;
  status: SignatureStatus;
  badge: StatusBadge;
  category: Category;
  categoryLabel: string;
  errorType: string;
  template: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  issueKey?: string;
}

/** Sort keys of the signature table. */
export type SignatureSortKey = 'lastSeen' | 'occurrences' | 'status' | 'category';

/** Builds the table rows out of the signatures. */
export function toSignatureRows(
  signatures: Signature[],
  shortId: (id: string) => string,
  lang: Lang,
): SignatureRow[] {
  return signatures.map((signature) => ({
    id: signature.id,
    shortId: shortId(signature.id),
    status: signature.status,
    badge: statusBadge(signature.status, lang),
    category: signature.category,
    categoryLabel: categoryLabel(signature.category, lang),
    errorType: signature.errorType,
    template: signature.template,
    occurrences: signature.occurrences,
    firstSeen: signature.firstSeen,
    lastSeen: signature.lastSeen,
    issueKey: signature.issueKey,
  }));
}

/** A row is kept when it contains the searched text. */
function matchesText(row: SignatureRow, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [row.template, row.errorType, row.shortId, row.issueKey ?? '']
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

/** Applies the filters of the project page. */
export function filterSignatureRows(
  rows: SignatureRow[],
  filter: SignatureFilter,
): SignatureRow[] {
  return rows.filter((row) => {
    if (filter.status && row.status !== filter.status) return false;
    if (filter.category && row.category !== filter.category) return false;
    return matchesText(row, filter.text ?? '');
  });
}

/** Compares two rows along one sort key. */
function compareRows(a: SignatureRow, b: SignatureRow, key: SignatureSortKey): number {
  switch (key) {
    case 'occurrences':
      return b.occurrences - a.occurrences;
    case 'status':
      return a.status.localeCompare(b.status);
    case 'category':
      return a.category.localeCompare(b.category);
    case 'lastSeen':
    default:
      return a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0;
  }
}

/** Sorts the table rows (stable sort, latest seen first). */
export function sortSignatureRows(
  rows: SignatureRow[],
  key: SignatureSortKey,
  descending = false,
): SignatureRow[] {
  const sorted = [...rows].sort((a, b) => compareRows(a, b, key));
  return descending ? sorted.reverse() : sorted;
}

/** One row of the occurrence table. */
export interface OccurrenceRow {
  occurredAt: string;
  repo: string;
  branch: string;
  commit: string;
  author: string;
  stepName: string;
  durationS: number;
  buildUrl?: string;
}

/** Builds the occurrence rows, most recent first. */
export function toOccurrenceRows(occurrences: Occurrence[]): OccurrenceRow[] {
  return [...occurrences]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .map((occurrence) => ({
      occurredAt: occurrence.occurredAt,
      repo: occurrence.repo,
      branch: occurrence.branch,
      commit: occurrence.commit,
      author: occurrence.author,
      stepName: occurrence.stepName,
      durationS: occurrence.durationS,
      buildUrl: occurrence.buildUrl,
    }));
}

/** One row of the Cost tab. */
export interface CostRow {
  signatureId: string;
  shortId: string;
  title: string;
  occurrences: number;
  ciMinutesLost: number;
  peopleAffected: number;
  retries: number;
}

/** Builds the Cost tab rows, most expensive first. */
export function toCostRows(report: CostReport, shortId: (id: string) => string): CostRow[] {
  return report.perSignature.map((cost) => ({
    signatureId: cost.signatureId,
    shortId: shortId(cost.signatureId),
    title: cost.title,
    occurrences: cost.occurrences,
    ciMinutesLost: cost.ciMinutesLost,
    peopleAffected: cost.peopleAffected,
    retries: cost.retries,
  }));
}
