/**
 * Tests of the settings coercion (`src/pure/settingsSchema.ts`): the page
 * payload is validated, bounded and projected — internal thresholds never
 * leak to the screen, wrong values never reach the store.
 */

import { describe, expect, it } from 'vitest';
import { coerceSettingsPatch, toSettingsPayload } from '../src/pure/settingsSchema';
import { DEFAULT_SETTINGS } from '../src/pure/defaults';

describe('coerceSettingsPatch', () => {
  it('accepts a full valid patch and normalises the project key', () => {
    const result = coerceSettingsPatch({
      issueProjectKey: 'pay',
      flakyMinOccurrences: 4,
      flakyMinBranches: '2',
      flakyWindowDays: 14,
      outbreakRepos: 3,
      outbreakWindowMin: 15,
      rawRetentionDays: 30,
      universalKey: 'abcdefgh',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.issueProjectKey).toBe('PAY');
      expect(result.value.flakyMinBranches).toBe(2);
      expect(result.value.universalKey).toBe('abcdefgh');
    }
  });

  it('rounds numbers and drops unknown keys', () => {
    const result = coerceSettingsPatch({ flakyWindowDays: 10.4, hacker: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flakyWindowDays).toBe(10);
      expect('hacker' in result.value).toBe(false);
    }
  });

  it.each([
    ['a non-object', 'nope'],
    ['a project key that is not a string', { issueProjectKey: 42 }],
    ['a numeric threshold below its bound', { flakyMinOccurrences: 0 }],
    ['a retention beyond a year', { rawRetentionDays: 400 }],
    ['a non-numeric threshold', { flakyWindowDays: 'soon' }],
    ['a too-short universal key', { universalKey: 'abc' }],
  ])('refuses %s', (_label, raw) => {
    expect(coerceSettingsPatch(raw).ok).toBe(false);
  });

  it('accepts an empty project key as « the project on screen »', () => {
    const result = coerceSettingsPatch({ issueProjectKey: '  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.issueProjectKey).toBe('');
  });
});

describe('toSettingsPayload', () => {
  it('projects only what the page shows', () => {
    const payload = toSettingsPayload({ ...DEFAULT_SETTINGS, universalKey: 'abcdefgh' });
    expect(payload).toEqual({
      issueProjectKey: 'CI',
      flakyMinOccurrences: 3,
      flakyMinBranches: 2,
      flakyWindowDays: 14,
      rawRetentionDays: 30,
      universalKey: 'abcdefgh',
    });
    expect('minConfidenceNotYourFault' in payload).toBe(false);
  });
});
