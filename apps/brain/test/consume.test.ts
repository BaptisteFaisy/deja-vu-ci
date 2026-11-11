/**
 * Tests of the idempotent consumer core (`src/pure/consume.ts`).
 *
 * The doubles come from `test/fakes/consumer.ts`: the memory, the engine and
 * the Jira side are injected, exactly like in the real consumer. What is
 * verified here belongs to the Brain: the deterministic occurrence id, the
 * replay skip, the signature upsert, the excerpt retention, the ticket key
 * propagation and the "never throws" rule.
 */

import { describe, expect, it } from 'vitest';
import type { IngestPayload, Signature, TicketAction } from '@dejavu/core';
import {
  buildOccurrence,
  consumeIngest,
  nextStatus,
  occurrenceIdFor,
  planAndApplyTickets,
  plusDaysIso,
  refineUnknownBlock,
  type ConsumerDeps,
  type LlmPort,
} from '../src/pure/consume';
import { FakeConsumerEngine, FakeConsumerStore, FakeTicketApplier } from './fakes/consumer';

function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    version: 1,
    workspace: 'acme',
    repository: 'acme/payments',
    branch: 'feature/login',
    commit: 'a'.repeat(40),
    author: 'marie',
    prId: 42,
    stepName: 'test',
    durationS: 120,
    failedAt: '2026-11-05T09:00:00.000Z',
    errorBlocks: ['AssertionError: expected 200 got 500'],
    ...overrides,
  };
}

function deps(overrides: Partial<ConsumerDeps> = {}): ConsumerDeps {
  return {
    store: new FakeConsumerStore(),
    engine: new FakeConsumerEngine(),
    tickets: new FakeTicketApplier(),
    now: () => new Date('2026-11-05T09:05:00.000Z'),
    ...overrides,
  };
}

describe('occurrenceIdFor', () => {
  it('is deterministic for the same payload', () => {
    expect(occurrenceIdFor(payload(), 0)).toBe(occurrenceIdFor(payload(), 0));
  });

  it('changes with the block index and with the payload identity', () => {
    expect(occurrenceIdFor(payload(), 0)).not.toBe(occurrenceIdFor(payload(), 1));
    expect(occurrenceIdFor(payload(), 0)).not.toBe(
      occurrenceIdFor(payload({ commit: 'b'.repeat(40) }), 0),
    );
  });
});

describe('consumeIngest', () => {
  it('stores one occurrence, one signature and one excerpt per block', async () => {
    const store = new FakeConsumerStore();
    const result = await consumeIngest(payload(), deps({ store }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.processed).toHaveLength(1);
    expect(store.occurrences.size).toBe(1);
    expect(store.signatures.size).toBe(1);
    expect(store.excerpts.size).toBe(1);
    const excerpt = [...store.excerpts.values()][0];
    expect(excerpt.expiresAt).toBe('2026-12-05T09:05:00.000Z'); // +30 days
  });

  it('is idempotent: replaying the same message changes nothing', async () => {
    const store = new FakeConsumerStore();
    const d = deps({ store });
    const first = await consumeIngest(payload(), d);
    const engine = d.engine as FakeConsumerEngine;
    const diagnosesAfterFirst = engine.diagnoseCalls;
    const second = await consumeIngest(payload(), d);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replays).toBe(1);
    expect(second.processed).toHaveLength(0);
    expect(store.occurrences.size).toBe(1);
    expect(store.signatures.size).toBe(1);
    expect(engine.diagnoseCalls).toBe(diagnosesAfterFirst);
  });

  it('processes each block of a multi-block payload separately', async () => {
    const store = new FakeConsumerStore();
    const result = await consumeIngest(
      payload({ errorBlocks: ['AssertionError: a', 'TimeoutError: b'] }),
      deps({ store }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.processed).toHaveLength(2);
    expect(store.occurrences.size).toBe(2);
    expect(store.signatures.size).toBe(2);
  });

  it('increments the signature and keeps firstSeen on a second, different failure', async () => {
    const store = new FakeConsumerStore();
    const d = deps({ store });
    await consumeIngest(payload(), d);
    await consumeIngest(payload({ failedAt: '2026-11-06T09:00:00.000Z' }), d);
    const signature = [...store.signatures.values()][0];
    expect(signature.occurrences).toBe(2);
    expect(signature.firstSeen).toBe('2026-11-05T09:00:00.000Z');
    expect(signature.lastSeen).toBe('2026-11-06T09:00:00.000Z');
    expect(signature.status).toBe('known');
    expect(store.occurrences.size).toBe(2);
  });

  it('skips a payload without any recognisable block', async () => {
    const result = await consumeIngest(payload({ errorBlocks: ['   '] }), deps());
    expect(result).toEqual({ ok: true, processed: [], replays: 0, skipped: 'no error block in the payload' });
  });

  it('never throws: an engine failure becomes an explicit error', async () => {
    const engine = new FakeConsumerEngine();
    engine.failure = 'engine exploded';
    const result = await consumeIngest(payload(), deps({ engine }));
    expect(result).toEqual({ ok: false, error: 'engine exploded' });
  });
});

describe('buildOccurrence', () => {
  it('maps the payload identity onto the occurrence row', () => {
    const block = {
      category: 'test' as const,
      errorType: 'AssertionError',
      message: 'm',
      rawMessage: 'm',
      frames: [],
      source: 'log' as const,
      rawText: 'm',
      testName: 'test_login',
    };
    const occurrence = buildOccurrence(payload(), 0, { signature: 'sig', family: 'fam' }, block);
    expect(occurrence.id).toBe(occurrenceIdFor(payload(), 0));
    expect(occurrence.signatureId).toBe('sig');
    expect(occurrence.familyId).toBe('fam');
    expect(occurrence.repo).toBe('acme/payments');
    expect(occurrence.commit).toBe('a'.repeat(40));
    expect(occurrence.prId).toBe(42);
    expect(occurrence.passedOnRetry).toBe(false);
    expect(occurrence.testName).toBe('test_login');
  });
});

describe('nextStatus', () => {
  const base: Signature = {
    id: 's', familyId: 'f', category: 'test', errorType: 'E', template: 't',
    frames: [], status: 'new', firstSeen: '', lastSeen: '', occurrences: 1,
  };
  const notFlaky = { flaky: false, reasons: [], occurrences: 0, branches: 0, sameCommitPass: false, flakyIndex: 0 };
  const flaky = { ...notFlaky, flaky: true };

  it('follows the transitions of § 8.2–8.4', () => {
    expect(nextStatus(undefined, false, notFlaky)).toBe('new');
    expect(nextStatus(base, false, notFlaky)).toBe('known');
    expect(nextStatus(base, false, flaky)).toBe('flaky');
    expect(nextStatus({ ...base, status: 'resolved' }, true, notFlaky)).toBe('regression');
    expect(nextStatus({ ...base, status: 'resolved' }, false, notFlaky)).toBe('resolved');
  });
});

describe('plusDaysIso', () => {
  it('adds whole days', () => {
    expect(plusDaysIso(new Date('2026-11-05T00:00:00.000Z'), 30)).toBe('2026-12-05T00:00:00.000Z');
  });
});

describe('planAndApplyTickets', () => {
  const signature: Signature = {
    id: 's', familyId: 'f', category: 'test', errorType: 'E', template: 't',
    frames: [], status: 'flaky', firstSeen: '', lastSeen: '', occurrences: 3,
  };
  const verdict = { flaky: true, reasons: [], occurrences: 3, branches: 2, sameCommitPass: true, flakyIndex: 0.5 };

  it('stores the issue key the applier returns after a creation', async () => {
    const store = new FakeConsumerStore();
    const tickets = new FakeTicketApplier();
    tickets.issueKey = 'CI-77';
    const engine = new FakeConsumerEngine();
    engine.planTicketActions = (): TicketAction[] => [
      { kind: 'create', familyId: 'f', signatureId: 's', summary: 'Flaky test' },
    ];
    const planned = await planAndApplyTickets(
      { store, engine, tickets, now: () => new Date('2026-11-05T00:00:00.000Z') },
      signature, [], verdict, store.settings,
    );
    expect(planned.signature.issueKey).toBe('CI-77');
    expect(store.signatures.get('s')?.issueKey).toBe('CI-77');
    expect(tickets.applied).toHaveLength(1);
  });

  it('passes the last synthesis comment date to the planner', async () => {
    const store = new FakeConsumerStore();
    const tickets = new FakeTicketApplier();
    tickets.lastComment = '2026-11-05T08:00:00.000Z';
    const engine = new FakeConsumerEngine();
    let seenInput: { lastCommentAt?: string } = {};
    engine.planTicketActions = (input): TicketAction[] => {
      seenInput = input;
      return [];
    };
    await planAndApplyTickets(
      { store, engine, tickets, now: () => new Date('2026-11-05T09:00:00.000Z') },
      { ...signature, issueKey: 'CI-77' }, [], verdict, store.settings,
    );
    expect(seenInput.lastCommentAt).toBe('2026-11-05T08:00:00.000Z');
  });
});

describe('the LLM fallback port (§ 9.5)', () => {
  function unknownDeps(llm?: LlmPort): { d: ConsumerDeps; store: FakeConsumerStore } {
    const store = new FakeConsumerStore();
    const engine = new FakeConsumerEngine();
    engine.blockCategory = 'unknown';
    return {
      d: { store, engine, tickets: new FakeTicketApplier(), now: () => new Date('2026-11-05T09:05:00.000Z'), ...(llm ? { llm } : {}) },
      store,
    };
  }

  it('refines an unknown block with the template and category of the port', async () => {
    const llm: LlmPort = {
      async normalize() {
        return { template: 'registry <name> unreachable', category: 'dependency' };
      },
    };
    const { d, store } = unknownDeps(llm);
    const result = await consumeIngest(payload({ errorBlocks: ['npm ERR! code ECONNREFUSED'] }), d);
    expect(result.ok).toBe(true);
    const signature = [...store.signatures.values()][0];
    expect(signature.category).toBe('dependency');
    expect(signature.template).toBe('registry <name> unreachable');
  });

  it('leaves the block untouched when the port fails or answers nothing', async () => {
    const throwing: LlmPort = {
      async normalize() {
        throw new Error('model unreachable');
      },
    };
    const empty: LlmPort = { async normalize() { return undefined; } };
    for (const llm of [throwing, empty]) {
      const { d, store } = unknownDeps(llm);
      const result = await consumeIngest(payload({ errorBlocks: ['weird failure'] }), d);
      expect(result.ok).toBe(true);
      expect([...store.signatures.values()][0].category).toBe('unknown');
    }
  });

  it('never calls the model for a block a pattern already recognised', async () => {
    let calls = 0;
    const llm: LlmPort = {
      async normalize() {
        calls += 1;
        return { template: 'x', category: 'config' };
      },
    };
    const store = new FakeConsumerStore();
    const d: ConsumerDeps = {
      store,
      engine: new FakeConsumerEngine(), // category 'test' by default
      tickets: new FakeTicketApplier(),
      now: () => new Date('2026-11-05T09:05:00.000Z'),
      llm,
    };
    await consumeIngest(payload(), d);
    expect(calls).toBe(0);
  });
});
