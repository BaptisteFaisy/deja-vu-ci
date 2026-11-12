/**
 * Panneau « Sécurité » — masquage, pont signé, minimisation, inventaire.
 *
 * Les quatre démonstrations tournent avec le vrai code du dépôt (voir
 * `securite-demo.ts` pour la logique pure et `securite-view.ts` pour le
 * rendu) : `maskSecrets` de `packages/core`, `signPayload`/`verifyRequest`/
 * `rotateSecret` de `packages/bridge`, `minimizeExcerpt` du moteur comparé à
 * `applyExcerptPolicy` du Cerveau, et le vrai `docs/SBOM.json`.
 *
 * L'état interactif (texte saisi, motif ajouté, enveloppe signée, refus déjà
 * essayés) vit dans un module : un changement de langue reconstruit le rendu
 * sans rien perdre, et rien n'est recalculé inutilement.
 */

import { el, mount } from '../render/dom';
import { t } from '../lib/i18n';
import type { Panel, PanelContext } from './types';
import './securite-strings';
import {
  bridgeSection,
  createState,
  ensureReady,
  maskingSection,
  minimizeSection,
  sbomSection,
} from './securite-view';

/** L'état du panneau, conservé d'un rendu (et d'une langue) à l'autre. */
const state = createState();

/** Rend le panneau dans son hôte (idempotent : reconstruit tout). */
function renderPanel(host: HTMLElement, ctx: PanelContext): void {
  const { lang, workspace } = ctx;
  ensureReady(state, workspace.now);
  const rerender = () => renderPanel(host, ctx);
  mount(
    host,
    el('div', { class: 'block' }, maskingSection(lang, state, rerender)),
    el('div', { class: 'block' }, bridgeSection(lang, state, rerender)),
    el('div', { class: 'block' }, minimizeSection(lang)),
    el('div', { class: 'block' }, sbomSection(lang)),
  );
}

export const panel: Panel = {
  id: 'securite',
  title: (lang) => t('panel.securite.title', lang),
  summary: (lang) => t('panel.securite.summary', lang),
  render: renderPanel,
};
