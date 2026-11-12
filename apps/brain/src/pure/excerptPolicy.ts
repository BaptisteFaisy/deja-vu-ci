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
 * **Split in two on purpose.** This file holds the constants, the types and the
 * guards the screens import; it has no Node import and no engine import, so the
 * Forge UI Kit bundle (a web target, Node built-ins disabled) can reach it.
 * Applying a policy hashes and masks — that half lives in `excerptApply.ts`,
 * for the backend only. `test/ui-bundle.test.ts` guards the boundary.
 *
 * Pure module: no `@forge/*` import, no network, no Node built-in.
 */

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
