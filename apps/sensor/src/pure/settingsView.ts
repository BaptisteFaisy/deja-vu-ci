/**
 * The settings page of a Bitbucket workspace (§ 14, screen 2) — pure types
 * and pure form helpers, no Forge import.
 *
 * These types used to live in `src/index.ts`, which imports `@forge/api`:
 * the UI bundle would then drag the server code with it. They live here, and
 * `src/index.ts` re-exports them so nothing else changes.
 *
 * Security: the shared secret is **write-only**. The view answers `paired`
 * (a boolean) and never the secret nor its identifier (§ 16).
 */

import { MAX_EXCERPT_BYTES, MIN_EXCERPT_BYTES } from './settings';

/** What the settings page shows. */
export interface SettingsView {
  ok: boolean;
  /** True when the workspace knows a Brain URL and a stored secret. */
  paired: boolean;
  brainUrl?: string;
  trackedRepositories: string[];
  maxExcerptBytes: number;
  error?: string;
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

/** An empty page, before anything is loaded. */
export function emptySettingsView(): SettingsView {
  return { ok: false, paired: false, trackedRepositories: [], maxExcerptBytes: MAX_EXCERPT_BYTES };
}

/**
 * The watched repositories as the textarea shows them: one slug per line.
 *
 * Blank lines, surrounding spaces and duplicates are dropped — a paste from a
 * README must not create three watch entries for one repository.
 */
export function parseRepositoryList(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const slug = line.trim();
    if (slug) seen.add(slug);
  }
  return [...seen];
}

/** The inverse of `parseRepositoryList`: what the textarea displays. */
export function formatRepositoryList(repositories: string[] | undefined): string {
  return (repositories ?? []).join('\n');
}

/** Keeps the excerpt size inside the bounds the Sensor enforces (§ 19). */
export function clampExcerptBytes(value: number): number {
  if (!Number.isFinite(value)) return MAX_EXCERPT_BYTES;
  return Math.min(MAX_EXCERPT_BYTES, Math.max(MIN_EXCERPT_BYTES, Math.trunc(value)));
}

/** A secret is accepted from 16 characters, like the pairing of § 15. */
export const MIN_SECRET_LENGTH = 16;

/**
 * Checks the form before it is posted.
 *
 * The Brain URL is required to pair; the secret is required only when the
 * workspace is not paired yet — afterwards the page saves preferences and
 * leaves the stored secret alone. An empty answer means "send it".
 */
export function validateSettingsForm(form: SettingsForm, paired: boolean): string {
  const url = (form.brainUrl ?? '').trim();
  if (!url) return 'brainUrlRequired';
  if (!/^https?:\/\/\S+$/.test(url)) return 'brainUrlInvalid';
  if (!paired && (form.secret ?? '').length < MIN_SECRET_LENGTH) return 'secretTooShort';
  return '';
}

/** The page's own state: everything is text until it is posted. */
export interface SettingsFormState {
  brainUrl: string;
  secret: string;
  repositories: string;
  maxExcerptBytes: string;
}

/** The form before the resolver answers. */
export const EMPTY_SETTINGS_FORM: SettingsFormState = {
  brainUrl: '',
  secret: '',
  repositories: '',
  maxExcerptBytes: '',
};

/**
 * Builds the form state out of what the resolver answered.
 *
 * The secret is never prefilled: it is not readable, not even by its owner —
 * an empty field means "leave the stored one alone" (§ 16).
 */
export function formOf(view: SettingsView): SettingsFormState {
  return {
    brainUrl: view.brainUrl ?? '',
    secret: '',
    repositories: formatRepositoryList(view.trackedRepositories),
    maxExcerptBytes: String(view.maxExcerptBytes),
  };
}

/**
 * The payload posted to `saveSettings`, built from the form state.
 *
 * An empty secret is dropped: it means "leave the stored one alone", and the
 * value never round-trips through the page.
 */
export function payloadOf(form: SettingsFormState): SettingsForm {
  const payload: SettingsForm = {
    brainUrl: form.brainUrl.trim(),
    trackedRepositories: parseRepositoryList(form.repositories),
    maxExcerptBytes: clampExcerptBytes(Number(form.maxExcerptBytes)),
  };
  if (form.secret) payload.secret = form.secret;
  return payload;
}

/**
 * The optimistic view after a successful save.
 *
 * The secret never enters the view — it stays write-only, even here: the
 * pairing flips to `paired` when a secret was just posted (§ 16).
 */
export function viewAfterSave(view: SettingsView, payload: SettingsForm): SettingsView {
  return {
    ok: true,
    paired: view.paired || Boolean(payload.secret),
    ...(payload.brainUrl !== undefined ? { brainUrl: payload.brainUrl } : {}),
    trackedRepositories: payload.trackedRepositories ?? view.trackedRepositories,
    maxExcerptBytes: payload.maxExcerptBytes ?? view.maxExcerptBytes,
  };
}
