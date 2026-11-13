/**
 * Le rendu du panneau « Justesse » — des sections, pas de logique.
 *
 * Chaque section prend la mesure (calculée une fois pour toutes, voir
 * `justesse-mesure.ts`) et la langue, et rend du DOM : aucune mesure ici, et
 * aucun texte écrit en dur — tout vient de la table de traductions du panneau
 * (`justesse-strings.ts`) ou de `@dejavu/present` (les catégories).
 */

import { categoryLabel, formatConfidence } from '@dejavu/present';
import { badge, el, table, type Child } from '../render/dom';
import { fill, t, type Lang } from '../lib/i18n';
import { REPO_URL } from '../render/sections';
import { PUBLISHED, compareWithPublished, type NightlyKey } from './justesse-nuit';
import { THRESHOLDS, type CorpusMeasurement, type ScoredRow } from './justesse-mesure';

/** Le lien vers un fichier du dépôt (le site public n'a pas de réseau). */
function repoLink(path: string, label: string): HTMLElement {
  return el('a', { href: `${REPO_URL}/blob/main/${path}`, rel: 'noopener' }, label);
}

/** L'introduction : quel corpus, mesuré quand, d'où il vient. */
export function introSection(measurement: CorpusMeasurement, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el('p', { class: 'section-note' }, fill(t('justesse.corpus', lang), {
      name: 'deja-vu-labeled-100',
      failures: measurement.report.failures,
      groups: measurement.grouping.groups,
      signatures: measurement.flaky.signatures,
      ms: measurement.elapsedMs,
    })),
    el('p', { class: 'section-note' }, t('justesse.corpus.cached', lang)),
    el('p', { class: 'section-note' }, fill(t('justesse.corpus.link', lang), {
      file: 'data/labeled/100-failures.json',
    }), ' ', repoLink('data/labeled/100-failures.json', 'data/labeled/100-failures.json')),
  );
}

/** Une carte d'indicateur : la valeur mesurée, la cible, le verdict. */
function indicatorCard(
  lang: Lang,
  title: string,
  what: string,
  value: number,
  target: string,
  ok: boolean,
): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, title),
    el(
      'p',
      {},
      el('strong', {}, formatConfidence(value)),
      ' ',
      badge(ok ? t('justesse.verdict.ok', lang) : t('justesse.verdict.breach', lang), ok ? 'green' : 'red'),
    ),
    el('p', { class: 'section-note' }, fill(t('justesse.target', lang), { target })),
    el('p', {}, what),
  );
}

/** Les trois indicateurs du § 18, en cartes. */
export function indicatorsSection(measurement: CorpusMeasurement, lang: Lang): HTMLElement {
  const report = measurement.report;
  const groupingOk = report.groupingAccuracy >= THRESHOLDS.grouping;
  const categoryOk = report.categoryAccuracy >= THRESHOLDS.category;
  const flakyOk = report.falseFlakyRate < THRESHOLDS.falseFlaky;
  return el(
    'div',
    {},
    el('h2', {}, t('justesse.indicators.title', lang)),
    el('p', { class: 'section-note' }, t('justesse.indicators.note', lang)),
    el(
      'div',
      { class: 'cards' },
      indicatorCard(
        lang,
        t('justesse.metric.grouping', lang),
        t('justesse.what.grouping', lang),
        report.groupingAccuracy,
        `≥ ${formatConfidence(THRESHOLDS.grouping)}`,
        groupingOk,
      ),
      indicatorCard(
        lang,
        t('justesse.metric.category', lang),
        t('justesse.what.category', lang),
        report.categoryAccuracy,
        `≥ ${formatConfidence(THRESHOLDS.category)}`,
        categoryOk,
      ),
      indicatorCard(
        lang,
        t('justesse.metric.falseFlaky', lang),
        t('justesse.what.falseFlaky', lang),
        report.falseFlakyRate,
        `< ${formatConfidence(THRESHOLDS.falseFlaky)}`,
        flakyOk,
      ),
    ),
  );
}

/** Le verdict d'une ligne : conforme, ou divergence de groupe / de catégorie. */
function rowVerdict(row: ScoredRow, dominant: string | undefined, lang: Lang): HTMLElement {
  if (!row.signature) return badge(t('justesse.state.noblock', lang), 'grey');
  const groupOk = row.signature === dominant;
  const categoryOk = row.category === row.expectedCategory;
  if (groupOk && categoryOk) return badge(t('justesse.state.ok', lang), 'green');
  if (!groupOk && !categoryOk) return badge(t('justesse.state.both', lang), 'red');
  return badge(groupOk ? t('justesse.state.category', lang) : t('justesse.state.group', lang), 'yellow');
}

/** Une ligne du détail : l'échec, son groupe, sa signature, ses catégories. */
function detailRow(row: ScoredRow, dominant: string | undefined, lang: Lang): Child[] {
  return [
    el('span', { class: 'mono', text: row.id }),
    el('span', { class: 'mono', text: row.expectedGroup }),
    el('span', { class: 'mono', text: row.signature ?? '—' }),
    categoryLabel(row.expectedCategory, lang),
    categoryLabel(row.category, lang),
    rowVerdict(row, dominant, lang),
  ];
}

/** Le tableau complet : une ligne par échec étiqueté. */
function detailTable(measurement: CorpusMeasurement, lang: Lang): HTMLElement {
  const rows = measurement.rows.map((row) =>
    detailRow(row, measurement.grouping.dominant.get(row.expectedGroup), lang),
  );
  return table(
    [
      t('justesse.col.id', lang),
      t('justesse.col.group', lang),
      t('justesse.col.signature', lang),
      t('justesse.col.expectedCategory', lang),
      t('justesse.col.gotCategory', lang),
      t('justesse.col.verdict', lang),
    ],
    rows,
    t('justesse.mismatches.none', lang),
  );
}

/** Les divergences : les échecs qui ne sont pas tombés où ils devaient. */
function mismatchesSection(measurement: CorpusMeasurement, lang: Lang): HTMLElement {
  const mismatches = measurement.report.mismatches;
  if (mismatches.length === 0) {
    return el('p', { class: 'empty' }, t('justesse.mismatches.none', lang));
  }
  const rows = mismatches.map((mismatch) => [
    el('span', { class: 'mono', text: mismatch.id }),
    el('span', { class: 'mono', text: mismatch.expectedGroup }),
    el('span', { class: 'mono', text: mismatch.gotSignature || '—' }),
    categoryLabel(mismatch.expectedCategory, lang),
    categoryLabel(mismatch.gotCategory, lang),
  ]);
  return table(
    [
      t('justesse.col.id', lang),
      t('justesse.col.group', lang),
      t('justesse.col.signature', lang),
      t('justesse.col.expectedCategory', lang),
      t('justesse.col.gotCategory', lang),
    ],
    rows,
    t('justesse.mismatches.none', lang),
  );
}

/** Le détail : les divergences, puis le tableau complet. */
export function detailSection(measurement: CorpusMeasurement, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el('h2', {}, t('justesse.detail.title', lang)),
    el('p', { class: 'section-note' }, t('justesse.detail.note', lang)),
    el('h3', {}, t('justesse.mismatches.title', lang)),
    el('p', { class: 'section-note' }, t('justesse.mismatches.note', lang)),
    mismatchesSection(measurement, lang),
    detailTable(measurement, lang),
  );
}

/** La méthode : d'où vient le corpus, ce qu'il mesure, ce qu'il ne prouve pas. */
export function methodSection(lang: Lang): HTMLElement {
  const step = (title: string, text: string) => el('li', {}, el('strong', {}, title), el('span', {}, text));
  return el(
    'div',
    {},
    el('h2', {}, t('justesse.method.title', lang)),
    el(
      'ol',
      { class: 'steps' },
      step(t('justesse.method.origin.title', lang), t('justesse.method.origin.text', lang)),
      step(t('justesse.method.measures.title', lang), t('justesse.method.measures.text', lang)),
      step(t('justesse.method.limits.title', lang), t('justesse.method.limits.text', lang)),
    ),
    el('p', { class: 'section-note' }, repoLink('tools/gen/corpus.mjs', 'tools/gen/corpus.mjs')),
  );
}

/** Le libellé d'une grandeur comparée à la trace nocturne. */
function metricLabel(key: NightlyKey, lang: Lang): string {
  if (key === 'grouping') return t('justesse.metric.grouping', lang);
  if (key === 'falseFlaky') return t('justesse.metric.falseFlaky', lang);
  if (key === 'category') return t('justesse.metric.category', lang);
  if (key === 'failures') return t('justesse.metric.failures', lang);
  if (key === 'groups') return t('justesse.metric.groups', lang);
  return t('justesse.metric.signatures', lang);
}

/** La valeur d'une grandeur : une proportion, ou un compte. */
function metricValue(key: NightlyKey, value: number): string {
  if (key === 'failures' || key === 'groups' || key === 'signatures') return String(value);
  return formatConfidence(value);
}

/** La comparaison avec la trace publiée par la vérification nocturne. */
export function nightlySection(measurement: CorpusMeasurement, lang: Lang): HTMLElement {
  const rows = compareWithPublished(measurement);
  const body = rows.map((row) => [
    metricLabel(row.key, lang),
    metricValue(row.key, row.live),
    metricValue(row.key, row.published),
    badge(
      row.same ? t('justesse.nightly.same', lang) : t('justesse.nightly.diff', lang),
      row.same ? 'green' : 'yellow',
    ),
  ]);
  return el(
    'div',
    {},
    el('h2', {}, t('justesse.nightly.title', lang)),
    el('p', { class: 'section-note' }, fill(t('justesse.nightly.note', lang), { date: PUBLISHED.date })),
    table(
      [
        t('justesse.nightly.col.metric', lang),
        t('justesse.nightly.col.live', lang),
        t('justesse.nightly.col.published', lang),
        t('justesse.col.verdict', lang),
      ],
      body,
      t('justesse.nightly.authority', lang),
    ),
    el('p', { class: 'section-note' }, t('justesse.nightly.authority', lang), ' ', repoLink(PUBLISHED.source, PUBLISHED.source)),
  );
}
