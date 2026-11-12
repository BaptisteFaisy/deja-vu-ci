/**
 * Le registre des panneaux : chaque fonctionnalité du produit a son onglet.
 *
 * Ce test est la garde du site « toutes les features visibles » : un panneau
 * sans titre, un identifiant en double ou un panneau oublié du registre casse
 * ici, avant d'arriver devant un visiteur.
 */

import { describe, expect, it } from 'vitest';
import { PANELS, panelById } from '../src/panels/registry';

/** Les fonctionnalités du produit qui doivent avoir un onglet. */
const ATTENDUS = [
  'replay',
  'erreur',
  'pr',
  'jira',
  'rovo',
  'curate',
  'incident',
  'cout',
  'universel',
  'securite',
  'justesse',
  'preuves',
];

describe('registre des panneaux', () => {
  it('couvre toutes les fonctionnalités annoncées', () => {
    expect(PANELS.map((panel) => panel.id)).toEqual(ATTENDUS);
  });

  it('n’a pas deux panneaux avec le même identifiant', () => {
    const ids = PANELS.map((panel) => panel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('donne à chaque panneau un titre et un résumé dans les deux langues', () => {
    for (const panel of PANELS) {
      for (const lang of ['en', 'fr'] as const) {
        const title = panel.title(lang);
        const summary = panel.summary(lang);
        expect(title.length, `${panel.id}/${lang}`).toBeGreaterThan(0);
        expect(summary.length, `${panel.id}/${lang}`).toBeGreaterThan(10);
        expect(title, `${panel.id}/${lang}`).not.toContain('panel.');
        expect(summary, `${panel.id}/${lang}`).not.toContain('panel.');
      }
    }
  });

  it('retrouve un panneau par identifiant, et rien sinon', () => {
    expect(panelById('rovo')?.id).toBe('rovo');
    expect(panelById('inexistant')).toBeUndefined();
  });
});
