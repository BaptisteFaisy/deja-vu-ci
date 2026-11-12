/**
 * Panneau « Carte de pull request » — la carte Bitbucket, pour de vrai.
 *
 * Le visiteur choisit un des 40 échecs du jeu d'exemple (ou l'un des trois
 * autres états de la carte) ; la réponse du Cerveau (`QueryResponse`) est
 * construite par `pr-donnees.ts` depuis la mémoire partagée, puis le **vrai
 * modèle de vue du Capteur** (`prCardView`, `apps/sensor/src/pure/prCardView.ts`)
 * la transforme en ce que la carte affiche. Le JSON des deux charges utiles est
 * montré à côté : c'est la preuve que le rendu vient du code du produit.
 *
 * Le rendu visuel utilise les helpers DOM du site (`el()`), pas le JSX Forge de
 * `apps/sensor/src/ui/customPrCard.tsx` — mais il respecte les mêmes
 * informations dans le même ordre : nature, confiance, titre, résumé, faits,
 * éléments vus (et fichiers suspects), action, ticket, résolution (et dernier
 * échec). Chaque libellé vient de `@dejavu/present` (table partagée du
 * produit), aucune table recopiée.
 */

import { diagnosticLabel, shortCommit } from '@dejavu/present';
import type { QueryResponse } from '@dejavu/core';
import { prCardView, type PrCardView } from '../../../apps/sensor/src/pure/prCardView';
import { badge, el, mount } from '../render/dom';
import { registerStrings, t, type Lang } from '../lib/i18n';
import { allChoices, defaultChoice, responseFor, type PrChoice } from './pr-donnees';
import type { Panel } from './types';

registerStrings({
  'panel.pr.title': ['Pull request card', 'Carte de pull request'],
  'panel.pr.summary': [
    'The card Bitbucket would show, built by the Sensor’s real view-model.',
    'La carte que Bitbucket afficherait, produite par le vrai modèle de vue du Capteur.',
  ],
  'pr.intro': [
    'The card Bitbucket would display on a pull request, computed in your browser by the Sensor’s ' +
      'real view-model (prCardView) from the shared memory of the replay. Choose one of the 40 ' +
      'failures of the sample set — or one of the three other states of the product.',
    'La carte que Bitbucket afficherait sur une pull request, calculée dans votre navigateur par le ' +
      'vrai modèle de vue du Capteur (prCardView) depuis la mémoire partagée du rejeu. Choisis ' +
      'l’un des 40 échecs du jeu d’exemple — ou l’un des trois autres états du produit.',
  ],
  'pr.select': ['Card content', 'Contenu de la carte'],
  'pr.state.loading': ['Loading — the card waits for the Brain', 'Chargement — la carte attend le Cerveau'],
  'pr.state.empty': ['Empty — a branch with no known failure', 'Vide — une branche sans échec connu'],
  'pr.state.error': ['Error — workspace not paired with a Brain', 'Erreur — espace non appairé à un Cerveau'],
  'pr.states.note': [
    'The last three entries are not fanciful simulations: they are the card’s own states in the ' +
      'product code (PrCardState). “Loading” is what the card renders before the Brain answers; ' +
      '“empty” is the real /query answer { ok: true } when the memory knows no failure of the ' +
      'branch; “error” is the exact answer of the Sensor’s getPrCard when the workspace is not ' +
      'paired. The diagnostic shown is the one the real engine produced during the replay, with ' +
      'the frozen clock of the demo.',
    'Les trois dernières entrées ne sont pas des simulations fantaisistes : ce sont les états de la ' +
      'carte dans le code du produit (PrCardState). « Chargement » est ce que la carte rend avant ' +
      'la réponse du Cerveau ; « vide » est la réponse réelle de /query ({ ok: true }) quand la ' +
      'mémoire ne connaît aucun échec de la branche ; « erreur » est la réponse exacte du ' +
      'getPrCard du Capteur quand l’espace n’est pas appairé. Le diagnostic affiché est celui que ' +
      'le vrai moteur a produit pendant le rejeu, avec l’horloge figée de la démo.',
  ],
  'pr.card.title': ['The card, as Bitbucket would show it', 'La carte, comme Bitbucket l’afficherait'],
  'pr.json.title': ['The proof: the real payloads', 'La preuve : les charges utiles réelles'],
  'pr.json.response': ['Brain answer (QueryResponse)', 'Réponse du Cerveau (QueryResponse)'],
  'pr.json.view': [
    'View model (PrCardView), produced by prCardView()',
    'Modèle de vue (PrCardView), produit par prCardView()',
  ],
  'pr.json.note': [
    'The card on the left places exactly these values, in this order — nothing else is rendered.',
    'La carte de gauche place exactement ces valeurs, dans cet ordre — rien d’autre n’est rendu.',
  ],
  'pr.note.ticket': [
    'The ticket line appears when the diagnostic carries an issue key. Today the engine attaches ' +
      'issue keys to signatures (see the ticket plan), not to diagnostics — so the real Bitbucket ' +
      'card does not show that line either. Nothing is hidden: the JSON above is the exact view ' +
      'model the card renders.',
    'La ligne ticket s’affiche quand le diagnostic porte une clé de ticket. Aujourd’hui le moteur ' +
      'attache les clés aux signatures (voir le plan de tickets), pas aux diagnostics — la vraie ' +
      'carte Bitbucket n’affiche donc pas cette ligne non plus. Rien n’est caché : le JSON ' +
      'ci-dessus est le modèle de vue exact que la carte rend.',
  ],
});

/** styles.css est partagé (interdit au panneau) : le retour à la ligne du JSON
 * est posé en attribut `style` local, sans toucher la feuille de style. */
const PRE_STYLE = 'white-space: pre-wrap; overflow-wrap: anywhere; max-height: 34em; overflow: auto; margin: 6px 0 0;';

/** Le choix courant du visiteur — conservé d'un rendu à l'autre. */
let selection: string | undefined;

/** Une ligne « Libellé : valeur », si la valeur existe. */
function line(label: string, value: string | undefined, mono = false): HTMLElement | null {
  if (!value) return null;
  return el('p', {}, `${label}: `, mono ? el('span', { class: 'mono' }, value) : value);
}

/** Une liste titrée (faits, éléments vus, suspects) ; absente si vide. */
function lines(label: string, values: string[], mono: boolean): HTMLElement | null {
  if (values.length === 0) return null;
  return el(
    'div',
    {},
    el('strong', {}, label),
    el('ul', { class: 'facts' }, ...values.map((value) => el('li', mono ? { class: 'mono' } : {}, value))),
  );
}

/** L'état diagnostic de la carte — mêmes informations, même ordre que le JSX du Capteur. */
function renderDiagnostic(view: PrCardView, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el(
      'p',
      {},
      view.headline && view.tone ? badge(view.headline, view.tone) : null,
      view.confidence ? ` ${t('diagnostic.confidence', lang)}: ${view.confidence}` : '',
    ),
    view.title ? el('h3', {}, view.title) : null,
    view.summary ? el('p', {}, view.summary) : null,
    lines(t('diagnostic.facts', lang), view.facts, false),
    lines(t('diagnostic.evidence', lang), view.evidence, true),
    lines(t('diagnostic.suspects', lang), view.suspects, true),
    view.action ? el('p', {}, `${t('diagnostic.action', lang)}: `, el('strong', {}, view.action)) : null,
    line(t('diagnostic.ticket', lang), view.issueKey, true),
    line(t('diagnostic.resolution', lang), view.resolution),
    line(t('diagnostic.lastFailure', lang), view.lastFailure),
  );
}

/** Un des quatre états de la carte (PrCardState) — le rendu réel du produit. */
function renderCard(view: PrCardView, lang: Lang): HTMLElement {
  if (view.state === 'loading') return el('p', { class: 'status' }, t('common.loading', lang));
  if (view.state === 'error') {
    return el('p', { class: 'status error' }, view.error ?? t('error.title', lang));
  }
  if (view.state === 'empty') return el('p', { class: 'empty' }, t('diagnostic.noMatch', lang));
  return renderDiagnostic(view, lang);
}

/** La preuve JSON : la réponse du Cerveau, puis le modèle de vue du Capteur. */
function renderJson(response: QueryResponse | undefined, view: PrCardView, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el('strong', {}, t('pr.json.response', lang)),
    el('pre', { class: 'mono', style: PRE_STYLE }, response === undefined ? 'undefined' : JSON.stringify(response, null, 2)),
    el('strong', {}, t('pr.json.view', lang)),
    el('pre', { class: 'mono', style: PRE_STYLE }, JSON.stringify(view, null, 2)),
    el('p', { class: 'section-note' }, t('pr.json.note', lang)),
    el('p', { class: 'section-note' }, t('pr.note.ticket', lang)),
  );
}

/** Le libellé d'une option : données du rejeu + libellés du produit. */
function optionLabel(choice: PrChoice, index: number, lang: Lang): string {
  if (choice.kind === 'loading') return t('pr.state.loading', lang);
  if (choice.kind === 'empty') return t('pr.state.empty', lang);
  if (choice.kind === 'error') return t('pr.state.error', lang);
  const { occurrence, diagnostic } = choice;
  if (!occurrence || !diagnostic) return choice.id;
  const nature = diagnosticLabel(diagnostic.kind, lang);
  return `#${index + 1} · ${occurrence.repo} · ${occurrence.branch} · ${shortCommit(occurrence.commit)} — ${nature}`;
}

export const panel: Panel = {
  id: 'pr',
  title: (lang) => t('panel.pr.title', lang),
  summary: (lang) => t('panel.pr.summary', lang),
  render(host, ctx) {
    const { workspace, lang } = ctx;
    const choices = allChoices(workspace.result);
    const choice = choices.find((candidate) => candidate.id === selection) ?? defaultChoice(choices);
    if (!choice) {
      mount(host, el('p', { class: 'empty' }, t('results.empty', lang)));
      return;
    }
    selection = choice.id;

    const cardHost = el('div', {});
    const jsonHost = el('div', {});
    /** Peint la carte et sa preuve JSON pour une entrée du sélecteur. */
    const paint = (id: string): void => {
      const chosen = choices.find((candidate) => candidate.id === id) ?? choice;
      const response = responseFor(chosen);
      const view = prCardView(response, lang);
      mount(cardHost, renderCard(view, lang));
      mount(jsonHost, renderJson(response, view, lang));
    };
    const select = el(
      'select',
      {
        'aria-label': t('pr.select', lang),
        onchange: (event: Event) => {
          selection = (event.target as HTMLSelectElement).value;
          paint(selection ?? choice.id);
        },
      },
      ...choices.map((candidate, index) =>
        el('option', { value: candidate.id, selected: candidate.id === choice.id }, optionLabel(candidate, index, lang)),
      ),
    );

    mount(
      host,
      el('p', { class: 'section-note' }, t('pr.intro', lang)),
      el('label', {}, `${t('pr.select', lang)} : `, select),
      el('p', { class: 'section-note' }, t('pr.states.note', lang)),
      el(
        'div',
        { class: 'cards' },
        el('div', { class: 'card' }, el('h3', {}, t('pr.card.title', lang)), cardHost),
        el('div', { class: 'card' }, el('h3', {}, t('pr.json.title', lang)), jsonHost),
      ),
    );
    paint(choice.id);
  },
};
