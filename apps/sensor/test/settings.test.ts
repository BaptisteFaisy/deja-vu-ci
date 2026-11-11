/**
 * Pairing and workspace settings — specification § 14 screen 2 and § 16
 * (`pairing.secretId`): the shared secret is referenced by an identifier,
 * never written in clear text in the application storage.
 */

import { describe, expect, it } from 'vitest';
import {
  addRepository,
  BRIDGE_SECRET_KEY,
  buildPairing,
  defaultSettings,
  isPaired,
  MAX_EXCERPT_BYTES,
  MIN_EXCERPT_BYTES,
  readSettings,
  removeRepository,
} from '../src/pure/settings';

const PAIRING = {
  brainUrl: 'https://acme.atlassian.net/webtrigger/dejavu/ingest',
  secret: 'a-shared-secret-long-enough',
  pairedBy: 'alice',
  now: '2026-11-11T09:00:00Z',
};

describe('buildPairing', () => {
  it('builds the settings of a paired workspace', () => {
    const result = buildPairing(PAIRING);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings).toMatchObject({
      brainUrl: PAIRING.brainUrl,
      secretId: BRIDGE_SECRET_KEY,
      pairedAt: '2026-11-11T09:00:00Z',
      pairedBy: 'alice',
      maxExcerptBytes: MAX_EXCERPT_BYTES,
    });
  });

  it('never returns the shared secret itself', () => {
    const result = buildPairing(PAIRING);
    expect(JSON.stringify(result)).not.toContain('a-shared-secret-long-enough');
  });

  it('refuses a missing or malformed Brain address', () => {
    expect(buildPairing({ ...PAIRING, brainUrl: '' })).toEqual({
      ok: false,
      error: 'the Brain URL is required',
    });
    expect(buildPairing({ ...PAIRING, brainUrl: 'not a url' }).ok).toBe(false);
  });

  it('refuses a shared secret that is too short to be a secret', () => {
    const result = buildPairing({ ...PAIRING, secret: 'short' });
    expect(result.ok).toBe(false);
  });
});

describe('readSettings', () => {
  it('returns the defaults for anything unreadable', () => {
    for (const stored of [undefined, null, 42, 'text', []]) {
      expect(readSettings(stored)).toEqual(defaultSettings());
    }
  });

  it('clamps the excerpt size to the allowed range', () => {
    expect(readSettings({ maxExcerptBytes: 10 }).maxExcerptBytes).toBe(MIN_EXCERPT_BYTES);
    expect(readSettings({ maxExcerptBytes: 10 ** 9 }).maxExcerptBytes).toBe(MAX_EXCERPT_BYTES);
    expect(readSettings({ maxExcerptBytes: 'nope' }).maxExcerptBytes).toBe(MAX_EXCERPT_BYTES);
  });

  it('drops the repositories that are not strings', () => {
    const settings = readSettings({ trackedRepositories: ['acme/payments', 42, null] });
    expect(settings.trackedRepositories).toEqual(['acme/payments']);
  });

  it('keeps the pairing fields when they are present', () => {
    const settings = readSettings({ brainUrl: 'https://x', secretId: BRIDGE_SECRET_KEY });
    expect(isPaired(settings)).toBe(true);
  });
});

describe('watch list', () => {
  it('adds a repository only once', () => {
    let settings = addRepository(defaultSettings(), 'acme/payments');
    settings = addRepository(settings, 'acme/payments');
    expect(settings.trackedRepositories).toEqual(['acme/payments']);
  });

  it('removes a repository', () => {
    const settings = removeRepository(addRepository(defaultSettings(), 'acme/payments'), 'acme/payments');
    expect(settings.trackedRepositories).toEqual([]);
  });

  it('ignores an empty slug', () => {
    expect(addRepository(defaultSettings(), '  ')).toEqual(defaultSettings());
  });
});

describe('isPaired', () => {
  it('is false for a fresh workspace', () => {
    expect(isPaired(defaultSettings())).toBe(false);
  });

  it('is false when the secret identifier is missing', () => {
    expect(isPaired({ ...defaultSettings(), brainUrl: 'https://x' })).toBe(false);
  });
});
