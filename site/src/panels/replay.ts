/**
 * Panneau « Rejeu » — la mémoire remplie par le vrai moteur.
 *
 * C'est le point d'entrée du site : le jeu d'exemple suivi par git (40 échecs,
 * 14 jours, 3 dépôts) est rejoué par `packages/core` dans le navigateur, et les
 * quatre blocs de résultats (diagnostics, signatures, plan de tickets, coût)
 * sont rendus par `render/results.ts` — les mêmes fonctions que la première
 * version du site, donc la même mise en forme que les écrans Jira.
 */

import { el, mount } from '../render/dom';
import { renderResults } from '../render/results';
import { SAMPLE, repositoriesOf } from '../lib/demo';
import { fill, registerStrings, t, type Lang } from '../lib/i18n';
import type { DemoRun } from '../lib/demo';
import type { Panel } from './types';

registerStrings({
  'panel.replay.title': ['Replay', 'Rejeu'],
  'panel.replay.summary': [
    'The sample set replayed by the real engine: signatures, diagnostics with their facts, the ticket plan and the cost.',
    'Le jeu d’exemple rejoué par le vrai moteur : signatures, diagnostics avec leurs faits, plan de tickets et coût.',
  ],
});

/** Les six compteurs du rejeu. */
export function counterList(run: DemoRun, lang: Lang): HTMLElement {
  const entries: Array<[string, string | number]> = [
    [t('counter.signatures', lang), run.signatures.length],
    [t('counter.failures', lang), run.failures],
    [t('counter.tickets', lang), run.tickets.filter((a) => a.kind === 'create').length],
    [t('counter.comments', lang), run.tickets.filter((a) => a.kind === 'comment').length],
    [t('cost.minutesLost', lang), Math.round(run.cost.ciMinutesLost)],
    [t('cost.peopleAffected', lang), run.cost.peopleAffected],
  ];
  return el(
    'ul',
    { class: 'counters' },
    ...entries.map(([label, value]) =>
      el('li', {}, el('span', { class: 'value' }, String(value)), el('span', { class: 'label' }, label)),
    ),
  );
}

/** La ligne qui dit quel jeu est rejoué (jamais de chiffre inventé). */
function datasetLine(lang: Lang): string {
  const failures = SAMPLE.occurrences.filter((o) => o.outcome === 'failure').length;
  return fill(t('demo.dataset', lang), {
    name: SAMPLE.name,
    days: SAMPLE.days,
    repos: repositoriesOf().length,
    failures,
  });
}

export const panel: Panel = {
  id: 'replay',
  title: (lang) => t('panel.replay.title', lang),
  summary: (lang) => t('panel.replay.summary', lang),
  render(host, ctx) {
    const { workspace, lang } = ctx;
    const results = renderResults({ lang, running: false, run: workspace.view });
    mount(
      host,
      el(
        'div',
        {},
        el('p', { class: 'section-note' }, datasetLine(lang)),
        counterList(workspace.view, lang),
        results ?? el('p', { class: 'empty' }, t('results.empty', lang)),
      ),
    );
  },
};
