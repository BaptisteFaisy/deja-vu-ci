/**
 * The pull-request card, as data (§ 14, screen 1) — pure, no React, no Forge.
 *
 * The card shows what the Brain answered for the branch: the nature of the
 * failure, how confident the diagnosis is, its title and summary, the facts
 * behind it, the action to take, and the ticket of the problem when there is
 * one. Every word comes from `@dejavu/present`, so the card and the Jira
 * screens say the same thing about the same diagnostic.
 *
 * The component (`src/ui/prCard.tsx`) only places these values: a screen that
 * cannot load says so, and a branch without a known failure says that too —
 * it never shows a blank rectangle.
 */

import type { QueryResponse } from '@dejavu/core';
import {
  actionLabel,
  diagnosticLabel,
  diagnosticTone,
  formatDate,
  formatConfidence,
  shortCommit,
  t,
} from '@dejavu/present';
import type { Lang, Tone } from '@dejavu/present';

/** What the card has to render. */
export type PrCardState = 'loading' | 'diagnostic' | 'empty' | 'error';

/** The card's view model: one field per thing it displays. */
export interface PrCardView {
  state: PrCardState;
  /** "Known flaky failure" — the nature of the failure. */
  headline?: string;
  /** Colour of the headline. */
  tone?: Tone;
  /** "83%". */
  confidence?: string;
  /** "Retry the build". */
  action?: string;
  title?: string;
  summary?: string;
  /** The facts, already spelled out ("occurrences: 17"). */
  facts: string[];
  /** Raw excerpts the diagnosis rests on (§ 18: the facts are always shown). */
  evidence: string[];
  issueKey?: string;
  /** The fix, when the failure was already seen and fixed. */
  resolution?: string;
  /** Changed files of the PR that appear in the stack. */
  suspects: string[];
  /** Date of the last known failure of the branch. */
  lastFailure?: string;
  error?: string;
}

/** A card with nothing to show yet. */
export function loadingCard(): PrCardView {
  return { state: 'loading', facts: [], evidence: [], suspects: [] };
}

/** Spells out the resolution the diagnostic cites. */
function resolutionLine(commit: string, author: string, note: string | undefined): string {
  return [shortCommit(commit), author, note ?? ''].filter((part) => part.length > 0).join(' — ');
}

/**
 * Turns the Brain's answer into what the card displays.
 *
 * `undefined` means "still loading"; `{ ok: false }` means the Brain could not
 * answer (or the workspace is not paired) and the reason is shown; `{ ok: true }`
 * without a diagnostic means no failure of this branch is known.
 */
export function prCardView(response: QueryResponse | undefined, lang: Lang): PrCardView {
  if (response === undefined) return loadingCard();
  if (!response.ok) {
    return {
      state: 'error',
      facts: [],
      evidence: [],
      suspects: [],
      error: response.error || t('error.title', lang),
    };
  }
  const diagnostic = response.diagnostic;
  if (!diagnostic) {
    return { state: 'empty', facts: [], evidence: [], suspects: [] };
  }
  return {
    state: 'diagnostic',
    headline: diagnosticLabel(diagnostic.kind, lang),
    tone: diagnosticTone(diagnostic.kind),
    confidence: formatConfidence(diagnostic.confidence),
    action: actionLabel(diagnostic.action, lang),
    title: diagnostic.title,
    summary: diagnostic.summary,
    facts: diagnostic.facts.map((fact) => `${fact.label}: ${fact.value}`),
    evidence: diagnostic.evidence ?? [],
    suspects: diagnostic.suspects ?? [],
    ...(diagnostic.issueKey ? { issueKey: diagnostic.issueKey } : {}),
    ...(diagnostic.resolution
      ? {
          resolution: resolutionLine(
            diagnostic.resolution.commit,
            diagnostic.resolution.author,
            diagnostic.resolution.note,
          ),
        }
      : {}),
    ...(response.lastFailureAt
      ? { lastFailure: formatDate(response.lastFailureAt, lang) }
      : {}),
  };
}
