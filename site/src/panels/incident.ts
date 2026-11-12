/**
 * Panneau « Incident » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.incident.title': ['Incident', 'Incident'],
  'panel.incident.summary': [
    'One infrastructure outage instead of ten alerts: the same signature failing everywhere at once.',
    'Une panne d’infrastructure au lieu de dix alertes : la même signature qui échoue partout en même temps.',
  ],
});

export const panel: Panel = {
  id: 'incident',
  title: (lang) => t('panel.incident.title', lang),
  summary: (lang) => t('panel.incident.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.incident.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
