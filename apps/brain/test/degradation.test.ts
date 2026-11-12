/**
 * Degradation under failure (lot `core-inv`).
 *
 * The Brain runs on a platform that fails: Forge SQL drops a connection, a
 * SELECT times out, Jira answers 403/429/500, the platform model is absent or
 * answers nonsense, and a payload arrives truncated. None of that may escape as
 * an exception, and none of it may end in a *silent* partial write: every
 * failure becomes an explicit result (`{ ok: false, error }` or an empty
 * state), and a redelivered message converges without duplicating anything.
 *
 * The doubles live in `test/fakes/degradation.ts`: the existing doubles of this
 * app, extended with one failure switch each. No network, no clock — `now` is
 * injected.
 */

import { describe, expect, it } from 'vitest';
import { llmNormalize, normalizedHash, TemplateCache } from '@dejavu/core';
import type { ErrorBlock, Signature } from '@dejavu/core';
import {
  consumeIngest,
  occurrenceIdFor,
  planAndApplyTickets,
  refineUnknownBlock,
  type LlmPort,
} from '../src/pure/consume';
import { validateIngestPayload, validateQueryRequest } from '../src/pure/validate';
import { findLastSynthesisAt } from '../src/pure/jira';
import { guard } from '../src/actions/engine';
import { explainBuildFailure } from '../src/actions/explain-build-failure';
import { makeFakeEngine } from './fakes/engine';
import { FakeConsumerStore } from './fakes/consumer';
import {
  FailingJira,
  FailingSqlStore,
  FailingStoreLike,
  JEST_LOG,
  coreEngine,
  deps,
  model,
  payload,
  ticketingEngine,
  unknownBlock,
} from './fakes/degradation';

// ---------------------------------------------------------------------------
// The memory (Forge SQL) when it fails
// ---------------------------------------------------------------------------

describe('Forge SQL store in failure', () => {
  it('turns a refused connection into an explicit error, never an exception', async () => {
    const store = new FailingSqlStore();
    store.failOn = 'getSettings';
    store.failure = 'connection terminated unexpectedly';
    const result = await consumeIngest(payload(), deps(store));
    expect(result).toEqual({ ok: false, error: 'connection terminated unexpectedly' });
    expect(store.signatures.size).toBe(0);
    expect(store.occurrences.size).toBe(0);
  });

  it('turns a SELECT over the 5 s budget into an explicit error', async () => {
    const store = new FailingSqlStore();
    store.failOn = 'listOccurrences';
    store.failure = 'query timeout after 5000 ms';
    const result = await consumeIngest(payload(), deps(store));
    expect(result).toEqual({ ok: false, error: 'query timeout after 5000 ms' });
  });

  it('reports a write that stopped halfway instead of hiding it', async () => {
    const store = new FailingSqlStore();
    store.failOn = 'saveOccurrence';
    store.failure = 'row is too large';
    const result = await consumeIngest(payload(), deps(store));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('row is too large');
    // The signature row did land, the occurrence did not: the failure is loud,
    // nothing is presented as a success.
    expect(store.signatures.size).toBe(1);
    expect(store.occurrences.size).toBe(0);
  });

  it('converges without duplicates when the platform redelivers the message', async () => {
    const broken = new FailingSqlStore();
    broken.failOn = 'saveOccurrence';
    const first = await consumeIngest(payload(), deps(broken));
    expect(first.ok).toBe(false);

    // Redelivery of the very same message, on a store that works again.
    const healthy = new FailingSqlStore();
    healthy.signatures.set([...broken.signatures.values()][0].id, [...broken.signatures.values()][0]);
    const second = await consumeIngest(payload(), deps(healthy));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.processed.length).toBe(1);
    expect(healthy.occurrences.size).toBe(1);
    expect(healthy.signatures.size).toBe(1);
    // The occurrence id is a digest of the payload identity: the replay of the
    // message lands on the same row, it never creates a second one.
    expect([...healthy.occurrences.keys()]).toEqual([occurrenceIdFor(payload(), 0)]);
  });

  it('treats a missing row as an empty state, not as a failure', async () => {
    const store = new FakeConsumerStore();
    const result = await consumeIngest(payload(), deps(store));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No signature, no resolution, no outbreak, no settings row: every read
    // answered "nothing known" and the pipeline still produced a diagnostic.
    expect(result.processed.length).toBe(1);
    expect(result.processed[0].diagnostic.kind).toBeDefined();
    expect(result.processed[0].diagnostic.facts.length).toBeGreaterThan(0);
    await expect(store.getResolution('missing')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Jira when it refuses the call
// ---------------------------------------------------------------------------

describe('Jira in failure', () => {
  it.each([403, 429, 500])('answers %i without an exception and without a ticket', async (status) => {
    const store = new FakeConsumerStore();
    const tickets = new FailingJira();
    tickets.status = status;
    const result = await consumeIngest(payload(), deps(store, tickets, ticketingEngine()));
    expect(result).toEqual({ ok: false, error: `Jira answered ${status}` });
    expect(tickets.applied).toEqual([]);
  });

  it('keeps the memory as the source of truth when Jira is down', async () => {
    const store = new FakeConsumerStore();
    const tickets = new FailingJira();
    tickets.status = 500;
    await consumeIngest(payload(), deps(store, tickets, ticketingEngine()));
    // The failure is explicit, and what the memory holds is still readable:
    // the Brain degrades, it does not corrupt.
    expect(store.occurrences.size).toBe(1);
    expect(store.signatures.size).toBe(1);
    expect([...store.signatures.values()][0].issueKey).toBeUndefined();
  });

  it('reports a failing comment lookup instead of guessing a date', async () => {
    const store = new FakeConsumerStore();
    const tickets = new FailingJira();
    tickets.status = 429;
    const signature: Signature = {
      id: 'sig-1',
      familyId: 'fam-1',
      category: 'test',
      errorType: 'AssertionError',
      template: 'expected 200 to be 500',
      frames: [],
      status: 'flaky',
      firstSeen: '2026-11-01T09:00:00.000Z',
      lastSeen: '2026-11-05T09:00:00.000Z',
      occurrences: 3,
      issueKey: 'CI-1',
    };
    const verdict = {
      flaky: true,
      reasons: [],
      occurrences: 3,
      branches: 2,
      sameCommitPass: true,
      flakyIndex: 0.5,
    };
    await expect(
      planAndApplyTickets(deps(store, tickets, ticketingEngine()), signature, [], verdict, store.settings),
    ).rejects.toThrow('Jira answered 429');
  });

  it('reads a malformed comment list without breaking the daily brake', () => {
    const comments = [
      { created: undefined, body: { weird: true } },
      { created: 12345 as unknown as string, body: null },
      { created: '2026-11-05T09:00:00.000Z' },
      { created: '2026-11-04T09:00:00.000Z', body: 'plain text from a human' },
    ];
    expect(() => findLastSynthesisAt(comments, 'sig-1')).not.toThrow();
    expect(findLastSynthesisAt(comments, 'sig-1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The model fallback (§ 9.5)
// ---------------------------------------------------------------------------

describe('model fallback in failure', () => {
  it('runs the deterministic path when the platform model is absent', async () => {
    const store = new FakeConsumerStore();
    const result = await consumeIngest(payload(), deps(store, new FailingJira(), coreEngine()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.processed.length).toBe(1);
  });

  it('keeps the original block when the model port fails or answers nothing', async () => {
    const block = unknownBlock();
    const throwing: LlmPort = {
      async normalize() {
        throw new Error('model unavailable');
      },
    };
    const empty: LlmPort = { async normalize() { return undefined; } };
    expect(await refineUnknownBlock(block, undefined)).toBe(block);
    expect(await refineUnknownBlock(block, throwing)).toEqual(block);
    expect(await refineUnknownBlock(block, empty)).toEqual(block);
    // A recognised block is never shown to the model at all.
    const known: ErrorBlock = { ...block, category: 'test' };
    let called = false;
    const spying: LlmPort = {
      async normalize() {
        called = true;
        return { template: 'nope', category: 'compile' };
      },
    };
    expect(await refineUnknownBlock(known, spying)).toBe(known);
    expect(called).toBe(false);
  });

  it('falls back deterministically on every unusable model answer', async () => {
    const block = unknownBlock();
    const answers = [
      '',
      '   ',
      'I cannot help with that.',
      '{"template": "Connection reset"',
      '{"template": 42, "category": "test"}',
      '{"category": "not-a-category"}',
      '```json\n{"template": "", "category": "test"}\n```',
    ];
    for (const answer of answers) {
      const cache = new TemplateCache();
      const result = await llmNormalize(block, { async complete() { return answer; } }, cache);
      expect(result, `answer ${JSON.stringify(answer)}`).toEqual({
        template: block.message,
        category: block.category,
      });
    }
  });

  it('falls back when the model throws, and never submits the same error twice', async () => {
    const block = unknownBlock();
    const cache = new TemplateCache();
    const throwing = model(() => {
      throw new Error('rate limited');
    });
    expect(await llmNormalize(block, throwing, cache)).toEqual({
      template: block.message,
      category: block.category,
    });
    expect(await llmNormalize(block, throwing, cache)).toEqual({
      template: block.message,
      category: block.category,
    });
    expect(throwing.calls).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get(normalizedHash(block))).toBeDefined();
  });

  it('uses a well-formed answer, once', async () => {
    const block = unknownBlock();
    const cache = new TemplateCache();
    const fallback = model(() => '{"template": "registry unreachable", "category": "dependency"}');
    expect(await llmNormalize(block, fallback, cache)).toEqual({
      template: 'registry unreachable',
      category: 'dependency',
    });
    expect(await llmNormalize(block, fallback, cache)).toEqual({
      template: 'registry unreachable',
      category: 'dependency',
    });
    expect(fallback.calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Truncated payloads
// ---------------------------------------------------------------------------

describe('truncated payload', () => {
  it('refuses a payload cut before its mandatory fields', () => {
    expect(validateIngestPayload({ version: 1, workspace: 'acme' })).toEqual({
      ok: false,
      error: 'field "repository" must be a non-empty string',
    });
    expect(validateIngestPayload({ ...payload(), failedAt: '2026-11-0' }).ok).toBe(false);
    expect(validateIngestPayload({ ...payload(), errorBlocks: 'FAIL src' }).ok).toBe(false);
    expect(validateIngestPayload(null).ok).toBe(false);
    expect(validateIngestPayload('{"version": 1, "workspace":').ok).toBe(false);
    expect(validateQueryRequest({ kind: 'pr-card', repository: 'acme/payments' })).toEqual({
      ok: false,
      error: 'field "branch" must be a non-empty string',
    });
  });

  it('answers an explicit empty state when nothing can be extracted', async () => {
    const store = new FakeConsumerStore();
    const result = await consumeIngest(payload({ errorBlocks: [] }), deps(store));
    expect(result).toEqual({ ok: true, processed: [], replays: 0, skipped: 'no error block in the payload' });
    expect(store.occurrences.size).toBe(0);
  });

  it('survives a log cut in the middle of a line', async () => {
    const store = new FakeConsumerStore();
    const cut = JEST_LOG.slice(0, JEST_LOG.indexOf('Expected'));
    const result = await consumeIngest(payload({ errorBlocks: [cut] }), deps(store));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.processed.length).toBe(1);
    expect(result.processed[0].diagnostic.facts.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The actions and the guard
// ---------------------------------------------------------------------------

describe('actions under failure', () => {
  it('turns any exception into an explicit internal error', async () => {
    const result = await guard(async () => {
      throw new Error('db down');
    });
    expect(result).toEqual({ ok: false, error: 'internal error: db down' });
  });

  it('answers an explicit error when the memory is unreachable', async () => {
    const engine = makeFakeEngine();
    const store = new FailingStoreLike();
    store.failure = 'connection terminated unexpectedly';
    engine.store = store;
    const result = await explainBuildFailure(engine, { issueKey: 'CI-1' });
    expect(result).toEqual({
      ok: false,
      error: 'internal error: connection terminated unexpectedly',
    });
  });

  it('answers an explicit refusal on a truncated action input', async () => {
    const engine = makeFakeEngine();
    expect(await explainBuildFailure(engine, {})).toEqual({
      ok: false,
      error: 'issueKey or buildUrl is required',
    });
    expect((await explainBuildFailure(engine, { issueKey: 'CI-404' })).ok).toBe(false);
  });
});
