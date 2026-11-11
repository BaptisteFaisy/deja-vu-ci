/**
 * Forge entry point of the Brain — the only file that wires everything.
 *
 * The manifest points every module at an export of this file:
 *  - web triggers: `ingest`, `query`, `universal`,
 *  - the queue `consumer` and the daily `scheduled` run,
 *  - the UI Kit screens of lot G (`projectPage`, `issueContext`,
 *    `settingsPage`) and their data resolvers (`memoryPage`, `issueData`,
 *    `settingsData`, `saveSettingsData`),
 *  - the six actions of § 13 (lot G), also exposed to Rovo and MCP.
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
import * as brainActions from './actions/index.js';
import { createBrainEngine, setDefaultEngine, type CoreFunctions } from './actions/engine.js';
import { ingest } from './ingest.js';
import { createQueryHandler, issueContextData, memoryPageData } from './query.js';
import { createUniversalHandler } from './universal.js';
import { createConsumerHandler } from './consumer.js';
import { createScheduledHandler } from './scheduled.js';
import { settingsData, saveSettingsData } from './settings.js';
import { toSettingsPayload } from './pure/settingsSchema.js';
import { DEFAULT_SETTINGS } from './pure/defaults.js';
import { brainStore } from './sql.js';
import type { IssueContextPayload, MemoryPagePayload } from './query.js';

// Re-export the screens of lot G: a UI module resolver is its component.
export { default as projectPage } from './ui/projectPage.js';
export { default as issueContext } from './ui/issueContext.js';
export { default as settingsPage } from './ui/settingsPage.js';
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
// The six actions of § 13 (lot G) — Forge resolvers around the descriptors.
// The descriptors read the default engine and never throw.
// ---------------------------------------------------------------------------

export const explainBuildFailure = (payload: unknown): Promise<unknown> =>
  brainActions['explain-build-failure'](payload);
export const searchFailures = (payload: unknown): Promise<unknown> =>
  brainActions['search-failures'](payload);
export const getSignature = (payload: unknown): Promise<unknown> =>
  brainActions['get-signature'](payload);
export const listFlakyTests = (payload: unknown): Promise<unknown> =>
  brainActions['list-flaky-tests'](payload);
export const reportResolution = (payload: unknown): Promise<unknown> =>
  brainActions['report-resolution'](payload);
export const confirmResolution = (payload: unknown): Promise<unknown> =>
  brainActions['confirm-resolution'](payload);

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

/** Reads the issue key out of the invoke payload or the Forge context. */
export function issueKeyOf(payload: unknown, context: unknown): string {
  for (const source of [payload, context]) {
    const record = (source ?? {}) as Record<string, unknown>;
    if (typeof record.issueKey === 'string') return record.issueKey;
    const issue = record.issue as Record<string, unknown> | undefined;
    if (issue && typeof issue.key === 'string') return issue.key;
  }
  return '';
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
