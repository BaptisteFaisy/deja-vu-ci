/**
 * Ancestor comparison — specification § 10.2: "already seen, already
 * fixed" needs to know whether the current branch contains the commit that
 * fixed the signature.
 */

import { describe, expect, it } from 'vitest';
import { containsCommit, MAX_ANCESTOR_DEPTH, toContainsResolution, type CommitReader } from '../src/ancestry.js';

/** Builds a reader over a small history graph. */
function readerOf(graph: Record<string, string[]>): CommitReader {
  return async (sha: string) => {
    const parents = graph[sha];
    return parents ? { parents } : undefined;
  };
}

/** A linear history: head → c1 → c2 → root. */
const LINEAR: Record<string, string[]> = {
  head: ['c1'],
  c1: ['c2'],
  c2: ['root'],
  root: [],
};

describe('containsCommit', () => {
  it('says the branch contains an ancestor commit', async () => {
    const verdict = await containsCommit('head', 'c2', readerOf(LINEAR));
    expect(verdict).toEqual({ commit: 'c2', contains: true, unknown: false });
  });

  it('says the branch is the commit itself', async () => {
    const verdict = await containsCommit('head', 'head', readerOf(LINEAR));
    expect(verdict.contains).toBe(true);
    expect(verdict.unknown).toBe(false);
  });

  it('says the branch does not contain an unknown commit', async () => {
    const verdict = await containsCommit('head', 'elsewhere', readerOf(LINEAR));
    expect(verdict).toEqual({ commit: 'elsewhere', contains: false, unknown: false });
  });

  it('follows both parents of a merge commit', async () => {
    const graph = { head: ['left', 'right'], left: ['root'], right: ['target'], root: [], target: [] };
    const verdict = await containsCommit('head', 'target', readerOf(graph));
    expect(verdict.contains).toBe(true);
  });

  it('answers "unknown" when the history cannot be read', async () => {
    const verdict = await containsCommit('head', 'c2', async () => undefined);
    expect(verdict.unknown).toBe(true);
    expect(verdict.contains).toBe(false);
  });

  it('answers "unknown" when the arguments are missing', async () => {
    expect((await containsCommit('', 'c2', readerOf(LINEAR))).unknown).toBe(true);
    expect((await containsCommit('head', '', readerOf(LINEAR))).unknown).toBe(true);
  });

  it('stops after the bounded depth instead of walking forever', async () => {
    const graph: Record<string, string[]> = {};
    for (let i = 0; i < 30; i += 1) graph[`c${i}`] = [`c${i + 1}`];
    graph.c30 = [];
    let calls = 0;
    const reader: CommitReader = async (sha) => {
      calls += 1;
      return graph[sha] ? { parents: graph[sha] } : undefined;
    };
    const verdict = await containsCommit('c0', 'c30', reader, 10);
    expect(verdict.contains).toBe(false);
    expect(verdict.unknown).toBe(true);
    expect(calls).toBeLessThanOrEqual(11);
  });

  it('survives a cycle in the history', async () => {
    const cyclic = { a: ['b'], b: ['a'] };
    const verdict = await containsCommit('a', 'nope', readerOf(cyclic), 50);
    expect(verdict.contains).toBe(false);
    expect(verdict.unknown).toBe(false);
  });

  it('declares a sane default depth', () => {
    expect(MAX_ANCESTOR_DEPTH).toBe(200);
  });
});

describe('toContainsResolution', () => {
  it('omits the field when the comparison is inconclusive', () => {
    expect(toContainsResolution({ commit: 'x', contains: false, unknown: true })).toBeUndefined();
  });

  it('reports the verdict when the comparison succeeded', () => {
    expect(toContainsResolution({ commit: 'x', contains: true, unknown: false })).toEqual({
      commit: 'x',
      contains: true,
    });
  });
});
