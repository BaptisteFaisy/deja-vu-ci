/**
 * Panneau « Rovo & MCP » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.rovo.title': ['Rovo & MCP', 'Rovo et MCP'],
  'panel.rovo.summary': [
    'The six agent actions, executed for real against the memory of this page.',
    'Les six actions de l’agent, exécutées pour de vrai sur la mémoire de cette page.',
  ],
});

export const panel: Panel = {
  id: 'rovo',
  title: (lang) => t('panel.rovo.title', lang),
  summary: (lang) => t('panel.rovo.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.rovo.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
