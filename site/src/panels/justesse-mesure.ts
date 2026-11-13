/**
 * La mesure de justesse (§ 18) — calculée dans le navigateur.
 *
 * Le dépôt mesure déjà la justesse du moteur : `tools/eval-accuracy.mjs` (la
 * porte `npm run eval` et le rapport nocturne lisent ce même code). Ce module
 * en est le miroir **pour le navigateur** : le calcul, lui, est bien celui du
 * moteur — `extractErrorBlocks`, `signatureOf`, `familyOf` et
 * `assessFlakiness` de `packages/core` — seul le score (regroupement, faux
 * « instable », catégories) est recomposé ici, à l'identique, parce que
 * l'outil de la porte est un script Node (`node:fs`) : il ne peut pas entrer
 * dans un bundle de navigateur.
 *
 * `site/test/panels-justesse.test.ts` compare les deux implémentations sur le
 * corpus réel : les chiffres doivent être **identiques**, pas seulement voisins.
 */

import {
  assessFlakiness,
  extractErrorBlocks,
  familyOf,
  signatureOf,
  type AccuracyReport,
  type Category,
  type LabeledCorpus,
  type LabeledFailure,
  type Occurrence,
} from '@dejavu/core';
import corpusJson from '../../../data/labeled/100-failures.json';

/** Le corpus étiqueté du dépôt : 100 échecs, 27 groupes, étiquetés à la main. */
export const CORPUS = corpusJson as unknown as LabeledCorpus;

/** Les seuils du § 18 — les mêmes que ceux de la porte `npm run eval`. */
export const THRESHOLDS = { grouping: 0.9, falseFlaky: 0.05, category: 0.9 } as const;

/** Les champs optionnels que le corpus peut porter (le moteur les honore). */
type ExtraFields = { occurredAt?: string; commit?: string; passedOnRetry?: boolean };

/** Un échec étiqueté, scorée par le moteur. */
export interface ScoredRow {
  id: string;
  repo: string;
  branch: string;
  step: string;
  expectedGroup: string;
  expectedCategory: Category;
  expectedDiagnostic?: string;
  /** La signature obtenue (vide si aucun bloc d'erreur n'a été extrait). */
  signature?: string;
  /** La famille obtenue. */
  family?: string;
  /** La catégorie obtenue. */
  category: Category;
  /** L'instant de l'échec (le corpus ne le porte pas : c'est l'heure de la mesure). */
  occurredAt: string;
  /** Le commit de l'échec, quand le corpus le porte. */
  commit?: string;
  /** Vrai si l'étape a réussi au même commit après l'échec. */
  passedOnRetry?: boolean;
}

/** Un seuil dépassé, par indicateur. */
export type BreachKey = 'grouping' | 'falseFlaky' | 'category';

/** Le regroupement, calculé une fois pour toutes. */
export interface GroupingStats {
  /** Part des échecs tombés sur la signature majoritaire de leur groupe. */
  accuracy: number;
  /** Les groupes éclatés (plusieurs signatures pour un même groupe). */
  scattered: Array<{ group: string; distinct: number; members: number }>;
  /** Le nombre de groupes. */
  groups: number;
  /** La signature majoritaire de chaque groupe. */
  dominant: Map<string, string | undefined>;
}

/** Les faux « instable » : les signatures déclarées instables à tort. */
export interface FlakyMeasure {
  /** Part des signatures déclarées instables qui ne le sont pas. */
  rate: number;
  /** Le nombre de signatures déclarées instables. */
  flagged: number;
  /** Le nombre de ces déclarations qui sont fausses. */
  wrong: number;
  /** Le nombre de signatures distinctes obtenues. */
  signatures: number;
}

/** La mesure complète du corpus. */
export interface CorpusMeasurement {
  /** Le rapport, au format gelé du moteur (`AccuracyReport`). */
  report: AccuracyReport;
  /** Les lignes scorées, une par échec. */
  rows: ScoredRow[];
  /** Le regroupement. */
  grouping: GroupingStats;
  /** Les faux « instable ». */
  flaky: FlakyMeasure;
  /** Le nombre d'échecs dont la catégorie est correcte. */
  categoryMatches: number;
  /** Les seuils dépassés (vide quand la mesure est conforme). */
  breaches: BreachKey[];
  /** Le temps de la mesure, en millisecondes. */
  elapsedMs: number;
}

/** Signature, famille et catégorie d'un échec étiqueté (moteur réel). */
export function signOne(failure: LabeledFailure): {
  signature?: string;
  family?: string;
  category: Category;
} {
  const extracted = extractErrorBlocks({ stepLog: failure.log, testCases: failure.testCases });
  const block = extracted.blocks[0];
  if (!block) return { signature: undefined, family: undefined, category: 'unknown' };
  return { signature: signatureOf(block), family: familyOf(block), category: block.category };
}

/** Signature majoritaire d'un groupe, et le nombre de membres qui la suivent. */
export function dominant(signatures: Array<string | undefined>): {
  signature: string | undefined;
  count: number;
  distinct: number;
} {
  const counts = new Map<string | undefined, number>();
  for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = -1;
  for (const [signature, count] of counts) {
    if (count > bestCount) {
      best = signature;
      bestCount = count;
    }
  }
  return { signature: best, count: bestCount, distinct: counts.size };
}

/** Les lignes d'un groupe, par identifiant de groupe attendu. */
function groupMembers(rows: ScoredRow[]): Map<string, ScoredRow[]> {
  const byGroup = new Map<string, ScoredRow[]>();
  for (const row of rows) {
    const members = byGroup.get(row.expectedGroup);
    if (members) members.push(row);
    else byGroup.set(row.expectedGroup, [row]);
  }
  return byGroup;
}

/** Le regroupement : part des échecs tombés sur la signature de leur groupe. */
export function groupingStats(rows: ScoredRow[]): GroupingStats {
  let matched = 0;
  const scattered: GroupingStats['scattered'] = [];
  const dominantByGroup = new Map<string, string | undefined>();
  for (const [group, members] of groupMembers(rows)) {
    const { signature, count, distinct } = dominant(members.map((m) => m.signature));
    dominantByGroup.set(group, signature);
    matched += count;
    if (distinct > 1) scattered.push({ group, distinct, members: members.length });
  }
  return {
    accuracy: rows.length === 0 ? 0 : matched / rows.length,
    scattered,
    groups: dominantByGroup.size,
    dominant: dominantByGroup,
  };
}

/** Les occurrences d'une signature, vues par le détecteur d'instabilité. */
function occurrencesOf(members: ScoredRow[]): Occurrence[] {
  return members.map((m) => ({
    id: m.id,
    signatureId: m.signature ?? m.id,
    familyId: m.family ?? m.id,
    workspace: '',
    repo: m.repo,
    branch: m.branch,
    commit: m.commit ?? m.id,
    author: '',
    stepName: m.step,
    durationS: 0,
    occurredAt: m.occurredAt,
    passedOnRetry: Boolean(m.passedOnRetry),
  }));
}

/**
 * Faux « instable » : signatures que le détecteur déclare instables alors que
 * leur groupe n'est pas étiqueté comme tel.
 *
 * Le corpus ne contient aucun succès au même commit : un détecteur correct ne
 * déclare donc rien d'instable ici. Toute déclaration est un faux positif.
 */
export function falseFlakyRate(rows: ScoredRow[]): FlakyMeasure {
  const bySignature = new Map<string | undefined, ScoredRow[]>();
  for (const row of rows) {
    const members = bySignature.get(row.signature);
    if (members) members.push(row);
    else bySignature.set(row.signature, [row]);
  }
  let flagged = 0;
  let wrong = 0;
  for (const [, members] of bySignature) {
    const verdict = assessFlakiness(occurrencesOf(members), { now: new Date(members[0].occurredAt) });
    if (!verdict.flaky) continue;
    flagged += 1;
    const labeledFlaky = members.some((m) => m.expectedDiagnostic === 'flaky');
    if (!labeledFlaky) wrong += 1;
  }
  return { rate: flagged === 0 ? 0 : wrong / flagged, flagged, wrong, signatures: bySignature.size };
}

/** L'instant de l'échec : le corpus ne le porte pas, c'est l'heure de la mesure. */
export function occurredAtOf(log: string, nowMs: number): string {
  return new Date(Date.parse(log.slice(0, 24)) || nowMs).toISOString();
}

/** Les lignes du corpus, scorées par le moteur. */
export function scoreRows(corpus: LabeledCorpus, nowMs: number): ScoredRow[] {
  return corpus.failures.map((failure) => {
    const scored = signOne(failure);
    const extra = failure as LabeledFailure & ExtraFields;
    return {
      id: failure.id,
      repo: failure.repo,
      branch: failure.branch,
      step: failure.step,
      expectedGroup: failure.expectedGroup,
      expectedCategory: failure.expectedCategory,
      expectedDiagnostic: failure.expectedDiagnostic,
      signature: scored.signature,
      family: scored.family,
      category: scored.category,
      occurredAt: extra.occurredAt ?? occurredAtOf(failure.log, nowMs),
      commit: extra.commit,
      passedOnRetry: extra.passedOnRetry,
    };
  });
}

/**
 * Les divergences : un échec tombé sur une autre signature que celle de son
 * groupe, ou dont la catégorie diffère de l'attendue.
 */
export function mismatchesOf(rows: ScoredRow[]): AccuracyReport['mismatches'] {
  const { dominant: dominantByGroup } = groupingStats(rows);
  const mismatches: AccuracyReport['mismatches'] = [];
  for (const row of rows) {
    const groupOk = row.signature === dominantByGroup.get(row.expectedGroup);
    const categoryOk = row.category === row.expectedCategory;
    if (groupOk && categoryOk) continue;
    mismatches.push({
      id: row.id,
      expectedGroup: row.expectedGroup,
      gotSignature: row.signature ?? '',
      expectedCategory: row.expectedCategory,
      gotCategory: row.category,
    });
  }
  return mismatches;
}

/**
 * Mesure le corpus étiqueté : les trois indicateurs du § 18, les lignes
 * scorées et les divergences.
 */
export function measureCorpus(corpus: LabeledCorpus, nowMs: number = Date.now()): CorpusMeasurement {
  const started = Date.now();
  const rows = scoreRows(corpus, nowMs);
  const grouping = groupingStats(rows);
  const flaky = falseFlakyRate(rows);
  const categoryMatches = rows.filter((row) => row.category === row.expectedCategory).length;
  const categoryAccuracy = rows.length === 0 ? 0 : categoryMatches / rows.length;

  const breaches: BreachKey[] = [];
  if (grouping.accuracy < THRESHOLDS.grouping) breaches.push('grouping');
  if (flaky.rate >= THRESHOLDS.falseFlaky) breaches.push('falseFlaky');
  if (categoryAccuracy < THRESHOLDS.category) breaches.push('category');

  const report: AccuracyReport = {
    failures: rows.length,
    groupingAccuracy: grouping.accuracy,
    falseFlakyRate: flaky.rate,
    categoryAccuracy,
    mismatches: mismatchesOf(rows),
  };
  return {
    report,
    rows,
    grouping,
    flaky,
    categoryMatches,
    breaches,
    elapsedMs: Date.now() - started,
  };
}

/** La mesure du corpus, gardée en cache : le corpus et le moteur ne bougent pas. */
let cached: CorpusMeasurement | undefined;

/** La mesure du corpus étiqueté du dépôt. */
export function measurement(): CorpusMeasurement {
  cached ??= measureCorpus(CORPUS);
  return cached;
}
