/**
 * Tests of the shared presentation vocabulary (`packages/present`).
 *
 * The package is pure: it is exercised here without Forge, without React and
 * without a browser. What is verified is what both apps depend on: every
 * label exists in both languages, an unknown value still renders a label,
 * and a module key always resolves to a screen.
 */

import { describe, expect, it } from 'vitest';
import {
  CATEGORIES_LIST,
  DIAGNOSTIC_KINDS,
  LANGS,
  LANG_LABELS,
  SIGNATURE_STATUSES,
  actionLabel,
  categoryLabel,
  diagnosticLabel,
  diagnosticTone,
  formatBytes,
  formatConfidence,
  formatDate,
  formatMinutes,
  langToggleLabel,
  normalizeLang,
  otherLang,
  resolveScreen,
  sharedKeys,
  sharedMessage,
  shortCommit,
  statusLabel,
  statusNeedsAttention,
  statusTone,
  t,
  type ScreenRule,
} from '../src/index.js';

describe('langue', () => {
  it('connaît les deux langues', () => {
    expect(LANGS).toEqual(['en', 'fr']);
    expect(LANG_LABELS).toEqual({ en: 'English', fr: 'Français' });
  });

  it('normalise une locale de navigateur', () => {
    expect(normalizeLang('fr')).toBe('fr');
    expect(normalizeLang('fr-FR')).toBe('fr');
    expect(normalizeLang('en-GB')).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
    expect(normalizeLang(42)).toBe('en');
  });

  it('bascule d’une langue à l’autre', () => {
    expect(otherLang('en')).toBe('fr');
    expect(otherLang('fr')).toBe('en');
    // Le bouton nomme la langue vers laquelle il bascule.
    expect(langToggleLabel('en')).toBe('Français');
    expect(langToggleLabel('fr')).toBe('English');
  });
});

describe('table de libellés partagés', () => {
  it('traduit une clé dans les deux langues', () => {
    expect(t('diagnostic.confidence', 'en')).toBe('Confidence');
    expect(t('diagnostic.confidence', 'fr')).toBe('Confiance');
    expect(t('settings.save', 'fr')).toBe('Enregistrer');
  });

  it('rend la clé elle-même quand elle n’est pas partagée', () => {
    expect(t('page.title', 'fr')).toBe('page.title');
    expect(sharedMessage('cle.inconnue', 'en')).toBeUndefined();
  });

  it('n’a aucune clé vide et jamais une clé pour libellé', () => {
    const keys = sharedKeys();
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of keys) {
      expect(t(key, 'en').length, key).toBeGreaterThan(0);
      expect(t(key, 'fr').length, key).toBeGreaterThan(0);
      expect(t(key, 'en'), key).not.toBe(key);
      expect(t(key, 'fr'), key).not.toBe(key);
    }
  });
});

describe('libellés du domaine', () => {
  it('nomme les cinq diagnostics dans les deux langues', () => {
    expect(diagnosticLabel('flaky', 'en')).toBe('Known flaky failure');
    expect(diagnosticLabel('flaky', 'fr')).toBe('Instabilité connue');
    expect(diagnosticLabel('already-fixed', 'fr')).toBe('Déjà vu, déjà corrigé');
    for (const kind of DIAGNOSTIC_KINDS) {
      expect(diagnosticLabel(kind, 'en')).not.toBe(kind);
      expect(diagnosticLabel(kind, 'fr')).not.toBe(kind);
    }
  });

  it('donne une couleur à chaque diagnostic', () => {
    expect(diagnosticTone('already-fixed')).toBe('green');
    expect(diagnosticTone('infrastructure')).toBe('purple');
  });

  it('nomme les cinq actions proposées', () => {
    expect(actionLabel('retry', 'en')).toBe('Retry the build');
    expect(actionLabel('rebase', 'fr')).toBe('Rebaser ou reprendre le correctif');
    expect(actionLabel('none', 'fr')).toBe('Rien à faire pour l’instant');
  });

  it('nomme les cinq statuts, avec leur couleur et l’attention requise', () => {
    expect(statusLabel('flaky', 'fr')).toBe('Instable');
    expect(statusTone('resolved')).toBe('green');
    for (const status of SIGNATURE_STATUSES) {
      expect(statusLabel(status, 'en')).not.toBe(status);
      expect(statusLabel(status, 'fr')).not.toBe(status);
      expect(statusNeedsAttention(status)).toBe(status === 'flaky' || status === 'regression');
    }
  });

  it('nomme les huit catégories', () => {
    expect(categoryLabel('dependency', 'en')).toBe('Dependency');
    expect(categoryLabel('dependency', 'fr')).toBe('Dépendance');
    expect(categoryLabel('unknown', 'fr')).toBe('Inconnue');
    for (const category of CATEGORIES_LIST) {
      expect(categoryLabel(category, 'en').length).toBeGreaterThan(0);
      expect(categoryLabel(category, 'fr').length).toBeGreaterThan(0);
    }
  });

  it('rend un libellé plutôt que `undefined` sur une valeur inconnue', () => {
    // Les valeurs arrivent en JSON : une version future du moteur ne doit pas
    // vider un écran.
    const unknown = 'never-seen' as unknown as 'flaky';
    expect(diagnosticLabel(unknown, 'fr')).toBe('Incertain');
    expect(statusLabel(unknown, 'en')).toBe('Known');
    expect(categoryLabel(unknown, 'fr')).toBe('Inconnue');
    expect(actionLabel(unknown, 'en')).toBe('Nothing to do yet');
    expect(diagnosticTone(unknown)).toBe('grey');
  });
});

describe('mise en forme', () => {
  it('formate une confiance en pourcentage, borné', () => {
    expect(formatConfidence(0.83)).toBe('83%');
    expect(formatConfidence(1)).toBe('100%');
    expect(formatConfidence(1.4)).toBe('100%');
    expect(formatConfidence(-1)).toBe('0%');
    expect(formatConfidence(Number.NaN)).toBe('0%');
  });

  it('formate les dates dans les deux langues', () => {
    expect(formatDate('2026-11-03T10:00:00Z', 'fr')).toBe('03/11/2026');
    expect(formatDate('2026-11-03T10:00:00Z', 'en')).toBe('11/03/2026');
    expect(formatDate('pas une date', 'fr')).toBe('pas une date');
  });

  it('formate les minutes de CI', () => {
    expect(formatMinutes(90)).toBe('1.5 min');
    expect(formatMinutes(30)).toBe('0.5 min');
    expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe('0 min');
  });

  it('formate une taille d’extrait', () => {
    expect(formatBytes(51200)).toBe('50 KiB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(-3)).toBe('0 KiB');
  });

  it('abrège un commit', () => {
    expect(shortCommit('abc123456789')).toBe('abc1234');
  });
});

describe('routage des écrans', () => {
  type Screen = 'card' | 'settings';
  const RULES: ScreenRule<Screen>[] = [
    { match: 'deja-vu-workspace-settings', screen: 'settings' },
    { match: 'deja-vu-pr-card', screen: 'card' },
  ];

  it('route sur la clé de module', () => {
    expect(resolveScreen('deja-vu-pr-card', RULES, 'card')).toBe('card');
    expect(resolveScreen('deja-vu-workspace-settings', RULES, 'card')).toBe('settings');
  });

  it('accepte une clé qui porte un suffixe de module', () => {
    expect(resolveScreen('deja-vu-workspace-settings/main', RULES, 'card')).toBe('settings');
  });

  it('retombe sur l’écran par défaut', () => {
    expect(resolveScreen(undefined, RULES, 'card')).toBe('card');
    expect(resolveScreen('inconnu', RULES, 'settings')).toBe('settings');
  });

  it('applique la première règle qui correspond', () => {
    const rules: ScreenRule<Screen>[] = [
      { match: 'card-extra', screen: 'settings' },
      { match: 'card', screen: 'card' },
    ];
    expect(resolveScreen('card-extra', rules, 'card')).toBe('settings');
  });
});
