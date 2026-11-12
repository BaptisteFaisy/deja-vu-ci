/**
 * Panneau « Jira screens » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.jira.title': ['Jira screens', 'Écrans Jira'],
  'panel.jira.summary': [
    'The project page and the issue panel, built by the Brain’s real screen views.',
    'La page projet et l’encart de ticket, produits par les vraies vues d’écran du Cerveau.',
  ],
});

export const panel: Panel = {
  id: 'jira',
  title: (lang) => t('panel.jira.title', lang),
  summary: (lang) => t('panel.jira.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.jira.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
