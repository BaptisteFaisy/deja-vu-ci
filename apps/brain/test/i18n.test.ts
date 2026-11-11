/**
 * Tests de la table de traduction (`src/ui/i18n.ts`).
 *
 * L'interface doit exister en anglais et en français (§ 18) : chaque clé se
 * trouve donc dans les deux langues, et la langue inconnue retombe sur
 * l'anglais.
 */

import { describe, expect, it } from 'vitest';
import { LANG_LABELS, LANGS, normalizeLang, t, translationKeys } from '../src/ui/i18n';

describe('table de traduction', () => {
  it('connaît les deux langues', () => {
    expect(LANGS).toEqual(['en', 'fr']);
    expect(LANG_LABELS.en).toBe('English');
    expect(LANG_LABELS.fr).toBe('Français');
  });

  it('traduit une clé dans les deux langues', () => {
    expect(t('page.title', 'en')).toBe('CI Memory');
    expect(t('page.title', 'fr')).toBe('Mémoire de CI');
    expect(t('tab.cost', 'fr')).toBe('Coût');
  });

  it('rend la clé elle-même quand elle est inconnue', () => {
    expect(t('cle.inconnue', 'fr')).toBe('cle.inconnue');
  });

  it('n\'a aucune clé vide', () => {
    for (const key of translationKeys()) {
      expect(t(key, 'en').length).toBeGreaterThan(0);
      expect(t(key, 'fr').length).toBeGreaterThan(0);
      expect(t(key, 'en')).not.toBe(key);
    }
  });

  it('couvre les libellés des trois écrans', () => {
    const keys = translationKeys();
    for (const key of ['page.title', 'tab.flaky', 'tab.pending', 'tab.cost']) {
      expect(keys).toContain(key);
    }
    for (const key of ['issue.diagnostic', 'issue.occurrences', 'issue.confirm']) {
      expect(keys).toContain(key);
    }
    for (const key of ['settings.project', 'settings.universalKey', 'settings.save']) {
      expect(keys).toContain(key);
    }
  });
});

describe('normalisation de la langue', () => {
  it('accepte le français et ses variantes', () => {
    expect(normalizeLang('fr')).toBe('fr');
    expect(normalizeLang('fr-FR')).toBe('fr');
  });

  it('retombe sur l\'anglais', () => {
    expect(normalizeLang('en-GB')).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
    expect(normalizeLang(42)).toBe('en');
  });
});
