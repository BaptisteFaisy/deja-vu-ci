/**
 * Multi-project / multi-repository isolation of the Brain memory.
 *
 * What is proven here, with the in-memory store (`MemoryStore`) and the
 * existing pure modules only — no `apps/brain/src` change:
 *
 *  1. Repo-scoped reads never cross repositories: `listTestStats(repo)`,
 *     `listOccurrences(signatureId)` and the SQL builders that scope a read
 *     (`selectTestStats`, `selectLatestOccurrence`, `selectPairing`) filter on
 *     the repo/branch/workspace and bind every value as a `?` placeholder, so
 *     a value can never be concatenated into the statement (no injection that
 *     would widen the scope).
 *  2. Settings do not bleed: two store instances keep independent settings,
 *     and the SQL settings row is keyed by a single constant.
 *  3. Occurrence identity is workspace+repo scoped: a replayed message for one
 *     repo cannot collide with (or overwrite) another repo's occurrence.
 *
 * KNOWN HOLE (explicit, not silently skipped — see the `it.fails` test below
 * and the lot report): the PR-card read (`selectLatestOccurrence`, fed by
 * `QueryRequest`) is scoped by `repo` + `branch` but **not** by `workspace`.
 * In an installation where two Bitbucket workspaces pair to the same Brain and
 * both own a repo of the same name, a query for that repo+branch returns the
 * latest occurrence across both workspaces (author, buildUrl, commit of the
 * other workspace). Fixing it touches the frozen `QueryRequest` type, so it is
 * left to a follow-up lot; this suite flags it instead of hiding it.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MemoryStore,
  type Occurrence,
  type Signature,
  type TestStats,
} from '@dejavu/core';
import type { IngestPayload } from '@dejavu/core';
import {
  SETTINGS_KEY,
  selectLatestOccurrence,
  selectPairing,
  selectSettings,
  selectTestStats,
} from '../src/pure/sqlQueries';
import { occurrenceIdFor } from '../src/pure/consume';

const NOW = '2026-11-11T08:00:00.000Z';

function makeOccurrence(over: Partial<Occurrence> = {}): Occurrence {
  return {
    id: 'occ-1',
    signatureId: 'sig-1',
    familyId: 'fam-1',
    workspace: 'acme',
    repo: 'payments',
    branch: 'main',
    commit: 'a'.repeat(40),
    author: 'alice',
    stepName: 'test',
    durationS: 12,
    occurredAt: NOW,
    passedOnRetry: false,
    ...over,
  };
}

function makeSignature(over: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-1',
    familyId: 'fam-1',
    category: 'test',
    errorType: 'AssertionError',
    template: 'expected 1 to be 2',
    frames: [],
    status: 'new',
    firstSeen: NOW,
    lastSeen: NOW,
    occurrences: 1,
    ...over,
  };
}

function makeStats(repo: string, testName: string): TestStats {
  return {
    repo,
    testName,
    runsFailed: 3,
    runsPassedSameCommit: 1,
    branches: 2,
    flakyIndex: 0.5,
    updatedAt: NOW,
  };
}

function makePayload(over: Partial<IngestPayload> = {}): IngestPayload {
  return {
    version: 1,
    workspace: 'acme',
    repository: 'payments',
    branch: 'main',
    commit: 'a'.repeat(40),
    author: 'alice',
    stepName: 'test',
    durationS: 12,
    failedAt: NOW,
    errorBlocks: ['AssertionError: expected 1 to be 2'],
    ...over,
  };
}

describe('isolation — repo-scoped reads on the in-memory store', () => {
  it('listTestStats(repo) returns only that repository', async () => {
    const store = new MemoryStore();
    await store.saveTestStats(makeStats('payments', 'test-a'));
    await store.saveTestStats(makeStats('billing', 'test-b'));
    const payments = await store.listTestStats('payments');
    expect(payments).toHaveLength(1);
    expect(payments[0].repo).toBe('payments');
    expect(payments.map((s) => s.repo)).not.toContain('billing');
  });

  it('listOccurrences(signatureId) returns only that signature', async () => {
    const store = new MemoryStore();
    await store.saveSignature(makeSignature({ id: 'sig-a' }));
    await store.saveSignature(makeSignature({ id: 'sig-b' }));
    await store.saveOccurrence(makeOccurrence({ id: 'o1', signatureId: 'sig-a', repo: 'payments' }));
    await store.saveOccurrence(makeOccurrence({ id: 'o2', signatureId: 'sig-b', repo: 'billing' }));
    const a = await store.listOccurrences('sig-a');
    expect(a).toHaveLength(1);
    expect(a[0].repo).toBe('payments');
  });
});

describe('isolation — SQL read builders are scoped and parameterized', () => {
  it('selectTestStats filters by repo and binds it as a placeholder', () => {
    const stmt = selectTestStats('payments');
    expect(stmt.text).toContain('WHERE repo = ?');
    expect(stmt.params).toEqual(['payments']);
    expect(stmt.text).not.toContain('payments');
  });

  it('selectPairing filters by workspace and binds it as a placeholder', () => {
    const stmt = selectPairing('acme');
    expect(stmt.text).toContain('WHERE workspace = ?');
    expect(stmt.params).toEqual(['acme']);
    expect(stmt.text).not.toContain('acme');
  });

  it('selectLatestOccurrence filters by repo and branch, bound as placeholders', () => {
    const stmt = selectLatestOccurrence('payments', 'main');
    expect(stmt.text).toContain('WHERE repo = ? AND branch = ?');
    expect(stmt.params).toEqual(['payments', 'main']);
    expect(stmt.text).not.toContain('payments');
  });

  it('selectSettings reads the single installation row', () => {
    const stmt = selectSettings();
    expect(stmt.text).toContain('WHERE project_key = ?');
    expect(stmt.params).toEqual([SETTINGS_KEY]);
  });
});

describe('isolation — settings never bleed between stores', () => {
  it('two store instances keep independent settings', async () => {
    const storeA = new MemoryStore();
    const storeB = new MemoryStore();
    await storeA.saveSettings({ ...DEFAULT_SETTINGS, issueProjectKey: 'PROJ_A' });
    const settingsB = await storeB.getSettings();
    expect(settingsB.issueProjectKey).toBe(DEFAULT_SETTINGS.issueProjectKey);
    expect(settingsB.issueProjectKey).not.toBe('PROJ_A');
  });

  it('a saved setting does not leak into a fresh store', async () => {
    const storeA = new MemoryStore();
    await storeA.saveSettings({ ...DEFAULT_SETTINGS, universalKey: 'key-a' });
    const fresh = new MemoryStore();
    expect((await fresh.getSettings()).universalKey).toBeUndefined();
  });
});

describe('isolation — occurrence identity is workspace+repo scoped', () => {
  it('the same step in two workspaces yields two distinct occurrence ids', () => {
    const acme = occurrenceIdFor(makePayload({ workspace: 'acme' }), 0);
    const globex = occurrenceIdFor(makePayload({ workspace: 'globex' }), 0);
    expect(acme).not.toBe(globex);
  });

  it('the same step in two repositories yields two distinct occurrence ids', () => {
    const payments = occurrenceIdFor(makePayload({ repository: 'payments' }), 0);
    const billing = occurrenceIdFor(makePayload({ repository: 'billing' }), 0);
    expect(payments).not.toBe(billing);
  });

  it('a replayed message for one repo cannot collide with another repo', () => {
    const a = occurrenceIdFor(makePayload({ workspace: 'acme', repository: 'payments' }), 0);
    const b = occurrenceIdFor(makePayload({ workspace: 'globex', repository: 'payments' }), 0);
    expect(a).not.toBe(b);
  });
});

describe('isolation — KNOWN HOLE: the PR-card read is not workspace-scoped', () => {
  it('characterizes the current scope: repo + branch only', () => {
    const stmt = selectLatestOccurrence('payments', 'main');
    // The read scopes by repo and branch, and by nothing else.
    expect(stmt.text).not.toContain('workspace');
    expect(stmt.params).toEqual(['payments', 'main']);
  });

  // Explicit expected-failure (not a silent skip): the read SHOULD also scope
  // by workspace so that two paired workspaces owning a repo of the same name
  // cannot surface each other's latest occurrence. It does not today, so this
  // assertion fails — `it.fails` records that as a known, intentional red.
  it.fails('the PR-card read should also scope by workspace', () => {
    const stmt = selectLatestOccurrence('payments', 'main');
    expect(stmt.text).toContain('workspace = ?');
  });
});
