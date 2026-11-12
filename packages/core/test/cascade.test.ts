/**
 * Cascade detection: one infrastructure event must not open one ticket per
 * family. The root outbreak defines the window; the families that fall inside
 * it across several repositories are its twins.
 */

import { describe, expect, it } from 'vitest';

import { detectCascade } from '../src/cascade.js';
import { makeOccurrence } from './fakes/lot-b-fixtures.js';

/** A root family failing in three repositories inside twelve minutes. */
const ROOT = [
  makeOccurrence({ id: 'r1', repo: 'api', familyId: 'fam-root', occurredAt: '2026-11-10T09:00:00.000Z' }),
  makeOccurrence({ id: 'r2', repo: 'web', familyId: 'fam-root', occurredAt: '2026-11-10T09:02:00.000Z' }),
  makeOccurrence({ id: 'r3', repo: 'mobile', familyId: 'fam-root', occurredAt: '2026-11-10T09:04:00.000Z' }),
];

describe('detectCascade', () => {
  it('groups the families that fall together inside the root window', () => {
    const occs = [
      ...ROOT,
      makeOccurrence({ id: 't1', repo: 'api', familyId: 'fam-twin', occurredAt: '2026-11-10T09:01:00.000Z' }),
      makeOccurrence({ id: 't2', repo: 'web', familyId: 'fam-twin', occurredAt: '2026-11-10T09:03:00.000Z' }),
    ];

    const cascade = detectCascade(occs);

    expect(cascade).toBeDefined();
    expect(cascade?.rootFamilyId).toBe('fam-root');
    expect(cascade?.familyIds).toEqual(['fam-root', 'fam-twin']);
    expect(cascade?.repoCount).toBe(3);
    expect(cascade?.windowMinutes).toBe(4);
  });

  it('returns nothing when no family reaches the outbreak thresholds', () => {
    const occs = [
      makeOccurrence({ id: 'a1', repo: 'api', familyId: 'fam-x', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'a2', repo: 'web', familyId: 'fam-x', occurredAt: '2026-11-10T09:02:00.000Z' }),
      makeOccurrence({ id: 'a3', repo: 'api', familyId: 'fam-y', occurredAt: '2026-11-10T09:03:00.000Z' }),
    ];

    expect(detectCascade(occs)).toBeUndefined();
  });

  it('returns nothing on an empty history', () => {
    expect(detectCascade([])).toBeUndefined();
  });

  it('leaves out a family that failed in a single repository', () => {
    const occs = [
      ...ROOT,
      makeOccurrence({ id: 's1', repo: 'api', familyId: 'fam-solo', occurredAt: '2026-11-10T09:05:00.000Z' }),
    ];

    const cascade = detectCascade(occs);

    expect(cascade?.familyIds).toEqual(['fam-root']);
    expect(cascade?.repoCount).toBe(3);
  });

  it('leaves out a family that failed after the window closed', () => {
    const occs = [
      ...ROOT,
      makeOccurrence({ id: 'l1', repo: 'api', familyId: 'fam-late', occurredAt: '2026-11-10T09:20:00.000Z' }),
      makeOccurrence({ id: 'l2', repo: 'web', familyId: 'fam-late', occurredAt: '2026-11-10T09:21:00.000Z' }),
    ];

    const cascade = detectCascade(occs);

    expect(cascade?.familyIds).toEqual(['fam-root']);
  });

  it('counts every repository of the whole group, not only the root ones', () => {
    const occs = [
      ...ROOT,
      makeOccurrence({ id: 't1', repo: 'billing', familyId: 'fam-twin', occurredAt: '2026-11-10T09:01:00.000Z' }),
      makeOccurrence({ id: 't2', repo: 'search', familyId: 'fam-twin', occurredAt: '2026-11-10T09:03:00.000Z' }),
    ];

    const cascade = detectCascade(occs);

    expect(cascade?.familyIds).toEqual(['fam-root', 'fam-twin']);
    expect(cascade?.repoCount).toBe(5);
  });

  it('honours custom outbreak thresholds', () => {
    const occs = [
      makeOccurrence({ id: 'c1', repo: 'api', familyId: 'fam-c', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'c2', repo: 'web', familyId: 'fam-c', occurredAt: '2026-11-10T09:01:00.000Z' }),
      makeOccurrence({ id: 'c3', repo: 'api', familyId: 'fam-d', occurredAt: '2026-11-10T09:02:00.000Z' }),
      makeOccurrence({ id: 'c4', repo: 'web', familyId: 'fam-d', occurredAt: '2026-11-10T09:03:00.000Z' }),
    ];

    const cascade = detectCascade(occs, { settings: { outbreakRepos: 2, outbreakWindowMin: 10 } });

    expect(cascade?.familyIds).toEqual(['fam-c', 'fam-d']);
    expect(cascade?.repoCount).toBe(2);
    expect(cascade?.windowMinutes).toBe(3);
  });

  it('returns nothing when the window is too short to hold the root outbreak', () => {
    const occs = [...ROOT];

    expect(detectCascade(occs, { settings: { outbreakWindowMin: 1 } })).toBeUndefined();
  });

  it('names the root family even when several families qualify', () => {
    const occs = [
      ...ROOT,
      makeOccurrence({ id: 't1', repo: 'api', familyId: 'aaa-twin', occurredAt: '2026-11-10T09:01:00.000Z' }),
      makeOccurrence({ id: 't2', repo: 'web', familyId: 'aaa-twin', occurredAt: '2026-11-10T09:03:00.000Z' }),
    ];

    const cascade = detectCascade(occs);

    expect(cascade?.rootFamilyId).toBe('fam-root');
    expect(cascade?.familyIds).toEqual(['aaa-twin', 'fam-root']);
  });
});