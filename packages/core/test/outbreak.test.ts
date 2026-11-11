import { describe, expect, it } from 'vitest';

import { detectOutbreak } from '../src/outbreak.js';
import { makeOccurrence } from './fakes/lot-b-fixtures.js';

describe('detectOutbreak', () => {
  it('detects the same family failing in three repositories within twelve minutes', () => {
    const occs = [
      makeOccurrence({ id: 'r1', repo: 'api', branch: 'main', commit: 'c1', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'r2', repo: 'web', branch: 'main', commit: 'c2', familyId: 'fam-x', occurredAt: '2026-11-10T09:06:00.000Z' }),
      makeOccurrence({ id: 'r3', repo: 'mobile', branch: 'main', commit: 'c3', familyId: 'fam-x', occurredAt: '2026-11-10T09:12:00.000Z' }),
    ];

    const outbreak = detectOutbreak(occs);

    expect(outbreak).toBeDefined();
    expect(outbreak?.familyId).toBe('fam-x');
    expect(outbreak?.repos).toEqual(['api', 'mobile', 'web']);
    expect(outbreak?.startedAt).toBe('2026-11-10T09:00:00.000Z');
  });

  it('does not fire when the repositories fail outside the time window', () => {
    const occs = [
      makeOccurrence({ id: 's1', repo: 'api', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 's2', repo: 'web', familyId: 'fam-x', occurredAt: '2026-11-10T09:06:00.000Z' }),
      makeOccurrence({ id: 's3', repo: 'mobile', familyId: 'fam-x', occurredAt: '2026-11-10T09:30:00.000Z' }),
    ];

    expect(detectOutbreak(occs)).toBeUndefined();
  });

  it('does not fire when two repositories are hit only', () => {
    const occs = [
      makeOccurrence({ id: 't1', repo: 'api', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 't2', repo: 'web', familyId: 'fam-x', occurredAt: '2026-11-10T09:02:00.000Z' }),
    ];

    expect(detectOutbreak(occs)).toBeUndefined();
  });

  it('keeps families apart', () => {
    const occs = [
      makeOccurrence({ id: 'u1', repo: 'api', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'u2', repo: 'web', familyId: 'fam-y', occurredAt: '2026-11-10T09:01:00.000Z' }),
      makeOccurrence({ id: 'u3', repo: 'mobile', familyId: 'fam-z', occurredAt: '2026-11-10T09:02:00.000Z' }),
    ];

    expect(detectOutbreak(occs)).toBeUndefined();
  });

  it('honours custom thresholds', () => {
    const occs = [
      makeOccurrence({ id: 'v1', repo: 'api', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'v2', repo: 'web', familyId: 'fam-x', occurredAt: '2026-11-10T09:02:00.000Z' }),
    ];

    const outbreak = detectOutbreak(occs, { settings: { outbreakRepos: 2, outbreakWindowMin: 15 } });

    expect(outbreak?.repos).toEqual(['api', 'web']);
  });

  it('returns the strongest outbreak when several families qualify', () => {
    const occs = [
      makeOccurrence({ id: 'w1', repo: 'api', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'w2', repo: 'web', familyId: 'fam-x', occurredAt: '2026-11-10T09:01:00.000Z' }),
      makeOccurrence({ id: 'w3', repo: 'api', familyId: 'fam-y', occurredAt: '2026-11-10T09:02:00.000Z' }),
      makeOccurrence({ id: 'w4', repo: 'web', familyId: 'fam-y', occurredAt: '2026-11-10T09:03:00.000Z' }),
      makeOccurrence({ id: 'w5', repo: 'mobile', familyId: 'fam-y', occurredAt: '2026-11-10T09:04:00.000Z' }),
    ];

    const outbreak = detectOutbreak(occs);

    expect(outbreak?.familyId).toBe('fam-y');
    expect(outbreak?.repos).toHaveLength(3);
  });
});
