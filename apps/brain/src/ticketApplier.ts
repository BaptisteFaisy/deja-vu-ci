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

/** Reads a Jira REST answer as JSON, tolerating empty bodies. */
async function jiraJson(response: { text(): Promise<string> }): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Finds the id of a "reopen"-like transition, when the workflow has one. */
async function findReopenTransition(issueKey: string): Promise<string | undefined> {
  const response = await requestJira(assumeTrustedRoute(`/rest/api/3/issue/${issueKey}/transitions`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const body = await jiraJson(response);
  const transitions = (body.transitions ?? []) as Array<{ id: string; name: string }>;
  return transitions.find((t) => /reopen/i.test(t.name))?.id;
}

/** Posts a plain comment (used as the fallback of every failed transition). */
async function postComment(issueKey: string, text: string): Promise<void> {
  await requestJira(assumeTrustedRoute(`/rest/api/3/issue/${issueKey}/comment`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commentBody(text)),
  });
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
 * One journal line for a ticket the app **refused** to create.
 *
 * The refusal is an action of the app like any other: the operator reads it in
 * the journal ("What the app did") instead of wondering why no ticket appeared.
 */
async function recordRefusal(
  options: TicketApplierOptions,
  signature: Signature,
  reason: string,
): Promise<void> {
  const at = options.now?.();
  await recordAudit(options.audit, {
    action: 'ticket-refused',
    signatureId: signature.id,
    detail: reason,
    ...(at ? { at } : {}),
  });
}

/**
 * The Jira side of the ticket plan (§ 11), as a real applier.
 *
 * The target project comes from `pure/projectTarget.ts` (the setting primes,
 * the screen answers, the background path refuses). Each applied action also
 * lands in the journal of what the app did; a journal failure never breaks the
 * action.
 */
export function jiraTicketApplier(target: ProjectTarget, options: TicketApplierOptions = {}) {
  return {
    async lastCommentAt(issueKey: string, signatureId: string): Promise<string | undefined> {
      const response = await requestJira(assumeTrustedRoute(`/rest/api/3/issue/${issueKey}/comment`), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const body = await jiraJson(response);
      const comments = ((body.comments ?? []) as Array<{ created?: string; body?: unknown }>);
      return findLastSynthesisAt(comments, signatureId);
    },

    async apply(action: TicketAction, signature: Signature): Promise<{ issueKey?: string; error?: string }> {
      try {
        const applied = await applyOne(action, signature, target);
        if (applied.error) {
          await recordRefusal(options, signature, applied.error);
          return applied;
        }
        await recordTicketAction(options, action, signature, applied.issueKey);
        return applied;
      } catch {
        return action.issueKey ? { issueKey: action.issueKey } : {};
      }
    },
  };
}

/** Applies one ticket action; returns the key the Brain must remember. */
async function applyOne(
  action: TicketAction,
  signature: Signature,
  target: ProjectTarget,
): Promise<{ issueKey?: string; error?: string }> {
  if (action.kind === 'create') {
    const decision = createDecision(target);
    if (!decision.ok) return { error: decision.reason };
    const response = await requestJira(assumeTrustedRoute('/rest/api/3/issue'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createIssueBody(action, decision.projectKey)),
    });
    const created = await jiraJson(response);
    return typeof created.key === 'string' ? { issueKey: created.key } : {};
  }

  const issueKey = action.issueKey;
  if (!issueKey) return {};

  if (action.kind === 'update' && action.description) {
    await requestJira(assumeTrustedRoute(`/rest/api/3/issue/${issueKey}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateIssueBody(action)),
    });
  }
  if (action.kind === 'comment' && action.comment) {
    await postComment(issueKey, `${action.comment}\n(${signature.id})`);
  }
  if (action.kind === 'reopen') {
    const transition = await findReopenTransition(issueKey);
    if (transition) {
      await requestJira(assumeTrustedRoute(`/rest/api/3/issue/${issueKey}/transitions`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: transition } }),
      });
    } else {
      await postComment(issueKey, `This problem came back (${signature.id}): the ticket should be reopened.`);
    }
  }
  if (action.kind === 'close-suggested') {
    await postComment(issueKey, `No occurrence for 14 days (${signature.id}): closure suggested.`);
  }
  return { issueKey };
}