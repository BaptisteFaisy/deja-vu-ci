/**
 * Tests of the CI-17 curation wiring (merge / split) — `src/pure/curation.ts`.
 *
 * The store is an in-memory double (`test/fakes/store.ts`): no network, no UI
 * Kit, no React. The engine's merge and split are the **real** `@dejavu/core`
 * functions (the vitest alias resolves the package to its source); these tests
 * check what lot G owns — the criterion mapping, the fact that a preview never
 * mutates the memory, and the assembly from two signature ids.
 */

import { describe, expect, it } from 'vitest';
import type { Occurrence, Signature } from '@dejavu/core';
import { FakeStore } from './fakes/store';
import {
  SPLIT_CRITERION_KEYS,
  assembleMergePreview,
  assembleSplitPreview,
  criterionOf,
  isSplitCriterionKey,
  previewMerge,
  previewSplit,
} from '../src/pure/curation';

/** A signature of category `test`, as the engine stores it. */
function sig(overrides: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-aaaaaaaaaaaaaaaa',
    familyId: 'fam-aaaaaaaaaaaaaaaa',
    category: 'test',
    errorType: 'AssertionError',
    template: 'expected true to equal false',
    frames: [{ file: 'src/calc.ts', fn: 'add', isProject: true }],
    status: 'known',
    firstSeen: '2026-11-01T08:00:00.000Z',
    lastSeen: '2026-11-09T08:00:00.000Z',
    occurrences: 5,
    ...overrides,
  };
}

/** An occurrence of the signature above. */
function occ(index: number, overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: `occ-${index}`,
    signatureId: 'sig-aaaaaaaaaaaaaaaa',
    familyId: 'fam-aaaaaaaaaaaaaaaa',
    workspace: 'ws',
    repo: 'demo',
    branch: 'main',
    commit: `commit-${index}`,
    author: 'alice',
    stepName: 'test',
    durationS: 120,
    occurredAt: `2026-11-0${(index % 9) + 1}T08:00:00.000Z`,
    passedOnRetry: false,
    ...overrides,
  };
}

/** Two signatures of the same error, split by a volatile shard id. */
const KEPT = sig({
  id: 'sig-kept',
  familyId: 'fam-kept',
  status: 'known',
  firstSeen: '2026-11-05T08:00:00.000Z',
  lastSeen: '2026-11-09T08:00:00.000Z',
  occurrences: 4,
  issueKey: 'CI-42',
  template: 'shard a3f9c2 rejected the write',
});
const DROPPED = sig({
  id: 'sig-drop',
  familyId: 'fam-drop',
  status: 'flaky',
  firstSeen: '2026-11-02T08:00:00.000Z',
  lastSeen: '2026-11-10T08:00:00.000Z',
  occurrences: 3,
  template: 'shard b7e1d4 rejected the write',
});

describe('criterionOf (CI-17)', () => {
  it('maps the three literal criteria to the engine discriminators', () => {
    expect(criterionOf('test-name')).toBe('test-name');
    expect(criterionOf('branch')).toBe('branch');
    expect(criterionOf('repository')).toBe('repository');
  });

  it('maps the "function" criterion to a step discriminator', () => {
    const criterion = criterionOf('function');
    expect(typeof criterion).toBe('function');
    if (typeof criterion === 'function') {
      expect(criterion(occ(1, { stepName: 'gradle test' }))).toBe('gradle test');
      expect(criterion(occ(2, { stepName: '' }))).toBe('(none)');
    }
  });

  it('lists the four criteria and guards them', () => {
    expect(SPLIT_CRITERION_KEYS).toEqual(['test-name', 'branch', 'repository', 'function']);
    expect(isSplitCriterionKey('branch')).toBe(true);
    expect(isSplitCriterionKey('nonsense')).toBe(false);
    expect(isSplitCriterionKey(undefined)).toBe(false);
  });
});

describe('previewMerge / previewSplit do not mutate the memory', () => {
  it('leaves the occurrences untouched after a merge preview', () => {
    const occurrences = [occ(1, { signatureId: 'sig-drop', familyId: 'fam-drop' })];
    const before = JSON.stringify(occurrences);
    const result = previewMerge(KEPT, DROPPED, occurrences);
    expect(JSON.stringify(occurrences)).toBe(before);
    expect(result.movedOccurrences).toBe(1);
    expect(result.merged.id).toBe('sig-kept');
  });

  it('leaves the occurrences untouched after a split preview', () => {
    const occurrences = [occ(1, { testName: 'a' }), occ(2, { testName: 'b' })];
    const before = JSON.stringify(occurrences);
    const result = previewSplit(sig(), occurrences, 'test-name');
    expect(JSON.stringify(occurrences)).toBe(before);
    expect(result.groups.length).toBeGreaterThanOrEqual(1);
  });
});

describe('assembleMergePreview (CI-17)', () => {
  it('refuses to merge a signature with itself', async () => {
    const store = new FakeStore({ signatures: [KEPT] });
    const answer = await assembleMergePreview(store, 'sig-kept', 'sig-kept');
    expect(answer.ok).toBe(false);
  });

  it('refuses an unknown signature', async () => {
    const store = new FakeStore({ signatures: [KEPT] });
    const answer = await assembleMergePreview(store, 'sig-kept', 'nope');
    expect(answer).toMatchObject({ ok: false, error: 'unknown signature: nope' });
  });

  it('shows what is kept before confirmation, and the rule', async () => {
    const dropped = [
      occ(1, { signatureId: 'sig-drop', familyId: 'fam-drop' }),
      occ(2, { signatureId: 'sig-drop', familyId: 'fam-drop' }),
      occ(3, { signatureId: 'sig-drop', familyId: 'fam-drop' }),
    ];
    const store = new FakeStore({ signatures: [KEPT, DROPPED], occurrences: dropped });
    const answer = await assembleMergePreview(store, 'sig-kept', 'sig-drop');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // Strongest status (flaky over known), single ticket, oldest firstSeen.
    expect(answer.data.merged.status).toBe('flaky');
    expect(answer.data.merged.issueKey).toBe('CI-42');
    expect(answer.data.merged.firstSeen).toBe('2026-11-02T08:00:00.000Z');
    expect(answer.data.merged.occurrences).toBe(7);
    expect(answer.data.retired.id).toBe('sig-drop');
    expect(answer.data.movedOccurrences).toBe(3);
    // The volatile shard id is isolated as a normalization rule.
    expect(answer.data.rule?.replacement).toBe('<HEX>');
    expect(answer.data.rule?.alreadyCovered).toBe(false);
  });

  it('never writes to the memory: the dropped occurrences stay put', async () => {
    const dropped = [occ(1, { signatureId: 'sig-drop', familyId: 'fam-drop' })];
    const store = new FakeStore({ signatures: [KEPT, DROPPED], occurrences: dropped });
    await assembleMergePreview(store, 'sig-kept', 'sig-drop');
    const stillThere = await store.listOccurrences('sig-drop');
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].signatureId).toBe('sig-drop');
  });
});

describe('assembleSplitPreview (CI-17)', () => {
  it('refuses an unknown signature', async () => {
    const store = new FakeStore({ signatures: [sig()] });
    const answer = await assembleSplitPreview(store, 'nope', 'test-name');
    expect(answer).toMatchObject({ ok: false, error: 'unknown signature: nope' });
  });

  it('previews the groups, majority first, without touching the memory', async () => {
    const base = sig({ id: 'sig-origin', familyId: 'fam-origin', issueKey: 'CI-7' });
    const occurrences = [
      occ(1, { signatureId: 'sig-origin', familyId: 'fam-origin', testName: 'testAlpha' }),
      occ(2, { signatureId: 'sig-origin', familyId: 'fam-origin', testName: 'testAlpha' }),
      occ(3, { signatureId: 'sig-origin', familyId: 'fam-origin', testName: 'testBeta' }),
    ];
    const store = new FakeStore({ signatures: [base], occurrences });
    const answer = await assembleSplitPreview(store, 'sig-origin', 'test-name');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.data.groups).toHaveLength(2);
    expect(answer.data.groups[0].signature.id).toBe('sig-origin');
    expect(answer.data.groups[0].signature.issueKey).toBe('CI-7');
    expect(answer.data.groups[0].occurrences).toHaveLength(2);
    // The memory is untouched: the occurrences still point at the origin.
    const stillThere = await store.listOccurrences('sig-origin');
    expect(stillThere.every((o) => o.signatureId === 'sig-origin')).toBe(true);
  });
});
