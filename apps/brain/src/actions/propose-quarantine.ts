/**
 * Action `propose-quarantine` (CI-19, § 25 "Quarantaine proposée") — GET,
 * `signatureId`.
 *
 * Drafts the quarantine of an unstable test: the idiomatic skip snippet of its
 * ecosystem, the repair ticket (suggested owner, 14-day deadline) and whether
 * it is worth it. It is a **proposal**: nothing is written to a repository and
 * no ticket is created here (§ 6 puts modifying the repository out of scope).
 *
 * When `assessFlakiness` does not call the test unstable, the action returns
 * the reasons of that verdict instead of a proposal — quarantining a genuinely
 * broken test would hide a real defect, and `proposeQuarantine` is the single
 * authority. The same assembly backs the action, the Rovo/MCP exposure and the
 * UI resolver, so the three read one truth.
 */

import { WORTH_IT, type QuarantineProposal } from '@dejavu/core';
import { fail, ok, type ActionResult, type BrainEngine } from './engine';
import { defineAction, type RawInput } from './descriptor';
import { requireText } from './validate';
import { decideQuarantine } from '../pure/quarantineUi';
import { auditSinkOf, recordAudit } from '../pure/auditLog';

/**
 * The three thresholds behind `worthIt`, as the engine defines them.
 *
 * Sent with the answer instead of being imported by the screens: the UI Kit
 * bundle is compiled for a web target where Node built-ins are disabled, and
 * importing a runtime value of `@dejavu/core` from a screen drags the whole
 * engine (including `crypto`) into it. One source of truth — the engine — and
 * the screens only display what they are handed.
 */
export interface WorthItThresholds {
  ciMinutesLost: number;
  flakyIndex: number;
  occurrences: number;
}

/** Answer of the action. */
export interface ProposeQuarantineData {
  signatureId: string;
  signatureShort: string;
  testName: string;
  /** True when `assessFlakiness` called the test unstable and a proposal was drafted. */
  flaky: boolean;
  /** The thresholds the engine applied, for the screens to display. */
  thresholds: WorthItThresholds;
  /** Reasons of the flakiness verdict when no proposal is made. */
  reasons: string[];
  proposal?: QuarantineProposal;
}

/**
 * Shared assembly: read the signature and its occurrences, then decide.
 *
 * Used by the action, by the Rovo/MCP exposure and by the UI resolver, so the
 * quarantine proposal is computed in exactly one place.
 */
export async function proposeQuarantineData(
  engine: BrainEngine,
  signatureId: string,
): Promise<ActionResult<ProposeQuarantineData>> {
  const signature = await engine.store.getSignature(signatureId);
  if (!signature) return fail(`unknown signature: ${signatureId}`);
  const [occurrences, settings] = await Promise.all([
    engine.store.listOccurrences(signature.id),
    engine.store.getSettings(),
  ]);
  const decision = decideQuarantine(signature, occurrences, { settings, now: engine.now() });
  const head = {
    signatureId: signature.id,
    signatureShort: engine.signatureShort(signature.id),
    thresholds: { ...WORTH_IT } as WorthItThresholds,
  };
  if (decision.kind === 'not-flaky') {
    const notFlaky: ProposeQuarantineData = {
      ...head,
      testName: signature.testName ?? signature.template,
      flaky: false,
      reasons: decision.reasons,
    };
    return ok(notFlaky);
  }
  const proposed: ProposeQuarantineData = {
    ...head,
    testName: decision.proposal.testName,
    flaky: true,
    reasons: [],
    proposal: decision.proposal,
  };
  // The journal records the proposal itself: the operator asked for it, and the
  // project page must be able to show when (nothing is written to a repository).
  await recordAudit(auditSinkOf(engine.store), {
    action: 'quarantine-proposed',
    signatureId: signature.id,
    ...(signature.issueKey ? { issueKey: signature.issueKey } : {}),
    detail: decision.proposal.testName,
    at: engine.now(),
  });
  return ok(proposed);
}

/** Validates the input, then delegates to the shared assembly. */
export async function runProposeQuarantine(
  engine: BrainEngine,
  raw: RawInput,
): Promise<ActionResult<ProposeQuarantineData>> {
  const signatureId = requireText(raw.signatureId, 'signatureId', 200);
  if (!signatureId.ok) return fail(signatureId.error);
  return proposeQuarantineData(engine, signatureId.value);
}

/** Action descriptor (§ 13, CI-19). */
export const proposeQuarantine = defineAction<ProposeQuarantineData>({
  key: 'propose-quarantine',
  verb: 'GET',
  description:
    'Draft the quarantine of an unstable test: idiomatic skip snippet, repair ticket and whether it is worth it.',
  inputs: {
    signatureId: { type: 'string', description: 'Identifier of the signature.', required: true },
  },
  run: runProposeQuarantine,
});
