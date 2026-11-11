/**
 * Text context of a Jira issue, for Rovo (§ 14, screen 4).
 *
 * `jira:issueContext` in the `function` variant renders **text**, not a
 * panel: it is what the Rovo agent reads to answer "why is this build red?"
 * without opening the app. The text is built here, out of Forge, so it is
 * unit-tested; the labels come from `@dejavu/present` — the same words the
 * Jira screens and the Bitbucket card display.
 *
 * Pure module: no `@forge/*` import.
 */

import type { Diagnostic, Occurrence } from '@dejavu/core';
import { actionLabel, diagnosticLabel, formatConfidence, formatMinutes, t } from '@dejavu/present';
import type { Lang } from '@dejavu/present';

/** What the issue panel resolver already produced (single source of truth). */
export interface IssueContextInput {
  diagnostic?: Diagnostic;
  occurrences?: Occurrence[];
  problem?: boolean;
}

/** Text rendered when the memory knows nothing about this issue. */
export const NO_KNOWN_FAILURE = 'No known CI failure for this issue.';

/** CI seconds lost on the occurrences of this problem. */
export function lostSeconds(occurrences: Occurrence[] | undefined): number {
  if (!occurrences) return 0;
  return occurrences.reduce((total, occurrence) => total + (occurrence.durationS || 0), 0);
}

/**
 * One short paragraph: the current diagnostic, the ticket of the problem and
 * what the failure already cost.
 *
 * Rovo reads English, so English is the default; the language stays a
 * parameter because the same builder serves the French interface.
 */
export function issueContextText(input: IssueContextInput, lang: Lang = 'en'): string {
  const diagnostic = input.diagnostic;
  if (!diagnostic) return NO_KNOWN_FAILURE;

  const parts: string[] = [
    `${diagnosticLabel(diagnostic.kind, lang)} (${formatConfidence(diagnostic.confidence)}).`,
    `${t('diagnostic.action', lang)}: ${actionLabel(diagnostic.action, lang)}.`,
  ];
  if (diagnostic.issueKey) parts.push(`${t('diagnostic.ticket', lang)}: ${diagnostic.issueKey}.`);
  const seconds = lostSeconds(input.occurrences);
  if (seconds > 0) {
    parts.push(`CI time lost: ${formatMinutes(seconds)} over ${input.occurrences?.length ?? 0} builds.`);
  }
  return parts.join(' ');
}
