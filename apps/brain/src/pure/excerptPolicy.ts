/**
 * The per-project retention policy of the raw excerpts (§ 18, CI-18).
 *
 * The engine owns this policy (`packages/core/src/minimize.ts`), but its barrel
 * does not re-export it and this lot may not change the engine, so the app
 * applies the policy itself — with the engine's own masker (`maskSecrets`, which
 * *is* exported) doing the masking. `applyExcerptPolicy` mirrors the engine's
 * `minimizeExcerpt` rule for rule, and `apps/brain/test/minimization.test.ts`
 * asserts the two agree on every policy and every input, so this copy can never
 * drift silently. Wiring the engine function directly is a one-line follow-up
 * for whoever owns the core barrel.
 *
 * The default is `full`, which is today's behaviour: the excerpt stored is the
 * masked text the extraction pipeline produced. An operator who wants the memory
 * to hold less picks `masked-snippet` (a bounded, masked excerpt) or `hash-only`
 * (no text at all — the fingerprint still correlates the failures).
 *
 * Pure module: no `@forge/*` import, no network.
 */

import { createHash } from 'node:crypto';
import { maskSecrets } from '@dejavu/core';

/** The three retention policies, from the most to the least minimizing. */
export const MINIMIZE_POLICIES = ['hash-only', 'masked-snippet', 'full'] as const;
export type MinimizePolicy = (typeof MINIMIZE_POLICIES)[number];

/** The policy of a project that never chose one: today's behaviour. */
export const DEFAULT_EXCERPT_POLICY: MinimizePolicy = 'full';

/** Character budget of a `masked-snippet`. */
export const SNIPPET_CHARS = 512;

/** What survives the policy. */
export interface MinimizedExcerpt {
  /** Stable fingerprint — always kept, even under `hash-only`. */
  fingerprint: string;
  /** Retained text; absent under `hash-only`. */
  text?: string;
  /** True when secrets were masked out of the retained text. */
  masked: boolean;
  /** True when the retained text was truncated to the budget. */
  truncated: boolean;
  /** UTF-8 byte size of the retained text (0 under `hash-only`). */
  bytes: number;
}

/**
 * The app policy row — the settings the frozen `Settings` type cannot carry.
 *
 * One row per installation (`app_policy`), read by the ingestion path and
 * written by the settings page and by the daily purge.
 */
export interface AppPolicy {
  /** Retention policy of the raw excerpts (§ 18). */
  excerptPolicy: MinimizePolicy;
  /** ISO instant of the last retention purge, when the app purged already. */
  lastPurgeAt?: string;
  /** ISO instant of the last write of this row. */
  updatedAt: string;
}

/** Type guard for the value the settings page sends (the payload is unknown). */
export function isMinimizePolicy(value: unknown): value is MinimizePolicy {
  return typeof value === 'string' && (MINIMIZE_POLICIES as readonly string[]).includes(value);
}

/** The policy to apply: the stored one when readable, the default otherwise. */
export function policyOr(value: unknown): MinimizePolicy {
  return isMinimizePolicy(value) ? value : DEFAULT_EXCERPT_POLICY;
}

/** Stable 16-hex fingerprint of a raw excerpt. */
export function excerptFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** UTF-8 size of a text, in bytes. */
function byteSize(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Reduces an excerpt to the strict minimum `policy` allows.
 *
 * The fingerprint is derived from the **raw** text, so the same excerpt
 * fingerprints identically under every policy; secrets are masked before
 * anything is retained — even under `full`, a raw secret never persists.
 * Pure: it never mutates its input and depends on no clock or storage.
 */
export function applyExcerptPolicy(
  excerpt: { text: string; fingerprint?: string },
  policy: MinimizePolicy = DEFAULT_EXCERPT_POLICY,
  maxChars: number = SNIPPET_CHARS,
): MinimizedExcerpt {
  const fingerprint = excerpt.fingerprint ?? excerptFingerprint(excerpt.text);

  if (policy === 'hash-only') {
    return { fingerprint, masked: false, truncated: false, bytes: 0 };
  }

  const maskedText = maskSecrets(excerpt.text).text;

  if (policy === 'full') {
    return {
      fingerprint,
      text: maskedText,
      masked: true,
      truncated: false,
      bytes: byteSize(maskedText),
    };
  }

  const truncated = maskedText.length > maxChars;
  const text = truncated ? maskedText.slice(0, maxChars) : maskedText;
  return { fingerprint, text, masked: true, truncated, bytes: byteSize(text) };
}
