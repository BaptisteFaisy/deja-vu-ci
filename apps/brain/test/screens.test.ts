/**
 * Tests of the Brain's screen routing (`src/pure/screens.ts`).
 *
 * The three Jira UI modules share one resource: a wrong mapping renders the
 * settings page inside a ticket panel, so the table is checked against the
 * module keys declared in `manifest.yml`.
 */

import { describe, expect, it } from 'vitest';
import { FALLBACK_SCREEN, SCREEN_RULES, resolveScreen } from '../src/pure/screens.js';

/** The `key` of every UI module of `apps/brain/manifest.yml`. */
const MANIFEST_KEYS = {
  projectPage: 'deja-vu-project-page',
  projectSettings: 'deja-vu-project-settings',
  issuePanel: 'deja-vu-issue-panel',
};

describe('routage des écrans du Cerveau', () => {
  it('route chaque module du manifeste vers son écran', () => {
    expect(resolveScreen(MANIFEST_KEYS.projectPage)).toBe('projectPage');
    expect(resolveScreen(MANIFEST_KEYS.projectSettings)).toBe('settingsPage');
    expect(resolveScreen(MANIFEST_KEYS.issuePanel)).toBe('issuePanel');
  });

  it('ne confond pas la page projet et ses réglages', () => {
    // Both keys start with `deja-vu-project`: the settings rule must win on
    // the settings key, and the page key must not match it.
    expect(resolveScreen('deja-vu-project-settings')).not.toBe('projectPage');
    expect(resolveScreen('deja-vu-project-page')).not.toBe('settingsPage');
  });

  it('accepte une clé de module suffixée par la plateforme', () => {
    expect(resolveScreen('deja-vu-issue-panel/main')).toBe('issuePanel');
  });

  it('retombe sur un écran lisible quand la clé est absente ou inconnue', () => {
    expect(resolveScreen(undefined)).toBe(FALLBACK_SCREEN);
    expect(resolveScreen('')).toBe(FALLBACK_SCREEN);
    expect(resolveScreen('un-module-inconnu')).toBe(FALLBACK_SCREEN);
  });

  it('couvre les trois écrans par exactement une règle chacun', () => {
    const screens = SCREEN_RULES.map((rule) => rule.screen).sort();
    expect(screens).toEqual(['issuePanel', 'projectPage', 'settingsPage']);
    expect(new Set(SCREEN_RULES.map((rule) => rule.match)).size).toBe(SCREEN_RULES.length);
  });
});
