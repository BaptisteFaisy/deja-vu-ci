/**
 * Panneau « Curation & quarantine » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.curate.title': ['Curation & quarantine', 'Curation et quarantaine'],
  'panel.curate.summary': [
    'Merge or split two signatures, and the quarantine proposal for an expensive flaky test.',
    'Fusionnez ou scindez deux signatures, et la proposition de quarantaine d’un test instable coûteux.',
  ],
});

export const panel: Panel = {
  id: 'curate',
  title: (lang) => t('panel.curate.title', lang),
  summary: (lang) => t('panel.curate.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.curate.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
