import { describe, expect, it } from 'vitest';
import type { FlakyVerdict, Occurrence, Signature } from '../src/types.js';
import { dailySynthesis, planTicketActions, sameProblem, ticketKeyFor } from '../src/tickets.js';

const NOW = new Date('2026-11-11T09:00:00.000Z');

function occurrence(index: number, overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: `occ-${index}`,
    signatureId: 'sig-abc',
    familyId: 'fam-abc',
    workspace: 'ws',
    repo: 'demo',
    branch: 'main',
    commit: `commit-${index}`,
    author: 'alice',
    stepName: 'test',
    durationS: 300,
    occurredAt: '2026-11-10T08:00:00.000Z',
    passedOnRetry: false,
    ...overrides,
  };
}

function signature(overrides: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-abc',
    familyId: 'fam-abc',
    category: 'test',
    errorType: 'AssertionError',
    template: 'expected true to be false\n  at src/app.ts',
    frames: [],
    status: 'known',
    firstSeen: '2026-11-01T08:00:00.000Z',
    lastSeen: '2026-11-10T08:00:00.000Z',
    occurrences: 1,
    testName: 'checkout.test_total',
    ...overrides,
  };
}

const FLAKY: FlakyVerdict = {
  flaky: true,
  reasons: ['3 occurrences on 2 branches'],
  occurrences: 3,
  branches: 2,
  sameCommitPass: true,
  flakyIndex: 0.4,
};

describe('ticket uniqueness', () => {
  it('uses the family as uniqueness key', () => {
    expect(ticketKeyFor(signature())).toBe('fam-abc');
  });

  it('gives the same ticket to two signatures of one family', () => {
    const a = signature({ id: 'sig-abc' });
    const b = signature({ id: 'sig-def' });
    expect(sameProblem(a, b)).toBe(true);
  });

  it('never shares a ticket between two families', () => {
    const a = signature({ id: 'sig-abc', familyId: 'fam-abc' });
    const b = signature({ id: 'sig-def', familyId: 'fam-other' });
    expect(sameProblem(a, b)).toBe(false);
  });
});

describe('planTicketActions', () => {
  it('creates exactly one ticket when the signature becomes unstable', () => {
    const actions = planTicketActions({
      signature: signature({ status: 'flaky' }),
      occurrences: [occurrence(1), occurrence(2), occurrence(3)],
      verdict: FLAKY,
      now: NOW,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('create');
    expect(actions[0].familyId).toBe('fam-abc');
    expect(actions[0].labels).toContain('test-instable');
  });

  it('creates no ticket while the problem is not unstable', () => {
    const actions = planTicketActions({
      signature: signature(),
      occurrences: [occurrence(1)],
      now: NOW,
    });
    expect(actions).toHaveLength(0);
  });

  it('describes the problem with excerpt, occurrences and cost', () => {
    const actions = planTicketActions({
      signature: signature({ status: 'flaky' }),
      occurrences: [
        occurrence(1, { branch: 'main', buildUrl: 'https://build/1' }),
        occurrence(2, { branch: 'feature/x', author: 'bob' }),
      ],
      verdict: FLAKY,
      now: NOW,
    });
    const description = actions[0].description ?? '';
    expect(description).toContain('checkout.test_total');
    expect(description).toContain('expected true to be false');
    expect(description).toContain('| Date | Repository | Branch | Link |');
    expect(description).toContain('https://build/1');
    expect(description).toContain('CI minutes lost');
    expect(actions[0].assignee).toBeDefined();
  });

  it('updates the ticket and comments once on the tenth occurrence', () => {
    const occs = Array.from({ length: 10 }, (_, i) =>
      occurrence(i, { occurredAt: `2026-11-11T0${i}:00:00.000Z` }),
    );
    const actions = planTicketActions({
      signature: signature({ status: 'flaky' }),
      occurrences: occs,
      verdict: FLAKY,
      existingIssueKey: 'CI-1',
      now: NOW,
    });
    const kinds = actions.map((action) => action.kind);
    expect(kinds).toContain('update');
    expect(kinds.filter((kind) => kind === 'comment')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'create')).toHaveLength(0);
  });

  it('adds no comment the next day when nothing is new', () => {
    const occs = Array.from({ length: 10 }, (_, i) =>
      occurrence(i, { occurredAt: `2026-11-10T0${i}:00:00.000Z` }),
    );
    const actions = planTicketActions({
      signature: signature({ status: 'flaky' }),
      occurrences: occs,
      verdict: FLAKY,
      existingIssueKey: 'CI-1',
      lastCommentAt: '2026-11-10T09:30:00.000Z',
      now: NOW,
    });
    expect(actions.map((action) => action.kind)).not.toContain('comment');
  });

  it('does not comment twice on the same day', () => {
    const occs = [occurrence(1, { occurredAt: '2026-11-11T08:00:00.000Z' })];
    const actions = planTicketActions({
      signature: signature({ status: 'flaky' }),
      occurrences: occs,
      verdict: FLAKY,
      existingIssueKey: 'CI-1',
      lastCommentAt: '2026-11-11T07:00:00.000Z',
      now: NOW,
    });
    expect(actions.map((action) => action.kind)).not.toContain('comment');
    const update = actions.find((action) => action.kind === 'update');
    expect(update?.commentAlreadyToday).toBe(true);
  });

  it('proposes the closure after 14 days without occurrence', () => {
    const actions = planTicketActions({
      signature: signature({ status: 'flaky' }),
      occurrences: [occurrence(1, { occurredAt: '2026-10-26T08:00:00.000Z' })],
      verdict: FLAKY,
      existingIssueKey: 'CI-1',
      lastCommentAt: '2026-10-26T09:00:00.000Z',
      now: NOW,
    });
    expect(actions.map((action) => action.kind)).toContain('close-suggested');
  });

  it('reopens the ticket when the problem comes back', () => {
    const occs = [
      occurrence(1, { occurredAt: '2026-10-26T08:00:00.000Z' }),
      occurrence(2, { occurredAt: '2026-11-11T08:00:00.000Z' }),
    ];
    const actions = planTicketActions({
      signature: signature({ status: 'resolved' }),
      occurrences: occs,
      existingIssueKey: 'CI-1',
      lastCommentAt: '2026-10-26T09:00:00.000Z',
      now: NOW,
    });
    const kinds = actions.map((action) => action.kind);
    expect(kinds).toContain('reopen');
    expect(kinds).not.toContain('close-suggested');
  });

  it('reopens the ticket when the signature is marked as a regression', () => {
    const actions = planTicketActions({
      signature: signature({ status: 'regression' }),
      occurrences: [occurrence(1, { occurredAt: '2026-11-11T08:00:00.000Z' })],
      existingIssueKey: 'CI-1',
      now: NOW,
    });
    expect(actions.map((action) => action.kind)).toContain('reopen');
  });

  it('never creates a second ticket for a family that already has one', () => {
    const actions = planTicketActions({
      signature: signature({ status: 'flaky' }),
      occurrences: [occurrence(1)],
      verdict: FLAKY,
      existingIssueKey: 'CI-1',
      now: NOW,
    });
    expect(actions.map((action) => action.kind)).not.toContain('create');
  });
});

describe('dailySynthesis', () => {
  it('summarizes the day, the branches, the last sighting and the cost', () => {
    const occs = [
      occurrence(1, { branch: 'main', occurredAt: '2026-11-11T07:00:00.000Z' }),
      occurrence(2, { branch: 'feature/x', occurredAt: '2026-11-11T08:00:00.000Z' }),
      occurrence(3, { branch: 'main', occurredAt: '2026-11-09T08:00:00.000Z' }),
    ];
    const text = dailySynthesis(signature(), occs, NOW);
    expect(text).toContain('Occurrences today: 2');
    expect(text).toContain('main');
    expect(text).toContain('feature/x');
    expect(text).toContain('2026-11-11T08:00:00.000Z');
    expect(text).toContain('CI minutes lost so far');
    expect(text).not.toContain('Occurrences today: 3');
  });
});
