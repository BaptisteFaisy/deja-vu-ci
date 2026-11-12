/**
 * Signature versioning and migration (CI "pérennité des signatures").
 *
 * The migration must be provably idempotent: a crash mid-run and a replay must
 * leave the memory in exactly the state a single clean run would.
 */

import { describe, expect, it } from 'vitest';

import {
  SIGNATURE_ALGORITHM,
  applySignatureMigration,
  planSignatureMigration,
  signatureIdOf,
} from '../src/signature-version.js';
import { signatureOf } from '../src/sign.js';
import { MemoryStore } from '../src/store.js';
import type { ErrorBlock, Signature } from '../src/types.js';
import { makeOccurrence, makeSignature } from './fakes/lot-b-fixtures.js';

function block(overrides: Partial<ErrorBlock> = {}): ErrorBlock {
  return {
    category: 'test',
    errorType: 'AssertionError',
    message: 'expected <NUM> to equal <NUM>',
    rawMessage: 'expected 4 to equal 5',
    frames: [{ file: 'src/calc.ts', fn: 'add', line: 42, isProject: true }],
    source: 'log',
    rawText: 'AssertionError: expected 4 to equal 5',
    ...overrides,
  };
}

/** A whole-store snapshot, used to prove that a replay changes nothing. */
async function snapshot(store: MemoryStore) {
  const signatures = await store.listSignatures();
  const occurrences: unknown[] = [];
  for (const signature of signatures) {
    occurrences.push(...(await store.listOccurrences(signature.id)));
  }
  return JSON.stringify({ signatures, occurrences });
}

describe('SIGNATURE_ALGORITHM', () => {
  it('names the current algorithm and its version', () => {
    expect(SIGNATURE_ALGORITHM).toEqual({ name: 'deja-vu-normalized-v1', version: 1 });
  });
});

describe('signatureIdOf', () => {
  it('is bit for bit the current signatureOf', () => {
    const blocks = [
      block(),
      block({ category: 'compile', errorType: 'CompileError', message: 'error TS2345' }),
      block({ frames: [] }),
      block({ message: 'connect ETIMEDOUT registry.example.com' }),
    ];
    for (const b of blocks) {
      expect(signatureIdOf(b)).toBe(signatureOf(b));
      expect(signatureIdOf(b, SIGNATURE_ALGORITHM.version)).toBe(signatureOf(b));
    }
  });

  it('refuses an algorithm version it cannot reproduce', () => {
    expect(() => signatureIdOf(block(), 2)).toThrow(/Unknown signature algorithm version: 2/);
    expect(() => signatureIdOf(block(), 0)).toThrow(/Unknown signature algorithm version: 0/);
  });
});

describe('planSignatureMigration', () => {
  it('plans nothing when every id already matches', () => {
    const signatures = [makeSignature({ id: 'aaa' }), makeSignature({ id: 'bbb' })];
    const plan = planSignatureMigration(signatures, (s) => s.id);

    expect(plan.moves).toEqual([]);
    expect(plan.merges).toEqual([]);
    expect(plan.algorithm).toEqual(SIGNATURE_ALGORITHM);
  });

  it('records one move per relocated signature, with its ticket', () => {
    const signatures = [
      makeSignature({ id: 'aaa', occurrences: 4, issueKey: 'CI-12' }),
      makeSignature({ id: 'bbb', occurrences: 1 }),
      makeSignature({ id: 'ccc', occurrences: 7 }),
    ];
    const plan = planSignatureMigration(signatures, (s) =>
      s.id === 'ccc' ? 'ccc' : `v2-${s.id}`,
    );

    expect(plan.moves).toEqual([
      { from: 'aaa', to: 'v2-aaa', occurrences: 4, issueKey: 'CI-12' },
      { from: 'bbb', to: 'v2-bbb', occurrences: 1 },
    ]);
    expect(plan.merges).toEqual([]);
  });

  it('detects a fusion when two old signatures land on one id', () => {
    const signatures = [
      makeSignature({ id: 'aaa', occurrences: 3 }),
      makeSignature({ id: 'bbb', occurrences: 2 }),
      makeSignature({ id: 'ccc', occurrences: 1 }),
    ];
    const plan = planSignatureMigration(signatures, (s) => (s.id === 'ccc' ? 'ccc' : 'shared'));

    expect(plan.moves).toHaveLength(2);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].map((m) => m.from)).toEqual(['aaa', 'bbb']);
    expect(plan.merges[0][0].to).toBe('shared');
  });
});

describe('applySignatureMigration', () => {
  /** A store holding two signatures and three occurrences. */
  function seededStore(): MemoryStore {
    const signatures: Signature[] = [
      makeSignature({
        id: 'aaa',
        familyId: 'fam-aaa',
        occurrences: 2,
        status: 'known',
        firstSeen: '2026-11-01T08:00:00.000Z',
        lastSeen: '2026-11-04T08:00:00.000Z',
      }),
      makeSignature({
        id: 'bbb',
        familyId: 'fam-bbb',
        occurrences: 1,
        status: 'flaky',
        issueKey: 'CI-7',
        firstSeen: '2026-10-28T08:00:00.000Z',
        lastSeen: '2026-11-05T08:00:00.000Z',
      }),
    ];
    const occurrences = [
      makeOccurrence({ id: 'o1', signatureId: 'aaa', familyId: 'fam-aaa', occurredAt: '2026-11-01T08:00:00.000Z' }),
      makeOccurrence({ id: 'o2', signatureId: 'aaa', familyId: 'fam-aaa', occurredAt: '2026-11-04T08:00:00.000Z' }),
      makeOccurrence({ id: 'o3', signatureId: 'bbb', familyId: 'fam-bbb', occurredAt: '2026-11-05T08:00:00.000Z' }),
    ];
    return new MemoryStore({ signatures, occurrences });
  }

  it('moves the occurrences and merges the counters', async () => {
    const store = seededStore();
    const plan = planSignatureMigration(await store.listSignatures(), (s) =>
      s.id === 'bbb' ? 'bbb' : 'v2-aaa',
    );

    await applySignatureMigration(store, plan);

    const moved = await store.getSignature('v2-aaa');
    expect(moved?.id).toBe('v2-aaa');
    expect(moved?.occurrences).toBe(2);
    expect(await store.listOccurrences('v2-aaa')).toHaveLength(2);
    expect(await store.listOccurrences('aaa')).toHaveLength(0);
  });

  it('keeps the oldest firstSeen and the most advanced status and ticket', async () => {
    const store = seededStore();
    const plan = planSignatureMigration(await store.listSignatures(), () => 'shared');

    await applySignatureMigration(store, plan);

    const shared = await store.getSignature('shared');
    expect(shared?.firstSeen).toBe('2026-10-28T08:00:00.000Z');
    expect(shared?.lastSeen).toBe('2026-11-05T08:00:00.000Z');
    expect(shared?.occurrences).toBe(3);
    expect(shared?.status).toBe('flaky');
    expect(shared?.issueKey).toBe('CI-7');
    expect(await store.listOccurrences('shared')).toHaveLength(3);
  });

  it('detects the fusion in the plan of the merge above', async () => {
    const store = seededStore();
    const plan = planSignatureMigration(await store.listSignatures(), () => 'shared');

    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].map((m) => m.from)).toEqual(['aaa', 'bbb']);
  });

  it('is idempotent: replaying an applied plan changes nothing', async () => {
    const store = seededStore();
    const plan = planSignatureMigration(await store.listSignatures(), (s) =>
      s.id === 'aaa' ? 'v2-aaa' : 'v2-bbb',
    );

    await applySignatureMigration(store, plan);
    const afterFirst = await snapshot(store);

    await applySignatureMigration(store, plan);
    await applySignatureMigration(store, plan);
    const afterThird = await snapshot(store);

    expect(afterThird).toBe(afterFirst);
  });

  it('is idempotent on a fusion too', async () => {
    const store = seededStore();
    const plan = planSignatureMigration(await store.listSignatures(), () => 'shared');

    await applySignatureMigration(store, plan);
    const afterFirst = await snapshot(store);

    await applySignatureMigration(store, plan);
    expect(await snapshot(store)).toBe(afterFirst);

    const shared = await store.getSignature('shared');
    expect(shared?.occurrences).toBe(3);
  });

  it('ignores a move whose source is already gone', async () => {
    const store = new MemoryStore({
      signatures: [makeSignature({ id: 'aaa', occurrences: 1 })],
      occurrences: [makeOccurrence({ id: 'o1', signatureId: 'aaa' })],
    });

    await applySignatureMigration(store, {
      algorithm: SIGNATURE_ALGORITHM,
      moves: [{ from: 'missing', to: 'whatever', occurrences: 9 }],
      merges: [],
    });

    expect(await store.getSignature('aaa')).toBeDefined();
    expect(await store.getSignature('whatever')).toBeUndefined();
    expect((await store.listOccurrences('aaa'))[0].signatureId).toBe('aaa');
  });

  it('is driven by a real recomputation of the stored template', async () => {
    const signatures = [
      makeSignature({
        id: 'legacy',
        category: 'test',
        errorType: 'AssertionError',
        template: 'expected <NUM> to equal <NUM>',
        frames: [{ file: 'src/calc.ts', fn: 'add', isProject: true }],
        occurrences: 2,
      }),
    ];
    const recompute = (s: Signature): string =>
      signatureIdOf({
        category: s.category,
        errorType: s.errorType,
        message: s.template,
        rawMessage: s.template,
        frames: s.frames,
        source: 'report',
        rawText: s.template,
      });

    const plan = planSignatureMigration(signatures, recompute);

    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].from).toBe('legacy');
    expect(plan.moves[0].to).toMatch(/^[0-9a-f]{16}$/);
    expect(plan.moves[0].to).toBe(signatureOf(block()));
  });
});