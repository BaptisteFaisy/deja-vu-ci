import { describe, expect, it } from 'vitest';
import type { Occurrence, Signature } from '../src/types.js';
import { computeCost } from '../src/cost.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');

function occurrence(index: number, overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: `occ-${index}`,
    signatureId: 'sig-abc',
    familyId: 'fam-abc',
    workspace: 'ws',
    repo: 'demo',
    branch: 'main',
    commit: `commit-${index}`,
    author: 'alice',
    stepName: 'test',
    durationS: 300,
    occurredAt: '2026-11-10T08:00:00.000Z',
    passedOnRetry: false,
    ...overrides,
  };
}

describe('computeCost', () => {
  it('computes the cost of 17 occurrences of 300 s with 4 authors', () => {
    const authors = ['alice', 'bob', 'carol', 'dave'];
    const occs = Array.from({ length: 17 }, (_, i) =>
      occurrence(i, { author: authors[i % authors.length] }),
    );
    const report = computeCost(occs, { now: NOW });
    expect(report.redBuilds).toBe(17);
    expect(report.ciMinutesLost).toBe(85);
    expect(report.peopleAffected).toBe(4);
    expect(report.retries).toBe(0);
    expect(report.windowDays).toBe(30);
  });

  it('counts the relaunch in the lost minutes and in the retries', () => {
    const occs = [
      occurrence(1, { durationS: 60, passedOnRetry: true }),
      occurrence(2, { durationS: 60, passedOnRetry: false }),
    ];
    const report = computeCost(occs, { now: NOW });
    expect(report.retries).toBe(1);
    // 60 s of red build + 60 s of estimated relaunch.
    expect(report.ciMinutesLost).toBe(3);
  });

  it('ignores the occurrences outside the window', () => {
    const occs = [
      occurrence(1, { occurredAt: '2026-10-01T08:00:00.000Z' }),
      occurrence(2, { occurredAt: '2026-11-10T08:00:00.000Z' }),
    ];
    const report = computeCost(occs, { now: NOW, windowDays: 30 });
    expect(report.redBuilds).toBe(1);
  });

  it('details the cost per signature, most expensive first', () => {
    const occs = [
      ...Array.from({ length: 5 }, (_, i) =>
        occurrence(i, { signatureId: 'sig-cheap', durationS: 60 }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        occurrence(100 + i, { signatureId: 'sig-costly', durationS: 600 }),
      ),
    ];
    const report = computeCost(occs, { now: NOW });
    expect(report.perSignature.map((s) => s.signatureId)).toEqual([
      'sig-costly',
      'sig-cheap',
    ]);
    expect(report.perSignature[0].ciMinutesLost).toBe(20);
    expect(report.perSignature[0].occurrences).toBe(2);
    expect(report.perSignature[1].ciMinutesLost).toBe(5);
  });

  it('gives a readable title from the known signatures', () => {
    const signatures: Signature[] = [
      {
        id: 'sig-abc',
        familyId: 'fam-abc',
        category: 'test',
        errorType: 'AssertionError',
        template: 'expected true to be false',
        frames: [],
        status: 'flaky',
        firstSeen: '2026-11-01T08:00:00.000Z',
        lastSeen: '2026-11-10T08:00:00.000Z',
        occurrences: 1,
        testName: 'checkout.test_total',
      },
    ];
    const report = computeCost([occurrence(1)], { now: NOW, signatures });
    expect(report.perSignature[0].title).toBe('checkout.test_total');
    expect(report.perSignature[0].signatureShort).toMatch(/^S-\d{3}$/);
  });

  it('counts distinct people only', () => {
    const occs = [
      occurrence(1, { author: 'alice' }),
      occurrence(2, { author: 'alice' }),
      occurrence(3, { author: 'bob' }),
    ];
    expect(computeCost(occs, { now: NOW }).peopleAffected).toBe(2);
  });

  it('reports an empty window without failing', () => {
    const report = computeCost([], { now: NOW });
    expect(report.redBuilds).toBe(0);
    expect(report.ciMinutesLost).toBe(0);
    expect(report.perSignature).toHaveLength(0);
  });
});
