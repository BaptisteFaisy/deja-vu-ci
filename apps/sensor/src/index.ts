/**
 * Forge entry point of the Sensor — the only file that wires Forge.
 *
 * `handler` is what `manifest.yml` points at (`function.handler:
 * index.handler`); it dispatches on the module that called it. Every
 * resolver answers `{ ok: false, error }` instead of raising: a Forge
 * function that throws is retried by the platform, and the build event is
 * lost anyway (E brief, "Constraints").
 *
 * Flow (§ 8.1, § 15): build-status event → failing step → log tail and test
 * reports → masked and bounded payload → ancestor verdict when the Brain
 * knows a fix → signed post to the Brain.
 */

import { storage } from '@forge/api';
import type { QueryRequest, QueryResponse } from '@dejavu/core';
import { isFailureState } from './pure/event.js';
import { coreMasker } from './masking.js';
import {
  askResolutionCommit,
  attachResolutionVerdict,
  collectAndBuildPayload,
  resolveEvent,
  type SensorDeps,
} from './buildPayload.js';
import { bitbucketReader } from './bitbucketApi.js';
import {
  isTracked,
  loadBridgeSecret,
  loadSettings,
  saveWorkspaceSettings,
  storeBridgeSecret,
} from './settings.js';
import { readSettings } from './pure/settings.js';
import { brainTransport } from './send.js';

/** Answer of a Forge function: never a thrown error. */
export type SensorAnswer = { ok: true; skipped?: string } | { ok: false; error: string };

/** The dependencies of the resolvers, replaceable for a local rehearsal. */
export const deps: SensorDeps = {
  read: bitbucketReader,
  storage,
  masker: coreMasker,
  transport: brainTransport,
};

function failure(error: unknown): SensorAnswer {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/** Reads the workspace of the invocation out of the Forge context. */
export function workspaceOf(context: unknown): string {
  const record = (context ?? {}) as Record<string, unknown>;
  return typeof record.workspace === 'string' ? record.workspace : '';
}

/**
 * Trigger `onBuildStatus`: only a failed build is forwarded (§ 15 step 1).
 *
 * Successes are not sent: the Brain notes "it passed at the same commit"
 * from its own history, and the Sensor keeps no data (§ 7).
 */
export async function onBuildStatus(payload: unknown, context?: unknown): Promise<SensorAnswer> {
  try {
    const event = resolveEvent(payload, workspaceOf(context));
    if (!event) return { ok: true, skipped: 'event without workspace, repository or commit' };
    if (!isFailureState(event.state)) return { ok: true, skipped: 'not a failed build' };

    const settings = await loadSettings(deps.storage, event.workspace);
    if (!settings.brainUrl || !settings.secretId) return { ok: true, skipped: 'workspace not paired' };
    if (!isTracked(settings, `${event.workspace}/${event.repository}`)) {
      return { ok: true, skipped: 'repository not watched' };
    }
    const secret = await loadBridgeSecret(deps.storage, settings.secretId);
    if (!secret) return { ok: false, error: 'the bridge secret is not readable' };

    const built = await collectAndBuildPayload(event, deps, settings.maxExcerptBytes);
    if (!built.payload) return { ok: true, skipped: built.reason ?? 'nothing to send' };

    // The Brain owns the memory, the Sensor owns Bitbucket: the ancestor
    // verdict of § 10.2 needs both. A missing answer is not an error.
    const fix = await askResolutionCommit(deps, settings.brainUrl, secret, event);
    const payloadToSend = fix
      ? await attachResolutionVerdict(deps, built.payload, fix)
      : built.payload;

    const answer = await deps.transport.post(settings.brainUrl, 'ingest', secret, payloadToSend);
    return answer.ok ? { ok: true } : { ok: false, error: answer.error };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Pull-request card `getPrCard`: asks the Brain for the diagnostic of the
 * branch (§ 14 screen 1) and returns it unchanged.
 */
export async function getPrCard(payload: unknown, context?: unknown): Promise<QueryResponse> {
  try {
    const event = resolveEvent(payload, workspaceOf(context));
    if (!event) return { ok: false, error: 'this card has no repository context' };
    const settings = await loadSettings(deps.storage, event.workspace);
    if (!settings.brainUrl || !settings.secretId) {
      return { ok: false, error: 'this workspace is not paired with a Brain yet' };
    }
    const secret = await loadBridgeSecret(deps.storage, settings.secretId);
    if (!secret) return { ok: false, error: 'the bridge secret is not readable' };

    const request: QueryRequest = {
      kind: 'pr-card',
      repository: `${event.workspace}/${event.repository}`,
      branch: event.branch ?? '',
      commit: event.commit,
    };
    const answer = await deps.transport.post(settings.brainUrl, 'query', secret, request);
    if (!answer.ok || !answer.body) {
      return { ok: false, error: answer.ok ? 'the Brain sent an empty answer' : answer.error };
    }
    return answer.body as QueryResponse;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** What the settings page shows (§ 14 screen 2). */
export interface SettingsView {
  ok: boolean;
  paired: boolean;
  brainUrl?: string;
  trackedRepositories: string[];
  maxExcerptBytes: number;
  error?: string;
}

/** Settings page `getSettings`: the secret identifier is never returned. */
export async function getSettings(_payload: unknown, context?: unknown): Promise<SettingsView> {
  try {
    const settings = await loadSettings(deps.storage, workspaceOf(context));
    return {
      ok: true,
      paired: Boolean(settings.brainUrl && settings.secretId),
      ...(settings.brainUrl ? { brainUrl: settings.brainUrl } : {}),
      trackedRepositories: settings.trackedRepositories,
      maxExcerptBytes: settings.maxExcerptBytes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, paired: false, trackedRepositories: [], maxExcerptBytes: 51200, error: message };
  }
}

/** The form posted by the settings page. */
export interface SettingsForm {
  brainUrl?: string;
  /** The shared secret, given once at pairing time. Never stored in clear. */
  secret?: string;
  trackedRepositories?: string[];
  maxExcerptBytes?: number;
  pairedBy?: string;
}

/**
 * Settings page `saveSettings`: pairing and preferences.
 *
 * The shared secret goes to the Forge secret storage; the application
 * storage keeps only its identifier (§ 16, `pairing.secretId`).
 */
export async function saveSettings(payload: unknown, context?: unknown): Promise<SensorAnswer> {
  try {
    const workspace = workspaceOf(context);
    const form = (payload ?? {}) as SettingsForm;
    const current = await loadSettings(deps.storage, workspace);
    const next = readSettings({
      ...current,
      ...(form.brainUrl !== undefined ? { brainUrl: form.brainUrl } : {}),
      ...(form.trackedRepositories ? { trackedRepositories: form.trackedRepositories } : {}),
      ...(form.maxExcerptBytes !== undefined ? { maxExcerptBytes: form.maxExcerptBytes } : {}),
      ...(form.pairedBy ? { pairedBy: form.pairedBy } : {}),
    });
    if (form.secret) {
      next.secretId = await storeBridgeSecret(deps.storage, form.secret);
      next.pairedAt = new Date().toISOString();
    }
    await saveWorkspaceSettings(deps.storage, workspace, next);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** The functions the manifest references, by key. */
const functions: Record<string, (payload: unknown, context?: unknown) => Promise<unknown>> = {
  onBuildStatus,
  getPrCard,
  getSettings,
  saveSettings,
};

/**
 * The single entry point of the app: `index.handler`.
 *
 * Forge calls it with the key of the module function; an unknown key is
 * answered, never thrown.
 */
export async function handler(
  payload: { call?: { functionKey?: string }; context?: unknown },
  context?: unknown,
): Promise<unknown> {
  const key = payload?.call?.functionKey ?? '';
  const invocation = functions[key];
  if (!invocation) return { ok: false, error: `unknown function ${key || '(none)'}` };
  return invocation(payload, context ?? payload?.context);
}

export default handler;
