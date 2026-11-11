/**
 * Formatters of the two Forge apps (§ 14) — pure, no locale library.
 *
 * Dates, durations, byte counts, commit hashes and confidences are printed
 * the same way on the Bitbucket card and on the Jira screens: one
 * implementation, imported by both.
 */

import type { Lang } from './lang.js';

/** Formats a 0..1 confidence as a percentage ("83%"). */
export function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return `${percent}%`;
}

/**
 * Formats an ISO-8601 date as a short date.
 *
 * French: `JJ/MM/AAAA`, English: `MM/DD/YYYY`. A value that is not a date is
 * returned untouched rather than rendered as `Invalid Date`.
 */
export function formatDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return lang === 'fr' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
}

/** Formats a duration in seconds as CI minutes ("1.5 min"). */
export function formatMinutes(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0 min';
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return `${minutes} min`;
}

/** Formats a byte count the way the excerpt limit is expressed ("50 KiB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KiB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return `${Math.round((bytes / 1024) * 10) / 10} KiB`;
}

/** Shortens a commit hash to the seven characters a human reads. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}
