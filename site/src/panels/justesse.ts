/**
 * Panneau « Accuracy » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.justesse.title': ['Accuracy', 'Justesse'],
  'panel.justesse.summary': [
    'The labelled corpus measured in your browser: grouping, categories, false flaky.',
    'Le corpus étiqueté mesuré dans votre navigateur : regroupement, catégories, faux instables.',
  ],
});

export const panel: Panel = {
  id: 'justesse',
  title: (lang) => t('panel.justesse.title', lang),
  summary: (lang) => t('panel.justesse.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.justesse.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
