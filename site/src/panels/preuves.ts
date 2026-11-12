/**
 * Panneau « Proofs » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.preuves.title': ['Proofs', 'Preuves'],
  'panel.preuves.summary': [
    'Benchmarks, the nightly run, the verification command, the decision log — and what this page does not prove.',
    'Bancs de mesure, rejeu nocturne, commande de vérification, journal des décisions — et ce que cette page ne prouve pas.',
  ],
});

export const panel: Panel = {
  id: 'preuves',
  title: (lang) => t('panel.preuves.title', lang),
  summary: (lang) => t('panel.preuves.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.preuves.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
