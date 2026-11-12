/**
 * Les données du panneau « Coût » — module pur, aucune DOM.
 *
 * Rien n'est recalculé ici : les quatre compteurs et le classement par
 * signature viennent de `computeCost` (`packages/core`), la tendance par jour
 * de `computeCostTrend` (le modèle de vue du Cerveau,
 * `apps/brain/src/pure/costTrend`) et le verdict d'instabilité de
 * `assessFlakiness` + `testStats` (`packages/core`). Ce module ne fait que
 * mettre en forme ce que le produit calcule déjà, pour que le panneau n'ait
 * plus qu'à placer des nœuds — et pour que les tests portent sur des chiffres,
 * pas sur du DOM.
 */

import {
  assessFlakiness,
  computeCost,
  testStats,
  type CostReport,
  type Occurrence,
  type Settings,
  type Signature,
  type SignatureCost,
  type SignatureStatus,
  type TestStats,
} from '@dejavu/core';
import { textBar, trendMax, type CostTrend } from '../../../apps/brain/src/pure/costTrend';
import { computeCostTrend } from '../../../apps/brain/src/pure/costTrendCompute';
import type { Lang } from '../lib/i18n';

/** Le rapport du moteur, réexporté : le rendu n'a pas à connaître `core`. */
export type { CostReport };

/** Largeur des barres : celle que dessine l'onglet Coût du Cerveau. */
const BAR_WIDTH = 12;

/**
 * Tarif par défaut du champ « coût d'une minute de CI », en euros.
 *
 * Ce nombre n'appartient **pas** au produit : Déjà-vu CI raisonne uniquement en
 * minutes de CI, il ne connaît aucun tarif. Le champ est donc modifiable, et le
 * panneau le dit explicitement (`cout.euro.honesty`).
 */
export const DEFAULT_EUR_PER_MINUTE = 0.1;

/** Ce que le panneau lit dans l'atelier partagé. */
export interface CostInput {
  /** Les échecs du rejeu (fenêtre du jeu). */
  occurrences: Occurrence[];
  /** Les signatures de la mémoire partagée. */
  signatures: Signature[];
  /** Les réglages de la mémoire partagée (seuils d'instabilité). */
  settings: Settings;
  /** L'horloge fixe du site. */
  now: Date;
  /** La fenêtre utilisée par la vue du rejeu. */
  windowDays: number;
}

/** Une ligne du classement : le coût d'une signature, et sa part du total. */
export interface RankRow extends SignatureCost {
  /** Part (0..1) des minutes de la fenêtre. */
  share: number;
}

/** Un jour de la tendance, prêt à dessiner. */
export interface TrendRow {
  day: string;
  redBuilds: number;
  ciMinutesLost: number;
  /** Barre textuelle du Cerveau (`textBar`), à l'échelle de la fenêtre. */
  bar: string;
  /** Part (0..1) des minutes de la fenêtre. */
  share: number;
}

/** Une signature instable, et ce qu'elle coûte. */
export interface FlakyRow {
  signatureId: string;
  shortId: string;
  title: string;
  status: SignatureStatus;
  occurrences: number;
  ciMinutesLost: number;
  retries: number;
  /** Branches distinctes vues par le moteur dans sa fenêtre d'instabilité. */
  branches: number;
  /** Indice 0..1 : part des échecs sans modification pertinente (§ 10.1). */
  flakyIndex: number;
  sameCommitPass: boolean;
  /** Les raisons du moteur, telles qu'il les écrit. */
  reasons: string[];
  issueKey?: string;
  /** Statistiques par test du moteur, quand un nom de test est connu. */
  stats?: TestStats;
}

/** La facture de l'instabilité. */
export interface FlakyBill {
  rows: FlakyRow[];
  ciMinutesLost: number;
  retries: number;
  occurrences: number;
  /** Part (0..1) des minutes de la fenêtre. */
  share: number;
}

/** Toutes les données du panneau, calculées d'un coup. */
export interface CostView {
  report: CostReport;
  ranking: RankRow[];
  trend: CostTrend;
  trendRows: TrendRow[];
  flaky: FlakyBill;
}

/** Le rapport de coût du moteur, sur la fenêtre de la vue du rejeu. */
export function reportOf(input: CostInput): CostReport {
  return computeCost(input.occurrences, {
    signatures: input.signatures,
    now: input.now,
    windowDays: input.windowDays,
  });
}

/** Une part (0..1) du total, sans division par zéro. */
function shareOf(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((value / total) * 1000) / 1000;
}

/** Le classement du moteur (déjà trié, le plus coûteux d'abord), avec les parts. */
export function rankingOf(report: CostReport): RankRow[] {
  return report.perSignature.map((row) => ({
    ...row,
    share: shareOf(row.ciMinutesLost, report.ciMinutesLost),
  }));
}

/** La tendance du Cerveau, sur la même fenêtre que les compteurs. */
export function trendOf(input: CostInput): CostTrend {
  return computeCostTrend(input.occurrences, {
    signatures: input.signatures,
    now: input.now,
    windowDays: input.windowDays,
  });
}

/** Les jours de la tendance, avec la barre et la part de chaque jour. */
export function trendRowsOf(trend: CostTrend): TrendRow[] {
  // La même échelle que l'onglet Coût du Cerveau (`costTrendView.tsx`).
  const scale = Math.max(trendMax(trend), 1);
  const total = trend.current.ciMinutesLost;
  return trend.points.map((point) => ({
    day: point.day,
    redBuilds: point.redBuilds,
    ciMinutesLost: point.ciMinutesLost,
    bar: textBar(point.ciMinutesLost, scale, BAR_WIDTH),
    share: shareOf(point.ciMinutesLost, total),
  }));
}

/** Les échecs groupés par signature (le regroupement du moteur). */
export function groupsOf(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  const groups = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const bucket = groups.get(occurrence.signatureId);
    if (bucket) bucket.push(occurrence);
    else groups.set(occurrence.signatureId, [occurrence]);
  }
  return groups;
}

/** Le nom de test d'un groupe : celui de la signature, sinon celui des échecs. */
function testNameOf(group: Occurrence[], signatureId: string, signatures: Signature[]): string | undefined {
  const known = signatures.find((candidate) => candidate.id === signatureId);
  return known?.testName ?? group.find((occurrence) => occurrence.testName)?.testName;
}

/** Une ligne du classement, retrouvée par identifiant de signature. */
function rankRowOf(ranking: RankRow[], signatureId: string): RankRow | undefined {
  return ranking.find((row) => row.signatureId === signatureId);
}

/** Une signature instable : le verdict du moteur et son coût dans la fenêtre. */
function flakyRowOf(
  signatureId: string,
  group: Occurrence[],
  input: CostInput,
  ranking: RankRow[],
): FlakyRow | undefined {
  const verdict = assessFlakiness(group, { settings: input.settings, now: input.now });
  if (!verdict.flaky) return undefined;
  const cost = rankRowOf(ranking, signatureId);
  const signature = input.signatures.find((candidate) => candidate.id === signatureId);
  const testName = testNameOf(group, signatureId, input.signatures);
  return {
    signatureId,
    shortId: cost?.signatureShort ?? signatureId.slice(0, 8),
    title: cost?.title ?? signature?.errorType ?? signatureId,
    status: signature?.status ?? 'new',
    occurrences: cost?.occurrences ?? verdict.occurrences,
    ciMinutesLost: cost?.ciMinutesLost ?? 0,
    retries: cost?.retries ?? 0,
    branches: verdict.branches,
    flakyIndex: verdict.flakyIndex,
    sameCommitPass: verdict.sameCommitPass,
    reasons: verdict.reasons,
    ...(signature?.issueKey ? { issueKey: signature.issueKey } : {}),
    ...(testName ? { stats: testStats(group, testName) } : {}),
  };
}

/**
 * La facture de l'instabilité : les signatures que le moteur déclare instables,
 * ce qu'elles coûtent, et la part qu'elles prennent dans la fenêtre.
 */
export function flakyBillOf(input: CostInput, ranking: RankRow[]): FlakyBill {
  const rows = [...groupsOf(input.occurrences).entries()]
    .map(([signatureId, group]) => flakyRowOf(signatureId, group, input, ranking))
    .filter((row): row is FlakyRow => row !== undefined)
    .sort((a, b) => b.ciMinutesLost - a.ciMinutesLost);
  const minutes = rows.reduce((total, row) => total + row.ciMinutesLost, 0);
  const report = ranking.reduce((total, row) => total + row.ciMinutesLost, 0);
  return {
    rows,
    ciMinutesLost: Math.round(minutes * 10) / 10,
    retries: rows.reduce((total, row) => total + row.retries, 0),
    occurrences: rows.reduce((total, row) => total + row.occurrences, 0),
    share: shareOf(minutes, report),
  };
}

/** Toutes les données du panneau, en un appel. */
export function costView(input: CostInput): CostView {
  const report = reportOf(input);
  const ranking = rankingOf(report);
  const trend = trendOf(input);
  return {
    report,
    ranking,
    trend,
    trendRows: trendRowsOf(trend),
    flaky: flakyBillOf(input, ranking),
  };
}

/** Le tarif saisi dans le champ : toute valeur inutilisable vaut zéro. */
export function rateOf(raw: string): number {
  const value = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Les euros d'une durée de CI, au tarif saisi par le visiteur.
 *
 * Conversion strictement linéaire (`minutes × tarif`) : le produit, lui, ne
 * raisonne qu'en minutes — c'est ce que dit la note d'honnêteté du panneau.
 */
export function minutesToEuros(minutes: number, ratePerMinute: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) return 0;
  return Math.round(minutes * ratePerMinute * 100) / 100;
}

/** Le montant en euros, dans la langue du visiteur (« 5,24 € » / « €5.24 »). */
export function eurosText(value: number, lang: Lang): string {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-IE';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(value);
}

/** Un pourcentage lisible (« 61 % ») — les parts du classement et de la tendance. */
export function percentText(share: number): string {
  return `${Math.round(share * 100)}%`;
}
