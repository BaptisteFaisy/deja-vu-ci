/**
 * Panneau « Incident » — une panne d'infrastructure, pas dix alertes (CI-15).
 *
 * Le visiteur voit la détection réelle (`detectOutbreak` du moteur) sur la
 * mémoire partagée, le panneau d'incident du Cerveau rendu comme l'app Jira
 * l'affiche (mêmes libellés, mêmes valeurs) avec son JSON brut, la
 * comparaison honnête « sans regroupement / avec regroupement » calculée
 * depuis les occurrences réelles, et les diagnostics `infrastructure` du
 * rejeu avec leurs faits. Un réglage de seuils recalcule la détection en
 * direct : les valeurs par défaut sont les constantes du moteur.
 *
 * Toute la logique de calcul vit dans `incident-donnees.ts` (pur, testé) ;
 * ce fichier ne fait que placer des valeurs dans le DOM. Les champs de seuil
 * ne sont jamais reconstruits pendant la saisie (le focus reste), seuls les
 * résultats le sont.
 */

import { actionLabel, formatConfidence, formatDate, shortCommit } from '@dejavu/present';
import { t as brainT } from '../../../apps/brain/src/ui/i18n';
import { badge, el, mount, table, type Child } from '../render/dom';
import { fill, registerStrings, t, type Lang } from '../lib/i18n';
import {
  computeIncident,
  defaultThresholds,
  sanitizeThreshold,
  type IncidentData,
} from './incident-donnees';
import type { Panel, PanelContext } from './types';

registerStrings({
  'panel.incident.title': ['Incident', 'Incident'],
  'panel.incident.summary': [
    'One infrastructure outage instead of ten alerts: the same signature failing everywhere at once.',
    'Une panne d’infrastructure au lieu de dix alertes : la même signature qui échoue partout en même temps.',
  ],
  'incident.computing': [
    'Detecting the outage in the shared memory…',
    'Détection de la panne dans la mémoire partagée…',
  ],
  'incident.error': ['The detection failed: {error}', 'La détection a échoué : {error}'],
  'incident.thresholds': ['Detection thresholds', 'Seuils de détection'],
  'incident.thresholds.note': [
    'Defaults are the engine’s own constants (DEFAULT_SETTINGS): {window} minutes, {repos} repositories. Change them — the detection below is recomputed live from the shared memory.',
    'Les valeurs par défaut sont les constantes du moteur (DEFAULT_SETTINGS) : {window} minutes, {repos} dépôts. Changez-les — la détection ci-dessous est recalculée en direct depuis la mémoire partagée.',
  ],
  'incident.windowMin': ['Window (minutes)', 'Fenêtre (minutes)'],
  'incident.minRepos': ['Distinct repositories (min)', 'Dépôts distincts (min)'],
  'incident.reset': ['Reset to engine defaults', 'Revenir aux réglages du moteur'],
  'incident.detection': ['The detection, computed by the engine', 'La détection, calculée par le moteur'],
  'incident.detection.note': [
    'detectOutbreak (packages/core) over {count} failure occurrences read from the shared memory — the same call the Jira app makes.',
    'detectOutbreak (packages/core) sur {count} occurrences d’échec lues dans la mémoire partagée — le même appel que l’app Jira.',
  ],
  'incident.empty': [
    'No outbreak with these thresholds: no family reaches {repos} distinct repositories inside {window} minutes.',
    'Aucune épidémie avec ces seuils : aucune famille n’atteint {repos} dépôts distincts en {window} minutes.',
  ],
  'incident.c.family': ['Family', 'Famille'],
  'incident.c.repos': ['Repositories hit', 'Dépôts touchés'],
  'incident.c.start': ['Started', 'Début'],
  'incident.c.window': ['Window', 'Fenêtre'],
  'incident.c.failures': ['Failures in window', 'Échecs dans la fenêtre'],
  'incident.brain': ['The Brain’s incident panel (Jira app)', 'Le panneau d’incident du Cerveau (app Jira)'],
  'incident.brain.note': [
    'Assembled by apps/brain/src/pure/incident.ts — the exact module the Jira screen calls — shown as the app displays it, with its raw JSON beside.',
    'Assemblé par apps/brain/src/pure/incident.ts — le module exact qu’appelle l’écran Jira — rendu comme l’app l’affiche, avec son JSON brut à côté.',
  ],
  'incident.rawJson': ['Raw JSON (what the app receives)', 'JSON brut (ce que reçoit l’app)'],
  'incident.compare': ['Without grouping vs with grouping', 'Sans regroupement contre avec regroupement'],
  'incident.compare.note': [
    'Both numbers come from the memory: the real failures inside the incident window, and the single ticket the family owns (§ 11).',
    'Les deux nombres viennent de la mémoire : les échecs réels dans la fenêtre de l’incident, et l’unique ticket que possède la famille (§ 11).',
  ],
  'incident.without': ['Without Déjà-vu CI', 'Sans Déjà-vu CI'],
  'incident.without.detail': [
    '{alerts} alerts — one per failing build inside the window.',
    '{alerts} alertes — une par build en échec dans la fenêtre.',
  ],
  'incident.with': ['With Déjà-vu CI', 'Avec Déjà-vu CI'],
  'incident.with.detail': [
    '1 incident, {tickets} ticket — one per family, however many builds fail.',
    '1 incident, {tickets} ticket — un par famille, quel que soit le nombre d’échecs.',
  ],
  'incident.compare.empty': [
    'No incident detected with these thresholds: nothing to compare.',
    'Aucun incident détecté avec ces seuils : rien à comparer.',
  ],
  'incident.infra': [
    'The infrastructure diagnostics behind the decision',
    'Les diagnostics « infrastructure » derrière la décision',
  ],
  'incident.infra.note': [
    '{count} failures of the replay were diagnosed “infrastructure” — each with the facts the engine relied on.',
    '{count} échecs du rejeu ont été diagnostiqués « infrastructure » — chacun avec les faits sur lesquels le moteur s’est appuyé.',
  ],
});

/** Le dernier rendu vivant : hôte, contexte, et div où montent les résultats. */
let dernier: { host: HTMLElement; ctx: PanelContext; resultats: HTMLElement } | undefined;
/** Les seuils choisis par le visiteur (persistés d'un rendu à l'autre). */
let seuils = defaultThresholds();
/** Anti-obsolescence : seul le dernier calcul lancé a le droit de monter. */
let token = 0;
/** Abonnement à l'atelier : la détection suit la mémoire partagée. */
let suivi: PanelContext['workspace'] | undefined;
let desabonner: (() => void) | undefined;

/** Recalcule l'incident, puis remplace les résultats (rendus périmés ignorés). */
function dessiner(): void {
  if (!dernier) return;
  const { resultats, ctx } = dernier;
  if (!resultats.isConnected) return;
  const monToken = ++token;
  mount(resultats, el('p', { class: 'status' }, t('incident.computing', ctx.lang)));
  const monter = (node: HTMLElement): void => {
    if (monToken === token && resultats.isConnected) mount(resultats, node);
  };
  void computeIncident(ctx.workspace, seuils)
    .then((data) => monter(blocs(data, ctx.lang)))
    .catch((error: unknown) =>
      monter(el('p', { class: 'status error' },
        fill(t('incident.error', ctx.lang), { error: String(error) }))));
}

/** Un seuil saisi : assaini, puis détection recalculée en direct. */
function regler(champ: 'windowMin' | 'repos', raw: number): void {
  seuils = { ...seuils, [champ]: sanitizeThreshold(raw, seuils[champ]) };
  dessiner();
}

/** Un champ numérique étiqueté du réglage de seuils. */
function champSeuil(cle: string, champ: 'windowMin' | 'repos', lang: Lang): HTMLElement {
  const input = el('input', {
    type: 'number',
    min: '1',
    step: '1',
    value: String(seuils[champ]),
    'aria-label': t(cle, lang),
    oninput: (event) => regler(champ, (event.target as HTMLInputElement).valueAsNumber),
  });
  return el('div', { class: 'card' }, el('h3', {}, t(cle, lang)), input);
}

/** Le réglage de seuils : deux champs, et un retour aux constantes du moteur. */
function controles(lang: Lang): HTMLElement {
  const defaults = defaultThresholds();
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, t('incident.thresholds', lang)),
    el('p', { class: 'section-note' },
      fill(t('incident.thresholds.note', lang), { window: defaults.windowMin, repos: defaults.repos })),
    el(
      'div',
      { class: 'cards' },
      champSeuil('incident.windowMin', 'windowMin', lang),
      champSeuil('incident.minRepos', 'repos', lang),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, '\u00a0'),
        el('button', {
          type: 'button',
          onclick: () => {
            seuils = defaultThresholds();
            if (dernier) panel.render(dernier.host, dernier.ctx);
          },
        }, t('incident.reset', lang)),
      ),
    ),
  );
}

/** Un bloc du panneau : titre, note, contenu. */
function bloc(title: string, note: string, content: HTMLElement): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, title),
    el('p', { class: 'section-note' }, note),
    content,
  );
}

/** Les compteurs de la détection, ou l'état vide explicite. */
function compteurs(data: IncidentData, lang: Lang): HTMLElement {
  const outbreak = data.outbreak;
  if (!outbreak) {
    return el('p', { class: 'empty' },
      fill(t('incident.empty', lang), { window: data.thresholds.windowMin, repos: data.thresholds.repos }));
  }
  const entries: Array<[string, string]> = [
    [t('incident.c.family', lang), outbreak.familyId.slice(0, 8)],
    [t('incident.c.repos', lang), String(outbreak.repos.length)],
    [t('incident.c.start', lang), formatDate(outbreak.startedAt, lang)],
    [t('incident.c.window', lang), `${data.thresholds.windowMin} min`],
    [t('incident.c.failures', lang), String(data.inWindow.length)],
  ];
  return el(
    'ul',
    { class: 'counters' },
    ...entries.map(([label, value]) =>
      el('li', {}, el('span', { class: 'value mono' }, value), el('span', { class: 'label' }, label)),
    ),
  );
}

/** Les échecs réels tombés dans la fenêtre de l'incident. */
function fenetreTable(data: IncidentData, lang: Lang): HTMLElement {
  const rows: Child[][] = data.inWindow.map((occurrence) => [
    el('span', { class: 'mono' }, occurrence.occurredAt),
    el('div', {}, el('div', {}, occurrence.repo), el('div', { class: 'mono' }, occurrence.branch)),
    el('span', { class: 'mono', title: occurrence.commit }, shortCommit(occurrence.commit)),
  ]);
  return table([t('col.time', lang), t('col.where', lang), t('col.commit', lang)], rows, '');
}

/** Le bloc « détection réelle » : compteurs, puis les échecs de la fenêtre. */
function detection(data: IncidentData, lang: Lang): HTMLElement {
  return el('div', {}, compteurs(data, lang), data.outbreak ? fenetreTable(data, lang) : null);
}

/** Le panneau d'incident tel que l'app Jira l'affiche (mêmes libellés). */
function brainCard(data: IncidentData, lang: Lang): HTMLElement {
  const panneau = data.panel;
  if (!panneau) {
    return el('div', { class: 'card' }, el('p', { class: 'empty' }, brainT('incident.none', lang)));
  }
  const lines: Array<[string, string]> = [
    [brainT('incident.family', lang), `${panneau.signatureShort} (${panneau.familyId.slice(0, 8)})`],
    [brainT('incident.repos', lang), panneau.repos.join(', ')],
    [brainT('incident.window', lang), `${panneau.windowMinutes} min`],
    [brainT('incident.started', lang), formatDate(panneau.startedAt, lang)],
    [brainT('incident.failures', lang), String(panneau.occurrences)],
  ];
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, brainT('incident.title', lang)),
    el(
      'ul',
      { class: 'facts' },
      ...lines.map(([label, value]) => el('li', {}, `${label}: `, el('strong', {}, value))),
      el(
        'li',
        {},
        `${brainT('incident.ticket', lang)}: `,
        panneau.issueKey ? badge(panneau.issueKey, 'purple') : brainT('incident.noTicket', lang),
      ),
    ),
  );
}

/** Le bloc Cerveau : le panneau rendu comme dans Jira, et son JSON brut. */
function brain(data: IncidentData, lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'cards' },
    brainCard(data, lang),
    el(
      'div',
      { class: 'card' },
      el('h3', {}, t('incident.rawJson', lang)),
      el('pre', { class: 'mono' }, JSON.stringify(data.panel ?? null, null, 2)),
    ),
  );
}

/** Une carte de la comparaison : un grand nombre, et ce qu'il veut dire. */
function carteComparaison(title: string, value: number, detail: string): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, title),
    el('ul', { class: 'counters' },
      el('li', {}, el('span', { class: 'value' }, String(value)), el('span', { class: 'label' }, detail))),
  );
}

/** La comparaison honnête : alertes sans regroupement, ticket avec. */
function compare(data: IncidentData, lang: Lang): HTMLElement {
  if (!data.panel) return el('p', { class: 'empty' }, t('incident.compare.empty', lang));
  return el(
    'div',
    { class: 'cards' },
    carteComparaison(
      t('incident.without', lang),
      data.comparison.alertsWithout,
      fill(t('incident.without.detail', lang), { alerts: data.comparison.alertsWithout }),
    ),
    carteComparaison(
      t('incident.with', lang),
      data.comparison.ticketsWith,
      fill(t('incident.with.detail', lang), { tickets: data.comparison.ticketsWith }),
    ),
  );
}

/** Le tableau des diagnostics `infrastructure` du rejeu, avec leurs faits. */
function infra(data: IncidentData, lang: Lang): HTMLElement {
  const rows: Child[][] = data.infra.map((entry) => [
    el('span', { class: 'mono' }, entry.at),
    el('div', {}, el('div', {}, entry.repo), el('div', { class: 'mono' }, entry.branch)),
    el('span', { class: 'mono', title: entry.commit }, shortCommit(entry.commit)),
    formatConfidence(entry.confidence),
    actionLabel(entry.action, lang),
    el('span', { class: 'mono' }, entry.signature),
    el('ul', { class: 'facts' }, ...entry.facts.map((fact) => el('li', {}, `${fact.label}: ${fact.value}`))),
  ]);
  return table(
    [
      t('col.time', lang), t('col.where', lang), t('col.commit', lang),
      t('col.confidence', lang), t('col.action', lang), t('col.signature', lang),
      t('kind.infrastructure', lang),
    ],
    rows,
    t('results.empty', lang),
  );
}

/** Les blocs de résultats, dans l'ordre de lecture. */
function blocs(data: IncidentData, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    bloc(
      t('incident.detection', lang),
      fill(t('incident.detection.note', lang), { count: data.occurrenceCount }),
      detection(data, lang),
    ),
    bloc(t('incident.brain', lang), t('incident.brain.note', lang), brain(data, lang)),
    bloc(t('incident.compare', lang), t('incident.compare.note', lang), compare(data, lang)),
    bloc(
      t('incident.infra', lang),
      fill(t('incident.infra.note', lang), { count: data.infra.length }),
      infra(data, lang),
    ),
  );
}

export const panel: Panel = {
  id: 'incident',
  title: (lang) => t('panel.incident.title', lang),
  summary: (lang) => t('panel.incident.summary', lang),
  render(host, ctx) {
    const resultats = el('div', {});
    mount(host, controles(ctx.lang), resultats);
    dernier = { host, ctx, resultats };
    if (suivi !== ctx.workspace) {
      desabonner?.();
      suivi = ctx.workspace;
      desabonner = ctx.workspace.subscribe(() => dessiner());
    }
    dessiner();
  },
};
