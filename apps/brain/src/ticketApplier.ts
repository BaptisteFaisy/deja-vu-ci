/**
 * The Jira side of the ticket plan (§ 11).
 *
 * Every action is best-effort: a refused transition degrades to a comment, and
 * a failure never aborts the whole message — the memory (SQL) stays the source
 * of truth. The **target project** is resolved upstream
 * (`pure/projectTarget.ts`): the app writes into the project the operator is
 * looking at, and creates no ticket at all when it knows no project — it says
 * why instead, in the journal and in the refusal it returns.
 *
 * **Invariant — the journal never lies.** `requestJira` resolves on *any* HTTP
 * answer, 403 included: it does not throw on a refusal. So an action is
 * journalled (`ticket-updated`, `comment-posted`, …) **only after Jira answered
 * 2xx**; otherwise the app journals a `ticket-refused` carrying the status and
 * the body it read, and returns the error to its caller. Without that check the
 * journal claimed writes that never reached the ticket — the exact opposite of
 * what this product promises.
 *
 * This module lives **apart from the consumer** so the refusal path is testable
 * without the platform: it imports only `@forge/api` and the `pure/` modules,
 * never `./sql` (which the root workspace does not install). The consumer wires
 * the real SQL store around it.
 */

import { assumeTrustedRoute, requestJira } from '@forge/api';
import type { Signature, TicketAction } from '@dejavu/core';
import { createDecision, type ProjectTarget } from './pure/projectTarget';
import { commentBody, createIssueBody, findLastSynthesisAt, updateIssueBody } from './pure/jira';
import {
  auditActionOfTicket,
  recordAudit,
  ticketAuditDetail,
  type AuditSink,
} from './pure/auditLog';

/** One Jira answer, read **once** (a fetch body cannot be replayed). */
interface JiraReply {
  ok: boolean;
  status: number;
  body: string;
}

/** What one ticket action produced: the key to remember, or the refusal. */
interface Applied {
  issueKey?: string;
  error?: string;
}

/** Reads a Jira answer once and keeps its status next to its raw body. */
async function readJira(response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}): Promise<JiraReply> {
  return { ok: response.ok, status: response.status, body: await response.text() };
}

/** The refusal carried by an answer — `undefined` when Jira accepted the write. */
function refusalOf(reply: JiraReply): string | undefined {
  if (reply.ok) return undefined;
  const detail = reply.body.replace(/\s+/g, ' ').trim().slice(0, 200);
  return `Jira ${reply.status}${detail ? `: ${detail}` : ''}`;
}

/** The JSON body of an answer, tolerant to empty or malformed payloads. */
function jsonOf(reply: JiraReply): Record<string, unknown> {
  if (!reply.body) return {};
  try {
    return JSON.parse(reply.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** One write to Jira: `undefined` when it landed, otherwise the refusal read. */
async function writeJira(
  path: string,
  method: 'POST' | 'PUT',
  payload: unknown,
): Promise<string | undefined> {
  const reply = await readJira(await requestJira(assumeTrustedRoute(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  return refusalOf(reply);
}

/** Posts a plain comment (also the fallback of every failed transition). */
function postComment(issueKey: string, text: string): Promise<string | undefined> {
  return writeJira(`/rest/api/3/issue/${issueKey}/comment`, 'POST', commentBody(text));
}

/** The id of a "reopen"-like transition, or the refusal that hid it. */
async function findReopenTransition(
  issueKey: string,
): Promise<{ transitionId?: string; error?: string }> {
  const reply = await readJira(await requestJira(
    assumeTrustedRoute(`/rest/api/3/issue/${issueKey}/transitions`),
    { method: 'GET', headers: { Accept: 'application/json' } },
  ));
  const error = refusalOf(reply);
  if (error) return { error };
  const transitions = (jsonOf(reply).transitions ?? []) as Array<{ id: string; name: string }>;
  const transitionId = transitions.find((t) => /reopen/i.test(t.name))?.id;
  return { ...(transitionId ? { transitionId } : {}) };
}

/** The journal side of the applier: where and when an action is recorded. */
export interface TicketApplierOptions {
  /** The journal of what the app did; absent = nothing is recorded. */
  audit?: AuditSink;
  /** The clock of the journal entries. */
  now?: () => Date;
}

/** One journal line per ticket action the app really applied. */
async function recordTicketAction(
  options: TicketApplierOptions,
  action: TicketAction,
  signature: Signature,
  issueKey: string | undefined,
): Promise<void> {
  const key = issueKey ?? action.issueKey;
  const detail = ticketAuditDetail(action);
  const at = options.now?.();
  await recordAudit(options.audit, {
    action: auditActionOfTicket(action.kind),
    signatureId: signature.id,
    ...(key ? { issueKey: key } : {}),
    ...(detail ? { detail } : {}),
    ...(at ? { at } : {}),
  });
}

/**
 * One journal line for a ticket action that **did not land**.
 *
 * The refusal is an action of the app like any other: the operator reads it in
 * the journal ("What the app did") instead of wondering why no ticket appeared,
 * and carries the reason Jira gave — not a silence the app dressed up as a
 * success.
 */
async function recordRefusal(
  options: TicketApplierOptions,
  signature: Signature,
  reason: string,
  issueKey?: string,
): Promise<void> {
  const at = options.now?.();
  await recordAudit(options.audit, {
    action: 'ticket-refused',
    signatureId: signature.id,
    ...(issueKey ? { issueKey } : {}),
    detail: reason,
    ...(at ? { at } : {}),
  });
}

/** The outcome of an action Jira refused: the error, plus the key to keep. */
function refused(issueKey: string | undefined, error: string): Applied {
  return { ...(issueKey ? { issueKey } : {}), error };
}

/**
 * The Jira side of the ticket plan (§ 11), as a real applier.
 *
 * The target project comes from `pure/projectTarget.ts` (the setting primes,
 * the screen answers, the background path refuses). Each applied action also
 * lands in the journal of what the app did; a journal failure never breaks the
 * action. A write Jira refused lands in the journal as a **refusal**, never as
 * a success.
 */
export function jiraTicketApplier(target: ProjectTarget, options: TicketApplierOptions = {}) {
  return {
    async lastCommentAt(issueKey: string, signatureId: string): Promise<string | undefined> {
      const reply = await readJira(await requestJira(
        assumeTrustedRoute(`/rest/api/3/issue/${issueKey}/comment`),
        { method: 'GET', headers: { Accept: 'application/json' } },
      ));
      if (!reply.ok) return undefined;
      const comments = (jsonOf(reply).comments ?? []) as Array<{ created?: string; body?: unknown }>;
      return findLastSynthesisAt(comments, signatureId);
    },

    async apply(action: TicketAction, signature: Signature): Promise<Applied> {
      try {
        const applied = await applyOne(action, signature, target);
        if (applied.error) {
          await recordRefusal(options, signature, applied.error, applied.issueKey);
          return applied;
        }
        await recordTicketAction(options, action, signature, applied.issueKey);
        return applied;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await recordRefusal(options, signature, `Jira injoignable: ${reason}`, action.issueKey);
        return refused(action.issueKey, reason);
      }
    },
  };
}

/** Creates the ticket, and takes the key Jira gave back — or its refusal. */
async function applyCreate(action: TicketAction, target: ProjectTarget): Promise<Applied> {
  const decision = createDecision(target);
  if (!decision.ok) return { error: decision.reason };
  const reply = await readJira(await requestJira(assumeTrustedRoute('/rest/api/3/issue'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createIssueBody(action, decision.projectKey)),
  }));
  const error = refusalOf(reply);
  if (error) return { error };
  const key = jsonOf(reply).key;
  return typeof key === 'string'
    ? { issueKey: key }
    : { error: `Jira ${reply.status} n'a rendu aucune cle de ticket` };
}

/** `update`: refreshes the description of the problem on the existing ticket. */
async function applyUpdate(action: TicketAction, issueKey: string): Promise<Applied> {
  if (!action.description) return { issueKey };
  const error = await writeJira(`/rest/api/3/issue/${issueKey}`, 'PUT', updateIssueBody(action));
  return error ? refused(issueKey, error) : { issueKey };
}

/** `comment`: the daily synthesis, tagged with the signature it describes. */
async function applyComment(
  action: TicketAction,
  signature: Signature,
  issueKey: string,
): Promise<Applied> {
  if (!action.comment) return { issueKey };
  const error = await postComment(issueKey, `${action.comment}\n(${signature.id})`);
  return error ? refused(issueKey, error) : { issueKey };
}

/** `reopen`: the workflow transition, or a comment when the workflow has none. */
async function applyReopen(signature: Signature, issueKey: string): Promise<Applied> {
  const found = await findReopenTransition(issueKey);
  if (found.error) return refused(issueKey, found.error);
  if (!found.transitionId) {
    const error = await postComment(
      issueKey,
      `This problem came back (${signature.id}): the ticket should be reopened.`,
    );
    return error ? refused(issueKey, error) : { issueKey };
  }
  const error = await writeJira(`/rest/api/3/issue/${issueKey}/transitions`, 'POST', {
    transition: { id: found.transitionId },
  });
  return error ? refused(issueKey, error) : { issueKey };
}

/** `close-suggested`: a suggestion of closure, never an actual transition. */
async function applyCloseSuggested(signature: Signature, issueKey: string): Promise<Applied> {
  const error = await postComment(
    issueKey,
    `No occurrence for 14 days (${signature.id}): closure suggested.`,
  );
  return error ? refused(issueKey, error) : { issueKey };
}

/** Applies one ticket action; returns the key the Brain must remember. */
async function applyOne(
  action: TicketAction,
  signature: Signature,
  target: ProjectTarget,
): Promise<Applied> {
  if (action.kind === 'create') return applyCreate(action, target);
  const issueKey = action.issueKey;
  if (!issueKey) return {};
  switch (action.kind) {
    case 'update':
      return applyUpdate(action, issueKey);
    case 'comment':
      return applyComment(action, signature, issueKey);
    case 'reopen':
      return applyReopen(signature, issueKey);
    case 'close-suggested':
      return applyCloseSuggested(signature, issueKey);
    default:
      return { issueKey };
  }
}
