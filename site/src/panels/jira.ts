/**
 * Panel "Jira screens" — the screens of the Brain, computed by their real models.
 *
 * Four sub-tabs, four screens of the Jira app:
 *  - the "CI Memory" project page, with the signature rows, the filters and
 *    the sort of `apps/brain/src/ui/format.ts`;
 *  - the issue panel, the text a Rovo agent reads on a ticket, built by
 *    `apps/brain/src/pure/issueContextText.ts`;
 *  - the panels the Brain added this week, from the app's pure modules;
 *  - the settings, with the schema the app really validates.
 *
 * Every sub-tab shows the JSON of its view model next to the rendering: what
 * the visitor sees is what the product computes, and the proof is readable.
 */

import {
  CATEGORIES_LIST,
  SIGNATURE_STATUSES,
  categoryLabel,
  formatDate,
  statusLabel,
} from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import { badge, el, mount, table, type Child } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel, PanelContext } from './types';
import {
  issueChoices,
  issueData,
  pageData,
  settingsData,
  visibleRows,
  weeklyData,
  type IssueChoice,
  type IssueData,
  type JiraSource,
  type PageData,
  type PageQuery,
  type SettingsData,
  type WeeklyData,
} from './jira-donnees';
import { jsonBlock, renderWeekly } from './jira-semaine';

registerStrings({
  'panel.jira.title': ['Jira screens', 'Écrans Jira'],
  'panel.jira.summary': [
    'The four screens of the Brain (the Jira app), computed by their real view models: the CI Memory page, the issue panel, the panels added this week and the settings.',
    'Les quatre écrans du Cerveau (l’app Jira), calculés par leurs vrais modèles de vue : la page Mémoire de CI, l’encart de ticket, les panneaux ajoutés cette semaine et les réglages.',
  ],
  'jira.tab.page': ['Project page — CI Memory', 'Page projet — Mémoire de CI'],
  'jira.tab.issue': ['Issue panel', 'Encart de ticket'],
  'jira.tab.panels': ['Panels added this week', 'Panneaux ajoutés cette semaine'],
  'jira.tab.settings': ['Settings', 'Réglages'],
  'jira.loading': ['Loading the real views…', 'Chargement des vraies vues…'],
  'jira.page.note': [
    'The CI Memory page as the Brain computes it: the rows, the filters and the sort come from the screen views of the app, the cost from the engine.',
    'La page Mémoire de CI telle que le Cerveau la calcule : les lignes, les filtres et le tri viennent des vues d’écran de l’app, le coût du moteur.',
  ],
  'jira.page.filter': ['Search a signature', 'Rechercher une signature'],
  'jira.page.all': ['All', 'Toutes'],
  'jira.page.sort': ['Sort by', 'Trier par'],
  'jira.page.cost': ['The cost of the same page', 'Le coût de la même page'],
  'jira.page.empty': ['No signature matches this filter.', 'Aucune signature ne correspond à ce filtre.'],
  'jira.sort.lastSeen': ['Last seen', 'Dernière vue'],
  'jira.sort.occurrences': ['Occurrences', 'Occurrences'],
  'jira.sort.status': ['Status', 'Statut'],
  'jira.sort.category': ['Category', 'Catégorie'],
  'jira.col.error': ['Error', 'Erreur'],
  'jira.col.template': ['Normalized template', 'Gabarit normalisé'],
  'jira.issue.note': [
    'The text an agent Rovo reads on a ticket: the diagnostic, the ticket of the problem and what the failure already cost.',
    'Le texte qu’un agent Rovo lit sur un ticket : le diagnostic, le ticket du problème et ce que l’échec a déjà coûté.',
  ],
  'jira.issue.pick': ['Signature of the ticket', 'Signature du ticket'],
  'jira.issue.text': ['Text read by Rovo', 'Texte lu par Rovo'],
  'jira.issue.facts': ['The facts behind the diagnostic', 'Les faits derrière le diagnostic'],
  'jira.issue.occurrences': ['Failures attached', 'Échecs rattachés'],
  'jira.settings.note': [
    'The real schema of the settings, with the values the engine starts from and what the validator accepts or refuses. The page only shows it: saving happens in the Jira app, which writes into its own storage.',
    'Le vrai schéma des réglages, avec les valeurs de départ du moteur et ce que le validateur accepte ou refuse. La page ne fait que le montrer : la sauvegarde se fait dans l’app Jira, qui écrit dans son propre stockage.',
  ],
  'jira.settings.current': ['Stored settings', 'Réglages stockés'],
  'jira.settings.defaults': ['Engine defaults', 'Valeurs par défaut du moteur'],
  'jira.settings.examples': ['What the validator accepts or refuses', 'Ce que le validateur accepte ou refuse'],
  'jira.settings.field': ['Field', 'Champ'],
  'jira.settings.value': ['Value', 'Valeur'],
  'jira.settings.input': ['Payload', 'Charge utile'],
  'jira.settings.result': ['Answer of the validator', 'Réponse du validateur'],
});

/** The four screens of the Brain. */
type TabId = 'page' | 'issue' | 'panels' | 'settings';

/** One sub-tab. */
interface Tab {
  id: TabId;
  label(lang: Lang): string;
}

/** The sub-tabs, in the order the app shows them. */
const TABS: Tab[] = [
  { id: 'page', label: (lang) => t('jira.tab.page', lang) },
  { id: 'issue', label: (lang) => t('jira.tab.issue', lang) },
  { id: 'panels', label: (lang) => t('jira.tab.panels', lang) },
  { id: 'settings', label: (lang) => t('jira.tab.settings', lang) },
];

/** What the visitor chose, kept between two renders. */
interface PanelState {
  tab: TabId;
  query: PageQuery;
  signatureId: string;
}

const state: PanelState = {
  tab: 'page',
  query: { text: '', sortKey: 'lastSeen' },
  signatureId: '',
};

/** Everything the panel needs, loaded once per render of the workshop. */
interface Loaded {
  source: JiraSource;
  lang: Lang;
  page: PageData;
  choices: IssueChoice[];
  weekly: WeeklyData;
  settings: SettingsData;
}

let loaded: Loaded | undefined;
let current: { body: HTMLElement; ctx: PanelContext } | undefined;
let token = 0;

/** An option of a select. */
function option(label: string, value: string, selected: boolean): HTMLElement {
  return el('option', { value, selected }, label);
}

/** A labelled select: the label is the first line of the card. */
function select(
  label: string,
  options: HTMLElement[],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const node = el(
    'select',
    { onchange: (event) => onChange((event.target as HTMLSelectElement).value) },
    ...options.map((item) => {
      const element = item as HTMLOptionElement;
      element.selected = element.value === value;
      return element;
    }),
  );
  return el('label', { class: 'card' }, el('div', {}, label), node);
}

/** The filters and the sort of the project page. */
function controls(draw: () => void, lang: Lang): HTMLElement {
  const query = state.query;
  const search = el('input', {
    type: 'search',
    value: query.text,
    placeholder: t('jira.page.filter', lang),
    oninput: (event) => {
      state.query.text = (event.target as HTMLInputElement).value;
      draw();
    },
  });
  const statuses = SIGNATURE_STATUSES.map((status) => option(statusLabel(status, lang), status, false));
  const categories = CATEGORIES_LIST.map((category) =>
    option(categoryLabel(category, lang), category, false),
  );
  const sorts = [
    option(t('jira.sort.lastSeen', lang), 'lastSeen', false),
    option(t('jira.sort.occurrences', lang), 'occurrences', false),
    option(t('jira.sort.status', lang), 'status', false),
    option(t('jira.sort.category', lang), 'category', false),
  ];
  return el(
    'div',
    { class: 'cards' },
    el('label', { class: 'card' }, el('div', {}, t('jira.page.filter', lang)), search),
    select(
      t('col.status', lang),
      [option(t('jira.page.all', lang), '', false), ...statuses],
      query.status ?? '',
      (value) => {
        state.query.status = (value || undefined) as PageQuery['status'];
        draw();
      },
    ),
    select(
      t('col.category', lang),
      [option(t('jira.page.all', lang), '', false), ...categories],
      query.category ?? '',
      (value) => {
        state.query.category = (value || undefined) as PageQuery['category'];
        draw();
      },
    ),
    select(t('jira.page.sort', lang), sorts, query.sortKey, (value) => {
      state.query.sortKey = value as PageQuery['sortKey'];
      draw();
    }),
  );
}

/** The signature table of the project page. */
function signatureTable(rows: PageData['rows'], lang: Lang): HTMLElement {
  const headers = [
    t('col.signature', lang), t('col.category', lang), t('col.status', lang),
    t('col.occurrences', lang), t('col.firstSeen', lang), t('col.lastSeen', lang),
    t('jira.col.error', lang), t('col.ticket', lang),
  ];
  const cells: Child[][] = rows.map((row) => [
    el('span', { class: 'mono', title: row.id }, row.shortId),
    row.categoryLabel,
    badge(row.badge.label, row.badge.tone),
    String(row.occurrences),
    formatDate(row.firstSeen, lang),
    formatDate(row.lastSeen, lang),
    el('div', {}, el('div', { class: 'mono' }, row.errorType), el('div', { class: 'facts' }, row.template)),
    el('span', { class: 'mono' }, row.issueKey ?? '—'),
  ]);
  return table(headers, cells, t('jira.page.empty', lang));
}

/** The cost of the same page, as the Cost tab of the app shows it. */
function costTable(data: PageData, lang: Lang): HTMLElement {
  const headers = [
    t('col.signature', lang), t('col.summary', lang), t('col.occurrences', lang),
    t('cost.minutesLost', lang), t('cost.peopleAffected', lang), t('cost.retries', lang),
  ];
  const cells: Child[][] = data.costRows.map((row) => [
    el('span', { class: 'mono' }, row.shortId),
    row.title,
    String(row.occurrences),
    String(Math.round(row.ciMinutesLost)),
    String(row.peopleAffected),
    String(row.retries),
  ]);
  return table(headers, cells, t('results.empty', lang));
}

/** The project page: the filters, the rows, the cost, the JSON. */
function pageTab(data: Loaded): HTMLElement {
  const lang = data.lang;
  const rowsHost = el('div', {});
  const draw = (): void => {
    mount(rowsHost, signatureTable(visibleRows(data.page.allRows, state.query), lang));
  };
  draw();
  return el(
    'div',
    {},
    el('p', { class: 'section-note' }, t('jira.page.note', lang)),
    controls(draw, lang),
    rowsHost,
    el('h3', {}, t('jira.page.cost', lang)),
    costTable(data.page, lang),
    jsonBlock(t('jira.json', lang), {
      rows: data.page.rows,
      cost: data.page.costRows,
      windowDays: data.page.windowDays,
    }),
  );
}

/** The issue panel: the text a Rovo agent reads, and its facts. */
function issueContent(issue: IssueData, lang: Lang): HTMLElement {
  const diagnostic = issue.diagnostic;
  const facts = diagnostic
    ? el(
        'ul',
        { class: 'facts' },
        ...diagnostic.facts.map((fact) => el('li', {}, `${fact.label}: ${fact.value}`)),
      )
    : el('p', { class: 'empty' }, t('results.empty', lang));
  return el(
    'div',
    {},
    el('h3', {}, t('jira.issue.text', lang)),
    el('pre', { class: 'mono' }, issue.text),
    el('h3', {}, t('jira.issue.facts', lang)),
    facts,
    el('p', { class: 'facts' }, `${t('jira.issue.occurrences', lang)}: ${issue.occurrences}`),
    jsonBlock(t('jira.json', lang), issue),
  );
}

/** The issue panel: the picker of the signature, then the text. */
function issueTab(data: Loaded): HTMLElement {
  const lang = data.lang;
  const host = el('div', {});
  const draw = (): void => {
    mount(host, issueContent(issueData(data.source, state.signatureId, lang), lang));
  };
  const picker = select(
    t('jira.issue.pick', lang),
    data.choices.map((choice) => option(`${choice.shortId} — ${choice.label}`, choice.id, false)),
    state.signatureId,
    (value) => {
      state.signatureId = value;
      draw();
    },
  );
  draw();
  return el(
    'div',
    {},
    el('p', { class: 'section-note' }, t('jira.issue.note', lang)),
    picker,
    host,
  );
}

/** One table of settings: the stored values, or the engine defaults. */
function settingsTable(entries: Array<[string, unknown]>, lang: Lang): HTMLElement {
  const rows: Child[][] = entries.map(([field, value]) => [
    el('span', { class: 'mono' }, field),
    el('span', { class: 'mono' }, String(value)),
  ]);
  return table(
    [t('jira.settings.field', lang), t('jira.settings.value', lang)],
    rows,
    t('results.empty', lang),
  );
}

/** The settings: what is stored, what the engine starts from, what is refused. */
function settingsTab(data: Loaded): HTMLElement {
  const lang = data.lang;
  const examples: Child[][] = data.settings.examples.map((example) => [
    el('span', { class: 'mono' }, JSON.stringify(example.input)),
    el('span', { class: 'mono' }, example.ok ? JSON.stringify(example.value) : (example.error ?? '—')),
  ]);
  return el(
    'div',
    {},
    el('p', { class: 'section-note' }, t('jira.settings.note', lang)),
    el('h3', {}, t('jira.settings.current', lang)),
    settingsTable(Object.entries(data.settings.payload), lang),
    el('h3', {}, t('jira.settings.defaults', lang)),
    settingsTable(Object.entries(data.settings.defaults), lang),
    el('h3', {}, t('jira.settings.examples', lang)),
    table(
      [t('jira.settings.input', lang), t('jira.settings.result', lang)],
      examples,
      t('results.empty', lang),
    ),
    jsonBlock(t('jira.json', lang), data.settings),
  );
}

/** Renders the sub-tab the visitor chose. */
function renderTab(): void {
  const data = loaded;
  const view = current;
  if (!data || !view) return;
  if (state.tab === 'issue') mount(view.body, issueTab(data));
  else if (state.tab === 'panels') mount(view.body, renderWeekly(data.weekly, data.lang));
  else if (state.tab === 'settings') mount(view.body, settingsTab(data));
  else mount(view.body, pageTab(data));
}

/** The sub-tab bar. */
function tabBar(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'tabs', role: 'tablist' },
    ...TABS.map((tab) =>
      el(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': String(tab.id === state.tab),
          onclick: () => {
            state.tab = tab.id;
            renderTab();
          },
        },
        tab.label(lang),
      ),
    ),
  );
}

/** Loads the view models of the app, then renders the sub-tab. */
async function fillPanel(body: HTMLElement, ctx: PanelContext): Promise<void> {
  const mine = ++token;
  const lang = ctx.lang;
  const source: JiraSource = {
    store: ctx.workspace.store,
    result: ctx.workspace.result,
    now: ctx.workspace.now,
  };
  mount(body, el('p', { class: 'status' }, t('jira.loading', lang)));
  const [page, choices, weekly, stored] = await Promise.all([
    pageData(source, state.query, lang),
    issueChoices(source, lang),
    weeklyData(source),
    ctx.workspace.store.getSettings(),
  ]);
  if (mine !== token) return;
  if (!state.signatureId && choices.length > 0) state.signatureId = choices[0].id;
  loaded = { source, lang, page, choices, weekly, settings: settingsData(stored) };
  renderTab();
}

export const panel: Panel = {
  id: 'jira',
  title: (lang) => t('panel.jira.title', lang),
  summary: (lang) => t('panel.jira.summary', lang),
  render(host, ctx) {
    const body = el('div', {});
    current = { body, ctx };
    mount(host, tabBar(ctx.lang), body);
    void fillPanel(body, ctx);
  },
};
