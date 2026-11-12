/**
 * Point d'entrée du site public — la coque : atelier partagé, onglets, langue.
 *
 * La coque ne sait rien du produit : elle crée **un** atelier (`state/
 * workspace.ts`, la mémoire rejouée), affiche un onglet par panneau
 * (`panels/registry.ts`) et rend le panneau actif. Chaque panneau, lui, montre
 * une fonctionnalité du produit avec le vrai code du dépôt.
 *
 * Aucun réseau : pas de télémétrie, pas de CDN, pas d'appel sortant. Tout est
 * calculé dans le navigateur, à partir du dépôt public.
 */

import { el, mount } from './render/dom';
import { normalizeLang, type Lang } from './lib/i18n';
import { PANELS, panelById } from './panels/registry';
import { renderHonesty, renderHow, renderKinds } from './render/content';
import {
  renderFooter,
  renderHero,
  renderTopbar,
  type Actions,
  type View,
} from './render/sections';
import { createWorkspace, type Workspace } from './state/workspace';

/** Ce que la coque sait : langue, atelier, panneau actif, rejeu en cours. */
interface State {
  lang: Lang;
  workspace?: Workspace;
  panel: string;
  running: boolean;
  error?: string;
}

/** La langue demandée : `?lang=`, sinon le navigateur, sinon l'anglais. */
function initialLang(): Lang {
  const asked =
    typeof location === 'undefined' ? undefined : new URLSearchParams(location.search).get('lang');
  return normalizeLang(asked ?? (typeof navigator === 'undefined' ? undefined : navigator.language));
}

/** Le panneau demandé : `?panel=`, sinon le premier. */
function initialPanel(): string {
  const asked =
    typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('panel');
  return asked && panelById(asked) ? asked : PANELS[0].id;
}

const state: State = { lang: initialLang(), panel: initialPanel(), running: true };

/** Rejoue le jeu d'exemple dans une mémoire neuve (bouton du héro). */
async function reload(): Promise<void> {
  if (!state.workspace || state.running) return;
  state.running = true;
  state.error = undefined;
  render();
  try {
    await state.workspace.reload();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    render();
  }
}

/** Les deux gestes de la coque : rejouer, changer de langue. */
const actions: Actions = {
  onRun: () => void reload(),
  onLang: (lang: Lang) => {
    state.lang = lang;
    document.documentElement.lang = lang;
    render();
  },
};

/** L'état, gelé en ce que les sections ont le droit de lire. */
function view(): View {
  return {
    lang: state.lang,
    running: state.running,
    ...(state.workspace ? { run: state.workspace.view } : {}),
    ...(state.error ? { error: state.error } : {}),
  };
}

/** Change de panneau et le dit dans l'adresse (lien partageable). */
function selectPanel(id: string): void {
  state.panel = id;
  const url = new URL(location.href);
  url.searchParams.set('panel', id);
  history.replaceState(null, '', url.toString());
  render();
}

/** La barre d'onglets : un bouton par panneau, rôle ARIA compris. */
function tabs(): HTMLElement {
  return el(
    'div',
    { role: 'tablist', 'aria-label': 'Features' },
    ...PANELS.map((panel) =>
      el(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `tab-${panel.id}`,
          'aria-selected': String(panel.id === state.panel),
          'aria-controls': 'panel',
          onclick: () => selectPanel(panel.id),
        },
        panel.title(state.lang),
      ),
    ),
  );
}

/** Le panneau actif, ou son état de chargement. */
function panelHost(host: HTMLElement): void {
  const panel = panelById(state.panel) ?? PANELS[0];
  host.setAttribute('role', 'tabpanel');
  host.setAttribute('aria-labelledby', `tab-${panel.id}`);
  if (!state.workspace) {
    mount(host, el('p', { class: 'status' }, '…'));
    return;
  }
  mount(host, el('p', { class: 'section-note' }, panel.summary(state.lang)));
  const body = el('div', {});
  host.appendChild(body);
  panel.render(body, { lang: state.lang, workspace: state.workspace });
}

/** Rend la coque entière : barre, héro, onglets, panneau, contexte, pied. */
function render(): void {
  mount(document.getElementById('topbar'), renderTopbar(view(), actions));
  mount(document.getElementById('hero'), renderHero(view(), actions));
  const tabHost = document.getElementById('tabs');
  if (tabHost) mount(tabHost, tabs());
  const host = document.getElementById('panel');
  if (host) panelHost(host);
  const current = view();
  mount(document.getElementById('diagnostics'), renderKinds(current));
  mount(document.getElementById('how'), renderHow(current));
  mount(document.getElementById('honesty'), renderHonesty(current));
  mount(document.getElementById('footer'), renderFooter(current));
}

/** Démarre : construit l'atelier (un rejeu), puis rend la page. */
async function start(): Promise<void> {
  document.documentElement.lang = state.lang;
  render();
  try {
    state.workspace = await createWorkspace();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    render();
  }
}

void start();

/** `?demo=1` rejoue dès le chargement (lien partageable, vérification headless). */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1') {
  void reload();
}
