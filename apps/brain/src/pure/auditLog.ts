/**
 * The journal of what the app did (§ 14, "What the app did" tab).
 *
 * Every action the Brain takes on the operator's behalf is written here: the
 * tickets it created, the synthesis comments it posted, the reopens, the
 * closure suggestions, the quarantine proposals, and the curation decisions
 * (merge / split) taken from the project page. Each entry carries the instant,
 * the action, the signature it concerns and the ticket it touched.
 *
 * The journal is **append-only** and bounded by the reader (the tab asks for
 * the last N entries). Writing an entry never breaks the flow that produced it:
 * a journal failure is swallowed, because the ticket action already happened.
 *
 * Pure module: `crypto` only, no `@forge/*` import.
 */

import { createHash } from 'crypto';
import type { TicketAction, TicketActionKind } from '@dejavu/core';

/** The actions the journal records. */
export const AUDIT_ACTIONS = [
  'ticket-created',
  'ticket-updated',
  'comment-posted',
  'ticket-reopened',
  'closure-suggested',
  'quarantine-proposed',
  'signature-merged',
  'signature-split',
  'excerpts-purged',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One journal line as the screens read it.
 *
 * The action is plain text on the read side: a build that does not know an
 * action still displays it instead of dropping the line.
 */
export interface AuditLine {
  /** Stable identifier, derived from the line's own content. */
  id: string;
  action: string;
  /** The signature the action concerns, when there is one. */
  signatureId?: string;
  /** The Jira ticket the action touched, when there is one. */
  issueKey?: string;
  /** A short human-readable complement (counts, ids, reasons). */
  detail?: string;
  /** ISO-8601 instant of the action. */
  createdAt: string;
}

/** One line the app writes: the action is one of the known kinds. */
export interface AuditEntry extends AuditLine {
  action: AuditAction;
}

/** What a caller hands over to record one action. */
export interface AuditInput {
  action: AuditAction;
  signatureId?: string;
  issueKey?: string;
  detail?: string;
  /** The instant of the action; defaults to the call time. */
  at?: Date;
}

/** Where the entries are stored — the SQL store implements it. */
export interface AuditSink {
  saveAuditEntry(entry: AuditEntry): Promise<void>;
}

/** Type guard for the action column (the row comes back as text). */
export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Stable identifier of an entry.
 *
 * Derived from the content, so recording the same action twice at the same
 * instant keeps one line — the journal stays idempotent under a platform
 * retry, exactly like the rest of the memory.
 */
export function auditId(
  action: AuditAction,
  signatureId: string | undefined,
  issueKey: string | undefined,
  createdAt: string,
  detail?: string,
): string {
  const identity = [action, signatureId ?? '', issueKey ?? '', createdAt, detail ?? ''].join('|');
  return createHash('sha256').update(identity).digest('hex').slice(0, 32);
}

/** Builds one journal entry. */
export function auditEntry(input: AuditInput): AuditEntry {
  const createdAt = (input.at ?? new Date()).toISOString();
  const entry: AuditEntry = {
    id: auditId(input.action, input.signatureId, input.issueKey, createdAt, input.detail),
    action: input.action,
    createdAt,
  };
  if (input.signatureId !== undefined) entry.signatureId = input.signatureId;
  if (input.issueKey !== undefined) entry.issueKey = input.issueKey;
  if (input.detail !== undefined) entry.detail = input.detail;
  return entry;
}

/** The journal action of one ticket action (§ 11). */
export function auditActionOfTicket(kind: TicketActionKind): AuditAction {
  switch (kind) {
    case 'create':
      return 'ticket-created';
    case 'update':
      return 'ticket-updated';
    case 'comment':
      return 'comment-posted';
    case 'reopen':
      return 'ticket-reopened';
    case 'close-suggested':
    default:
      return 'closure-suggested';
  }
}

/** A short complement for the journal, derived from the ticket action. */
export function ticketAuditDetail(
  action: Pick<TicketAction, 'kind' | 'summary'>,
): string | undefined {
  switch (action.kind) {
    case 'create':
      return action.summary;
    case 'update':
      return 'description refreshed';
    case 'comment':
      return 'daily synthesis';
    case 'reopen':
      return 'the failure came back';
    case 'close-suggested':
    default:
      return 'no recent occurrence';
  }
}

/** Newest first, ties broken by id (a total order). */
export function sortAuditEntries(entries: AuditLine[]): AuditLine[] {
  return [...entries].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Views a store that may carry a journal as an audit sink. */
export function auditSinkOf(
  store: { saveAuditEntry?(entry: AuditEntry): Promise<void> } | undefined,
): AuditSink | undefined {
  const save = store?.saveAuditEntry;
  if (!store || !save) return undefined;
  return { saveAuditEntry: (entry: AuditEntry) => save.call(store, entry) };
}

/**
 * Records one action, best-effort.
 *
 * Without a sink (a read-only path, a test double) nothing happens; a storage
 * failure is swallowed — the action it describes already took place, and the
 * journal must never be the reason a ticket is not created.
 */
export async function recordAudit(
  sink: AuditSink | undefined,
  input: AuditInput,
): Promise<AuditEntry | undefined> {
  if (!sink) return undefined;
  const entry = auditEntry(input);
  try {
    await sink.saveAuditEntry(entry);
    return entry;
  } catch {
    return undefined;
  }
}
