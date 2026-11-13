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
} from '@dejavu/core';
import { resolveProjectTarget } from './pure/projectTarget';
import { consumeIngest, type ConsumeResult, type ConsumerEngine, type LlmPort } from './pure/consume';
import { applyExcerptPolicy } from './pure/excerptApply';
import { validateIngestPayload } from './pure/validate';
import { loadExcerptPolicy, loadSettings } from './settings';
import { migrateOnce, type BrainSqlStore } from './sql';
import { jiraTicketApplier } from './ticketApplier';

// L'applicateur Jira vit dans son propre module (`./ticketApplier`) : il ne
// dépend que de `@forge/api` et des modules `pure/`, jamais de `./sql`. Le
// refus de créer un ticket se teste donc sans la plateforme — et ce module
// reste importable par le root workspace, qui n'installe pas `@forge/sql`.

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
  const [settings, excerptPolicy, llm] = await Promise.all([
    loadSettings(store),
    loadExcerptPolicy(store),
    createLlmPort(store),
  ]);
  // The queue consumer has no screen context: the effective target is the
  // register alone. An empty register means no ticket is created.
  const target = resolveProjectTarget({ chosen: settings.issueProjectKey });
  return consumeIngest(parsed.value, {
    store,
    engine: coreConsumerEngine(),
    tickets: jiraTicketApplier(target, { audit: store, now: () => now }),
    now: () => now,
    // The retention policy of the project (§ 18, CI-18): `hash-only` keeps no
    // text at all, `masked-snippet` a bounded masked excerpt, `full` the text.
    excerptPolicy,
    minimize: applyExcerptPolicy,
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
