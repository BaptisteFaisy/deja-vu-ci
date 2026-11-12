/**
 * La mesure de justesse — ce que le panneau affiche, et ce qu'il promet.
 *
 * Trois contrôles :
 *  1. les trois indicateurs du § 18 sont des proportions, et le nombre
 *     d'échecs mesurés est celui du corpus ;
 *  2. les chiffres sont **identiques** à ceux de l'outil de la porte
 *     (`tools/eval-accuracy.mjs`) : le miroir du navigateur ne diverge pas ;
 *  3. une divergence est bien listée — sur un petit corpus fabriqué pour
 *     l'occasion, sans toucher au corpus du dépôt.
 *
 * La trace nocturne citée par le panneau est relue dans
 * `docs/NIGHTLY-REPORT.md` : si le rapport change, la citation doit changer.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assessFlakiness,
  extractErrorBlocks,
  familyOf,
  signatureOf,
  type Category,
  type LabeledCorpus,
  type LabeledFailure,
} from '@dejavu/core';
// L'outil de la porte : la même mesure, mais en Node (`npm run eval`).
import { evaluateCorpus, THRESHOLDS as TOOL_THRESHOLDS } from '../../tools/eval-accuracy.mjs';
import {
  CORPUS,
  THRESHOLDS,
  measureCorpus,
  measurement,
} from '../src/panels/justesse-mesure';
import { PUBLISHED, compareWithPublished } from '../src/panels/justesse-nuit';
import { panel } from '../src/panels/justesse';

/** Le moteur, sous la forme que l'outil de la porte attend. */
const ENGINE = { extractErrorBlocks, signatureOf, familyOf, assessFlakiness };

/** Un faux échec étiqueté : le journal décide de la signature. */
function fakeFailure(
  id: string,
  expectedGroup: string,
  expectedCategory: Category,
  log: string,
): LabeledFailure {
  return {
    id,
    repo: 'fake-api',
    branch: 'main',
    step: 'unit-tests (pytest)',
    log,
    expectedGroup,
    expectedCategory,
  };
}

/** Un journal d'échec de test : la catégorie du moteur est `test`. */
const LOG_ALPHA = [
  'FAILED tests/test_alpha.py::test_one - AssertionError',
  '=================================== FAILURES ===================================',
  '________________________________ test_one __________________________________',
  '    def test_one():',
  '>       assert 1 == 2',
  'E       AssertionError: assert 1 == 2',
  'tests/test_alpha.py:10: AssertionError',
].join('\n');

/** Un autre journal d'échec, d'un autre type : une autre signature. */
const LOG_BETA = [
  'FAILED tests/test_beta.py::test_two - ConnectionError',
  '=================================== FAILURES ===================================',
  '________________________________ test_two __________________________________',
  '    def test_two():',
  ">       session.execute('SELECT 1')",
  "E       ConnectionError: could not connect to server: Connection refused",
  'tests/test_beta.py:20: ConnectionError',
].join('\n');

/** Un petit corpus fabriqué : un groupe éclaté, une catégorie fausse. */
const FAKE: LabeledCorpus = {
  name: 'fake-corpus',
  description: 'Trois échecs fabriqués pour prouver que les divergences sont listées.',
  failures: [
    fakeFailure('f1', 'g1', 'test', LOG_ALPHA),
    fakeFailure('f2', 'g1', 'test', LOG_BETA),
    fakeFailure('f3', 'g2', 'style', LOG_ALPHA),
  ],
};

describe('mesure de justesse', () => {
  it('mesure autant d’échecs que le corpus en contient', () => {
    const mesure = measurement();
    expect(mesure.report.failures).toBe(CORPUS.failures.length);
    expect(mesure.rows.length).toBe(CORPUS.failures.length);
    expect(mesure.grouping.groups).toBe(new Set(CORPUS.failures.map((f) => f.expectedGroup)).size);
  });

  it('donne trois proportions, toutes dans [0, 1]', () => {
    const { report } = measurement();
    for (const value of [report.groupingAccuracy, report.categoryAccuracy, report.falseFlakyRate]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('tient les seuils du § 18 sur le corpus du dépôt', () => {
    const { report } = measurement();
    expect(report.groupingAccuracy).toBeGreaterThanOrEqual(THRESHOLDS.grouping);
    expect(report.categoryAccuracy).toBeGreaterThanOrEqual(THRESHOLDS.category);
    expect(report.falseFlakyRate).toBeLessThan(THRESHOLDS.falseFlaky);
  });

  it('prend les mêmes seuils que la porte du dépôt', () => {
    expect(THRESHOLDS.grouping).toBe(TOOL_THRESHOLDS.grouping);
    expect(THRESHOLDS.falseFlaky).toBe(TOOL_THRESHOLDS.falseFlaky);
    expect(THRESHOLDS.category).toBe(TOOL_THRESHOLDS.category);
  });

  it('donne exactement les mêmes chiffres que l’outil de la porte', () => {
    const outil = evaluateCorpus(ENGINE, CORPUS);
    const mien = measureCorpus(CORPUS);
    expect(mien.report.groupingAccuracy).toBe(outil.grouping.accuracy);
    expect(mien.report.categoryAccuracy).toBe(outil.categoryAccuracy);
    expect(mien.report.falseFlakyRate).toBe(outil.flaky.rate);
    expect(mien.categoryMatches).toBe(outil.categoryMatches);
    expect(mien.grouping.groups).toBe(outil.grouping.groups);
    expect(mien.grouping.scattered).toEqual(outil.grouping.scattered);
    expect(mien.flaky.flagged).toBe(outil.flaky.flagged);
    expect(mien.flaky.wrong).toBe(outil.flaky.wrong);
    expect(mien.flaky.signatures).toBe(outil.flaky.signatures);
    expect(mien.breaches.length).toBe(outil.breaches.length);
    for (const [index, row] of mien.rows.entries()) {
      expect(row.signature).toBe(outil.rows[index].signature);
      expect(row.category).toBe(outil.rows[index].category);
    }
  });

  it('liste les divergences d’un corpus fabriqué', () => {
    const mesure = measureCorpus(FAKE);
    const divergences = mesure.report.mismatches;
    // Le groupe `g1` est éclaté (deux signatures) et `f3` porte une
    // catégorie fausse : deux divergences au moins.
    expect(divergences.length).toBeGreaterThanOrEqual(2);
    expect(divergences.map((d) => d.id)).toContain('f3');
    expect(mesure.report.groupingAccuracy).toBeLessThan(1);
    expect(mesure.report.categoryAccuracy).toBeLessThan(1);
    for (const divergence of divergences) {
      const row = mesure.rows.find((candidate) => candidate.id === divergence.id);
      expect(row).toBeDefined();
      expect(divergence.expectedGroup).toBe(row?.expectedGroup);
      expect(divergence.gotSignature).toBe(row?.signature ?? '');
      expect(divergence.gotCategory).toBe(row?.category);
    }
  });

  it('ne mesure pas le corpus du dépôt en plus de deux secondes', () => {
    expect(measurement().elapsedMs).toBeLessThan(2000);
  });
});

describe('trace nocturne publiée', () => {
  const RAPPORT = readFileSync(new URL('../../docs/NIGHTLY-REPORT.md', import.meta.url), 'utf8');

  /** La valeur en pourcentage d'une ligne du tableau du rapport. */
  function pourcentage(libelle: string): number {
    const ligne = RAPPORT.split('\n').find((candidate) => candidate.startsWith(`| ${libelle} |`));
    expect(ligne, libelle).toBeDefined();
    const valeur = Number(ligne?.split('|')[2]?.trim().replace('%', '').trim());
    return valeur / 100;
  }

  it('cite le rapport publié, à la date qu’il annonce', () => {
    const date = RAPPORT.match(/Generated on \*\*(\d{4}-\d{2}-\d{2})\*\*/)?.[1];
    expect(date).toBeDefined();
    expect(PUBLISHED.date).toBe(date);
    expect(PUBLISHED.source).toBe('docs/NIGHTLY-REPORT.md');
  });

  it('cite les mêmes indicateurs que le rapport', () => {
    expect(PUBLISHED.grouping).toBeCloseTo(pourcentage('Correct grouping'), 6);
    expect(PUBLISHED.falseFlaky).toBeCloseTo(pourcentage('False "flaky"'), 6);
    expect(PUBLISHED.category).toBeCloseTo(pourcentage('Correct category'), 6);
  });

  it('cite le même corpus que le rapport', () => {
    const corpus = RAPPORT.match(/Corpus: (\S+) — (\d+) labelled failures, (\d+) groups, (\d+) signatures\./);
    expect(corpus).not.toBeNull();
    expect(PUBLISHED.failures).toBe(Number(corpus?.[2]));
    expect(PUBLISHED.groups).toBe(Number(corpus?.[3]));
    expect(PUBLISHED.signatures).toBe(Number(corpus?.[4]));
  });

  it('compare la mesure du navigateur à la trace, ligne par ligne', () => {
    const rows = compareWithPublished(measurement());
    expect(rows.map((row) => row.key)).toEqual([
      'grouping',
      'falseFlaky',
      'category',
      'failures',
      'groups',
      'signatures',
    ]);
    for (const row of rows) {
      expect(row.same).toBe(row.live === row.published);
    }
  });

  it('signale une différence quand les chiffres divergent', () => {
    const faux = {
      report: { groupingAccuracy: 0.5, falseFlakyRate: 0, categoryAccuracy: 1, failures: 100, mismatches: [] },
      rows: [],
      grouping: { accuracy: 0.5, scattered: [], groups: 27, dominant: new Map() },
      flaky: { rate: 0, flagged: 0, wrong: 0, signatures: 26 },
      categoryMatches: 100,
      breaches: [],
      elapsedMs: 1,
    };
    const rows = compareWithPublished(faux as never);
    expect(rows.find((row) => row.key === 'grouping')?.same).toBe(false);
    expect(rows.find((row) => row.key === 'category')?.same).toBe(true);
  });
});

describe('panneau justesse', () => {
  it('expose un titre et un résumé dans les deux langues', () => {
    expect(panel.id).toBe('justesse');
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(0);
      expect(panel.summary(lang).length).toBeGreaterThan(10);
      expect(panel.title(lang)).not.toContain('panel.');
    }
  });
});
