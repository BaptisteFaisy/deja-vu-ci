/**
 * Tests of the settings page's pure part (`src/pure/settingsView.ts`).
 *
 * Two things are checked: the form round-trips with what the resolver
 * answers, and the secret stays write-only — the page never displays it, and
 * an empty secret field means "leave the stored one alone".
 */

import { describe, expect, it } from 'vitest';
import { MAX_EXCERPT_BYTES, MIN_EXCERPT_BYTES } from '../src/pure/settings.js';
import {
  MIN_SECRET_LENGTH,
  clampExcerptBytes,
  emptySettingsView,
  formatRepositoryList,
  parseRepositoryList,
  validateSettingsForm,
  type SettingsView,
} from '../src/pure/settingsView.js';

const PAIRED: SettingsView = {
  ok: true,
  paired: true,
  brainUrl: 'https://xyz.webtrigger.atlassian.app',
  trackedRepositories: ['acme/web', 'acme/api'],
  maxExcerptBytes: 51200,
};

describe('liste des dépôts suivis', () => {
  it('passe du presse-papiers au tableau', () => {
    expect(parseRepositoryList('acme/web\nacme/api\n')).toEqual(['acme/web', 'acme/api']);
  });

  it('ignore les lignes vides, les espaces et les doublons', () => {
    expect(parseRepositoryList('  acme/web \n\n acme/web\r\nacme/api')).toEqual([
      'acme/web',
      'acme/api',
    ]);
    expect(parseRepositoryList('')).toEqual([]);
  });

  it('revient au texte, un dépôt par ligne', () => {
    expect(formatRepositoryList(['acme/web', 'acme/api'])).toBe('acme/web\nacme/api');
    expect(formatRepositoryList(undefined)).toBe('');
  });

  it('fait l’aller-retour sans perte', () => {
    const list = PAIRED.trackedRepositories;
    expect(parseRepositoryList(formatRepositoryList(list))).toEqual(list);
  });
});

describe('taille maximale des extraits', () => {
  it('reste dans les bornes du Capteur (§ 19)', () => {
    expect(clampExcerptBytes(10)).toBe(MIN_EXCERPT_BYTES);
    expect(clampExcerptBytes(10 * 1024 * 1024)).toBe(MAX_EXCERPT_BYTES);
    expect(clampExcerptBytes(20480.7)).toBe(20480);
  });

  it('retombe sur la limite par défaut quand la saisie n’est pas un nombre', () => {
    expect(clampExcerptBytes(Number.NaN)).toBe(MAX_EXCERPT_BYTES);
    expect(clampExcerptBytes(Number.POSITIVE_INFINITY)).toBe(MAX_EXCERPT_BYTES);
  });

  it('affiche la limite dans l’unité du réglage', () => {
    expect(emptySettingsView().maxExcerptBytes).toBe(MAX_EXCERPT_BYTES);
  });
});

describe('validation du formulaire', () => {
  it('exige l’URL du Cerveau', () => {
    expect(validateSettingsForm({ brainUrl: '  ' }, false)).toBe('brainUrlRequired');
    expect(validateSettingsForm({}, true)).toBe('brainUrlRequired');
  });

  it('refuse une URL qui n’en est pas une', () => {
    expect(validateSettingsForm({ brainUrl: 'brain.local' }, true)).toBe('brainUrlInvalid');
    expect(validateSettingsForm({ brainUrl: 'ftp://x' }, true)).toBe('brainUrlInvalid');
    expect(
      validateSettingsForm({ brainUrl: 'https://xyz.webtrigger.atlassian.app' }, true),
    ).toBe('');
  });

  it('exige le secret au jumelage, et seulement au jumelage', () => {
    const url = 'https://xyz.webtrigger.atlassian.app';
    expect(validateSettingsForm({ brainUrl: url }, false)).toBe('secretTooShort');
    expect(validateSettingsForm({ brainUrl: url, secret: 'court' }, false)).toBe('secretTooShort');
    expect(MIN_SECRET_LENGTH).toBe(16);
    expect(validateSettingsForm({ brainUrl: url, secret: 'x'.repeat(MIN_SECRET_LENGTH) }, false)).toBe('');
    // Already paired: saving preferences must not ask for the secret again.
    expect(validateSettingsForm({ brainUrl: url }, true)).toBe('');
  });
});
