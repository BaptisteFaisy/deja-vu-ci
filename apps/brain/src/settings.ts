/**
 * Settings of the Brain (§ 14, screen 5).
 *
 * Storage: the single `settings` row of Forge SQL, through the store of
 * `src/sql.ts`. Defaults come from the engine (`DEFAULT_SETTINGS` mirror).
 * The resolvers behind the settings page live here too: they answer the
 * `invoke('settings')` / `invoke('save-settings')` calls of the UI Kit
 * screen (lot G). A patch is coerced by `pure/settingsSchema.ts` before it
 * is merged — a resolver never stores a half-validated row.
 */

import type { Settings } from '@dejavu/core';
import type { BrainSqlStore } from './sql';
import { DEFAULT_SETTINGS } from './pure/defaults';
import { coerceSettingsPatch, toSettingsPayload, type SettingsPayload } from './pure/settingsSchema';

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
    return { ...DEFAULT_SETTINGS };
  }
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
    return { ok: true, settings: toSettingsPayload(await loadSettings(store)) };
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
    const patch = coerceSettingsPatch(raw);
    if (!patch.ok) return { ok: false, error: patch.error };
    const merged = await saveSettings(store, patch.value);
    return { ok: true, settings: toSettingsPayload(merged) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
