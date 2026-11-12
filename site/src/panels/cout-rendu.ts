/**
 * Le rendu du panneau « Coût » — des nœuds DOM, aucune logique métier.
 *
 * Les chiffres viennent de `cout-donnees.ts` (donc du moteur), les libellés de
 * `@dejavu/present` pour le domaine (`cost.*`, statuts, dates, ratios) et de la
 * table du panneau pour ce qui n'appartient qu'au site. Aucun `innerHTML` : tout
 * passe par `textContent`, et les barres de la tendance sont celles que dessine
 * l'onglet Coût du Cerveau (`textBar`) — aucune bibliothèque graphique.
 */

import { formatDate, formatConfidence, statusLabel, statusTone } from '@dejavu/present';
import { badge, el, table, type Child } from '../render/dom';
import { fill, t, type Lang } from '../lib/i18n';
import {
  eurosText,
  minutesToEuros,
  percentText,
  type CostReport,
  type CostView,
  type FlakyRow,
} from './cout-donnees';

/** Une cellule en euros, et les minutes qu'elle convertit. */
interface EuroCell {
  node: HTMLElement;
  minutes: number;
}

/**
 * Les cellules en euros posées par le rendu.
 *
 * Le champ tarif les recalcule toutes sans re-rendre le panneau : le visiteur
 * voit ses euros bouger pendant qu'il tape, et le champ garde le focus.
 */
export interface EuroSinks {
  cells: EuroCell[];
}

/** Un registre de cellules en euros, vide. */
export function euroSinks(): EuroSinks {
  return { cells: [] };
}

/** Une cellule en euros, enregistrée pour les rafraîchissements suivants. */
function euroCell(sinks: EuroSinks, minutes: number, rate: number, lang: Lang): HTMLElement {
  const node = el('span', { class: 'mono' }, eurosText(minutesToEuros(minutes, rate), lang));
  sinks.cells.push({ node, minutes });
  return node;
}

/** Recalcule toutes les cellules en euros au nouveau tarif. */
export function refreshEuros(sinks: EuroSinks, rate: number, lang: Lang): void {
  for (const cell of sinks.cells) {
    cell.node.textContent = eurosText(minutesToEuros(cell.minutes, rate), lang);
  }
}

/** Un bloc du panneau : titre, note, contenu (la mise en forme du rejeu). */
function block(title: string, note: string, ...content: Child[]): HTMLElement {
  return el('div', { class: 'block' }, el('h2', {}, title), el('p', { class: 'section-note' }, note), ...content);
}

/** Une vignette de compteur : valeur au-dessus, libellé en dessous. */
function counter(label: string, value: string | number | HTMLElement): HTMLElement {
  return el('li', {}, el('span', { class: 'value' }, value), el('span', { class: 'label' }, label));
}

/** Les quatre compteurs du moteur (CI-14), et la fenêtre sur laquelle ils portent. */
export function countersSection(report: CostReport, lang: Lang): HTMLElement {
  const entries: Array<[string, string | number]> = [
    [t('cost.redBuilds', lang), report.redBuilds],
    [t('cost.minutesLost', lang), report.ciMinutesLost],
    [t('cost.peopleAffected', lang), report.peopleAffected],
    [t('cost.retries', lang), report.retries],
    [t('cost.window', lang), report.windowDays],
  ];
  const counters = el('ul', { class: 'counters' }, ...entries.map(([label, value]) => counter(label, value)));
  return block(t('results.cost', lang), t('results.cost.note', lang), counters);
}

/** Le classement par signature : le plus coûteux d'abord, avec sa part et ses euros. */
export function rankingSection(view: CostView, sinks: EuroSinks, rate: number, lang: Lang): HTMLElement {
  const headers = [
    t('col.signature', lang), t('col.summary', lang), t('col.occurrences', lang),
    t('cost.minutesLost', lang), t('cout.col.share', lang), t('cout.col.euros', lang),
  ];
  const rows: Child[][] = view.ranking.map((row) => [
    el('span', { class: 'mono', title: row.signatureId }, row.signatureShort),
    row.title,
    String(row.occurrences),
    String(row.ciMinutesLost),
    percentText(row.share),
    euroCell(sinks, row.ciMinutesLost, rate, lang),
  ]);
  const body = table(headers, rows, t('results.empty', lang));
  return block(t('cout.ranking.title', lang), t('cout.ranking.note', lang), body);
}

/** La synthèse de la tendance : le total de la fenêtre, puis sa variation. */
function trendSummary(view: CostView, lang: Lang): HTMLElement {
  const trend = view.trend;
  const current = fill(t('cout.trend.current', lang), {
    minutes: trend.current.ciMinutesLost,
    builds: trend.current.redBuilds,
    days: trend.points.length,
  });
  const variation =
    trend.minutesDeltaPct === null
      ? fill(t('cout.trend.noPrevious', lang), {
          minutes: trend.current.ciMinutesLost,
          builds: trend.current.redBuilds,
        })
      : fill(t('cout.trend.summary', lang), {
          minutes: trend.minutesDelta,
          percent: trend.minutesDeltaPct,
          direction: directionOf(trend.minutesDelta, lang),
          vs: t('cout.trend.vsPrevious', lang),
        });
  return el('p', { class: 'status' }, current, ' ', variation);
}

/** Le sens de la variation, dans les mots du Cerveau. */
function directionOf(delta: number, lang: Lang): string {
  if (delta > 0) return t('cout.trend.up', lang);
  if (delta < 0) return t('cout.trend.down', lang);
  return t('cout.trend.flat', lang);
}

/** La tendance par jour : les barres textuelles du Cerveau, jour par jour. */
export function trendSection(view: CostView, sinks: EuroSinks, rate: number, lang: Lang): HTMLElement {
  const headers = [
    t('cout.trend.day', lang), t('cout.trend.bar', lang), t('cost.minutesLost', lang),
    t('cout.col.euros', lang), t('cost.redBuilds', lang), t('cout.col.share', lang),
  ];
  const rows: Child[][] = view.trendRows.map((row) => [
    formatDate(`${row.day}T00:00:00.000Z`, lang),
    el('span', { class: 'mono' }, row.bar),
    String(row.ciMinutesLost),
    euroCell(sinks, row.ciMinutesLost, rate, lang),
    String(row.redBuilds),
    percentText(row.share),
  ]);
  const body = table(headers, rows, t('results.empty', lang));
  return block(t('cout.trend.title', lang), t('cout.trend.note', lang), trendSummary(view, lang), body);
}

/** Les trois totaux convertis au tarif saisi. */
function euroCounters(view: CostView, sinks: EuroSinks, rate: number, lang: Lang): HTMLElement {
  const days = Math.max(view.trend.points.filter((point) => point.redBuilds > 0).length, 1);
  return el(
    'ul',
    { class: 'counters' },
    counter(t('cout.euro.total', lang), euroCell(sinks, view.report.ciMinutesLost, rate, lang)),
    counter(t('cout.euro.perDay', lang), euroCell(sinks, view.report.ciMinutesLost / days, rate, lang)),
    counter(t('cout.euro.flaky', lang), euroCell(sinks, view.flaky.ciMinutesLost, rate, lang)),
  );
}

/** Le champ tarif, les totaux convertis, et la note d'honnêteté obligatoire. */
export function euroSection(
  view: CostView,
  sinks: EuroSinks,
  rate: number,
  lang: Lang,
  onRate: (raw: string) => void,
): HTMLElement {
  const field = el('input', {
    type: 'number',
    id: 'cout-rate',
    min: '0',
    step: '0.01',
    value: String(rate),
    'aria-label': t('cout.euro.rate', lang),
    oninput: (event: Event) => onRate((event.target as HTMLInputElement).value),
  });
  return block(
    t('cout.euro.title', lang),
    t('cout.euro.note', lang),
    el('label', { for: 'cout-rate' }, `${t('cout.euro.rate', lang)} `, field),
    euroCounters(view, sinks, rate, lang),
    el('p', { class: 'section-note' }, t('cout.euro.honesty', lang)),
  );
}

/** Une signature instable : le verdict du moteur, ses raisons et son coût. */
function flakyRow(row: FlakyRow, sinks: EuroSinks, rate: number, lang: Lang): Child[] {
  return [
    el('span', { class: 'mono', title: row.signatureId }, row.shortId),
    el(
      'div',
      {},
      el('div', {}, row.title),
      badge(statusLabel(row.status, lang), statusTone(row.status)),
      el('ul', { class: 'facts' }, ...row.reasons.map((reason) => el('li', {}, reason))),
      row.stats ? el('div', { class: 'facts' }, statsLine(row, lang)) : null,
    ),
    String(row.occurrences),
    String(row.branches),
    formatConfidence(row.flakyIndex),
    row.sameCommitPass ? t('cout.flaky.yes', lang) : t('cout.flaky.no', lang),
    String(row.ciMinutesLost),
    euroCell(sinks, row.ciMinutesLost, rate, lang),
    el('span', { class: 'mono' }, row.issueKey ?? '—'),
  ];
}

/** La ligne `test_stats` du moteur, quand un nom de test est connu. */
function statsLine(row: FlakyRow, lang: Lang): string {
  const stats = row.stats;
  if (!stats) return '';
  return fill(t('cout.flaky.stats', lang), {
    repo: stats.repo,
    test: stats.testName,
    failed: stats.runsFailed,
    passed: stats.runsPassedSameCommit,
  });
}

/** La facture de l'instabilité : ce que les tests instables coûtent vraiment. */
export function flakySection(
  view: CostView,
  diagnosedFlaky: number,
  failures: number,
  sinks: EuroSinks,
  rate: number,
  lang: Lang,
): HTMLElement {
  const headers = [
    t('col.signature', lang), t('col.summary', lang), t('col.occurrences', lang),
    t('cout.flaky.branches', lang), t('cout.flaky.index', lang), t('cout.flaky.sameCommit', lang),
    t('cost.minutesLost', lang), t('cout.col.euros', lang), t('col.ticket', lang),
  ];
  const rows = view.flaky.rows.map((row) => flakyRow(row, sinks, rate, lang));
  const bill = fill(t('cout.flaky.bill', lang), {
    minutes: view.flaky.ciMinutesLost,
    share: percentText(view.flaky.share),
    retries: view.flaky.retries,
    occurrences: view.flaky.occurrences,
  });
  const status = el(
    'p',
    { class: 'status' },
    `${fill(t('cout.flaky.diagnosed', lang), { count: diagnosedFlaky, failures })} ${bill}`,
  );
  return block(
    t('cout.flaky.title', lang),
    t('cout.flaky.note', lang),
    status,
    table(headers, rows, t('cout.flaky.none', lang)),
  );
}
