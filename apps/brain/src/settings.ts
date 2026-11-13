/**
 * Settings of the Brain (§ 14, screen 5).
 *
 * Storage: the single `settings` row of Forge SQL for the thresholds the engine
 * owns, plus the app's own `app_policy` row for what the frozen `Settings` type
 * cannot carry — the retention policy of the raw excerpts (§ 18) and the date of
 * the last purge. Defaults come from the engine (`DEFAULT_SETTINGS` mirror).
 *
 * The resolvers behind the settings page live here too: they answer the
 * `invoke('settings')` / `invoke('save-settings')` calls of the UI Kit screen
 * (lot G). A patch is coerced by `pure/settingsSchema.ts` before it is merged —
 * a resolver never stores a half-validated row.
 */

import type { Settings } from '@dejavu/core';
import { migrateOnce, type BrainSqlStore } from './sql';
import { DEFAULT_SETTINGS } from './pure/defaults';
import { UNCHOSEN_PROJECT_KEY } from './pure/projectTarget';
import { DEFAULT_EXCERPT_POLICY, type MinimizePolicy } from './pure/excerptPolicy';
import {
  coerceSettingsPatch,
  excerptPolicyOf,
  toSettingsPayload,
  type SettingsPayload,
} from './pure/settingsSchema';

/** Answer of a resolver: never a thrown error. */
export type SettingsAnswer =
  | { ok: true; settings?: SettingsPayload }
  | { ok: false; error: string };

/** Reads the settings, falling back to the engine defaults. */
export async function loadSettings(store: BrainSqlStore): Promise<Settings> {
  try {
    const stored = await store.getSettings();
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS, issueProjectKey: UNCHOSEN_PROJECT_KEY };
  }
}

/**
 * The retention policy of the project (§ 18, CI-18).
 *
 * A project that never chose one keeps the behaviour the app always had: the
 * masked excerpt is stored in full. An unreadable row degrades to that default
 * rather than refusing an ingestion.
 */
export async function loadExcerptPolicy(store: BrainSqlStore): Promise<MinimizePolicy> {
  try {
    const policy = await store.getAppPolicy();
    return policy?.excerptPolicy ?? DEFAULT_EXCERPT_POLICY;
  } catch {
    return DEFAULT_EXCERPT_POLICY;
  }
}

/** Writes the retention policy, keeping the date of the last purge. */
export async function saveExcerptPolicy(
  store: BrainSqlStore,
  policy: MinimizePolicy | undefined,
): Promise<MinimizePolicy> {
  const current = await store.getAppPolicy();
  const next = policy ?? current?.excerptPolicy ?? DEFAULT_EXCERPT_POLICY;
  await store.saveAppPolicy(next, current?.lastPurgeAt);
  return next;
}

/** Merges a validated patch over the stored settings and saves the result. */
export async function saveSettings(
  store: BrainSqlStore,
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await loadSettings(store);
  const merged: Settings = { ...current, ...patch };
  await store.saveSettings(merged);
  return merged;
}

/** Resolver `settings`: the payload the page displays. */
export async function settingsData(store: BrainSqlStore): Promise<SettingsAnswer> {
  try {
    await migrateOnce();
    const [settings, policy] = await Promise.all([
      loadSettings(store),
      loadExcerptPolicy(store),
    ]);
    return { ok: true, settings: toSettingsPayload(settings, policy) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Resolver `save-settings`: coerce, merge, store. */
export async function saveSettingsData(
  store: BrainSqlStore,
  raw: unknown,
): Promise<SettingsAnswer> {
  try {
    await migrateOnce();
    const patch = coerceSettingsPatch(raw);
    if (!patch.ok) return { ok: false, error: patch.error };
    const policy = excerptPolicyOf(raw);
    if (!policy.ok) return { ok: false, error: policy.error };
    const merged = await saveSettings(store, patch.value);
    const stored = await saveExcerptPolicy(store, policy.value);
    return { ok: true, settings: toSettingsPayload(merged, stored) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
