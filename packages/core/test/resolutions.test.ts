import { describe, expect, it } from 'vitest';
import type { Occurrence, Signature } from '../src/types.js';
import { detectRegression, inferCandidateResolution } from '../src/resolutions.js';

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: 'occ-1',
    signatureId: 'sig-abc',
    familyId: 'fam-abc',
    workspace: 'ws',
    repo: 'demo',
    branch: 'main',
    commit: 'aaaaaaa',
    author: 'alice',
    stepName: 'test',
    durationS: 300,
    occurredAt: '2026-11-01T10:00:00.000Z',
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
    template: 'expected true to be false',
    frames: [],
    status: 'known',
    firstSeen: '2026-11-01T10:00:00.000Z',
    lastSeen: '2026-11-01T10:00:00.000Z',
    occurrences: 1,
    ...overrides,
  };
}

describe('inferCandidateResolution', () => {
  it('returns undefined when the window holds no commit', () => {
    const result = inferCandidateResolution({
      signatureId: 'sig-abc',
      history: [occurrence()],
      commitsBetween: [],
    });
    expect(result).toBeUndefined();
  });

  it('prioritises the commit touching a file of the stack', () => {
    const history = [
      occurrence({ id: 'o1', commit: 'bad1111', changedFiles: ['src/app.ts'] }),
      occurrence({
        id: 'o2',
        commit: 'good222',
        occurredAt: '2026-11-01T11:00:00.000Z',
        passedOnRetry: true,
      }),
    ];
    const result = inferCandidateResolution({
      signatureId: 'sig-abc',
      history,
      commitsBetween: [
        { sha: 'ccc3333', author: 'bob', files: ['docs/readme.md'], message: 'docs only' },
        { sha: 'fix4444', author: 'bob', files: ['src/app.ts'], message: 'fix the assertion' },
      ],
    });
    expect(result).toBeDefined();
    expect(result?.commit).toBe('fix4444');
    expect(result?.author).toBe('bob');
    expect(result?.files).toEqual(['src/app.ts']);
    expect(result?.signatureId).toBe('sig-abc');
  });

  it('keeps the confidence low until a human confirms', () => {
    const result = inferCandidateResolution({
      signatureId: 'sig-abc',
      history: [occurrence({ changedFiles: ['src/app.ts'] })],
      commitsBetween: [
        { sha: 'fix4444', author: 'bob', files: ['src/app.ts'], message: 'fix it' },
      ],
      linkedIssueKey: 'CI-12',
    });
    expect(result?.confidence).toBeLessThan(0.6);
    expect(result?.confidence).toBeGreaterThan(0);
    expect(result?.confirmedBy).toBeUndefined();
  });

  it('prefers a commit citing the linked issue when nothing else stands out', () => {
    const result = inferCandidateResolution({
      signatureId: 'sig-abc',
      history: [occurrence()],
      commitsBetween: [
        { sha: 'aaa1111', author: 'bob', files: ['docs/readme.md'], message: 'unrelated work' },
        { sha: 'bbb2222', author: 'bob', files: ['docs/other.md'], message: 'revert CI-12 attempt' },
      ],
      linkedIssueKey: 'CI-12',
    });
    expect(result?.commit).toBe('bbb2222');
  });

  it('truncates the commit message cleanly', () => {
    const message = `fix the flaky assertion ${'x'.repeat(200)}`;
    const result = inferCandidateResolution({
      signatureId: 'sig-abc',
      history: [occurrence()],
      commitsBetween: [{ sha: 'fix4444', author: 'bob', files: [], message }],
    });
    expect(result?.note).toBeDefined();
    expect(result?.note!.length).toBeLessThanOrEqual(123);
    expect(result?.note).not.toContain('\n');
  });

  it('never proposes the commit that was already failing', () => {
    const result = inferCandidateResolution({
      signatureId: 'sig-abc',
      history: [occurrence({ commit: 'aaaaaaa' })],
      commitsBetween: [
        { sha: 'aaaaaaa', author: 'alice', files: [], message: 'the failing commit' },
      ],
    });
    expect(result).toBeUndefined();
  });
});

describe('detectRegression', () => {
  const resolved = signature({
    status: 'resolved',
    lastSeen: '2026-11-01T10:00:00.000Z',
  });

  it('detects a resolved signature that comes back', () => {
    const back = occurrence({
      occurredAt: '2026-11-20T10:00:00.000Z',
      commit: 'dddd444',
    });
    expect(detectRegression(resolved, back)).toBe(true);
  });

  it('ignores a signature that was not resolved', () => {
    const known = signature({ status: 'known' });
    const back = occurrence({ occurredAt: '2026-11-20T10:00:00.000Z' });
    expect(detectRegression(known, back)).toBe(false);
  });

  it('uses the confirmation date of the resolution when known', () => {
    const resolution = {
      id: 'res-1',
      signatureId: 'sig-abc',
      commit: 'fix4444',
      author: 'bob',
      files: [],
      confidence: 0.9,
      confirmedBy: 'bob',
      confirmedAt: '2026-11-15T08:00:00.000Z',
    };
    const before = occurrence({ occurredAt: '2026-11-10T10:00:00.000Z' });
    const after = occurrence({ occurredAt: '2026-11-18T10:00:00.000Z' });
    expect(detectRegression(resolved, before, resolution)).toBe(false);
    expect(detectRegression(resolved, after, resolution)).toBe(true);
  });

  it('ignores an occurrence of another signature', () => {
    const other = occurrence({
      signatureId: 'sig-xyz',
      occurredAt: '2026-11-20T10:00:00.000Z',
    });
    expect(detectRegression(resolved, other)).toBe(false);
  });
});
