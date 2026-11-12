/**
 * Panneau « Entrée universelle » — n'importe quelle CI, en une ligne.
 *
 * Le visiteur construit une charge utile d'entrée universelle et voit **le
 * produit la juger** : le validateur réel (`parseUniversalPayload`), le
 * masquage réel (`maskSecrets`), la troncature réelle (`truncateBytes`). Puis
 * il repart avec la commande exacte de son CI — six extraits, tous dérivés de
 * la même charge (aucune copie à la main).
 *
 * Rien n'est envoyé : la page montre les commandes, elle ne les exécute pas.
 */

import { el, mount, table, badge } from '../render/dom';
import { REPO_URL } from '../render/sections';
import { fill, registerStrings, t, type Lang } from '../lib/i18n';
import type { Panel, PanelContext } from './types';
import {
  EXEMPLES,
  KEY_PLACEHOLDER,
  defaultValues,
  maskPayload,
  validate,
  type FormValues,
  type Validation,
} from './universel-donnees';
import { buildSnippets, type Snippet } from './universel-snippets';
import { TEXTES } from './universel-textes';
import { GITHUB_LOG, adaptGitHub, adapterPayload } from './universel-adaptateurs';

registerStrings(TEXTES);

/** L'état du panneau : il survit aux re-rendus de la coque. */
interface Etat {
  /** Les valeurs du formulaire. */
  values: FormValues;
  /** Le résultat de la dernière validation, s'il y en a une. */
  validation: Validation | null;
  /** L'extrait copié : `id:ok` ou `id:ko`. */
  copie: string | null;
}

let etat: Etat = { values: defaultValues(), validation: null, copie: null };
let hote: HTMLElement | null = null;
let contexte: PanelContext | null = null;

/** Redessine le panneau (le même chemin que celui de la coque). */
function rafraichir(): void {
  if (!hote || !contexte) return;
  rendre();
}

/** Le gestionnaire de saisie : la valeur va dans l'état, sans redessiner. */
function saisie(champ: keyof FormValues): (event: Event) => void {
  return (event) => {
    const cible = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    etat = { ...etat, values: { ...etat.values, [champ]: cible.value } };
  };
}

/** Un champ du formulaire : un libellé, un contrôle, une aide. */
function champ(label: string, controle: HTMLElement, aide?: string): HTMLElement {
  return el(
    'p',
    {},
    el('label', {}, el('strong', {}, label), ' ', controle),
    aide ? el('span', { class: 'section-note' }, aide) : null,
  );
}

/** La zone de journal : sa valeur vit dans l'état, pas dans l'attribut. */
function journal(): HTMLTextAreaElement {
  const zone = el('textarea', { class: 'mono', rows: '10', oninput: saisie('log') });
  zone.value = etat.values.log;
  return zone;
}

/** Le choix du résultat : seuls les échecs sont rapportés. */
function resultats(lang: Lang): HTMLSelectElement {
  const choix = el(
    'select',
    { onchange: saisie('outcome') },
    el('option', { value: 'failure' }, t('universel.outcome.failure', lang)),
    el('option', { value: 'success' }, t('universel.outcome.success', lang)),
  );
  choix.value = etat.values.outcome;
  return choix;
}

/** Les quatre exemples, un par écosystème. */
function exemples(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'cards' },
    ...EXEMPLES.map((exemple) =>
      el(
        'div',
        { class: 'card' },
        el('h3', {}, t(exemple.labelKey, lang)),
        el('p', {}, exemple.values.repository, ' · ', exemple.values.branch),
        el(
          'p',
          {},
          el(
            'button',
            {
              type: 'button',
              onclick: () => {
                etat = { ...etat, values: { ...exemple.values }, validation: null, copie: null };
                rafraichir();
              },
            },
            t('universel.example.use', lang),
          ),
        ),
      ),
    ),
  );
}

/** Les champs du contrat : un contrôle par champ de la charge utile. */
function champsFormulaire(lang: Lang): HTMLElement[] {
  const valeurs = etat.values;
  return [
    champ(
      t('universel.field.projectKey', lang),
      el('input', { type: 'password', value: valeurs.projectKey, oninput: saisie('projectKey') }),
      t('universel.field.projectKey.help', lang),
    ),
    champ(t('universel.field.repository', lang), el('input', { type: 'text', value: valeurs.repository, oninput: saisie('repository') })),
    champ(t('universel.field.branch', lang), el('input', { type: 'text', value: valeurs.branch, oninput: saisie('branch') })),
    champ(t('universel.field.commit', lang), el('input', { type: 'text', value: valeurs.commit, oninput: saisie('commit') })),
    champ(t('universel.field.step', lang), el('input', { type: 'text', value: valeurs.step, oninput: saisie('step') })),
    champ(t('universel.field.duration', lang), el('input', { type: 'text', value: valeurs.durationS, oninput: saisie('durationS') })),
    champ(t('universel.field.outcome', lang), resultats(lang)),
    champ(t('universel.field.log', lang), journal()),
  ];
}

/** Le formulaire : les champs du contrat et les deux boutons. */
function formulaire(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, t('universel.form.title', lang)),
    el('p', { class: 'section-note' }, t('universel.form.note', lang)),
    ...champsFormulaire(lang),
    el(
      'p',
      {},
      el(
        'button',
        {
          type: 'button',
          onclick: () => {
            etat = { ...etat, validation: validate(etat.values), copie: null };
            rafraichir();
          },
        },
        t('universel.validate', lang),
      ),
      ' ',
      el(
        'button',
        {
          type: 'button',
          onclick: () => {
            etat = { values: defaultValues(), validation: null, copie: null };
            rafraichir();
          },
        },
        t('universel.reset', lang),
      ),
    ),
    el('h3', {}, t('universel.examples', lang)),
    exemples(lang),
  );
}

/** Le verdict du validateur, puis les deux charges (normalisée et masquée). */
function verdict(lang: Lang): HTMLElement {
  const validation = etat.validation;
  if (!validation) return el('p', { class: 'empty' }, t('universel.noResult', lang));
  if (!validation.ok) {
    return el(
      'div',
      {},
      el('h2', {}, badge(t('universel.refused', lang), 'red'), ' ', t('universel.refused.note', lang)),
      el('pre', { class: 'mono' }, validation.error),
    );
  }
  const masque = maskPayload(validation.payload);
  const charge = validation.payload;
  const lignes: string[][] = [
    ['projectKey', KEY_PLACEHOLDER],
    ['repository', charge.repository],
    ['branch', charge.branch],
    ['commit', charge.commit ?? '—'],
    ['step', charge.step ?? '—'],
    ['failedAt', charge.failedAt ?? '—'],
    ['log', fill(t('universel.chars', lang), { n: charge.log.length })],
  ];
  return el(
    'div',
    {},
    el('h2', {}, badge(t('universel.accepted', lang), 'green'), ' ', t('universel.accepted.note', lang)),
    el('h3', {}, t('universel.normalized', lang)),
    table([t('universel.col.field', lang), t('universel.col.value', lang)], lignes, t('universel.noResult', lang)),
    el('h3', {}, t('universel.masked', lang)),
    el('pre', { class: 'mono' }, masque.text),
    el('p', { class: 'section-note' }, masque.masked === 0 ? t('universel.masked.none', lang) : fill(t('universel.masked.some', lang), { count: masque.masked, kinds: masque.kinds.join(', ') })),
    masque.truncated ? el('p', { class: 'status' }, t('universel.masked.truncated', lang)) : null,
    el('p', { class: 'section-note' }, t('universel.key.note', lang)),
    el('p', { class: 'section-note' }, t('universel.extras.note', lang)),
    etat.values.outcome !== 'failure' ? el('p', { class: 'status error' }, t('universel.skip.note', lang)) : null,
  );
}

/** Un extrait et son bouton de copie. */
function extrait(lang: Lang, snippet: Snippet): HTMLElement {
  const copie = etat.copie;
  const statut =
    copie === `${snippet.id}:ok`
      ? badge(t('universel.copied', lang), 'green')
      : copie === `${snippet.id}:ko`
        ? badge(t('universel.copy.failed', lang), 'red')
        : null;
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, t(snippet.labelKey, lang)),
    el('pre', { class: 'mono' }, snippet.text),
    el(
      'p',
      {},
      el('button', { type: 'button', onclick: () => copier(snippet.id, snippet.text) }, t('universel.copy', lang)),
      ' ',
      statut,
    ),
  );
}

/** Les six extraits, tous dérivés de la même charge masquée. */
function extraits(lang: Lang): HTMLElement | null {
  const validation = etat.validation;
  if (!validation || !validation.ok) return null;
  const masque = maskPayload(validation.payload);
  const snippets = buildSnippets(masque.payload, etat.values);
  return el(
    'div',
    {},
    el('h2', {}, t('universel.snippets.title', lang)),
    el('p', { class: 'section-note' }, t('universel.snippets.note', lang)),
    ...snippets.map((snippet) => extrait(lang, snippet)),
  );
}

/** Copie l'extrait dans le presse-papiers (jamais d'envoi réseau). */
function copier(id: string, texte: string): void {
  const marquer = (etatCopie: string): void => {
    etat = { ...etat, copie: etatCopie };
    rafraichir();
  };
  try {
    const promesse = navigator.clipboard?.writeText(texte);
    if (!promesse) {
      marquer(`${id}:ko`);
      return;
    }
    promesse.then(() => marquer(`${id}:ok`)).catch(() => marquer(`${id}:ko`));
  } catch {
    marquer(`${id}:ko`);
  }
}

/** L'adaptateur réel, appelé dans le navigateur sur un journal brut. */
function adaptateur(lang: Lang): HTMLElement {
  const report = adaptGitHub({
    log: GITHUB_LOG,
    repository: etat.values.repository,
    branch: etat.values.branch,
    commit: etat.values.commit,
  });
  const payload = adapterPayload(report);
  const masque = maskPayload(payload);
  const lignes: string[][] = [
    [t('universel.col.step', lang), report.step],
    [t('universel.col.duration', lang), report.durationS === undefined ? '—' : `${report.durationS} s`],
    [t('universel.col.exit', lang), report.exitCode === undefined ? '—' : String(report.exitCode)],
    [t('universel.col.tests', lang), report.testCases.map((cas) => cas.name).join(', ') || '—'],
  ];
  return el(
    'div',
    {},
    el('h2', {}, t('universel.adapter.title', lang)),
    el('p', { class: 'section-note' }, t('universel.adapter.note', lang)),
    el('h3', {}, t('universel.adapter.report', lang)),
    table([t('universel.col.step', lang), t('universel.col.value', lang)], lignes, t('universel.noResult', lang)),
    el('h3', {}, t('universel.adapter.payload', lang)),
    el('pre', { class: 'mono' }, masque.text),
  );
}

/** Les liens vers le contrat, dans le dépôt. */
function documentation(lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el('h2', {}, t('universel.docs.title', lang)),
    el('p', { class: 'section-note' }, t('universel.docs.note', lang)),
    el(
      'ul',
      { class: 'facts' },
      el('li', {}, el('a', { href: `${REPO_URL}/blob/main/docs/openapi.yaml`, rel: 'noopener' }, t('universel.docs.openapi', lang))),
      el('li', {}, el('a', { href: `${REPO_URL}/blob/main/docs/API-UNIVERSELLE.md`, rel: 'noopener' }, t('universel.docs.guide', lang))),
    ),
  );
}

/** Le panneau, dans l'ordre de lecture. */
function rendre(): void {
  if (!hote || !contexte) return;
  const lang = contexte.lang;
  mount(
    hote,
    el('p', { class: 'section-note' }, t('universel.intro', lang)),
    el('p', { class: 'status' }, t('universel.noNetwork', lang)),
    formulaire(lang),
    verdict(lang),
    extraits(lang),
    adaptateur(lang),
    documentation(lang),
  );
}

export const panel: Panel = {
  id: 'universel',
  title: (lang) => t('panel.universel.title', lang),
  summary: (lang) => t('panel.universel.summary', lang),
  render(host, ctx) {
    hote = host;
    contexte = ctx;
    rendre();
  },
};
