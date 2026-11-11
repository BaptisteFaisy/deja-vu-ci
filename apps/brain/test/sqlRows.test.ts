/**
 * Tests of the SQL row mapping (`src/pure/sqlRows.ts`): every column quirk
 * (TIMESTAMP as string or epoch, INT booleans, per mille ratios, JSON text,
 * NULL optionals) is normalised to the engine types.
 */

import { describe, expect, it } from 'vitest';
import {
  boolean,
  fromPerMille,
  iso,
  json,
  mapOccurrence,
  mapResolution,
  mapSettings,
  mapSignature,
  mapTemplateEntry,
  number,
  text,
} from '../src/pure/sqlRows.js';
import { DEFAULT_SETTINGS } from '../src/pure/defaults.js';

describe('scalar readers', () => {
  it('normalises strings, numbers and booleans', () => {
    const row = { a: 'x', b: 42, c: '7', d: 1, e: 0, f: null };
    expect(text(row, 'a')).toBe('x');
    expect(text(row, 'f')).toBeUndefined();
    expect(number(row, 'b')).toBe(42);
    expect(number(row, 'c')).toBe(7);
    expect(number(row, 'f', 9)).toBe(9);
    expect(boolean(row, 'd')).toBe(true);
    expect(boolean(row, 'e')).toBe(false);
    expect(fromPerMille({ v: 750 }, 'v')).toBe(0.75);
  });

  it('normalises timestamps given as ISO string or epoch milliseconds', () => {
    expect(iso({ t: '2026-11-05T09:00:00Z' }, 't')).toBe('2026-11-05T09:00:00.000Z');
    expect(iso({ t: Date.parse('2026-11-05T09:00:00.000Z') }, 't')).toBe('2026-11-05T09:00:00.000Z');
    expect(iso({ t: 'garbage' }, 't')).toBe('');
  });

  it('parses JSON cells with a fallback', () => {
    expect(json({ j: '["a"]' }, 'j', [])).toEqual(['a']);
    expect(json({ j: 'not json' }, 'j', ['fallback'])).toEqual(['fallback']);
    expect(json({ j: null }, 'j', undefined)).toBeUndefined();
  });
});

describe('domain mappers', () => {
  it('maps a signature row', () => {
    const signature = mapSignature({
      id: 'sig1', family_id: 'fam1', category: 'test', error_type: 'AssertionError',
      template: 't', frames_json: '[{"file":"a.ts","isProject":true}]', status: 'flaky',
      first_seen: '2026-11-01T00:00:00.000Z', last_seen: '2026-11-05T00:00:00.000Z',
      occurrences: 3, issue_key: 'CI-9', test_name: 'test_login',
    });
    expect(signature.frames).toEqual([{ file: 'a.ts', isProject: true }]);
    expect(signature.issueKey).toBe('CI-9');
    expect(signature.status).toBe('flaky');
  });

  it('maps an occurrence row, NULL optionals left absent', () => {
    const occurrence = mapOccurrence({
      id: 'occ1', signature_id: 'sig1', family_id: 'fam1', workspace: 'acme',
      repo: 'r', branch: 'main', commit_sha: 'abc', author: 'marie', pr_id: null,
      step_name: 'test', duration_s: '60', build_url: null,
      occurred_at: '2026-11-05T00:00:00.000Z', passed_on_retry: 1, test_name: null,
      changed_files_json: null,
    });
    expect(occurrence.durationS).toBe(60);
    expect(occurrence.passedOnRetry).toBe(true);
    expect('prId' in occurrence).toBe(false);
    expect('buildUrl' in occurrence).toBe(false);
    expect('changedFiles' in occurrence).toBe(false);
  });

  it('maps a resolution row with per mille confidence', () => {
    const resolution = mapResolution({
      id: 'r1', signature_id: 'sig1', commit_sha: 'abc', author: 'marie',
      files_json: '["a.ts"]', note: null, confidence: 600,
      confirmed_by: 'marie', confirmed_at: '2026-11-04T00:00:00.000Z',
    });
    expect(resolution.confidence).toBe(0.6);
    expect(resolution.confirmedAt).toBe('2026-11-04T00:00:00.000Z');
    expect('note' in resolution).toBe(false);
  });

  it('falls back to the engine defaults for a partial settings row', () => {
    const settings = mapSettings({
      project_key: 'default', issue_project_key: 'PAY',
      flaky_min_occurrences: 5, flaky_min_branches: null, flaky_window_days: null,
      outbreak_repos: null, outbreak_window_min: null, raw_retention_days: null,
      min_confidence_not_your_fault: null, universal_key: null, updated_at: '2026-11-05',
    });
    expect(settings.issueProjectKey).toBe('PAY');
    expect(settings.flakyMinOccurrences).toBe(5);
    expect(settings.flakyMinBranches).toBe(DEFAULT_SETTINGS.flakyMinBranches);
    expect(settings.minConfidenceNotYourFault).toBe(DEFAULT_SETTINGS.minConfidenceNotYourFault);
    expect('universalKey' in settings).toBe(false);
  });
});

describe('mapTemplateEntry', () => {
  it('maps a cache row, unreadable category degrading to unknown', () => {
    expect(mapTemplateEntry({ normalized_hash: 'h', template: 't', category: 'test' })).toEqual({
      normalizedHash: 'h', template: 't', category: 'test',
    });
    expect(mapTemplateEntry({}).category).toBe('unknown');
  });
});
