/**
 * Point d'entrée du site public — le seul fichier qui touche à l'état.
 *
 * La page tient dans un état minuscule (langue, rejeu en cours, résultat,
 * erreur) : chaque changement re-rend les sections, et les sections ne savent
 * rien de l'état (elles reçoivent un `View`). Le rejeu lui-même est lancé par
 * `lib/demo.ts`, qui fait tourner le vrai moteur sur le vrai jeu d'exemple.
 *
 * Aucun réseau : pas de télémétrie, pas de CDN, pas d'appel sortant. Ce que le
 * visiteur voit est calculé dans son navigateur, à partir du dépôt public.
 */

import { runDemo, type DemoRun } from './lib/demo';
import { normalizeLang, type Lang } from './lib/i18n';
import { renderHonesty, renderHow, renderKinds } from './render/content';
import { renderResults } from './render/results';
import {
  into,
  renderDemo,
  renderFooter,
  renderHero,
  renderTopbar,
  type Actions,
  type View,
} from './render/sections';

/** Tout ce que la page sait d'elle-même. */
interface State {
  lang: Lang;
  running: boolean;
  run?: DemoRun;
  error?: string;
}

/** La langue demandée : `?lang=`, sinon le navigateur, sinon l'anglais. */
function initialLang(): Lang {
  const asked =
    typeof location === 'undefined' ? undefined : new URLSearchParams(location.search).get('lang');
  return normalizeLang(asked ?? (typeof navigator === 'undefined' ? undefined : navigator.language));
}

const state: State = { lang: initialLang(), running: false };

/** L'état, gelé en ce que les sections ont le droit de lire. */
function view(): View {
  return {
    lang: state.lang,
    running: state.running,
    ...(state.run ? { run: state.run } : {}),
    ...(state.error ? { error: state.error } : {}),
  };
}

/** Les deux gestes de la page : rejouer, changer de langue. */
const actions: Actions = {
  onRun: () => void replay(),
  onLang: (lang: Lang) => {
    state.lang = lang;
    render();
    document.documentElement.lang = lang;
  },
};

/** Rend toutes les sections, et masque les résultats tant qu'il n'y en a pas. */
function render(): void {
  const current = view();
  into('topbar', renderTopbar(current, actions));
  into('hero', renderHero(current, actions));
  into('demo', renderDemo(current, actions));
  into('results', renderResults(current));
  into('diagnostics', renderKinds(current));
  into('how', renderHow(current));
  into('honesty', renderHonesty(current));
  into('footer', renderFooter(current));
  const results = document.getElementById('results');
  if (results) results.hidden = !state.run;
}

/** Laisse le navigateur peindre l'état « en cours » avant de calculer. */
function paint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Rejoue le jeu d'exemple, puis affiche les quatre blocs de résultats. */
async function replay(): Promise<void> {
  if (state.running) return;
  state.running = true;
  state.error = undefined;
  render();
  await paint();
  try {
    state.run = await runDemo();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    render();
    if (state.run) {
      document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

document.documentElement.lang = state.lang;
render();

/**
 * `?demo=1` rejoue le jeu au chargement.
 *
 * Deux usages, un seul mécanisme : un lien partagé qui montre directement les
 * résultats, et une vérification headless du site rendu (Chrome sans interface,
 * captures du README) sans outillage de test supplémentaire.
 */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1') {
  void replay();
}
