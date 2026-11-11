/**
 * Les quatre blocs de résultats : diagnostics, signatures, plan de tickets, coût.
 *
 * Tout vient de `runDemo()` — donc du vrai moteur. La mise en forme réutilise
 * `@dejavu/present` (libellés, tons, dates, confiance, commits courts) : la
 * page publique n'a pas sa propre idée de ce qu'est un diagnostic « instable ».
 */

import {
  actionLabel,
  categoryLabel,
  diagnosticLabel,
  diagnosticTone,
  formatConfidence,
  formatDate,
  shortCommit,
  statusLabel,
  statusTone,
} from '@dejavu/present';
import { badge, el, table, type Child } from './dom';
import { t, type Lang } from '../lib/i18n';
import type { DemoRun } from '../lib/demo';
import type { View } from './sections';

/** Une cellule « diagnostic » : pastille, titre, résumé et les faits. */
function diagnosticCell(run: DemoRun, index: number, lang: Lang): HTMLElement {
  const entry = run.diagnostics[index];
  return el(
    'div',
    {},
    badge(diagnosticLabel(entry.kind, lang), diagnosticTone(entry.kind)),
    el('div', {}, el('strong', {}, entry.title)),
    el('div', { class: 'facts' }, entry.summary),
    el('ul', { class: 'facts' }, ...entry.facts.map((fact) => el('li', {}, `${fact.label}: ${fact.value}`))),
  );
}

/** Le tableau des diagnostics : une ligne par échec du jeu d'exemple. */
export function diagnosticsTable(run: DemoRun, lang: Lang): HTMLElement {
  const headers = [
    t('col.time', lang), t('col.where', lang), t('col.commit', lang),
    t('col.kind', lang), t('col.confidence', lang), t('col.action', lang), t('col.signature', lang),
  ];
  const rows: Child[][] = run.diagnostics.map((entry, index) => [
    formatDate(entry.at, lang),
    el('div', {}, el('div', {}, entry.repo), el('div', { class: 'mono' }, entry.branch)),
    el('span', { class: 'mono', title: entry.commit }, shortCommit(entry.commit)),
    diagnosticCell(run, index, lang),
    formatConfidence(entry.confidence),
    actionLabel(entry.action, lang),
    el('span', { class: 'mono' }, entry.signature),
  ]);
  return table(headers, rows, t('results.empty', lang));
}

/** Le tableau des signatures de la mémoire. */
export function signaturesTable(run: DemoRun, lang: Lang): HTMLElement {
  const headers = [
    t('col.signature', lang), t('col.category', lang), t('col.status', lang),
    t('col.occurrences', lang), t('col.firstSeen', lang), t('col.lastSeen', lang),
    t('col.test', lang), t('col.ticket', lang),
  ];
  const rows: Child[][] = run.signatures.map((signature) => [
    el('span', { class: 'mono', title: signature.id }, signature.shortId),
    categoryLabel(signature.category, lang),
    badge(statusLabel(signature.status, lang), statusTone(signature.status)),
    String(signature.occurrences),
    formatDate(signature.firstSeen, lang),
    formatDate(signature.lastSeen, lang),
    el('span', { class: 'mono' }, signature.testName ?? '—'),
    el('span', { class: 'mono' }, signature.issueKey ?? '—'),
  ]);
  return table(headers, rows, t('results.empty', lang));
}

/** Le plan de tickets : ce que l'app ferait dans Jira. */
export function ticketsTable(run: DemoRun, lang: Lang): HTMLElement {
  const headers = [
    t('col.kindOfAction', lang), t('col.signature', lang), t('col.ticket', lang), t('col.summary', lang),
  ];
  const rows: Child[][] = run.tickets.map((action) => [
    action.kind,
    el('span', { class: 'mono' }, action.familyId.slice(0, 12)),
    el('span', { class: 'mono' }, action.issueKey ?? '—'),
    el('div', {}, el('div', {}, action.summary),
      action.comment ? el('div', { class: 'facts' }, action.comment) : null),
  ]);
  return table(headers, rows, t('results.empty', lang));
}

/** Le coût : les compteurs, puis les signatures qui coûtent le plus. */
export function costPanel(run: DemoRun, lang: Lang): HTMLElement {
  const entries: Array<[string, string | number]> = [
    [t('cost.minutesLost', lang), Math.round(run.cost.ciMinutesLost)],
    [t('cost.peopleAffected', lang), run.cost.peopleAffected],
    [t('cost.redBuilds', lang), run.cost.redBuilds],
    [t('cost.retries', lang), run.cost.retries],
    [t('cost.window', lang), run.cost.windowDays],
  ];
  const counters = el('ul', { class: 'counters' }, ...entries.map(([label, value]) =>
    el('li', {}, el('span', { class: 'value' }, String(value)), el('span', { class: 'label' }, label))));
  const top = table(
    [t('col.signature', lang), t('col.summary', lang), t('col.occurrences', lang), t('cost.minutesLost', lang)],
    run.cost.top.map((row) => [
      el('span', { class: 'mono' }, row.signature),
      row.title,
      String(row.occurrences),
      String(Math.round(row.ciMinutesLost)),
    ]),
    t('results.empty', lang),
  );
  return el('div', {}, counters, el('h3', {}, t('col.top', lang)), top);
}

/** Un bloc de résultats : titre, note, contenu. */
function block(title: string, note: string, content: HTMLElement): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, title),
    el('p', { class: 'section-note' }, note),
    content,
  );
}

/**
 * Les quatre blocs, rendus d'un coup — ou rien tant que le rejeu n'a pas tourné.
 *
 * C'est la seule fonction de ce module que `main.ts` appelle : les tableaux
 * restent exportés pour les tests, mais la page n'en connaît qu'un.
 */
export function renderResults(view: View): HTMLElement | undefined {
  const run = view.run;
  if (!run) return undefined;
  const lang = view.lang;
  return el(
    'div',
    {},
    block(t('results.diagnostics', lang), t('results.diagnostics.note', lang), diagnosticsTable(run, lang)),
    block(t('results.signatures', lang), t('results.signatures.note', lang), signaturesTable(run, lang)),
    block(t('results.tickets', lang), t('results.tickets.note', lang), ticketsTable(run, lang)),
    block(t('results.cost', lang), t('results.cost.note', lang), costPanel(run, lang)),
  );
}
