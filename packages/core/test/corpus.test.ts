/**
 * The labeled corpus as a CI gate (§ 18 "Justesse").
 *
 * The 100 hand-labeled failures are the measuring instrument of the product:
 * grouping must stay at or above 90 %, categories at or above 90 %, and false
 * "flaky" verdicts below 5 %. Running it as a test means a change to the
 * normalizer or the categorizer that degrades accuracy breaks the build
 * instead of silently shipping.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessFlakiness } from '../src/flaky.js';
import { extractErrorBlocks } from '../src/extract.js';
import { signatureOf } from '../src/sign.js';
import type { LabeledCorpus, Occurrence } from '../src/types.js';

const CORPUS_URL = new URL('../../../data/labeled/100-failures.json', import.meta.url);
const corpus = JSON.parse(readFileSync(CORPUS_URL, 'utf8')) as LabeledCorpus;

/** Signature and category computed for one labeled failure. */
function signOne(failure: (typeof corpus.failures)[number]) {
  const extracted = extractErrorBlocks({
    stepLog: failure.log,
    testCases: failure.testCases,
  });
  const block = extracted.blocks[0];
  return {
    signature: block ? signatureOf(block) : 'no-block',
    category: block?.category ?? 'unknown',
  };
}

const rows = corpus.failures.map((failure) => ({ failure, ...signOne(failure) }));

/** Share of failures that land on the dominant signature of their group. */
function groupingAccuracy(): number {
  const byGroup = new Map<string, string[]>();
  for (const row of rows) {
    const list = byGroup.get(row.failure.expectedGroup) ?? [];
    list.push(row.signature);
    byGroup.set(row.failure.expectedGroup, list);
  }
  let matched = 0;
  for (const signatures of byGroup.values()) {
    const counts = new Map<string, number>();
    for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1);
    matched += Math.max(...counts.values());
  }
  return matched / rows.length;
}

/** Share of failures whose category is the labeled one. */
function categoryAccuracy(): number {
  const right = rows.filter((row) => row.category === row.failure.expectedCategory).length;
  return right / rows.length;
}

/**
 * False "flaky" rate: signatures the detector declares unstable although their
 * group is not labeled as such. The corpus holds no success at the same commit,
 * so a correct detector declares nothing unstable here.
 */
function falseFlakyRate(): number {
  const bySignature = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = bySignature.get(row.signature) ?? [];
    list.push(row);
    bySignature.set(row.signature, list);
  }
  let flagged = 0;
  let wrong = 0;
  for (const [, members] of bySignature) {
    const occurrences: Occurrence[] = members.map((member, index) => ({
      id: `${member.failure.id}-${index}`,
      signatureId: member.signature,
      familyId: member.signature,
      workspace: 'corpus',
      repo: member.failure.repo,
      branch: member.failure.branch,
      commit: member.failure.id,
      author: 'corpus',
      stepName: member.failure.step,
      durationS: 30,
      occurredAt: new Date(Date.parse('2026-11-01T08:00:00Z') + index * 3_600_000).toISOString(),
      passedOnRetry: false,
    }));
    const verdict = assessFlakiness(occurrences, { now: new Date(occurrences.at(-1)!.occurredAt) });
    if (!verdict.flaky) continue;
    flagged += 1;
    if (!members.some((m) => m.failure.expectedDiagnostic === 'flaky')) wrong += 1;
  }
  return flagged === 0 ? 0 : wrong / flagged;
}

describe('corpus étiqueté de 100 échecs (§ 18)', () => {
  it('charge le corpus complet', () => {
    expect(corpus.failures).toHaveLength(100);
    expect(new Set(corpus.failures.map((f) => f.expectedGroup)).size).toBeGreaterThanOrEqual(20);
  });

  it('regroupe au moins 90 % des échecs sur la signature de leur groupe', () => {
    expect(groupingAccuracy()).toBeGreaterThanOrEqual(0.9);
  });

  it('reconnaît la catégorie d’au moins 90 % des échecs', () => {
    expect(categoryAccuracy()).toBeGreaterThanOrEqual(0.9);
  });

  it('produit moins de 5 % de faux « instable »', () => {
    expect(falseFlakyRate()).toBeLessThan(0.05);
  });

  it('donne une signature à chaque échec du corpus', () => {
    const without = rows.filter((row) => row.signature === 'no-block');
    expect(without.map((row) => row.failure.id)).toEqual([]);
  });
});
