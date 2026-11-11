/**
 * Tests of the settings page's pure part (`src/pure/settingsView.ts`).
 *
 * Two things are checked: the form round-trips with what the resolver
 * answers, and the secret stays write-only — the page never displays it, and
 * an empty secret field means "leave the stored one alone".
 */

import { describe, expect, it } from 'vitest';
import { MAX_EXCERPT_BYTES, MIN_EXCERPT_BYTES } from '../src/pure/settings';
import {
  EMPTY_SETTINGS_FORM,
  MIN_SECRET_LENGTH,
  clampExcerptBytes,
  emptySettingsView,
  formOf,
  formatRepositoryList,
  parseRepositoryList,
  payloadOf,
  validateSettingsForm,
  viewAfterSave,
  type SettingsView,
} from '../src/pure/settingsView';

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

describe('état du formulaire bâti par la page (Custom UI)', () => {
  it('reflète la vue du résolveur, texte par texte', () => {
    expect(formOf(PAIRED)).toEqual({
      brainUrl: PAIRED.brainUrl,
      secret: '',
      repositories: 'acme/web\nacme/api',
      maxExcerptBytes: '51200',
    });
  });

  it('ne préremplit jamais le secret — il est write-only (§ 16)', () => {
    expect(formOf(PAIRED).secret).toBe('');
    expect(formOf(emptySettingsView()).secret).toBe('');
    expect(EMPTY_SETTINGS_FORM.secret).toBe('');
  });

  it('tolère une vue sans URL ni dépôts', () => {
    const state = formOf({ ok: true, paired: false, trackedRepositories: [], maxExcerptBytes: 20480 });
    expect(state.brainUrl).toBe('');
    expect(state.repositories).toBe('');
    expect(state.maxExcerptBytes).toBe('20480');
  });
});

describe('payload posté par la page (Custom UI)', () => {
  it('nettoie le texte : URL rognée, dépôts dédoublonnés, extraits bornés', () => {
    const payload = payloadOf({
      brainUrl: '  https://xyz.webtrigger.atlassian.app  ',
      secret: '',
      repositories: 'acme/web\n\nacme/web\nacme/api',
      maxExcerptBytes: '999999999',
    });
    expect(payload.brainUrl).toBe('https://xyz.webtrigger.atlassian.app');
    expect(payload.trackedRepositories).toEqual(['acme/web', 'acme/api']);
    expect(payload.maxExcerptBytes).toBe(MAX_EXCERPT_BYTES);
  });

  it('omet un secret vide — « laisser celui qui est rangé »', () => {
    expect(payloadOf({ ...EMPTY_SETTINGS_FORM, brainUrl: 'https://x.app' }).secret).toBeUndefined();
    expect(payloadOf({ ...EMPTY_SETTINGS_FORM, secret: 'x'.repeat(16) }).secret).toHaveLength(16);
  });

  it('la vue optimiste après un enregistrement réussi ne contient pas le secret', () => {
    const payload = payloadOf({
      brainUrl: 'https://xyz.webtrigger.atlassian.app',
      secret: 'x'.repeat(16),
      repositories: 'acme/web',
      maxExcerptBytes: '20480',
    });
    const saved = viewAfterSave(emptySettingsView(), payload);
    expect(saved.ok).toBe(true);
    expect(saved.paired).toBe(true); // le secret vient d’être posté
    expect(saved.brainUrl).toBe('https://xyz.webtrigger.atlassian.app');
    expect(saved.trackedRepositories).toEqual(['acme/web']);
    expect(saved.maxExcerptBytes).toBe(20480);
    expect('secret' in saved).toBe(false);
  });

  it('sans secret posté, le jumelage existant est conservé', () => {
    const saved = viewAfterSave(PAIRED, { brainUrl: PAIRED.brainUrl });
    expect(saved.paired).toBe(true);
    expect(saved.trackedRepositories).toEqual(PAIRED.trackedRepositories);
  });
});
