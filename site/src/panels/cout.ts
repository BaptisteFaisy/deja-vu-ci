/**
 * Panneau « Cost » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.cout.title': ['Cost', 'Coût'],
  'panel.cout.summary': [
    'CI minutes lost, people affected, retries — and what that costs in euros.',
    'Minutes de CI perdues, personnes touchées, relances — et ce que cela coûte en euros.',
  ],
});

export const panel: Panel = {
  id: 'cout',
  title: (lang) => t('panel.cout.title', lang),
  summary: (lang) => t('panel.cout.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.cout.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
