/**
 * Panneau « Your error » — en construction.
 *
 * Le squelette existe pour que le site compile et reste cohérent pendant que ce
 * panneau est écrit ; son contenu réel (et ses propres chaînes) remplaceront
 * ce fichier.
 */

import { el, mount } from '../render/dom';
import { registerStrings, t } from '../lib/i18n';
import type { Panel } from './types';

registerStrings({
  'panel.erreur.title': ['Your error', 'Votre erreur'],
  'panel.erreur.summary': [
    'Paste a failing log: the engine masks the secrets, extracts the error, signs it and answers with a diagnostic.',
    'Collez un journal en échec : le moteur masque les secrets, extrait l’erreur, la signe et répond par un diagnostic.',
  ],
});

export const panel: Panel = {
  id: 'erreur',
  title: (lang) => t('panel.erreur.title', lang),
  summary: (lang) => t('panel.erreur.summary', lang),
  render(host, ctx) {
    mount(
      host,
      el('p', { class: 'section-note' }, t('panel.erreur.summary', ctx.lang)),
      el('p', { class: 'empty' }, 'en construction'),
    );
  },
};
