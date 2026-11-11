/**
 * Quarantine proposal (CI-19, § 25) — decision logic for the CI Memory page
 * and the `propose-quarantine` action, kept **pure** so it is tested without
 * React and without the UI Kit.
 *
 * `proposeQuarantine` in `@dejavu/core` is the **only authority**: it returns
 * a proposal when, and only when, `assessFlakiness` calls the test unstable.
 * This module wraps it so the caller also gets the *reasons* of the verdict
 * when nothing is proposed — the screen must explain why instead of failing
 * silently, and quarantining a genuinely broken test would hide a real defect.
 *
 * Nothing here touches Forge, React or the network.
 */

import {
  assessFlakiness,
  proposeQuarantine,
  type Occurrence,
  type QuarantineProposal,
  type Settings,
  type Signature,
} from '@dejavu/core';

/** Options of the decision: the settings and the clock of the engine. */
export interface QuarantineOptions {
  settings?: Partial<Settings>;
  now?: Date;
}

/** What the decision produced: a proposal, or the reasons it is not flaky. */
export type QuarantineDecision =
  | { kind: 'proposal'; proposal: QuarantineProposal }
  | { kind: 'not-flaky'; reasons: string[] };

/**
 * Decides whether to propose a quarantine for a signature.
 *
 * The verdict comes from `assessFlakiness`; a test that is not unstable gets no
 * proposal and the reasons of that verdict are returned. When it is unstable,
 * `proposeQuarantine` drafts the change, the repair ticket and the `worthIt`
 * verdict — it stays the single source of truth.
 */
export function decideQuarantine(
  signature: Signature,
  occurrences: Occurrence[],
  opts?: QuarantineOptions,
): QuarantineDecision {
  const options = opts?.settings ? { settings: opts.settings } : {};
  const clock = opts?.now ? { now: opts.now } : {};
  const verdict = assessFlakiness(occurrences, { ...options, ...clock });
  if (!verdict.flaky) return { kind: 'not-flaky', reasons: verdict.reasons };
  const proposal = proposeQuarantine({ signature, occurrences, ...options, ...clock });
  if (!proposal) return { kind: 'not-flaky', reasons: verdict.reasons };
  return { kind: 'proposal', proposal };
}
