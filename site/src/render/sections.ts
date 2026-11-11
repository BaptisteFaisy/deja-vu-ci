/**
 * Les sections « vitrine » du site : barre du haut, héro, panneau de démo, pied.
 *
 * Chaque fonction rend un nœud à partir de l'état courant (langue, rejeu en
 * cours, résultat) — aucune logique métier ici, seulement les textes de
 * `lib/i18n.ts` et les libellés partagés de `@dejavu/present`.
 */

import { el, mount } from './dom';
import { fill, langToggleLabel, t, type Lang } from '../lib/i18n';
import { repositoriesOf, SAMPLE, type DemoRun } from '../lib/demo';

/** Dépôt public : tous les liens externes du site pointent là. */
export const REPO_URL = 'https://github.com/BaptisteFaisy/deja-vu-ci';

/** Ce que le site a besoin de savoir pour se rendre. */
export interface View {
  lang: Lang;
  running: boolean;
  run?: DemoRun;
  error?: string;
}

/** Les deux gestes possibles sur la page. */
export interface Actions {
  onRun(): void;
  onLang(lang: Lang): void;
}

/** Barre du haut : marque, liens, bascule de langue. */
export function renderTopbar(view: View, actions: Actions): HTMLElement {
  const brand = el(
    'span',
    { class: 'brand' },
    el('img', { src: './icon.svg', alt: '', width: '26', height: '26' }),
    'Déjà-vu CI',
  );
  const nav = el(
    'nav',
    {},
    el('a', { href: '#demo' }, t('nav.demo', view.lang)),
    el('a', { href: '#how' }, t('nav.how', view.lang)),
    el('a', { href: `${REPO_URL}/blob/main/docs/JUDGES.md`, rel: 'noopener' }, t('nav.judges', view.lang)),
    el('a', { href: REPO_URL, rel: 'noopener' }, t('nav.repo', view.lang)),
    el('button', { type: 'button', onclick: () => actions.onLang(view.lang === 'fr' ? 'en' : 'fr') },
      langToggleLabel(view.lang)),
  );
  return el('div', {}, brand, nav);
}

/** Héro : la promesse, le bouton, et ce que la démo prouve. */
export function renderHero(view: View, actions: Actions): HTMLElement {
  return el(
    'div',
    {},
    el('h1', {}, t('hero.title', view.lang)),
    el('p', { class: 'pitch' }, t('hero.pitch', view.lang)),
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'primary', type: 'button', disabled: view.running, onclick: actions.onRun },
        t('hero.cta', view.lang)),
      el('a', { href: `${REPO_URL}/blob/main/docs/JUDGES.md`, rel: 'noopener' },
        el('button', { type: 'button' }, t('hero.secondary', view.lang))),
    ),
    el('p', { class: 'note' }, t('hero.note', view.lang)),
  );
}

/** La ligne d'état du panneau de démo : en cours, fini, ou échec. */
function statusLine(view: View): HTMLElement {
  if (view.error) return el('p', { class: 'status error' }, fill(t('demo.error', view.lang), { error: view.error }));
  if (view.running) return el('p', { class: 'status' }, t('demo.running', view.lang));
  if (view.run) {
    return el('p', { class: 'status' }, fill(t('demo.done', view.lang), { ms: view.run.elapsedMs }));
  }
  return el('p', { class: 'status' }, fill(t('demo.dataset', view.lang), {
    name: SAMPLE.name,
    days: SAMPLE.days,
    repos: repositoriesOf().length,
    failures: SAMPLE.occurrences.filter((o) => o.outcome === 'failure').length,
  }));
}

/** Panneau de démo : le bouton, l'état, et les compteurs une fois joué. */
export function renderDemo(view: View, actions: Actions): HTMLElement {
  const counters = view.run ? counterList(view.run, view.lang) : undefined;
  return el(
    'div',
    { class: 'panel' },
    el('h2', {}, t('demo.title', view.lang)),
    el('p', { class: 'section-note' }, t('demo.description', view.lang)),
    el('button', { class: 'primary', type: 'button', disabled: view.running, onclick: actions.onRun },
      t('hero.cta', view.lang)),
    statusLine(view),
    counters,
  );
}

/** Les six compteurs du rejeu. */
function counterList(run: DemoRun, lang: Lang): HTMLElement {
  const entries: Array<[string, string | number]> = [
    [t('counter.signatures', lang), run.signatures.length],
    [t('counter.failures', lang), run.failures],
    [t('counter.tickets', lang), run.tickets.filter((a) => a.kind === 'create').length],
    [t('counter.comments', lang), run.tickets.filter((a) => a.kind === 'comment').length],
    [t('cost.minutesLost', lang), Math.round(run.cost.ciMinutesLost)],
    [t('cost.peopleAffected', lang), run.cost.peopleAffected],
  ];
  return el('ul', { class: 'counters' }, ...entries.map(([label, value]) =>
    el('li', {}, el('span', { class: 'value' }, String(value)), el('span', { class: 'label' }, label))));
}

/** Pied de page. */
export function renderFooter(view: View): HTMLElement {
  return el(
    'div',
    {},
    `${t('footer.license', view.lang)} `,
    el('a', { href: REPO_URL, rel: 'noopener' }, 'BaptisteFaisy/deja-vu-ci'),
    ` — ${t('footer.contest', view.lang)} ${t('footer.source', view.lang)}`,
  );
}

/** Rend une section dans son conteneur d'id donné. */
export function into(id: string, node: HTMLElement | undefined): void {
  mount(document.getElementById(id), node);
}
