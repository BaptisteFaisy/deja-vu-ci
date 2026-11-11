/**
 * Jira-side helpers of the ticket applier (§ 11).
 *
 * The consumer plans ticket actions with the engine; the adapter
 * (`src/consumer.ts`) turns them into Jira REST calls. This module keeps
 * the testable part pure: ADF conversion of plain text, request bodies,
 * and the detection of the app's own last synthesis comment (the daily
 * comment brake of § 11 needs its date).
 *
 * Pure module: no `@forge/*` import.
 */

import type { TicketAction } from '@dejavu/core';

/** Marker line the app prepends to its own comments (brake detection). */
export const SYNTHESIS_MARKER = '[deja-vu-ci]';

/** One ADF node (Atlassian Document Format), as Jira REST v3 expects. */
export interface AdfNode {
  type: string;
  text?: string;
  marks?: Array<{ type: string }>;
  content?: AdfNode[];
}

/** ADF document built from a plain-text body. */
export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

function paragraph(line: string): AdfNode {
  if (line === '') return { type: 'paragraph', content: [] };
  return { type: 'paragraph', content: [{ type: 'text', text: line }] };
}

/** Converts plain text (one paragraph per line) to an ADF document. */
export function textToAdf(text: string, marker?: string): AdfDocument {
  const lines = marker ? [marker, ...text.split('\n')] : text.split('\n');
  return { type: 'doc', version: 1, content: lines.map(paragraph) };
}

/** Body of the comment REST call, with the app marker. */
export function commentBody(text: string): { body: AdfDocument } {
  return { body: textToAdf(text, SYNTHESIS_MARKER) };
}

/** Body of the issue-create REST call for a `create` ticket action. */
export function createIssueBody(
  action: TicketAction,
  projectKey: string,
): { fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: action.summary,
    issuetype: { name: 'Task' },
    labels: [...(action.labels ?? [])],
  };
  if (action.description) fields.description = textToAdf(action.description, SYNTHESIS_MARKER);
  if (action.assignee) fields.assignee = { id: action.assignee };
  return { fields };
}

/** Body of the issue-edit REST call for an `update` ticket action. */
export function updateIssueBody(
  action: TicketAction,
): { fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = { summary: action.summary };
  if (action.description) fields.description = textToAdf(action.description, SYNTHESIS_MARKER);
  if (action.labels) fields.labels = [...action.labels];
  return { fields };
}

/** One comment of the Jira REST answer, as far as this module cares. */
export interface JiraComment {
  created?: string;
  body?: unknown;
}

/** True when an ADF body contains the app marker and the signature id. */
function isOwnComment(comment: JiraComment, signatureId: string): boolean {
  const raw = JSON.stringify(comment.body ?? '');
  return raw.includes(SYNTHESIS_MARKER) && raw.includes(signatureId);
}

/**
 * ISO date of the last synthesis comment the app posted for a signature.
 * The daily brake of § 11 (`commentAlreadyToday`) reads this date; Jira
 * itself is the source of truth, so a Brain redeploy never double-comments.
 */
export function findLastSynthesisAt(
  comments: JiraComment[],
  signatureId: string,
): string | undefined {
  let latest: string | undefined;
  for (const comment of comments) {
    if (typeof comment.created !== 'string') continue;
    if (!isOwnComment(comment, signatureId)) continue;
    if (latest === undefined || comment.created > latest) latest = comment.created;
  }
  return latest;
}
