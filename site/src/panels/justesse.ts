/**
 * Panneau « Justesse » — la mesure § 18, calculée dans le navigateur.
 *
 * Le corpus étiqueté du dépôt (`data/labeled/100-failures.json` : 100 échecs
 * étiquetés à la main, 27 groupes) est mesuré **en direct** par le vrai
 * moteur (`packages/core`) : les trois indicateurs du § 18 (regroupement,
 * catégories, faux « instable »), le détail ligne à ligne, et la comparaison
 * avec la trace publiée par la vérification nocturne.
 *
 * La mesure est calculée une fois pour la page (le corpus et le moteur ne
 * changent pas) : le panneau le dit, et affiche le temps qu'elle a pris.
 */

import { el, mount } from '../render/dom';
import { t } from '../lib/i18n';
import type { Panel, PanelContext } from './types';
import './justesse-strings';
import { measurement } from './justesse-mesure';
import {
  detailSection,
  indicatorsSection,
  introSection,
  methodSection,
  nightlySection,
} from './justesse-view';

/** Rend le panneau dans son hôte (idempotent : reconstruit tout). */
function renderPanel(host: HTMLElement, ctx: PanelContext): void {
  const { lang } = ctx;
  const mesure = measurement();
  mount(
    host,
    el('div', { class: 'block' }, introSection(mesure, lang)),
    el('div', { class: 'block' }, indicatorsSection(mesure, lang)),
    el('div', { class: 'block' }, detailSection(mesure, lang)),
    el('div', { class: 'block' }, methodSection(lang)),
    el('div', { class: 'block' }, nightlySection(mesure, lang)),
  );
}

export const panel: Panel = {
  id: 'justesse',
  title: (lang) => t('panel.justesse.title', lang),
  summary: (lang) => t('panel.justesse.summary', lang),
  render: renderPanel,
};
