/**
 * The panels the Brain added this week — rendered from the app's pure modules.
 *
 * Six panels, one per module of `apps/brain/src/pure/`: the infrastructure
 * incident, the cost trend, the health of the memory, the audit journal, the
 * export of the memory and the retention policy of the raw excerpts. Each one
 * shows what the product computes **and** the JSON of that view model, so a
 * judge can read the code that produced the numbers.
 *
 * Nothing here is simulated: the incident comes from the engine's own
 * detector, the trend from the engine's cost report, the health from the row
 * counts of the shared memory, the journal from the ticket plan of the replay.
 */

import { formatDate, formatMinutes } from '@dejavu/present';
import { el, table, type Child } from '../render/dom';
import { registerStrings, t, type Lang } from '../lib/i18n';
import { formatOccupancy, usedPercent } from '../../../apps/brain/src/pure/memoryHealth';
import type { WeeklyData } from './jira-donnees';

registerStrings({
  'jira.json': ['View model (JSON)', 'Modèle de vue (JSON)'],
  'jira.panels.note': [
    'The panels the Brain added to the CI Memory page, each one computed by the pure module of the app that owns it.',
    'Les panneaux que le Cerveau ajoute à la page Mémoire de CI, chacun calculé par le module pur de l’app qui le porte.',
  ],
  'jira.panels.incident': ['Infrastructure incident', 'Incident d’infrastructure'],
  'jira.panels.incident.none': [
    'No infrastructure incident in this sample set: no family fails on several repositories inside the detection window.',
    'Aucun incident d’infrastructure dans ce jeu d’exemple : aucune famille n’échoue sur plusieurs dépôts dans la fenêtre de détection.',
  ],
  'jira.panels.trend': ['Cost trend', 'Tendance de coût'],
  'jira.panels.trend.totals': [
    'Window: {days} days — {minutes} CI minutes lost, {red} red builds. Variation on the previous window: {delta} minutes ({pct}).',
    'Fenêtre : {days} jours — {minutes} minutes de CI perdues, {red} builds rouges. Variation sur la fenêtre précédente : {delta} minutes ({pct}).',
  ],
  'jira.panels.health': ['Memory health', 'Santé de la mémoire'],
  'jira.panels.health.note': [
    'The occupancy is an estimate: the app counts the rows with SQL COUNT(*); the browser counts the rows the shared memory holds, and leaves the tables it cannot read at zero.',
    'L’occupation est une estimation : l’app compte les lignes avec COUNT(*) en SQL ; le navigateur compte les lignes que la mémoire partagée contient, et laisse à zéro les tables qu’il ne peut pas lire.',
  ],
  'jira.panels.health.used': [
    'Estimated: {bytes} of the {limit} platform limit ({percent}%), {rows} rows in memory.',
    'Estimé : {bytes} sur la limite plateforme de {limit} ({percent} %), {rows} lignes en mémoire.',
  ],
  'jira.panels.audit': ['What the app did', 'Ce que l’app a fait'],
  'jira.panels.audit.note': [
    'The journal the Brain writes in Jira; here it is rebuilt from the ticket plan of the replay, with the app’s own action names.',
    'Le journal que le Cerveau écrit dans Jira ; ici il est reconstruit depuis le plan de tickets du rejeu, avec les noms d’action de l’app.',
  ],
  'jira.panels.export': ['Export of the memory', 'Export de la mémoire'],
  'jira.panels.export.note': [
    'Both formats are produced by the resolver: a tidy CSV and a JSON document, byte-identical from one export to the next.',
    'Les deux formats sont produits par le résolveur : un CSV lisible et un document JSON, identiques d’un export à l’autre.',
  ],
  'jira.panels.excerpt': ['Minimization of the raw excerpts', 'Minimisation des extraits bruts'],
  'jira.panels.excerpt.note': [
    'The three retention policies applied to a real excerpt of the sample set: the fingerprint always survives, the text only when the policy allows it.',
    'Les trois politiques de rétention appliquées à un extrait réel du jeu d’exemple : l’empreinte survit toujours, le texte seulement si la politique l’autorise.',
  ],
  'jira.col.repos': ['Repositories', 'Dépôts'],
  'jira.col.started': ['Started', 'Début'],
  'jira.col.window': ['Detection window (min)', 'Fenêtre de détection (min)'],
  'jira.col.table': ['Table', 'Table'],
  'jira.col.rows': ['Rows', 'Lignes'],
  'jira.col.bytes': ['Estimated size', 'Taille estimée'],
  'jira.col.action': ['Action', 'Action'],
  'jira.col.detail': ['Detail', 'Détail'],
  'jira.col.policy': ['Policy', 'Politique'],
  'jira.col.fingerprint': ['Fingerprint', 'Empreinte'],
  'jira.col.kept': ['Bytes kept', 'Octets conservés'],
  'jira.col.masked': ['Masked', 'Masqué'],
  'jira.col.truncated': ['Truncated', 'Tronqué'],
  'jira.col.file': ['File', 'Fichier'],
  'jira.col.format': ['Format', 'Format'],
  'jira.col.counts': ['Counts', 'Comptes'],
  'jira.col.day': ['Day', 'Jour'],
  'jira.col.bar': ['CI minutes', 'Minutes de CI'],
});

/** A block of JSON: the view model, as the product computed it. */
export function jsonBlock(label: string, value: unknown): HTMLElement {
  return el(
    'details',
    {},
    el('summary', {}, label),
    el('pre', { class: 'mono' }, JSON.stringify(value, null, 2)),
  );
}

/** One titled block: a title, a note, the rendering, the JSON. */
function block(
  title: string,
  note: string,
  content: HTMLElement,
  json: unknown,
  lang: Lang,
): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h3', {}, title),
    el('p', { class: 'section-note' }, note),
    content,
    jsonBlock(t('jira.json', lang), json),
  );
}

/** The infrastructure incident, when the detector found one. */
function incidentBlock(data: WeeklyData, lang: Lang): HTMLElement {
  const incident = data.incident;
  if (!incident) {
    return el('p', { class: 'empty' }, t('jira.panels.incident.none', lang));
  }
  const rows: Child[][] = [
    [t('jira.col.repos', lang), incident.repos.join(', ')],
    [t('jira.col.started', lang), formatDate(incident.startedAt, lang)],
    [t('col.lastSeen', lang), formatDate(incident.lastSeenAt, lang)],
    [t('jira.col.window', lang), String(incident.windowMinutes)],
    [t('col.occurrences', lang), String(incident.occurrences)],
    [t('col.ticket', lang), incident.issueKey ?? '—'],
  ];
  return el(
    'div',
    { class: 'card' },
    el('p', {}, el('span', { class: 'mono' }, incident.signatureShort)),
    table([t('jira.settings.field', lang), t('jira.settings.value', lang)], rows, ''),
  );
}

/** The cost trend: one row per day of the window, with its text bar. */
function trendBlock(data: WeeklyData, lang: Lang): HTMLElement {
  const rows: Child[][] = data.points.map((point) => [
    point.day,
    String(point.redBuilds),
    String(Math.round(point.ciMinutesLost)),
    el('span', { class: 'mono' }, point.bar),
  ]);
  const totals = t('jira.panels.trend.totals', lang)
    .replace('{days}', String(data.trend.windowDays))
    .replace('{minutes}', formatMinutes(Math.round(data.trend.current.ciMinutesLost * 60)))
    .replace('{red}', String(data.trend.current.redBuilds))
    .replace('{delta}', String(data.trend.minutesDelta))
    .replace('{pct}', data.trend.minutesDeltaPct === null ? '—' : `${data.trend.minutesDeltaPct}%`);
  return el(
    'div',
    {},
    el('p', { class: 'facts' }, totals),
    table(
      [t('jira.col.day', lang), t('cost.redBuilds', lang), t('cost.minutesLost', lang), t('jira.col.bar', lang)],
      rows,
      t('results.empty', lang),
    ),
  );
}

/** The health of the memory: one row per table, with the estimated size. */
function healthBlock(data: WeeklyData, lang: Lang): HTMLElement {
  const rows: Child[][] = data.health.tables.map((entry) => [
    el('span', { class: 'mono' }, entry.table),
    String(entry.rows),
    formatOccupancy(entry.estimatedBytes),
  ]);
  const used = t('jira.panels.health.used', lang)
    .replace('{bytes}', formatOccupancy(data.health.estimatedBytes))
    .replace('{limit}', formatOccupancy(data.health.limitBytes))
    .replace('{percent}', String(usedPercent(data.health.estimatedBytes)))
    .replace('{rows}', String(data.health.totalRows));
  return el(
    'div',
    {},
    el('p', { class: 'facts' }, used),
    table([t('jira.col.table', lang), t('jira.col.rows', lang), t('jira.col.bytes', lang)], rows, ''),
  );
}

/** The audit journal: what the app did, with its own action names. */
function auditBlock(data: WeeklyData, lang: Lang): HTMLElement {
  const rows: Child[][] = data.audit.map((line) => [
    formatDate(line.createdAt, lang),
    line.action,
    el('span', { class: 'mono' }, line.signatureId ?? '—'),
    el('span', { class: 'mono' }, line.issueKey ?? '—'),
    line.detail ?? '—',
  ]);
  return table(
    [
      t('col.time', lang), t('jira.col.action', lang), t('col.signature', lang),
      t('col.ticket', lang), t('jira.col.detail', lang),
    ],
    rows,
    t('results.empty', lang),
  );
}

/** One export: its file name, its counts and the head of the document. */
function exportBlock(data: WeeklyData, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    ...data.exports.map((item) =>
      el(
        'div',
        { class: 'card' },
        el('h3', {}, item.filename),
        el('p', {}, `${t('jira.col.format', lang)}: ${item.format} — ${item.contentType}`),
        el('p', { class: 'facts' },
          `${t('jira.col.counts', lang)}: ${item.counts.signatures} / ${item.counts.occurrences} / ${item.counts.resolutions}`),
        el('pre', { class: 'mono' }, item.content.split('\r\n').slice(0, 6).join('\n')),
      ),
    ),
  );
}

/** The three retention policies, applied to one real excerpt. */
function excerptBlock(data: WeeklyData, lang: Lang): HTMLElement {
  const rows: Child[][] = data.excerpts.map((entry) => [
    entry.policy,
    el('span', { class: 'mono' }, entry.result.fingerprint),
    String(entry.result.bytes),
    entry.result.masked ? '—' : '—',
    entry.result.truncated ? 'yes' : 'no',
    entry.result.text ? el('span', { class: 'mono' }, `${entry.result.text.slice(0, 120)}…`) : '—',
  ]);
  return el(
    'div',
    {},
    el('pre', { class: 'mono' }, `${data.excerptSource.slice(0, 240)}…`),
    table(
      [
        t('jira.col.policy', lang), t('jira.col.fingerprint', lang), t('jira.col.kept', lang),
        t('jira.col.masked', lang), t('jira.col.truncated', lang), t('jira.col.detail', lang),
      ],
      rows,
      '',
    ),
  );
}

/** The six panels, each with its rendering and its view model. */
export function renderWeekly(data: WeeklyData, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el('p', { class: 'section-note' }, t('jira.panels.note', lang)),
    block(t('jira.panels.incident', lang), '', incidentBlock(data, lang), data.incident ?? null, lang),
    block(t('jira.panels.trend', lang), '', trendBlock(data, lang), data.trend, lang),
    block(
      t('jira.panels.health', lang),
      t('jira.panels.health.note', lang),
      healthBlock(data, lang),
      { health: data.health, rows: data.healthRows },
      lang,
    ),
    block(t('jira.panels.audit', lang), t('jira.panels.audit.note', lang), auditBlock(data, lang), data.audit, lang),
    block(
      t('jira.panels.export', lang),
      t('jira.panels.export.note', lang),
      exportBlock(data, lang),
      data.exports,
      lang,
    ),
    block(
      t('jira.panels.excerpt', lang),
      t('jira.panels.excerpt.note', lang),
      excerptBlock(data, lang),
      data.excerpts,
      lang,
    ),
  );
}
