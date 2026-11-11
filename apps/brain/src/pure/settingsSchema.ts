/**
 * Validation of the settings the screens write (§ 14, screen 5).
 *
 * The settings page sends a flat object; this module coerces it into a
 * `Partial<Settings>` the store can merge over `DEFAULT_SETTINGS`. Unknown
 * keys are dropped, wrong types are refused with an explicit error — a
 * resolver never stores a half-validated row.
 *
 * Pure module: type-only imports from `@dejavu/core`.
 */

import type { Settings } from '@dejavu/core';
import type { Validation } from './validate';

/** Numeric settings and their bounds (positive, sane upper limits). */
const NUMBER_FIELDS: Array<{ key: keyof Settings; min: number; max: number }> = [
  { key: 'flakyMinOccurrences', min: 1, max: 1000 },
  { key: 'flakyMinBranches', min: 1, max: 1000 },
  { key: 'flakyWindowDays', min: 1, max: 365 },
  { key: 'outbreakRepos', min: 2, max: 1000 },
  { key: 'outbreakWindowMin', min: 1, max: 1440 },
  { key: 'rawRetentionDays', min: 1, max: 365 },
];

/** Coerces the raw payload of `save-settings` into a settings patch. */
export function coerceSettingsPatch(raw: unknown): Validation<Partial<Settings>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'settings must be an object' };
  }
  const record = raw as Record<string, unknown>;
  const patch: Partial<Settings> = {};

  if (record.issueProjectKey !== undefined) {
    const value = record.issueProjectKey;
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, error: 'issueProjectKey must be a non-empty string' };
    }
    patch.issueProjectKey = value.trim().toUpperCase();
  }
  if (record.universalKey !== undefined && record.universalKey !== null) {
    const value = record.universalKey;
    if (typeof value !== 'string' || value.length < 8) {
      return { ok: false, error: 'universalKey must be a string of at least 8 characters' };
    }
    patch.universalKey = value;
  }
  for (const field of NUMBER_FIELDS) {
    const value = record[field.key];
    if (value === undefined || value === null) continue;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
      return { ok: false, error: `${field.key} must be a number` };
    }
    const rounded = Math.round(parsed);
    if (rounded < field.min || rounded > field.max) {
      return { ok: false, error: `${field.key} must be between ${field.min} and ${field.max}` };
    }
    (patch as Record<string, unknown>)[field.key] = rounded;
  }
  return { ok: true, value: patch };
}

/** The subset of the settings the settings page displays. */
export interface SettingsPayload {
  issueProjectKey: string;
  flakyMinOccurrences: number;
  flakyMinBranches: number;
  flakyWindowDays: number;
  rawRetentionDays: number;
  universalKey?: string;
}

/** Projects the stored settings onto the page payload (no secret leaked). */
export function toSettingsPayload(settings: Settings): SettingsPayload {
  return {
    issueProjectKey: settings.issueProjectKey,
    flakyMinOccurrences: settings.flakyMinOccurrences,
    flakyMinBranches: settings.flakyMinBranches,
    flakyWindowDays: settings.flakyWindowDays,
    rawRetentionDays: settings.rawRetentionDays,
    ...(settings.universalKey ? { universalKey: settings.universalKey } : {}),
  };
}
