/**
 * Panneau « Pull request card » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.pr.title': ['Pull request card', 'Carte de pull request'],
  'panel.pr.summary': [
    'The card Bitbucket would show, built by the Sensor’s real view-model.',
    'La carte que Bitbucket afficherait, produite par le vrai modèle de vue du Capteur.',
  ],
});

export const panel: Panel = {
  id: 'pr',
  title: (lang) => t('panel.pr.title', lang),
  summary: (lang) => t('panel.pr.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.pr.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
