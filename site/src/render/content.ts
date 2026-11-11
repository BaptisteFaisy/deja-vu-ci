/**
 * Les sections de contenu : les quatre diagnostics, le fonctionnement, et ce
 * que la page prouve vraiment.
 *
 * Les noms et les couleurs des diagnostics viennent de `@dejavu/present` : la
 * carte de PR Bitbucket, les écrans Jira et cette page disent donc exactement
 * les mêmes mots, dans les deux langues, avec une seule table.
 */

import { diagnosticLabel, diagnosticTone } from '@dejavu/present';
import type { DiagnosticKind } from '@dejavu/core';
import { badge, el } from './dom';
import { t } from '../lib/i18n';
import type { View } from './sections';

/** Les quatre diagnostics du § 5, plus le repli prudent. */
const KINDS: DiagnosticKind[] = ['flaky', 'already-fixed', 'new', 'infrastructure', 'uncertain'];

/** Une carte de diagnostic : nom, couleur du produit, explication, et le vrai
 * nombre d'occurrences quand le rejeu a tourné. */
function kindCard(kind: DiagnosticKind, view: View): HTMLElement {
  const count = view.run ? view.run.byKind[kind] : undefined;
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, badge(diagnosticLabel(kind, view.lang), diagnosticTone(kind))),
    el('p', {}, t(`kind.${kind}`, view.lang)),
    count === undefined ? null : el('p', { class: 'mono' }, `${count}`),
  );
}

/** Section « quatre diagnostics, un repli honnête ». */
export function renderKinds(view: View): HTMLElement {
  return el(
    'div',
    {},
    el('h2', {}, t('kinds.title', view.lang)),
    el('p', { class: 'section-note' }, t('kinds.note', view.lang)),
    el('div', { class: 'cards' }, ...KINDS.map((kind) => kindCard(kind, view))),
  );
}

/** Les cinq étapes du produit, du build rouge à l'agent Rovo. */
export function renderHow(view: View): HTMLElement {
  const steps = [1, 2, 3, 4, 5].map((n) =>
    el('li', {}, el('strong', {}, t(`how.s${n}.title`, view.lang)), el('span', {}, t(`how.s${n}.text`, view.lang))));
  return el(
    'div',
    {},
    el('h2', {}, t('how.title', view.lang)),
    el('p', { class: 'section-note' }, t('how.note', view.lang)),
    el('ol', { class: 'steps' }, ...steps),
  );
}

/** Ce que la démo prouve, et ce qui exige un vrai tenant — sans ambiguïté. */
export function renderHonesty(view: View): HTMLElement {
  const list = (keys: string[]) =>
    el('ul', {}, ...keys.map((key) => el('li', {}, t(key, view.lang))));
  return el(
    'div',
    { class: 'panel' },
    el('h2', {}, t('honesty.title', view.lang)),
    el('strong', {}, t('honesty.here', view.lang)),
    list(['honesty.here1', 'honesty.here2', 'honesty.here3']),
    el('strong', {}, t('honesty.not', view.lang)),
    list(['honesty.not1', 'honesty.not2', 'honesty.not3']),
  );
}
