/**
 * Forge entry point of the Brain — the only file that wires everything.
 *
 * The manifest points every module at an export of this file:
 *  - web triggers: `ingest`, `query`, `universal`,
 *  - the queue `consumer` and the daily `scheduled` run,
 *  - the UI Kit 2 screens: they are rendered by `src/frontend.tsx`
 *    (`resources: main`) and read their data through `uiResolverHandler`,
 *    which dispatches the `invoke()` names (`memory-page`, `issue-context`,
 *    `settings`, `save-settings`, `replay-sample`, `curate-merge`,
 *    `curate-split`, `quarantine-proposal`) to the resolvers below,
 *  - `issueContextText`, the text a Rovo agent reads on a ticket,
 *  - the six actions of § 13 (lot G) plus `propose-quarantine` (CI-19), also
 *    exposed to Rovo and MCP.
 *
 * Wiring: one Forge SQL store (memory), one engine assembled from the real
 * `@dejavu/core` functions, registered as the default engine of lot G's
 * action descriptors. Handlers answer `{ ok: false, error }` instead of
 * throwing; data resolvers degrade to empty payloads so a screen always
 * renders.
 */

import {
  assessFlakiness,
  computeCost,
  diagnose,
  extractErrorBlocks,
  signatureKeys,
  signatureShort,
} from '@dejavu/core';
import * as brainActions from './actions/index';
import { createBrainEngine, setDefaultEngine, type CoreFunctions } from './actions/engine';
import {
  proposeQuarantine as proposeQuarantineAction,
  proposeQuarantineData,
} from './actions/propose-quarantine';
import { isSplitCriterionKey, type SplitCriterionKey } from './pure/curation';
import { assembleMergePreview, assembleSplitPreview } from './pure/curationCompute';
import { ingest } from './ingest';
import { createQueryHandler, issueContextData, memoryPageData } from './query';
import { createUniversalHandler } from './universal';
import { createConsumerHandler } from './consumer';
import { jiraTicketApplier } from './ticketApplier';
import { createScheduledHandler } from './scheduled';
import { settingsData, saveSettingsData, loadSettings } from './settings';
import { auditLogData, memoryExportData, memoryHealthData } from './memoryViews';
import { recordAudit } from './pure/auditLog';
import { replayEngine, replaySample as runReplaySample, type ReplayOutcome } from './seed';
import { toSettingsPayload } from './pure/settingsSchema';
import { DEFAULT_SETTINGS } from './pure/defaults';
import { brainStore, migrateOnce } from './sql';
import Resolver from '@forge/resolver';
import { registerUiResolvers } from './resolvers';
import { issueKeyFrom, projectKeyFrom } from './pure/invokeContext';
import { resolveProjectTarget } from './pure/projectTarget';
import {
  issueContextText as renderIssueContextText,
  type IssueContextInput,
} from './pure/issueContextText';
import type { IssueContextPayload, MemoryPagePayload } from './query';

export { ingest };

/** The engine functions lot G's `createBrainEngine` expects. */
const coreFunctions: CoreFunctions = {
  diagnose,
  extractErrorBlocks,
  signatureKeys,
  signatureShort,
  assessFlakiness,
  computeCost,
};

/** One memory, one engine, shared by every resolver of the app. */
const store = brainStore();
const engine = createBrainEngine(coreFunctions, store);
setDefaultEngine(engine);

/** Web trigger `/query` and the two other background handlers. */
export const query = createQueryHandler(store, engine);
export const universal = createUniversalHandler(store);
export const consumer = createConsumerHandler(store);
export const scheduled = createScheduledHandler(store);

// ---------------------------------------------------------------------------
// The six actions of § 13 (lot G) plus `propose-quarantine` (CI-19) — Forge
// resolvers around the descriptors. The descriptors receive the shared engine
// and never throw.
// ---------------------------------------------------------------------------

export const explainBuildFailure = (payload: unknown): Promise<unknown> =>
  brainActions['explain-build-failure'](engine, (payload ?? {}) as Record<string, unknown>);
export const searchFailures = (payload: unknown): Promise<unknown> =>
  brainActions['search-failures'](engine, (payload ?? {}) as Record<string, unknown>);
export const getSignature = (payload: unknown): Promise<unknown> =>
  brainActions['get-signature'](engine, (payload ?? {}) as Record<string, unknown>);
export const listFlakyTests = (payload: unknown): Promise<unknown> =>
  brainActions['list-flaky-tests'](engine, (payload ?? {}) as Record<string, unknown>);
export const reportResolution = (payload: unknown): Promise<unknown> =>
  brainActions['report-resolution'](engine, (payload ?? {}) as Record<string, unknown>);
export const confirmResolution = (payload: unknown): Promise<unknown> =>
  brainActions['confirm-resolution'](engine, (payload ?? {}) as Record<string, unknown>);
/**
 * Seventh action (CI-19, § 25): drafts the quarantine of an unstable test.
 * Exposed to Rovo and MCP through the manifest `actionProposeQuarantine`
 * handler; the UI resolver `quarantine-proposal` reads the same assembly.
 */
export const proposeQuarantine = (payload: unknown): Promise<unknown> =>
  proposeQuarantineAction(engine, (payload ?? {}) as Record<string, unknown>);

// ---------------------------------------------------------------------------
// Data resolvers of the UI Kit screens (called through `invoke`, lot G).
// A failure degrades to an empty payload: the screen renders its error or
// empty state instead of breaking.
// ---------------------------------------------------------------------------

/** Resolver `memory-page` (project page, § 14 screen 3). */
export async function memoryPage(): Promise<MemoryPagePayload> {
  const result = await memoryPageData(store, engine);
  return result.ok ? result.data : { signatures: [] };
}

/**
 * Reads the issue key out of the invoke payload or the Forge context.
 *
 * The lookup covers every shape the platform uses (`src/pure/invokeContext.ts`):
 * a bare payload, a UI Kit 2 `invoke()` envelope, and the product context of
 * an issue panel — so the panel and the Rovo text read the same issue.
 */
export function issueKeyOf(payload: unknown, context: unknown): string {
  return issueKeyFrom({ payload, context });
}

/** Resolver `issue-context` (issue panel, § 14 screen 4). */
export async function issueData(payload?: unknown, context?: unknown): Promise<IssueContextPayload> {
  const issueKey = issueKeyOf(payload, context);
  if (!issueKey) return { problem: false };
  const result = await issueContextData(store, engine, issueKey);
  return result.ok ? result.data : { problem: false };
}

/** Resolver `settings` (settings page, § 14 screen 5). */
export async function settings(): Promise<ReturnType<typeof toSettingsPayload>> {
  const result = await settingsData(store);
  return result.ok && result.settings ? result.settings : toSettingsPayload(DEFAULT_SETTINGS);
}

/** Resolver `save-settings` (settings page). */
export async function saveSettings(payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const result = await saveSettingsData(store, payload);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Resolver `replay-sample` and manifest function `replaySample` (§ 22, CI-11).
 *
 * Fills the memory with the sample set — 40 failures over 14 days — through
 * the real engine and the real Forge SQL store, then creates the tickets the
 * replay planned on the real Jira. The project the tickets go to is resolved
 * once, here: the operator's explicit choice primes; without one, the project
 * the operator is looking at (`context.extension.project.key`) is used; with
 * neither — a call with no project context — no ticket is created and the
 * summary says why. Idempotent: on a memory that already holds signatures
 * nothing is injected (`src/seed.ts`). Never throws: a failure comes back as
 * `{ ok: false, error }` and the screen displays it.
 */
export async function replaySample(payload?: unknown, context?: unknown): Promise<ReplayOutcome> {
  try {
    await migrateOnce();
    const settings = await loadSettings(store);
    const target = resolveProjectTarget({
      chosen: settings.issueProjectKey,
      screenProjectKey: projectKeyFrom({ payload, context }),
    });
    return await runReplaySample({
      store,
      tickets: jiraTicketApplier(target, { audit: store }),
      engine: replayEngine(),
      projectKey: target.projectKey,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// UI Kit 2 wiring (§ 14, CI-08). The three Jira modules point at one resource
// (`src/frontend.tsx`, `resources: main`) and at one resolver function: the
// `invoke()` names of the screens are dispatched by `registerUiResolvers`,
// which is where the platform routes every call of a UI module.
// ---------------------------------------------------------------------------

/**
 * Resolver `curate-merge` (project page curation, CI-17): previews the merge of
 * two signatures **without** writing to the memory. The screen shows what is
 * kept (strongest status, single ticket, oldest `firstSeen`) before the operator
 * confirms; the copy in `src/pure/curation.ts` keeps the store untouched.
 */
export async function curateMerge(payload?: unknown): Promise<unknown> {
  const body = (payload ?? {}) as { keepId?: unknown; dropId?: unknown };
  const keepId = typeof body.keepId === 'string' ? body.keepId.trim() : '';
  const dropId = typeof body.dropId === 'string' ? body.dropId.trim() : '';
  const answer = await assembleMergePreview(store, keepId, dropId);
  if (answer.ok) {
    await recordAudit(store, {
      action: 'signature-merged',
      signatureId: keepId,
      detail: `absorbed ${dropId}, ${answer.data.movedOccurrences} occurrence(s) — preview`,
    });
  }
  return answer;
}

/**
 * Resolver `curate-split` (project page curation, CI-17): previews how one
 * signature splits by the chosen criterion, without writing to the memory.
 */
export async function curateSplit(payload?: unknown): Promise<unknown> {
  const body = (payload ?? {}) as { signatureId?: unknown; criterion?: unknown };
  const signatureId = typeof body.signatureId === 'string' ? body.signatureId.trim() : '';
  const criterion: SplitCriterionKey = isSplitCriterionKey(body.criterion)
    ? body.criterion
    : 'test-name';
  const answer = await assembleSplitPreview(store, signatureId, criterion);
  if (answer.ok) {
    await recordAudit(store, {
      action: 'signature-split',
      signatureId,
      detail: `by ${criterion}, ${answer.data.groups.length} group(s) — preview`,
    });
  }
  return answer;
}

/**
 * Resolver `quarantine-proposal` (project page, CI-19): the quarantine draft of
 * a signature, or the reasons `assessFlakiness` did not call it unstable. Reads
 * the same assembly as the `propose-quarantine` action (single truth).
 */
export async function quarantineProposal(payload?: unknown): Promise<unknown> {
  const body = (payload ?? {}) as { signatureId?: unknown };
  const signatureId = typeof body.signatureId === 'string' ? body.signatureId.trim() : '';
  if (!signatureId) return { ok: false, error: 'signatureId is required' };
  return proposeQuarantineData(engine, signatureId);
}

/**
 * Resolver `audit-log` (project page, "What the app did" tab): the journal of
 * the actions the app took — tickets created, comments posted, reopens,
 * quarantine proposals, curation decisions — newest first.
 */
export async function auditLog(): Promise<unknown> {
  const result = await auditLogData(store);
  return result.ok ? { ok: true, entries: result.data } : result;
}

/**
 * Resolver `memory-export` (project page, "Export" panel): the signatures,
 * their occurrences and their resolutions as one CSV or JSON document, built
 * here rather than in the browser, with a timestamped file name.
 */
export async function memoryExport(payload?: unknown): Promise<unknown> {
  const body = (payload ?? {}) as { format?: unknown };
  const result = await memoryExportData(store, body.format, new Date());
  return result.ok ? { ok: true, ...result.data } : result;
}

/**
 * Resolver `memory-health` (project page, small panel): how full the memory is
 * against the platform's 1 GiB, how old its oldest failure is, and when the app
 * last purged the raw excerpts it no longer needed.
 */
export async function memoryHealth(): Promise<unknown> {
  const result = await memoryHealthData(store, new Date());
  return result.ok ? { ok: true, health: result.data } : result;
}

/** The resolver the UI modules of the manifest point at. */
const uiResolver = new Resolver();
registerUiResolvers(uiResolver, {
  memoryPage,
  issuePanel: issueData,
  settings,
  saveSettings,
  replaySample,
  curateMerge,
  curateSplit,
  quarantineProposal,
  auditLog,
  memoryExport,
  memoryHealth,
});

/** Handler of `projectPageResolver`, `settingsPageResolver`, `issuePanelResolver`. */
export const uiResolverHandler = uiResolver.getDefinitions();

/**
 * Data of the issue panel (`jira:issuePanel`, § 14 screen 4).
 *
 * The panel and the Rovo text read the same memory through the same call:
 * one diagnostic, one place where it is computed.
 */
export const issuePanel = issueData;

/**
 * Text context of a ticket for Rovo (`jira:issueContext`, function variant):
 * the current diagnostic, the ticket of the problem and what it already cost.
 *
 * The paragraph is built in `src/pure/issueContextText.ts` (tested); this
 * function only feeds it with the data the panel already uses.
 */
export async function issueContextText(payload?: unknown, context?: unknown): Promise<string> {
  const data = (await issueData(payload, context)) as IssueContextInput;
  return renderIssueContextText(data);
}
