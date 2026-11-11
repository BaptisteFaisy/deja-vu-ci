import { describe, expect, it } from 'vitest';
import type { Occurrence, Signature, SignatureStatus } from '../src/types.js';
import { normalizeMessage } from '../src/normalize.js';
import {
  mergeSignatures,
  splitSignature,
  suggestNormalizationRule,
  type SplitCriterion,
} from '../src/curate.js';

/** Apply a suggested rule the way the normalizer table would. */
function applyRule(text: string, rule: { pattern: string; replacement: string }): string {
  return text.replace(new RegExp(rule.pattern, 'g'), rule.replacement);
}

function signature(overrides: Partial<Signature> = {}): Signature {
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

function occurrence(index: number, overrides: Partial<Occurrence> = {}): Occurrence {
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

describe('suggestNormalizationRule', () => {
  it('returns undefined when the two templates are already identical', () => {
    expect(suggestNormalizationRule('same template', 'same template')).toBeUndefined();
  });

  it('isolates a volatile short hex id that normalize.ts does not cover', () => {
    const a = 'shard a3f9c2 rejected the write';
    const b = 'shard b7e1d4 rejected the write';
    const rule = suggestNormalizationRule(a, b);
    expect(rule).toBeDefined();
    expect(rule!.token).toBe('a3f9c2');
    expect(rule!.replacement).toBe('<HEX>');
    expect(rule!.alreadyCovered).toBe(false);
    // Applying the suggested rule makes both templates identical.
    expect(applyRule(a, rule!)).toBe(applyRule(b, rule!));
    expect(applyRule(a, rule!)).toBe('shard <HEX> rejected the write');
  });

  it('flags a difference the existing table already covers (UUID)', () => {
    const a = 'task 550e8400-e29b-41d4-a716-446655440000 timed out';
    const b = 'task 6ba7b810-9dad-11d1-80b4-00c04fd430c8 timed out';
    const rule = suggestNormalizationRule(a, b)!;
    expect(rule.replacement).toBe('<UUID>');
    expect(rule.alreadyCovered).toBe(true);
    expect(rule.confidence).toBeGreaterThanOrEqual(0.95);
    // The normalizer alone already reconciles them.
    expect(normalizeMessage(a)).toBe(normalizeMessage(b));
  });

  it('classifies an isolated build number as <NUM>', () => {
    const rule = suggestNormalizationRule('build 4821 failed', 'build 4822 failed')!;
    expect(rule.token).toBe('4821');
    expect(rule.replacement).toBe('<NUM>');
    expect(rule.alreadyCovered).toBe(true);
  });

  it('classifies a 40-hex commit as <SHA> and a 12-hex run as <HEX>', () => {
    const sha = suggestNormalizationRule(
      'checkout 4f9a2c7b1d8e3a6f5c0b9d2e1a7f4c8b9e6d3a2c ok',
      'checkout 1111111111111111111111111111111111111111 ok',
    )!;
    expect(sha.replacement).toBe('<SHA>');
    const hex = suggestNormalizationRule('blob a3f9c2b7e1d4 bad', 'blob ffeeddccbbaa bad')!;
    expect(hex.replacement).toBe('<HEX>');
    expect(hex.alreadyCovered).toBe(true);
  });

  it('falls back to a bounded identifier rule for an opaque worker id', () => {
    const a = 'job build-worker-7f3a9c died';
    const b = 'job build-worker-2b8e1d died';
    const rule = suggestNormalizationRule(a, b)!;
    expect(rule.alreadyCovered).toBe(false);
    expect(rule.confidence).toBeLessThan(0.5);
    expect(rule.confidence).toBeGreaterThan(0);
    expect(applyRule(a, rule!)).toBe(applyRule(b, rule!));
  });

  it('handles templates that differ only by a trailing extra word', () => {
    const rule = suggestNormalizationRule('container exited', 'container exited 137')!;
    expect(rule.token).toBe('137');
    expect(rule.replacement).toBe('<NUM>');
  });
});

describe('mergeSignatures', () => {
  const kept = signature({
    id: 'sig-kept',
    familyId: 'fam-kept',
    status: 'known',
    firstSeen: '2026-11-05T08:00:00.000Z',
    lastSeen: '2026-11-09T08:00:00.000Z',
    occurrences: 4,
    issueKey: 'CI-42',
    template: 'shard a3f9c2 rejected the write',
  });
  const dropped = signature({
    id: 'sig-drop',
    familyId: 'fam-drop',
    status: 'flaky',
    firstSeen: '2026-11-02T08:00:00.000Z',
    lastSeen: '2026-11-10T08:00:00.000Z',
    occurrences: 3,
    template: 'shard b7e1d4 rejected the write',
  });

  it('reunites history, sums occurrences and keeps the kept identity', () => {
    const { merged } = mergeSignatures(kept, dropped, []);
    expect(merged.id).toBe('sig-kept');
    expect(merged.familyId).toBe('fam-kept');
    expect(merged.occurrences).toBe(7);
    expect(merged.firstSeen).toBe('2026-11-02T08:00:00.000Z');
    expect(merged.lastSeen).toBe('2026-11-10T08:00:00.000Z');
  });

  it('never loses the strongest status (flaky over known, regression over all)', () => {
    expect(mergeSignatures(kept, dropped, []).merged.status).toBe('flaky');
    const regressed = mergeSignatures(
      signature({ status: 'flaky' }),
      signature({ id: 'x', status: 'regression' }),
      [],
    );
    expect(regressed.merged.status).toBe('regression');
    const keepRegression = mergeSignatures(
      signature({ status: 'regression' }),
      signature({ id: 'y', status: 'resolved' }),
      [],
    );
    expect(keepRegression.merged.status).toBe('regression');
  });

  it('never creates a second ticket: the kept key wins, else the dropped one', () => {
    expect(mergeSignatures(kept, dropped, []).merged.issueKey).toBe('CI-42');
    const adopted = mergeSignatures(
      signature({ issueKey: undefined }),
      signature({ id: 'z', issueKey: 'CI-99' }),
      [],
    );
    expect(adopted.merged.issueKey).toBe('CI-99');
  });

  it('falls back to the dropped testName when the kept one has none', () => {
    const { merged } = mergeSignatures(
      signature({ testName: undefined }),
      signature({ id: 'z', testName: 'testAdd' }),
      [],
    );
    expect(merged.testName).toBe('testAdd');
    const keepOwn = mergeSignatures(
      signature({ testName: 'testOwn' }),
      signature({ id: 'z', testName: 'testOther' }),
      [],
    );
    expect(keepOwn.merged.testName).toBe('testOwn');
  });

  it('reattaches the dropped occurrences to the kept signature and counts them', () => {
    const occs = [
      occurrence(1, { signatureId: 'sig-kept', familyId: 'fam-kept' }),
      occurrence(2, { signatureId: 'sig-drop', familyId: 'fam-drop' }),
      occurrence(3, { signatureId: 'sig-drop', familyId: 'fam-drop' }),
    ];
    const { movedOccurrences } = mergeSignatures(kept, dropped, occs);
    expect(movedOccurrences).toBe(2);
    expect(occs[1].signatureId).toBe('sig-kept');
    expect(occs[1].familyId).toBe('fam-kept');
    expect(occs[2].signatureId).toBe('sig-kept');
    expect(occs[0].signatureId).toBe('sig-kept');
  });

  it('does not mutate the two input signatures', () => {
    const before = JSON.stringify({ kept, dropped });
    mergeSignatures(kept, dropped, []);
    expect(JSON.stringify({ kept, dropped })).toBe(before);
  });

  it('carries the normalization rule that reconciles the two templates', () => {
    const { rule, retired } = mergeSignatures(kept, dropped, []);
    expect(rule).toBeDefined();
    expect(retired.id).toBe('sig-drop');
    expect(applyRule(kept.template, rule!)).toBe(applyRule(dropped.template, rule!));
  });

  it('omits the rule when the two templates are already identical', () => {
    const same = 'identical template';
    const { rule } = mergeSignatures(
      signature({ template: same }),
      signature({ id: 'z', template: same }),
      [],
    );
    expect(rule).toBeUndefined();
  });
});

describe('splitSignature', () => {
  const base = signature({
    id: 'sig-origin',
    familyId: 'fam-origin',
    issueKey: 'CI-7',
    occurrences: 5,
  });

  it('splits by test name, majority group first, keeping the original signature', () => {
    const occs = [
      occurrence(1, { testName: 'testAlpha', occurredAt: '2026-11-01T08:00:00.000Z' }),
      occurrence(2, { testName: 'testAlpha', occurredAt: '2026-11-03T08:00:00.000Z' }),
      occurrence(3, { testName: 'testAlpha', occurredAt: '2026-11-02T08:00:00.000Z' }),
      occurrence(4, { testName: 'testBeta', occurredAt: '2026-11-05T08:00:00.000Z' }),
      occurrence(5, { testName: 'testBeta', occurredAt: '2026-11-04T08:00:00.000Z' }),
    ];
    const { groups } = splitSignature(base, occs, 'test-name');
    expect(groups).toHaveLength(2);
    // Majority group keeps the original identity and ticket.
    expect(groups[0].signature.id).toBe('sig-origin');
    expect(groups[0].signature.issueKey).toBe('CI-7');
    expect(groups[0].signature.testName).toBe('testAlpha');
    expect(groups[0].signature.occurrences).toBe(3);
    expect(groups[0].occurrences.map((o) => o.occurredAt)).toEqual([
      '2026-11-01T08:00:00.000Z',
      '2026-11-02T08:00:00.000Z',
      '2026-11-03T08:00:00.000Z',
    ]);
    // Minority group gets a fresh fingerprint and no inherited ticket.
    expect(groups[1].signature.id).not.toBe('sig-origin');
    expect(groups[1].signature.id).toMatch(/^[0-9a-f]{16}$/);
    expect(groups[1].signature.issueKey).toBeUndefined();
    expect(groups[1].signature.testName).toBe('testBeta');
    expect(groups[1].signature.template).toContain('testBeta');
  });

  it('never invents an occurrence: the groups add up to the exact input', () => {
    const occs = [
      occurrence(1, { testName: 'a' }),
      occurrence(2, { testName: 'b' }),
      occurrence(3, { testName: 'a' }),
    ];
    const { groups } = splitSignature(base, occs, 'test-name');
    const total = groups.reduce((sum, g) => sum + g.occurrences.length, 0);
    expect(total).toBe(3);
    const ids = groups.flatMap((g) => g.occurrences.map((o) => o.id)).sort();
    expect(ids).toEqual(['occ-1', 'occ-2', 'occ-3']);
  });

  it('reattaches each occurrence to its own group signature', () => {
    const occs = [
      occurrence(1, { testName: 'a' }),
      occurrence(2, { testName: 'a' }),
      occurrence(3, { testName: 'b' }),
    ];
    const { groups } = splitSignature(base, occs, 'test-name');
    const aSig = groups[0].signature;
    const bSig = groups[1].signature;
    expect(occs[0].signatureId).toBe(aSig.id);
    expect(occs[2].signatureId).toBe(bSig.id);
    expect(occs[2].familyId).toBe(bSig.familyId);
  });

  it('returns no group for an empty occurrence list', () => {
    expect(splitSignature(base, [], 'test-name').groups).toEqual([]);
  });

  it('splits by repository and by a custom criterion function', () => {
    const occs = [
      occurrence(1, { repo: 'alpha' }),
      occurrence(2, { repo: 'beta' }),
      occurrence(3, { repo: 'alpha' }),
    ];
    const byRepo = splitSignature(base, occs, 'repository');
    expect(byRepo.groups.map((g) => g.signature.occurrences)).toEqual([2, 1]);

    const occs2 = [occurrence(1, { branch: 'main' }), occurrence(2, { branch: 'dev' })];
    const byFn: SplitCriterion = (o) => o.branch;
    const byCustom = splitSignature(base, occs2, byFn);
    expect(byCustom.groups).toHaveLength(2);
    // Tie on size → the first group (by value) keeps the original template,
    // the second is the minority and gets the annotated one.
    expect(byCustom.groups[1].signature.template).toContain('criterion');
    expect(byCustom.groups[0].signature.id).toBe('sig-origin');
  });

  it('produces distinct fingerprints for two minority groups', () => {
    const occs = [
      occurrence(1, { testName: 'a' }),
      occurrence(2, { testName: 'a' }),
      occurrence(3, { testName: 'a' }),
      occurrence(4, { testName: 'b' }),
      occurrence(5, { testName: 'c' }),
    ];
    const { groups } = splitSignature(base, occs, 'test-name');
    const ids = groups.map((g) => g.signature.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('status precedence table', () => {
  const order: SignatureStatus[] = ['regression', 'flaky', 'resolved', 'known', 'new'];

  it('always keeps the higher-precedence status whichever side it is on', () => {
    for (let i = 0; i < order.length; i += 1) {
      for (let j = 0; j < order.length; j += 1) {
        const { merged } = mergeSignatures(
          signature({ status: order[i] }),
          signature({ id: `s-${i}-${j}`, status: order[j] }),
          [],
        );
        expect(merged.status).toBe(order[Math.min(i, j)]);
      }
    }
  });
});
