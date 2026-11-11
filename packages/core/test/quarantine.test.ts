/**
 * Quarantine proposal (CI-19, § 25).
 *
 * The point of these tests is the discipline of the feature: nothing is
 * proposed for a test that is not flaky (a genuinely broken test must stay
 * red), the snippet is idiomatic per ecosystem, and the ticket commits
 * somebody to a repair with a deadline.
 */

import { describe, expect, it } from 'vitest';
import {
  QUARANTINE_DUE_DAYS,
  QUARANTINE_LABELS,
  WORTH_IT,
  detectEcosystem,
  isWorthIt,
  proposeQuarantine,
  quarantinePatch,
} from '../src/quarantine.js';
import type { Occurrence, Signature } from '../src/types.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-01T09:00:00Z');

const FLAKY_TEST = 'com.payments.RefundLimiterTest#limitsRefundAmount';

/** A signature of category `test`, as the engine stores it. */
function signature(overrides: Partial<Signature> = {}): Signature {
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
    testName: FLAKY_TEST,
    ...overrides,
  };
}

/** Six failures on three branches, one of them followed by a same-commit pass. */
function flakyOccurrences(): Occurrence[] {
  const branches = ['feature/a', 'feature/b', 'main'];
  const authors = ['marie', 'samir', 'marie', 'marie', 'lina', 'samir'];
  return Array.from({ length: 6 }, (_, index) => ({
    id: `occ-${index}`,
    signatureId: 'sig-quarantine-1',
    familyId: 'fam-quarantine-1',
    workspace: 'payments',
    repo: 'payments-api',
    branch: branches[index % branches.length],
    commit: `c0ffee0${index}`,
    author: authors[index],
    stepName: 'gradle test',
    durationS: 600,
    occurredAt: new Date(T0 + index * DAY).toISOString(),
    passedOnRetry: index === 1,
    testName: FLAKY_TEST,
  }));
}

/** Occurrences that never passed at the same commit: a genuinely broken test. */
function brokenOccurrences(): Occurrence[] {
  return flakyOccurrences().map((occurrence) => ({ ...occurrence, passedOnRetry: false }));
}

describe('detectEcosystem', () => {
  it('recognises the four ecosystems from the test name and the step', () => {
    expect(detectEcosystem('com.acme.FooTest#bar')).toBe('junit');
    expect(detectEcosystem('tests/test_foo.py::test_bar')).toBe('pytest');
    expect(detectEcosystem('cart > totals the basket')).toBe('jest');
    expect(detectEcosystem('TestBatchCutOff')).toBe('go');
    expect(detectEcosystem('something odd')).toBe('unknown');
  });

  it('falls back to the step name when the test name says nothing', () => {
    expect(detectEcosystem('weird', 'gradle test')).toBe('junit');
    expect(detectEcosystem('weird', 'unit-tests (pytest)')).toBe('pytest');
    expect(detectEcosystem('weird', 'jest')).toBe('jest');
    expect(detectEcosystem('weird', 'go test ./...')).toBe('go');
    expect(detectEcosystem('weird', 'deploy')).toBe('unknown');
  });
});

describe('quarantinePatch', () => {
  it('writes the idiomatic isolation of each ecosystem', () => {
    expect(quarantinePatch('junit', 'com.acme.FooTest#bar', 'FooTest.java', 'flaky').snippet).toContain(
      '@Disabled("flaky")',
    );
    expect(quarantinePatch('pytest', 'tests/test_foo.py::test_bar', 'test_foo.py', 'flaky').snippet).toContain(
      '@pytest.mark.xfail(reason="flaky", strict=False)',
    );
    expect(quarantinePatch('jest', 'cart > totals', 'cart.test.js', 'flaky').snippet).toContain('it.skip(');
    expect(quarantinePatch('go', 'TestBatch', 'batch_test.go', 'flaky').snippet).toContain('t.Skip("flaky")');
    expect(quarantinePatch('unknown', 'whatever', 'file', 'flaky').instruction).toContain('Isoler');
  });

  it('names the file and keeps the short test name in the instruction', () => {
    const patch = quarantinePatch('junit', FLAKY_TEST, 'RefundLimiterTest.java', 'flaky');
    expect(patch.file).toBe('RefundLimiterTest.java');
    expect(patch.instruction).toContain('limitsRefundAmount');
    expect(patch.instruction).toContain('RefundLimiterTest.java');
  });
});

describe('isWorthIt', () => {
  const base = { occurrences: 1, branches: 1, ciMinutesLost: 0, flakyIndex: 0 };

  it('is worth it above any of the three thresholds', () => {
    expect(isWorthIt({ ...base, ciMinutesLost: WORTH_IT.ciMinutesLost })).toBe(true);
    expect(isWorthIt({ ...base, flakyIndex: WORTH_IT.flakyIndex })).toBe(true);
    expect(isWorthIt({ ...base, occurrences: WORTH_IT.occurrences })).toBe(true);
  });

  it('is not worth it for a cheap, rarely failing test', () => {
    expect(isWorthIt({ ...base, ciMinutesLost: 5, flakyIndex: 0.2, occurrences: 3 })).toBe(false);
  });
});

describe('proposeQuarantine', () => {
  it('proposes nothing for a test that is not flaky', () => {
    const proposal = proposeQuarantine({
      signature: signature({ status: 'known' }),
      occurrences: brokenOccurrences(),
    });
    expect(proposal).toBeUndefined();
  });

  it('proposes nothing for a single failure', () => {
    const proposal = proposeQuarantine({
      signature: signature(),
      occurrences: brokenOccurrences().slice(0, 1),
    });
    expect(proposal).toBeUndefined();
  });

  it('proposes the quarantine of a flaky test, with its patch and its ticket', () => {
    const proposal = proposeQuarantine({
      signature: signature(),
      occurrences: flakyOccurrences(),
      now: new Date(T0 + 6 * DAY),
    });
    expect(proposal).toBeDefined();
    expect(proposal?.testName).toBe(FLAKY_TEST);
    expect(proposal?.patch.ecosystem).toBe('junit');
    expect(proposal?.patch.snippet).toContain('@Disabled');
    expect(proposal?.cost.occurrences).toBe(6);
    expect(proposal?.cost.branches).toBe(3);
    // six runs of 600 s, plus the retried one counted as a re-run (§ CI-14).
    expect(proposal?.cost.ciMinutesLost).toBe(70);
    expect(proposal?.worthIt).toBe(true);
  });

  it('files a repair ticket with labels, a deadline and the most frequent author', () => {
    const proposal = proposeQuarantine({
      signature: signature(),
      occurrences: flakyOccurrences(),
      now: new Date(T0 + 6 * DAY),
    });
    expect(proposal?.ticket.labels).toEqual(QUARANTINE_LABELS);
    expect(proposal?.ticket.dueInDays).toBe(QUARANTINE_DUE_DAYS);
    expect(proposal?.ticket.assignee).toBe('marie'); // three of six failures
    expect(proposal?.ticket.summary).toContain('limitsRefundAmount');
    expect(proposal?.ticket.description).toContain('6');
  });

  it('takes the flaky index of the statistics when the caller provides them', () => {
    const proposal = proposeQuarantine({
      signature: signature(),
      occurrences: flakyOccurrences(),
      stats: {
        repo: 'payments-api',
        testName: FLAKY_TEST,
        runsFailed: 6,
        runsPassedSameCommit: 1,
        branches: 3,
        flakyIndex: 0.83,
        updatedAt: new Date(T0).toISOString(),
      },
    });
    expect(proposal?.cost.flakyIndex).toBe(0.83);
    expect(proposal?.worthIt).toBe(true);
  });

  it('uses the cost given by the caller instead of recomputing it', () => {
    const proposal = proposeQuarantine({
      signature: signature(),
      occurrences: flakyOccurrences(),
      cost: {
        signatureId: 'sig-quarantine-1',
        signatureShort: 'S-123',
        title: 'flaky',
        occurrences: 17,
        ciMinutesLost: 4,
        peopleAffected: 5,
        retries: 3,
      },
    });
    expect(proposal?.cost.occurrences).toBe(17);
    expect(proposal?.cost.ciMinutesLost).toBe(4);
    // 4 minutes is cheap, but 17 occurrences cross the count threshold.
    expect(proposal?.worthIt).toBe(true);
  });

  it('finds the file in the signature stack, and falls back to the changed files', () => {
    const withFrame = proposeQuarantine({ signature: signature(), occurrences: flakyOccurrences() });
    expect(withFrame?.patch.file).toBe('src/test/java/RefundLimiterTest.java');

    const withoutFrame = proposeQuarantine({
      signature: signature({ frames: [] }),
      occurrences: flakyOccurrences().map((o, i) =>
        i === 0 ? { ...o, changedFiles: ['src/main/java/Limiter.java'] } : o,
      ),
    });
    expect(withoutFrame?.patch.file).toBe('src/main/java/Limiter.java');
  });
});
