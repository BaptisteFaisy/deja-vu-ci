/**
 * Panneau « Universal entry » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.universel.title': ['Universal entry', 'Entrée universelle'],
  'panel.universel.summary': [
    'Any CI feeding the same memory: build the payload, copy the one-liner.',
    'N’importe quelle CI alimente la même mémoire : construisez la charge, copiez la ligne de commande.',
  ],
});

export const panel: Panel = {
  id: 'universel',
  title: (lang) => t('panel.universel.title', lang),
  summary: (lang) => t('panel.universel.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.universel.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
