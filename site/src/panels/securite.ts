/**
 * Panneau « Security » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.securite.title': ['Security', 'Sécurité'],
  'panel.securite.summary': [
    'Masking patterns and the signed bridge, computed live: what leaves Bitbucket and what is refused.',
    'Motifs de masquage et pont signé, calculés en direct : ce qui quitte Bitbucket et ce qui est refusé.',
  ],
});

export const panel: Panel = {
  id: 'securite',
  title: (lang) => t('panel.securite.title', lang),
  summary: (lang) => t('panel.securite.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.securite.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
