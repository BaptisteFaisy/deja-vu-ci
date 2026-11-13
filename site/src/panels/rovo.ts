/**
 * Panneau « Rovo & MCP » — la console qui exécute les six actions pour de vrai.
 *
 * Le visiteur choisit une action de l'agent, remplit ses paramètres (le
 * formulaire est **généré depuis le schéma d'entrée du descripteur**) et clique
 * « Appeler » : la réponse affichée est le `ActionResult` réel du Cerveau,
 * calculé sur la mémoire partagée de la page. Les gardes sont montrées telles
 * quelles : un appel sans paramètre rend `{ ok: false, error }`, jamais une
 * exception. La logique pure vit dans `rovo-console.ts` ; ce fichier ne fait
 * que du DOM.
 */

import { badge, el, mount, table } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Lang } from '../lib/i18n';
import {
  coerceArgs,
  fieldSpecs,
  humanRead,
  inputsLine,
  listActions,
  suggestArgs,
  type FieldSpec,
  type RovoAction,
} from './rovo-console';
import type { RawInput } from '../../../apps/brain/src/actions/descriptor';
import type { ActionResult } from '../../../apps/brain/src/actions/engine';
import type { Panel, PanelContext } from './types';

registerStrings({
  'panel.rovo.title': ['Rovo & MCP', 'Rovo et MCP'],
  'panel.rovo.summary': [
    'The six agent actions, executed for real against the memory of this page.',
    'Les six actions de l’agent, exécutées pour de vrai sur la mémoire de cette page.',
  ],
  'rovo.agent.title': ['The Rovo agent', 'L’agent Rovo'],
  'rovo.agent.note': [
    'The agent (name, description, conversation starters) is declared in the Forge manifest of ' +
      'the Brain. The YAML is not bundled here — the site adds no dependency — so the file below ' +
      'is the source of truth.',
    'L’agent (nom, description, amorces de conversation) est déclaré dans le manifeste Forge du ' +
      'Cerveau. Le YAML n’est pas embarqué ici — le site n’ajoute aucune dépendance — donc le ' +
      'fichier ci-dessous fait foi.',
  ],
  'rovo.agent.link': ['Open apps/brain/manifest.yml on GitHub', 'Ouvrir apps/brain/manifest.yml sur GitHub'],
  'rovo.tools.title': ['The MCP tools', 'Les outils MCP'],
  'rovo.tools.note': [
    'Derived from the action descriptors of the Brain (apps/brain/src/actions) — the same objects ' +
      'the Forge manifest and the rovo:mcp server expose. Call any of them below: the answer is ' +
      'computed here, on the memory of this page.',
    'Déduite des descripteurs d’actions du Cerveau (apps/brain/src/actions) — les mêmes objets que ' +
      'le manifeste Forge et le serveur rovo:mcp exposent. Appelle-les ci-dessous : la réponse est ' +
      'calculée ici, sur la mémoire de cette page.',
  ],
  'rovo.col.tool': ['Tool', 'Outil'],
  'rovo.col.verb': ['Verb', 'Verbe'],
  'rovo.col.description': ['Description (as declared)', 'Description (telle que déclarée)'],
  'rovo.col.inputs': ['Inputs (from the schema)', 'Entrées (depuis le schéma)'],
  'rovo.console.title': ['The console: call an action', 'La console : appeler une action'],
  'rovo.console.note': [
    'The form is generated from the input schema of the descriptor; the fields are pre-filled with ' +
      'real values of the replay (a signature, a ticket key, an error log of the sample dataset).',
    'Le formulaire est généré depuis le schéma d’entrée du descripteur ; les champs sont ' +
      'pré-remplis avec de vraies valeurs du rejeu (une signature, une clé de ticket, un journal ' +
      'd’erreur du jeu d’exemple).',
  ],
  'rovo.action.pick': ['Action', 'Action'],
  'rovo.field.required': ['required', 'obligatoire'],
  'rovo.field.optional': ['optional', 'facultatif'],
  'rovo.call': ['Call', 'Appeler'],
  'rovo.call.guard': ['Call with no argument', 'Appeler sans paramètre'],
  'rovo.guard.note': [
    'The guards never throw: a missing or invalid argument answers { ok: false, error } — the real ' +
      'answer of the Brain, shown as-is.',
    'Les gardes ne lèvent jamais d’exception : un paramètre manquant ou invalide répond ' +
      '{ ok: false, error } — la réponse réelle du Cerveau, affichée telle quelle.',
  ],
  'rovo.memory.note': [
    'This action writes to the memory of this page only: no Jira ticket is created, nothing is sent ' +
      'anywhere. Other panels see the write, exactly like the real app.',
    'Cette action écrit dans la mémoire de cette page seulement : aucun ticket Jira n’est créé, ' +
      'rien n’est envoyé nulle part. Les autres panneaux voient l’écriture, comme dans l’app réelle.',
  ],
  'rovo.response.title': ['Response', 'Réponse'],
  'rovo.response.args': ['Arguments sent', 'Arguments envoyés'],
  'rovo.response.json': ['Raw response (JSON)', 'Réponse brute (JSON)'],
  'rovo.response.human': ['Human reading', 'Lecture humaine'],
  'rovo.response.empty': ['Call an action to see its real answer here.', 'Appelle une action pour voir ici sa réponse réelle.'],
});

/** Le manifeste fait foi pour l’agent : lien vers la source, rien de recopié. */
const MANIFEST_URL =
  'https://github.com/Tradoooo/deja-vu-ci/blob/main/apps/brain/manifest.yml';

/** Ton du verbe, déduit des métadonnées du descripteur. */
const VERB_TONE: Record<string, string> = { GET: 'blue', CREATE: 'green', UPDATE: 'yellow' };

/** Brouillons de formulaire par action, et dernier appel — conservés entre rendus. */
const drafts = new Map<string, Record<string, string>>();
let selectedKey = '';
let lastCall: { key: string; args: RawInput; result: ActionResult<unknown> } | null = null;
let rerender: (() => void) | null = null;

/** Le brouillon d'une action : pré-rempli une fois depuis le rejeu réel. */
function valuesFor(ctx: PanelContext, action: RovoAction): Record<string, string> {
  let values = drafts.get(action.key);
  if (!values) {
    values = suggestArgs(ctx.workspace.view);
    drafts.set(action.key, values);
  }
  return values;
}

/** La carte de l'agent : le manifeste fait foi, lien vers la source. */
function agentCard(lang: Lang): HTMLElement {
  return el(
    'section',
    { class: 'card' },
    el('h3', {}, t('rovo.agent.title', lang)),
    el('p', { class: 'section-note' }, t('rovo.agent.note', lang)),
    el(
      'p',
      {},
      el('a', { href: MANIFEST_URL, target: '_blank', rel: 'noopener' }, t('rovo.agent.link', lang)),
    ),
  );
}

/** La liste des outils MCP, déduite des descripteurs (jamais recopiée). */
function toolsSection(lang: Lang): HTMLElement {
  const rows = listActions().map((action) => [
    el('span', { class: 'mono' }, action.key),
    badge(action.verb, VERB_TONE[action.verb] ?? 'grey'),
    action.description,
    el('span', { class: 'mono' }, inputsLine(action.inputs)),
  ]);
  return el(
    'section',
    {},
    el('h3', {}, t('rovo.tools.title', lang)),
    el('p', { class: 'section-note' }, t('rovo.tools.note', lang)),
    table(
      [
        t('rovo.col.tool', lang),
        t('rovo.col.verb', lang),
        t('rovo.col.description', lang),
        t('rovo.col.inputs', lang),
      ],
      rows,
      t('rovo.response.empty', lang),
    ),
  );
}

/** Le sélecteur d'action : les six descripteurs, verbe compris. */
function picker(lang: Lang, actions: RovoAction[]): HTMLElement {
  const select = el(
    'select',
    {
      onchange: (event: Event) => {
        selectedKey = (event.target as HTMLSelectElement).value;
        rerender?.();
      },
    },
    ...actions.map((action) =>
      el('option', { value: action.key }, `${action.key} (${action.verb})`),
    ),
  );
  select.value = selectedKey;
  return el('label', { style: 'display:block;margin:8px 0' }, t('rovo.action.pick', lang), ' ', select);
}

/** Un champ booléen : non défini / true / false — le schéma décide. */
function booleanSelect(value: string, save: (next: string) => void): HTMLElement {
  const select = el(
    'select',
    { onchange: (event: Event) => save((event.target as HTMLSelectElement).value) },
    el('option', { value: '' }, '—'),
    el('option', { value: 'true' }, 'true'),
    el('option', { value: 'false' }, 'false'),
  );
  select.value = value;
  return select;
}

/** Une ligne du formulaire généré : type, obligation et description du schéma. */
function fieldRow(spec: FieldSpec, values: Record<string, string>, lang: Lang): HTMLElement {
  const value = values[spec.name] ?? '';
  const save = (next: string): void => {
    values[spec.name] = next;
  };
  const oninput = (event: Event): void => save((event.target as HTMLInputElement).value);
  let control: HTMLElement;
  if (spec.type === 'boolean') control = booleanSelect(value, save);
  else if (spec.type === 'integer') control = el('input', { type: 'number', value, oninput });
  else if (value.length > 120 || value.includes('\n')) {
    control = el('textarea', { rows: 4, oninput });
    (control as HTMLTextAreaElement).value = value;
  } else control = el('input', { type: 'text', value, oninput });
  const state = spec.required ? t('rovo.field.required', lang) : t('rovo.field.optional', lang);
  return el(
    'label',
    { style: 'display:block;margin:8px 0' },
    el('span', { class: 'mono' }, `${spec.name}: ${spec.type} (${state})`),
    ' ',
    el('span', { class: 'section-note' }, spec.description),
    control,
  );
}

/** Appelle le descripteur : la vraie réponse, jamais une exception. */
async function call(ctx: PanelContext, action: RovoAction, guard: boolean): Promise<void> {
  const args = guard ? {} : coerceArgs(action.inputs, valuesFor(ctx, action));
  const result = await action(ctx.workspace.brain, args);
  lastCall = { key: action.key, args, result };
  if (result.ok && action.verb !== 'GET') await ctx.workspace.notify();
  rerender?.();
}

/** Les deux boutons : l'appel saisi, et l'appel sans paramètre (gardes). */
function callButtons(ctx: PanelContext, action: RovoAction): HTMLElement {
  return el(
    'div',
    { style: 'margin:10px 0' },
    el('button', { type: 'button', onclick: () => void call(ctx, action, false) }, t('rovo.call', ctx.lang)),
    ' ',
    el('button', { type: 'button', onclick: () => void call(ctx, action, true) }, t('rovo.call.guard', ctx.lang)),
    el('p', { class: 'section-note' }, t('rovo.guard.note', ctx.lang)),
  );
}

/** Une puce de lecture humaine, avec son ton quand le domaine en donne un. */
function factItem(entry: { label: string; value: string; tone?: string }): HTMLElement {
  return el(
    'li',
    {},
    `${entry.label}: `,
    entry.tone ? badge(entry.value, entry.tone) : entry.value,
  );
}

/** La réponse du dernier appel : JSON brut + lecture humaine. */
function responseSection(ctx: PanelContext): HTMLElement {
  if (!lastCall) return el('p', { class: 'empty' }, t('rovo.response.empty', ctx.lang));
  const read = humanRead(lastCall.key, lastCall.result, ctx.lang);
  return el(
    'div',
    {},
    el('h3', {}, t('rovo.response.title', ctx.lang)),
    el(
      'p',
      { class: 'section-note' },
      `${t('rovo.response.args', ctx.lang)}: `,
      el('span', { class: 'mono' }, JSON.stringify(lastCall.args)),
    ),
    el('pre', { class: 'mono' }, JSON.stringify(lastCall.result, null, 2)),
    el('ul', { class: 'facts' }, ...read.facts.map(factItem)),
    ...read.tables.map((entry) =>
      el('div', {}, el('h3', {}, entry.title), table(entry.headers, entry.rows, '—')),
    ),
  );
}

/** La console : sélecteur, formulaire généré, boutons, réponse réelle. */
function consoleSection(ctx: PanelContext): HTMLElement {
  const actions = listActions();
  if (!actions.some((action) => action.key === selectedKey)) selectedKey = actions[0]?.key ?? '';
  const action = actions.find((candidate) => candidate.key === selectedKey);
  if (!action) return el('p', { class: 'empty' }, t('rovo.response.empty', ctx.lang));
  const values = valuesFor(ctx, action);
  return el(
    'section',
    { class: 'card' },
    el('h3', {}, t('rovo.console.title', ctx.lang)),
    el('p', { class: 'section-note' }, t('rovo.console.note', ctx.lang)),
    picker(ctx.lang, actions),
    ...fieldSpecs(action.inputs).map((spec) => fieldRow(spec, values, ctx.lang)),
    callButtons(ctx, action),
    action.verb === 'GET' ? null : el('p', { class: 'section-note' }, t('rovo.memory.note', ctx.lang)),
    responseSection(ctx),
  );
}

export const panel: Panel = {
  id: 'rovo',
  title: (lang) => t('panel.rovo.title', lang),
  summary: (lang) => t('panel.rovo.summary', lang),
  render(host, ctx) {
    rerender = () => panel.render(host, ctx);
    mount(host, agentCard(ctx.lang), toolsSection(ctx.lang), consoleSection(ctx));
  },
};
