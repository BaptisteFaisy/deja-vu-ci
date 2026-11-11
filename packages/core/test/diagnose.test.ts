import { describe, expect, it } from 'vitest';

import { diagnose } from '../src/diagnose.js';
import type { DiagnoseInput } from '../src/diagnose.js';
import { detectOutbreak } from '../src/outbreak.js';
import { makeFrame, makeOccurrence, makeResolution, makeSignature } from './fakes/lot-b-fixtures.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');

function baseContext(overrides: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    occurrence: makeOccurrence({ id: 'current', occurredAt: '2026-11-10T09:00:00.000Z' }),
    history: [],
    familyHistory: [],
    branchContainsResolution: false,
    changedFiles: [],
    now: NOW,
    ...overrides,
  };
}

describe('diagnose — flaky', () => {
  it('calls a test flaky after three branches failed then passed at the same commit', () => {
    const history = [
      makeOccurrence({ id: 'h1', branch: 'feature/a', commit: 'aaa1111', passedOnRetry: true, occurredAt: '2026-11-08T09:00:00.000Z' }),
      makeOccurrence({ id: 'h2', branch: 'feature/b', commit: 'bbb2222', passedOnRetry: true, occurredAt: '2026-11-08T11:00:00.000Z' }),
      makeOccurrence({ id: 'h3', branch: 'feature/c', commit: 'ccc3333', passedOnRetry: true, occurredAt: '2026-11-09T08:00:00.000Z' }),
    ];

    const diagnostic = diagnose(baseContext({ history }));

    expect(diagnostic.kind).toBe('flaky');
    expect(diagnostic.action).toBe('retry');
    expect(diagnostic.confidence).toBeGreaterThanOrEqual(0.75);
    expect(diagnostic.title.length).toBeLessThanOrEqual(90);
    expect(diagnostic.facts.length).toBeGreaterThanOrEqual(1);
    expect(diagnostic.summary).toContain('4 times');
    expect(diagnostic.summary).toContain('4 branches');
    expect(diagnostic.evidence?.length).toBeGreaterThan(0);
    expect(diagnostic.stats?.branches).toBe(4);
  });

  it('gives one signature, hence one ticket, for the three flaky branches', () => {
    const history = [
      makeOccurrence({ id: 'h1', branch: 'feature/a', commit: 'aaa1111', passedOnRetry: true, occurredAt: '2026-11-08T09:00:00.000Z' }),
      makeOccurrence({ id: 'h2', branch: 'feature/b', commit: 'bbb2222', passedOnRetry: true, occurredAt: '2026-11-08T11:00:00.000Z' }),
      makeOccurrence({ id: 'h3', branch: 'feature/c', commit: 'ccc3333', passedOnRetry: true, occurredAt: '2026-11-09T08:00:00.000Z' }),
    ];

    const branches = ['feature/a', 'feature/b', 'feature/c'];
    const kinds = branches.map(
      (branch) =>
        diagnose(
          baseContext({
            occurrence: makeOccurrence({ id: `now-${branch}`, branch, commit: 'ddd4444', occurredAt: '2026-11-10T09:00:00.000Z' }),
            history,
          }),
        ).kind,
    );

    expect(new Set(kinds)).toEqual(new Set(['flaky']));
  });

  it('never calls a test broken everywhere on main flaky', () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      makeOccurrence({
        id: `broken-${index}`,
        branch: 'main',
        commit: `dead${index}`,
        passedOnRetry: false,
        occurredAt: `2026-11-0${(index % 9) + 1}T10:00:00.000Z`,
      }),
    );

    const diagnostic = diagnose(baseContext({ history }));

    expect(diagnostic.kind).not.toBe('flaky');
    expect(diagnostic.action).not.toBe('retry');
  });
});

describe('diagnose — already fixed', () => {
  it('cites the fix commit and its author when the branch does not contain it', () => {
    const resolution = makeResolution({
      commit: 'abc1234def5678',
      author: 'marie',
      note: 'update of the http client',
      files: ['src/client.ts'],
      confirmedBy: 'marie',
    });

    const diagnostic = diagnose(
      baseContext({
        history: [makeOccurrence({ id: 'old', branch: 'main', occurredAt: '2026-11-03T10:00:00.000Z' })],
        resolution,
        branchContainsResolution: false,
      }),
    );

    expect(diagnostic.kind).toBe('already-fixed');
    expect(diagnostic.action).toBe('rebase');
    expect(diagnostic.resolution?.commit).toBe('abc1234def5678');
    expect(diagnostic.resolution?.author).toBe('marie');
    expect(diagnostic.resolution?.confirmed).toBe(true);
    expect(diagnostic.summary).toContain('marie');
    expect(diagnostic.summary).toContain('abc1234');
    expect(diagnostic.facts.map((fact) => fact.value).join(' ')).toContain('marie');
  });

  it('does not claim a fix the branch already contains', () => {
    const resolution = makeResolution({ commit: 'abc1234def5678', author: 'marie' });

    const diagnostic = diagnose(
      baseContext({
        history: [makeOccurrence({ id: 'old', branch: 'main', occurredAt: '2026-11-03T10:00:00.000Z' })],
        resolution,
        branchContainsResolution: true,
      }),
    );

    expect(diagnostic.kind).toBe('uncertain');
  });
});

describe('diagnose — infrastructure', () => {
  it('calls a package registry error infrastructure', () => {
    const diagnostic = diagnose(
      baseContext({
        category: 'dependency',
        errorText: 'npm ERR! code E404 registry.npmjs.org returned 404 for package @acme/http',
      }),
    );

    expect(diagnostic.kind).toBe('infrastructure');
    expect(diagnostic.action).toBe('wait');
    expect(diagnostic.confidence).toBeGreaterThanOrEqual(0.75);
    expect(diagnostic.summary.length).toBeGreaterThan(0);
  });

  it('calls an outbreak infrastructure and names the repositories', () => {
    const occs = [
      makeOccurrence({ id: 'r1', repo: 'api', branch: 'main', commit: 'c1', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'r2', repo: 'web', branch: 'main', commit: 'c2', familyId: 'fam-x', occurredAt: '2026-11-10T09:06:00.000Z' }),
      makeOccurrence({ id: 'r3', repo: 'mobile', branch: 'main', commit: 'c3', familyId: 'fam-x', occurredAt: '2026-11-10T09:12:00.000Z' }),
    ];
    const outbreak = detectOutbreak(occs, { now: NOW });

    const diagnostic = diagnose(
      baseContext({
        occurrence: occs[0],
        outbreak,
        errorText: 'npm ERR! registry.npmjs.org unreachable',
      }),
    );

    expect(outbreak).toBeDefined();
    expect(diagnostic.kind).toBe('infrastructure');
    expect(diagnostic.summary).toContain('api');
    expect(diagnostic.summary).toContain('web');
    expect(diagnostic.summary).toContain('mobile');
    expect(diagnostic.facts.map((fact) => fact.value).join(' ')).toContain('api, mobile, web');
  });
});

describe('diagnose — new', () => {
  it('calls an unseen error new and points at the files of the pull request in the stack', () => {
    const diagnostic = diagnose(
      baseContext({
        occurrence: makeOccurrence({ id: 'brand-new', stepName: 'unit-tests', changedFiles: ['src/refund/Limiter.java'] }),
        changedFiles: ['src/refund/Limiter.java', 'README.md'],
        frames: [makeFrame('src/refund/Limiter.java', 42)],
        signature: makeSignature({ frames: [makeFrame('src/refund/Limiter.java', 42)] }),
      }),
    );

    expect(diagnostic.kind).toBe('new');
    expect(diagnostic.action).toBe('fix');
    expect(diagnostic.suspects).toEqual(['src/refund/Limiter.java']);
    expect(diagnostic.confidence).toBeGreaterThanOrEqual(0.75);
    expect(diagnostic.summary).toContain('src/refund/Limiter.java');
  });

  it('is uncertain once the family was seen before', () => {
    const diagnostic = diagnose(
      baseContext({
        familyHistory: [makeOccurrence({ id: 'family-1', branch: 'main', occurredAt: '2026-11-02T10:00:00.000Z' })],
        frames: [makeFrame('src/refund/Limiter.java', 42)],
      }),
    );

    expect(diagnostic.kind).toBe('uncertain');
    expect(diagnostic.action).toBe('none');
  });
});

describe('diagnose — uncertain', () => {
  it('stays uncertain on a signature seen once and never excuses the pull request', () => {
    const diagnostic = diagnose(
      baseContext({
        history: [makeOccurrence({ id: 'once', branch: 'main', commit: 'old1', occurredAt: '2026-11-04T10:00:00.000Z' })],
      }),
    );

    expect(diagnostic.kind).toBe('uncertain');
    expect(diagnostic.action).toBe('none');
    expect(diagnostic.summary.toLowerCase()).not.toContain('unrelated');
    expect(diagnostic.summary.toLowerCase()).not.toContain('not related');
    expect(diagnostic.facts.length).toBeGreaterThanOrEqual(1);
    expect(diagnostic.title.length).toBeLessThanOrEqual(90);
  });

  it('turns an excusing verdict into uncertain below the prudence threshold', () => {
    const history = [
      makeOccurrence({ id: 'h1', branch: 'feature/a', commit: 'aaa1111', passedOnRetry: true, occurredAt: '2026-11-08T09:00:00.000Z' }),
      makeOccurrence({ id: 'h2', branch: 'feature/b', commit: 'bbb2222', passedOnRetry: true, occurredAt: '2026-11-08T11:00:00.000Z' }),
      makeOccurrence({ id: 'h3', branch: 'feature/c', commit: 'ccc3333', passedOnRetry: true, occurredAt: '2026-11-09T08:00:00.000Z' }),
    ];

    const diagnostic = diagnose(
      baseContext({ history, settings: { minConfidenceNotYourFault: 0.99 } }),
    );

    expect(diagnostic.kind).toBe('uncertain');
    expect(diagnostic.action).toBe('none');
    expect(diagnostic.facts.length).toBeGreaterThanOrEqual(1);
    expect(diagnostic.evidence?.length).toBeGreaterThan(0);
  });
});
