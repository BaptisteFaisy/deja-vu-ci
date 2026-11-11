/**
 * Consumer — the heart of the Brain (§ 8.1 steps 4–5, § 15 step 5).
 *
 * One queued message is one `IngestPayload`. The whole pipeline (extract →
 * sign → store → diagnose → plan tickets → apply on Jira) is the pure core
 * `pure/consume.ts`, fed here with the real ports: the Forge SQL store, the
 * engine functions of `@dejavu/core`, and the Jira REST applier below.
 *
 * Platform frame: 900 s per invocation — the platform redelivers a message
 * whose processing failed, and the core is idempotent, so a redelivery after
 * a partial failure never duplicates anything.
 */

import { assumeTrustedRoute, requestJira } from '@forge/api';
import type { AsyncEvent } from '@forge/events';
import type { ChatResponse, Prompt } from '@forge/llm';
import {
  assessFlakiness,
  detectOutbreak,
  detectRegression,
  diagnose,
  extractErrorBlocks,
  llmNormalize,
  normalizedHash,
  planTicketActions,
  signatureKeys,
  TemplateCache,
  testStats,
  type ErrorBlock,
  type Settings,
  type Signature,
  type TicketAction,
} from '@dejavu/core';
import { consumeIngest, type ConsumeResult, type ConsumerEngine, type LlmPort } from './pure/consume';
import { commentBody, createIssueBody, findLastSynthesisAt, updateIssueBody } from './pure/jira';
import { validateIngestPayload } from './pure/validate';
import { loadSettings } from './settings';
import { migrateOnce, type BrainSqlStore } from './sql';

/** The engine port, wired to the real `@dejavu/core` functions. */
export function coreConsumerEngine(): ConsumerEngine {
  return {
    extractErrorBlocks,
    signatureKeys,
    diagnose,
    assessFlakiness,
    planTicketActions,
    detectOutbreak,
    testStats,
    detectRegression,
  };
}

// ---------------------------------------------------------------------------
// LLM fallback (§ 9.5) — the model only ever sees an already-masked block,
// only when no pattern recognised it, and never twice for the same error:
// the engine cache is hydrated from, and persisted to, `llm_template_cache`.
// ---------------------------------------------------------------------------

/** Specifier kept in a constant: the bundler must not resolve it eagerly. */
const LLM_PACKAGE = '@forge/llm';

/** Model family declared in the `llm` module of the manifest. */
const LLM_MODEL = 'claude';

/** The real SDK entry point: `chat(prompt)` answers one assistant message. */
type ChatFn = (prompt: Prompt) => Promise<ChatResponse>;

type Completion = (prompt: string) => Promise<string>;

let completion: Completion | undefined;
let llmProbed = false;
let templates: TemplateCache | undefined;

/** Extracts the assistant text of a chat response (plain string or parts). */
export function chatText(response: ChatResponse): string {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  }
  return '';
}

/** Probes the platform model; unavailable means deterministic path only. */
async function probeLlm(): Promise<Completion | undefined> {
  if (llmProbed) return completion;
  llmProbed = true;
  try {
    const mod = (await import(LLM_PACKAGE)) as { chat?: ChatFn };
    const chat = mod.chat;
    if (typeof chat === 'function') {
      completion = async (prompt) =>
        chatText(await chat({ model: LLM_MODEL, messages: [{ role: 'user', content: prompt }] }));
    }
  } catch {
    completion = undefined;
  }
  return completion;
}

/** Builds the LLM port, or undefined when the platform model is absent. */
export async function createLlmPort(store: BrainSqlStore): Promise<LlmPort | undefined> {
  const complete = await probeLlm();
  if (!complete) return undefined;
  if (!templates) {
    templates = new TemplateCache();
    for (const entry of await store.listTemplateCache()) {
      templates.set(entry.normalizedHash, { template: entry.template, category: entry.category });
    }
  }
  const cache = templates;
  return {
    async normalize(block: ErrorBlock) {
      const hash = normalizedHash(block);
      const wasCached = cache.get(hash) !== undefined;
      const result = await llmNormalize(block, { complete }, cache);
      if (!wasCached) {
        await store.saveTemplateCacheEntry({
          normalizedHash: hash,
          template: result.template,
          category: result.category,
        });
      }
      return result;
    },
  };
}

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

/**
 * The Jira side of the ticket plan (§ 11). Every action is best-effort:
 * a refused transition degrades to a comment, and a failure never aborts
 * the whole message — the memory (SQL) stays the source of truth.
 */
export function jiraTicketApplier(settings: Settings) {
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

    async apply(action: TicketAction, signature: Signature): Promise<{ issueKey?: string }> {
      try {
        return await applyOne(action, signature, settings);
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
  settings: Settings,
): Promise<{ issueKey?: string }> {
  if (action.kind === 'create') {
    const response = await requestJira(assumeTrustedRoute('/rest/api/3/issue'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createIssueBody(action, settings.issueProjectKey)),
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

/** One queued message → one consumption result. */
export async function consumeMessage(
  store: BrainSqlStore,
  body: unknown,
  now: Date,
): Promise<ConsumeResult> {
  // The real queue carries object bodies (`Record<string, unknown>`); a JSON
  // string is still accepted so an older in-flight message stays consumable.
  const parsed = validateIngestPayload(typeof body === 'string' ? JSON.parse(body) : body);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const settings = await loadSettings(store);
  const llm = await createLlmPort(store);
  return consumeIngest(parsed.value, {
    store,
    engine: coreConsumerEngine(),
    tickets: jiraTicketApplier(settings),
    now: () => now,
    ...(llm ? { llm } : {}),
  });
}

/** Handler factory of the Forge consumer (batch of queued messages). */
export function createConsumerHandler(store: BrainSqlStore) {
  return async function consumer(
    messages: AsyncEvent[],
  ): Promise<Array<{ success: boolean; details?: { message: string } }>> {
    await migrateOnce();
    const results: Array<{ success: boolean; details?: { message: string } }> = [];
    for (const message of messages) {
      try {
        const result = await consumeMessage(store, message.body, new Date());
        results.push(
          result.ok
            ? { success: true }
            : { success: false, details: { message: result.error } },
        );
      } catch (error) {
        results.push({
          success: false,
          details: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    return results;
  };
}
