/**
 * Les sections « vitrine » du site : barre du haut, héro, panneau de démo, pied.
 *
 * Chaque fonction rend un nœud à partir de l'état courant (langue, rejeu en
 * cours, résultat) — aucune logique métier ici, seulement les textes de
 * `lib/i18n.ts` et les libellés partagés de `@dejavu/present`.
 */

import { el, mount } from './dom';
import { langToggleLabel, t, type Lang } from '../lib/i18n';
import type { DemoRun } from '../lib/demo';

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
