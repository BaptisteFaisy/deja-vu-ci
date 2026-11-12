/**
 * Tests of the incident panel assembly (`src/pure/incident.ts`, CI-15).
 *
 * The outbreak itself is the engine's (`detectOutbreak`): what is verified here
 * is the panel the project page shows — the repositories, the window, the start,
 * the single ticket of the family — and the explicit absence of a panel when no
 * family reaches the thresholds.
 */

import { describe, expect, it } from 'vitest';
import type { Occurrence, Outbreak, Signature } from '@dejavu/core';
import {
  assembleIncident,
  groupByFamily,
  incidentOccurrences,
  isStronger,
  ticketSignature,
  type IncidentPanel,
  type IncidentReadStore,
} from '../src/pure/incident';
import { DEFAULT_SETTINGS } from '../src/pure/defaults';

const NOW = new Date('2026-11-12T10:00:00.000Z');

function occurrence(id: string, repo: string, occurredAt: string, over: Partial<Occurrence> = {}): Occurrence {
  return {
    id,
    signatureId: 'sig-1',
    familyId: 'fam-1',
    workspace: 'acme',
    repo,
    branch: 'main',
    commit: 'a'.repeat(40),
    author: 'marie',
    stepName: 'test',
    durationS: 60,
    occurredAt,
    passedOnRetry: false,
    ...over,
  };
}

function signature(over: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-1',
    familyId: 'fam-1',
    category: 'dependency',
    errorType: 'ENOTFOUND',
    template: 'getaddrinfo ENOTFOUND registry.internal',
    frames: [],
    status: 'new',
    firstSeen: '2026-11-12T09:50:00.000Z',
    lastSeen: '2026-11-12T09:58:00.000Z',
    occurrences: 3,
    ...over,
  };
}

/** Three repositories inside the detection window: an outbreak. */
const OUTBREAK_OCCURRENCES: Occurrence[] = [
  occurrence('o1', 'payments', '2026-11-12T09:50:00.000Z'),
  occurrence('o2', 'billing', '2026-11-12T09:55:00.000Z'),
  occurrence('o3', 'search', '2026-11-12T09:58:00.000Z'),
];

/** Two repositories only: below the `outbreakRepos` threshold. */
const TOO_FEW_REPOS: Occurrence[] = [
  occurrence('o1', 'payments', '2026-11-12T09:50:00.000Z'),
  occurrence('o2', 'billing', '2026-11-12T09:55:00.000Z'),
];

function fakeStore(signatures: Signature[], outbreaks: Outbreak[] = []): IncidentReadStore {
  return {
    async findSignaturesByFamily(familyId: string) {
      return signatures.filter((s) => s.familyId === familyId);
    },
    async findOutbreak(familyId: string) {
      return outbreaks.find((o) => o.familyId === familyId);
    },
  };
}

const shortId = (id: string): string => `S-${id.slice(-3)}`;

describe('assembleIncident', () => {
  it('builds the panel of a running outbreak', async () => {
    const store = fakeStore([signature({ issueKey: 'CI-7' })]);
    const panel = await assembleIncident(store, OUTBREAK_OCCURRENCES, DEFAULT_SETTINGS, NOW, shortId);
    expect(panel).toBeDefined();
    expect(panel?.familyId).toBe('fam-1');
    expect(panel?.repos).toEqual(['billing', 'payments', 'search']);
    expect(panel?.startedAt).toBe('2026-11-12T09:50:00.000Z');
    expect(panel?.windowMinutes).toBe(DEFAULT_SETTINGS.outbreakWindowMin);
    expect(panel?.occurrences).toBe(3);
    expect(panel?.issueKey).toBe('CI-7');
    expect(panel?.signatureShort).toBe('S-g-1');
  });

  it('shows nothing when no family reaches the thresholds', async () => {
    const store = fakeStore([signature()]);
    const panel = await assembleIncident(store, TOO_FEW_REPOS, DEFAULT_SETTINGS, NOW, shortId);
    expect(panel).toBeUndefined();
  });

  it('shows nothing when the memory is empty', async () => {
    const panel = await assembleIncident(fakeStore([]), [], DEFAULT_SETTINGS, NOW, shortId);
    expect(panel).toBeUndefined();
  });

  it('prefers the incident key the memory recorded over the ticket of the family', async () => {
    const stored: Outbreak = {
      id: 'ob-1',
      familyId: 'fam-1',
      startedAt: '2026-11-12T09:50:00.000Z',
      repos: ['billing', 'payments', 'search'],
      incidentKey: 'INC-1',
    };
    const panel = await assembleIncident(
      fakeStore([signature({ issueKey: 'CI-7' })], [stored]),
      OUTBREAK_OCCURRENCES,
      DEFAULT_SETTINGS,
      NOW,
      shortId,
    );
    expect(panel?.issueKey).toBe('INC-1');
  });

  it('keeps the strongest incident when several families break at once', async () => {
    const wide = OUTBREAK_OCCURRENCES.map((o) => ({ ...o }));
    const narrow: Occurrence[] = [
      occurrence('n1', 'alpha', '2026-11-12T09:51:00.000Z', { familyId: 'fam-2', signatureId: 'sig-2' }),
      occurrence('n2', 'beta', '2026-11-12T09:52:00.000Z', { familyId: 'fam-2', signatureId: 'sig-2' }),
      occurrence('n3', 'gamma', '2026-11-12T09:53:00.000Z', { familyId: 'fam-2', signatureId: 'sig-2' }),
    ];
    const store = fakeStore([signature(), signature({ id: 'sig-2', familyId: 'fam-2' })]);
    const panel = await assembleIncident(store, [...wide, ...narrow], DEFAULT_SETTINGS, NOW, shortId);
    // Both incidents hit three repositories: the earliest start wins.
    expect(panel?.familyId).toBe('fam-1');
  });
});

describe('the panel helpers', () => {
  it('groups the occurrences by family', () => {
    const groups = groupByFamily([
      ...OUTBREAK_OCCURRENCES,
      occurrence('n1', 'alpha', '2026-11-12T09:51:00.000Z', { familyId: 'fam-2' }),
    ]);
    expect([...groups.keys()].sort()).toEqual(['fam-1', 'fam-2']);
    expect(groups.get('fam-1')).toHaveLength(3);
  });

  it('keeps only the failures inside the detection window', () => {
    const outside = occurrence('o9', 'late', '2026-11-12T11:00:00.000Z');
    const inside = incidentOccurrences(
      [...OUTBREAK_OCCURRENCES, outside],
      '2026-11-12T09:50:00.000Z',
      15,
    );
    expect(inside.map((o) => o.id)).toEqual(['o1', 'o2', 'o3']);
  });

  it('ranks an incident by repositories, then by start', () => {
    const base: IncidentPanel = {
      familyId: 'a',
      signatureId: 'a',
      signatureShort: 'S-a',
      repos: ['one', 'two', 'three'],
      startedAt: '2026-11-12T09:50:00.000Z',
      lastSeenAt: '2026-11-12T09:58:00.000Z',
      windowMinutes: 15,
      occurrences: 3,
    };
    const wider = { ...base, repos: ['a', 'b', 'c', 'd'] };
    const earlier = { ...base, startedAt: '2026-11-12T09:40:00.000Z' };
    expect(isStronger(wider, base)).toBe(true);
    expect(isStronger(base, wider)).toBe(false);
    expect(isStronger(earlier, base)).toBe(true);
    expect(isStronger(base, earlier)).toBe(false);
  });

  it('picks the signature that carries the ticket, most occurrences first', () => {
    const without = signature({ id: 'sig-a', issueKey: undefined, occurrences: 9 });
    const withTicket = signature({ id: 'sig-b', issueKey: 'CI-9', occurrences: 2 });
    expect(ticketSignature([without, withTicket])?.id).toBe('sig-b');
    expect(ticketSignature([without])?.id).toBe('sig-a');
    expect(ticketSignature([])).toBeUndefined();
  });
});
