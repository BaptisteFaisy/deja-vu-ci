/**
 * Tests of the CI-19 quarantine wiring — `src/pure/quarantineUi.ts` and the
 * `propose-quarantine` action.
 *
 * The store is an in-memory double (`test/fakes/`): no network, no UI Kit, no
 * React. `decideQuarantine` and the action call the **real** `@dejavu/core`
 * `assessFlakiness` / `proposeQuarantine` (the vitest alias resolves the
 * package to its source) — the flakiness verdict is never recomputed here, and
 * `proposeQuarantine` stays the single authority. These tests check what lot G
 * owns: the "not flaky → explain, propose nothing" discipline and the action's
 * input handling and metadata.
 */

import { describe, expect, it } from 'vitest';
import type { Occurrence, Signature } from '@dejavu/core';
import { decideQuarantine } from '../src/pure/quarantineUi';
import {
  proposeQuarantine,
  proposeQuarantineData,
  runProposeQuarantine,
} from '../src/actions/propose-quarantine';
import { makeFakeEngine } from './fakes/engine';
import { FLAKY_SIGNATURE, NEW_SIGNATURE, SEED } from './fakes/fixtures';

/** The clock the fake engine uses; occurrences stay inside the 14-day window. */
const NOW = new Date('2026-11-11T09:00:00Z');
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-05T09:00:00Z');
const JUNIT_TEST = 'com.acme.RefundLimiterTest#limitsRefundAmount';

/** A JUnit test signature, so the ecosystem of the proposal is `junit`. */
function junitSignature(overrides: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-quarantine-1',
    familyId: 'fam-quarantine-1',
    category: 'test',
    errorType: 'AssertionError',
    template: 'expected: <100> but was: <0>',
    frames: [{ file: 'src/test/java/RefundLimiterTest.java', fn: 'limitsRefundAmount', isProject: true }],
    status: 'flaky',
    firstSeen: new Date(T0).toISOString(),
    lastSeen: new Date(T0 + 5 * DAY).toISOString(),
    occurrences: 6,
    testName: JUNIT_TEST,
    ...overrides,
  };
}

/** Six failures on three branches, one followed by a same-commit pass. */
function flakyOccurrences(): Occurrence[] {
  const branches = ['feature/a', 'feature/b', 'main'];
  return Array.from({ length: 6 }, (_, index) => ({
    id: `occ-${index}`,
    signatureId: 'sig-quarantine-1',
    familyId: 'fam-quarantine-1',
    workspace: 'payments',
    repo: 'payments-api',
    branch: branches[index % branches.length],
    commit: `c0ffee0${index}`,
    author: index % 2 === 0 ? 'marie' : 'samir',
    stepName: 'gradle test',
    durationS: 600,
    occurredAt: new Date(T0 + index * DAY).toISOString(),
    passedOnRetry: index === 1,
    testName: JUNIT_TEST,
  }));
}

/** The same failures, but none ever passed at the same commit: genuinely broken. */
function brokenOccurrences(): Occurrence[] {
  return flakyOccurrences().map((occurrence) => ({ ...occurrence, passedOnRetry: false }));
}

describe('decideQuarantine (CI-19)', () => {
  it('drafts the proposal of an unstable test, with the idiomatic snippet', () => {
    const decision = decideQuarantine(junitSignature(), flakyOccurrences(), { now: NOW });
    expect(decision.kind).toBe('proposal');
    if (decision.kind !== 'proposal') return;
    expect(decision.proposal.patch.ecosystem).toBe('junit');
    expect(decision.proposal.patch.snippet).toContain('@Disabled');
    expect(decision.proposal.ticket.dueInDays).toBe(14);
    expect(decision.proposal.testName).toBe(JUNIT_TEST);
  });

  it('proposes nothing for a genuinely broken test, and says why', () => {
    const decision = decideQuarantine(junitSignature({ status: 'known' }), brokenOccurrences(), {
      now: NOW,
    });
    expect(decision.kind).toBe('not-flaky');
    if (decision.kind !== 'not-flaky') return;
    expect(decision.reasons.length).toBeGreaterThan(0);
  });
});

describe('propose-quarantine action (CI-19)', () => {
  it('drafts the proposal of a flaky signature read from the memory', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runProposeQuarantine(engine, { signatureId: FLAKY_SIGNATURE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.flaky).toBe(true);
    expect(result.data.proposal).toBeDefined();
    expect(result.data.signatureShort).toBe(`S-${FLAKY_SIGNATURE.id.slice(-3)}`);
  });

  it('explains why a non-flaky signature gets no proposal', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runProposeQuarantine(engine, { signatureId: NEW_SIGNATURE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.flaky).toBe(false);
    expect(result.data.proposal).toBeUndefined();
    expect(result.data.reasons.length).toBeGreaterThan(0);
  });

  it('fails on an unknown signature', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runProposeQuarantine(engine, { signatureId: 'nope' });
    expect(result).toMatchObject({ ok: false });
  });

  it('fails on a missing signatureId', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runProposeQuarantine(engine, {});
    expect(result).toMatchObject({ ok: false });
  });

  it('answers the same through the descriptor and the shared assembly', async () => {
    const engine = makeFakeEngine(SEED);
    const viaDescriptor = await proposeQuarantine(engine, { signatureId: FLAKY_SIGNATURE.id });
    const viaAssembly = await proposeQuarantineData(engine, FLAKY_SIGNATURE.id);
    expect(viaDescriptor).toEqual(viaAssembly);
  });

  it('exposes the metadata the manifest declares', () => {
    expect(proposeQuarantine.key).toBe('propose-quarantine');
    expect(proposeQuarantine.verb).toBe('GET');
    expect(proposeQuarantine.key.length).toBeLessThanOrEqual(23);
    expect(proposeQuarantine.description.length).toBeGreaterThan(10);
    expect(proposeQuarantine.description.length).toBeLessThanOrEqual(255);
    expect(proposeQuarantine.inputs.signatureId.required).toBe(true);
  });
});
