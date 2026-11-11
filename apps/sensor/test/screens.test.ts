/**
 * Tests of the Sensor's screen routing (`src/pure/screens.ts`).
 *
 * Both Bitbucket modules share one resource: a wrong mapping renders the
 * settings form inside a pull request, so the table is checked against the
 * module keys declared in `manifest.yml`.
 */

import { describe, expect, it } from 'vitest';
import { FALLBACK_SCREEN, SCREEN_RULES, resolveScreen } from '../src/pure/screens.js';

/** The `key` of every UI module of `apps/sensor/manifest.yml`. */
const MANIFEST_KEYS = {
  prCard: 'deja-vu-pr-card',
  settings: 'deja-vu-workspace-settings',
};

describe('routage des écrans du Capteur', () => {
  it('route chaque module du manifeste vers son écran', () => {
    expect(resolveScreen(MANIFEST_KEYS.prCard)).toBe('prCard');
    expect(resolveScreen(MANIFEST_KEYS.settings)).toBe('settings');
  });

  it('accepte une clé de module suffixée par la plateforme', () => {
    expect(resolveScreen('deja-vu-workspace-settings/main')).toBe('settings');
  });

  it('retombe sur la carte quand la clé est absente ou inconnue', () => {
    expect(resolveScreen(undefined)).toBe(FALLBACK_SCREEN);
    expect(resolveScreen('')).toBe('prCard');
    expect(resolveScreen('un-module-inconnu')).toBe('prCard');
  });

  it('couvre les deux écrans, une règle chacun', () => {
    expect(SCREEN_RULES.map((rule) => rule.screen).sort()).toEqual(['prCard', 'settings']);
    expect(new Set(SCREEN_RULES.map((rule) => rule.match)).size).toBe(SCREEN_RULES.length);
  });
});
