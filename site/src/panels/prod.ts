/**
 * Panneau « Production » — l'app installée sur un vrai site Jira, en face de la démo.
 *
 * Le site rejoue déjà le moteur dans le navigateur ; ce panneau ajoute la
 * vitrine de l'environnement **réel** : les chiffres relevés le 12/11/2026 sur
 * `one-atlas-cndz.atlassian.net` (le Cerveau, v2.12.0, projet PAY), l'incident
 * d'infrastructure détecté, le refus honnête de Jira, les quatre environnements
 * et la marche à suivre pour reproduire.
 *
 * Toute la donnée figée vit dans `prod-faits.ts` (pur, testé) ; ce fichier ne
 * fait que la placer dans le DOM — aucun chiffre écrit à la main ici.
 */

import { diagnosticLabel, diagnosticTone, formatDate } from '@dejavu/present';
import { t as brainT } from '../../../apps/brain/src/ui/i18n';
import { badge, el, mount, table, type Child } from '../render/dom';
import { fill, t, type Lang } from '../lib/i18n';
import './prod-textes';
import {
  APP_ID,
  APP_PAGE_PATH,
  DEPLOY_ENV,
  DEPLOYED_VERSION,
  INCIDENT,
  INSTALL_STATUS,
  OBSERVED_AT,
  PROJECT_URL,
  REFUSAL_QUOTE,
  REFUSAL_STATUS,
  REPLAY,
  SITE_URL,
  environments,
  kindRows,
  observationRows,
  prodTotal,
  reproLinks,
  reproSteps,
} from './prod-faits';
import type { DemoRun } from '../lib/demo';
import type { Panel, PanelContext } from './types';



/** Un bloc de titre : h2 + note, puis le contenu qui suit. */
function bloc(titre: string, note: string, contenu: HTMLElement): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, titre),
    el('p', { class: 'section-note' }, note),
    contenu,
  );
}

/** Une carte : titre, puces de faits. */
function carte(titre: string, puces: string[]): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, titre),
    el('ul', { class: 'facts' }, ...puces.map((item) => el('li', {}, item))),
  );
}

/** La colonne « ici » : les quatre puces du navigateur. */
function iciPuce(lang: Lang): string[] {
  return [1, 2, 3, 4].map((n) => t(`prod.here.${n}`, lang));
}

/** La colonne « là-bas » : la dernière puce porte la date du relevé. */
function laBasPuce(lang: Lang): string[] {
  return [1, 2, 3].map((n) =>
    fill(t(`prod.there.${n}`, lang), { date: formatDate(OBSERVED_AT, lang) }),
  );
}

/** Les deux colonnes honnêtes : ici (navigateur) contre l'app déployée. */
function splitSection(lang: Lang): HTMLElement {
  return bloc(
    t('prod.split.title', lang),
    t('prod.split.note', lang),
    el(
      'div',
      { class: 'cards' },
      carte(t('prod.here.title', lang), iciPuce(lang)),
      carte(t('prod.there.title', lang), laBasPuce(lang)),
    ),
  );
}

/** Le tableau de l'installation : site, identifiant, version, page. */
function installTable(lang: Lang): HTMLElement {
  const rows: Child[][] = [
    [t('prod.app.site', lang), el('a', { href: PROJECT_URL, rel: 'noopener' }, SITE_URL)],
    [t('prod.app.id', lang), el('span', { class: 'mono' }, APP_ID)],
    [t('prod.app.env', lang), badge(DEPLOY_ENV, 'green')],
    [t('prod.app.version', lang), el('span', { class: 'mono' }, DEPLOYED_VERSION)],
    [t('prod.app.status', lang), badge(INSTALL_STATUS, 'green')],
    [t('prod.app.page', lang), el('span', { class: 'mono' }, APP_PAGE_PATH)],
  ];
  return table([t('prod.col.observation', lang), t('prod.col.value', lang)], rows, t('results.empty', lang));
}

/** Le tableau du rejeu : signatures, échecs, commentaires. */
function countsTable(lang: Lang): HTMLElement {
  const rows: Child[][] = observationRows().map((row) => [
    t(row.labelKey, lang),
    el('span', { class: 'mono' }, String(row.value)),
  ]);
  return table([t('prod.col.observation', lang), t('prod.col.value', lang)], rows, t('results.empty', lang));
}

/** Le tableau des diagnostics : les mots du moteur, les comptes relevés. */
function diagnosticsTable(lang: Lang): HTMLElement {
  const rows: Child[][] = kindRows().map((row) => [
    badge(diagnosticLabel(row.kind, lang), diagnosticTone(row.kind)),
    el('span', { class: 'mono' }, String(row.count)),
  ]);
  return table([t('prod.col.observation', lang), t('prod.col.value', lang)], rows, t('results.empty', lang));
}

/** L'observation de production : installation, rejeu, diagnostics. */
function observedSection(lang: Lang): HTMLElement {
  return bloc(
    t('prod.observed.title', lang),
    fill(t('prod.observed.note', lang), { date: formatDate(OBSERVED_AT, lang), site: SITE_URL }),
    el(
      'div',
      { class: 'block' },
      el('h3', {}, t('prod.facts.title', lang)),
      installTable(lang),
      el('h3', {}, t('prod.counts.title', lang)),
      countsTable(lang),
      el('h3', {}, t('prod.diagnostics', lang)),
      el('p', { class: 'section-note' }, fill(t('prod.diagnostics.note', lang), { total: prodTotal() })),
      diagnosticsTable(lang),
    ),
  );
}

/** L'incident d'infrastructure relevé en production (CI-15). */
function incidentCard(lang: Lang): HTMLElement {
  const facts: Array<[string, string]> = [
    [brainT('incident.family', lang), `${INCIDENT.signature} (${INCIDENT.familyHash})`],
    [brainT('incident.repos', lang), INCIDENT.repos.join(', ')],
    [brainT('incident.window', lang), `${INCIDENT.windowMinutes} min`],
    [brainT('incident.failures', lang), String(INCIDENT.failures)],
  ];
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, t('prod.incident.title', lang)),
    el('p', { class: 'section-note' }, t('prod.incident.note', lang)),
    el(
      'ul',
      { class: 'facts' },
      ...facts.map(([label, value]) => el('li', {}, `${label}: `, el('strong', {}, value))),
      el('li', {}, `${brainT('incident.ticket', lang)}: `, brainT('incident.noTicket', lang)),
    ),
  );
}

/** Le refus honnête de Jira : la preuve en français, telle qu'affichée. */
function refusalCard(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, t('prod.refusal.title', lang)),
    el('p', { class: 'section-note' }, fill(t('prod.refusal.note', lang), { status: REFUSAL_STATUS })),
    el('div', { class: 'panel' }, el('p', { class: 'mono' }, REFUSAL_QUOTE)),
  );
}

/** Une fiche d'environnement : titre, texte, lien réel. */
function nodeCard(id: 'jira' | 'sql' | 'actions' | 'pages', lang: Lang): HTMLElement {
  const href = environments().find((env) => env.id === id)?.href ?? '#';
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, t(`prod.env.${id}.title`, lang)),
    el('p', {}, t(`prod.env.${id}.text`, lang)),
    el('a', { href, rel: 'noopener' }, t('prod.env.link', lang)),
  );
}

/** Les quatre environnements réels, en fiches. */
function environmentsSection(lang: Lang): HTMLElement {
  const ids: Array<'jira' | 'sql' | 'actions' | 'pages'> = ['jira', 'sql', 'actions', 'pages'];
  return bloc(
    t('prod.env.title', lang),
    t('prod.env.note', lang),
    el('div', { class: 'cards' }, ...ids.map((id) => nodeCard(id, lang))),
  );
}

/** La marche à suivre : les vraies étapes, puis les liens (jamais de copie). */
function reproduceSection(lang: Lang): HTMLElement {
  const steps = el(
    'ol',
    { class: 'steps' },
    ...reproSteps().map((step) =>
      el(
        'li',
        {},
        el('strong', {}, t(step.titleKey, lang)),
        el('span', {}, t(step.textKey, lang)),
      ),
    ),
  );
  const links = el(
    'ul',
    {},
    ...reproLinks().map((link) =>
      el('li', {}, el('a', { href: link.href, rel: 'noopener' }, t(link.labelKey, lang))),
    ),
  );
  return bloc(
    t('prod.repro.title', lang),
    t('prod.repro.note', lang),
    el('div', {}, steps, links),
  );
}

/** Ce que la production ne montre pas encore — énoncé, jamais maquillé. */
function gapsSection(lang: Lang): HTMLElement {
  const items: Array<[string, string]> = [
    [t('prod.gaps.pairing.title', lang), t('prod.gaps.pairing.text', lang)],
    [t('prod.gaps.ticket.title', lang), t('prod.gaps.ticket.text', lang)],
  ];
  return bloc(
    t('prod.gaps.title', lang),
    t('prod.gaps.note', lang),
    el(
      'div',
      { class: 'cards' },
      ...items.map(([title, text]) => el('div', { class: 'card' }, el('h3', {}, title), el('p', {}, text))),
    ),
  );
}

/** Une ligne de comparaison : le libellé, le relevé figé, le calcul d'ici. */
function compareRow(label: Child, recorded: number, here: number): Child[] {
  const same = recorded === here;
  return [
    label,
    el('span', { class: 'mono' }, String(recorded)),
    el(
      'span',
      { class: 'mono' },
      String(here),
      same ? '' : ` (${here > recorded ? '+' : ''}${here - recorded})`,
    ),
  ];
}

/**
 * Le même rejeu, ici et maintenant : les compteurs et les verdicts recalculés
 * par cette page, en face des chiffres relevés en production.
 *
 * Deux colonnes, aucune retouche : quand les deux diffèrent, la différence est
 * affichée avec son écart, pas lissée. Le jeu d'exemple est le même fichier ;
 * c'est le moteur qui a bougé (le build déployé est antérieur à cet arbre).
 */
function liveSection(run: DemoRun, lang: Lang): HTMLElement {
  const counters: Child[][] = [
    compareRow(t('prod.signatures', lang), REPLAY.signatures, run.signatures.length),
    compareRow(t('prod.failures', lang), REPLAY.failures, run.failures),
    compareRow(t('prod.comments', lang), REPLAY.comments, run.tickets.filter((a) => a.kind === 'comment').length),
  ];
  const kinds: Child[][] = kindRows().map((row) =>
    compareRow(
      badge(diagnosticLabel(row.kind, lang), diagnosticTone(row.kind)),
      row.count,
      run.byKind[row.kind] ?? 0,
    ),
  );
  const headers = [
    t('prod.col.observation', lang),
    t('prod.col.recorded', lang),
    t('prod.col.here', lang),
  ];
  return bloc(
    t('prod.live.title', lang),
    fill(t('prod.live.note', lang), { date: formatDate(OBSERVED_AT, lang) }),
    el(
      'div',
      {},
      table(headers, [...counters, ...kinds], t('results.empty', lang)),
      el('p', { class: 'section-note' }, t('prod.live.why', lang)),
    ),
  );
}

export const panel: Panel = {
  id: 'prod',
  title: (lang) => t('panel.prod.title', lang),
  summary: (lang) => t('panel.prod.summary', lang),
  render(host, ctx) {
    const { lang } = ctx;
    mount(
      host,
      splitSection(lang),
      observedSection(lang),
      liveSection(ctx.workspace.view, lang),
      el(
        'div',
        { class: 'block' },
        el('div', { class: 'cards' }, incidentCard(lang), refusalCard(lang)),
      ),
      environmentsSection(lang),
      reproduceSection(lang),
      gapsSection(lang),
    );
  },
};