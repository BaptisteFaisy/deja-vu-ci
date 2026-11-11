import { describe, expect, it } from 'vitest';
import { MemoryStore, SQL_SCHEMA, type Store } from '../src/store.js';
import type { Occurrence, Outbreak, RawExcerpt, Resolution, Settings, Signature, TestStats } from '../src/types.js';

function signature(overrides: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-1',
    familyId: 'fam-1',
    category: 'test',
    errorType: 'AssertionError',
    template: 'expected true to be false',
    frames: [],
    status: 'new',
    firstSeen: '2026-11-01T10:00:00.000Z',
    lastSeen: '2026-11-01T10:00:00.000Z',
    occurrences: 1,
    ...overrides,
  };
}

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: 'occ-1',
    signatureId: 'sig-1',
    familyId: 'fam-1',
    workspace: 'ws',
    repo: 'repo',
    branch: 'main',
    commit: 'abc123',
    author: 'marie',
    stepName: 'test',
    durationS: 120,
    occurredAt: '2026-11-01T10:00:00.000Z',
    passedOnRetry: false,
    ...overrides,
  };
}

function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return {
    id: 'res-1',
    signatureId: 'sig-1',
    commit: 'def456',
    author: 'marie',
    files: ['src/a.ts'],
    confidence: 0.4,
    ...overrides,
  };
}

describe('MemoryStore', () => {
  it('stores and reads back a signature', async () => {
    const store = new MemoryStore();
    await store.saveSignature(signature());
    const found = await store.getSignature('sig-1');
    expect(found?.template).toBe('expected true to be false');
    expect(await store.getSignature('missing')).toBeUndefined();
  });

  it('stores occurrences and lists them by signature, oldest first', async () => {
    const store = new MemoryStore();
    await store.saveOccurrence(occurrence({ id: 'occ-2', occurredAt: '2026-11-03T10:00:00.000Z' }));
    await store.saveOccurrence(occurrence({ id: 'occ-1', occurredAt: '2026-11-01T10:00:00.000Z' }));
    const list = await store.listOccurrences('sig-1');
    expect(list.map((o) => o.id)).toEqual(['occ-1', 'occ-2']);
    expect(await store.listOccurrences('other')).toEqual([]);
  });

  it('lists the occurrences of a family', async () => {
    const store = new MemoryStore();
    await store.saveOccurrence(occurrence({ id: 'occ-1', familyId: 'fam-1' }));
    await store.saveOccurrence(occurrence({ id: 'occ-2', familyId: 'fam-2' }));
    const list = await store.listFamilyOccurrences('fam-1');
    expect(list.map((o) => o.id)).toEqual(['occ-1']);
  });

  it('stores a resolution and reads it back by signature', async () => {
    const store = new MemoryStore();
    await store.saveResolution(resolution());
    const found = await store.getResolution('sig-1');
    expect(found?.commit).toBe('def456');
    expect(await store.getResolution('other')).toBeUndefined();
  });

  it('sorts the signatures by last seen, most recent first', async () => {
    const store = new MemoryStore();
    await store.saveSignature(signature({ id: 'sig-old', lastSeen: '2026-11-01T10:00:00.000Z' }));
    await store.saveSignature(signature({ id: 'sig-new', lastSeen: '2026-11-05T10:00:00.000Z' }));
    await store.saveSignature(signature({ id: 'sig-mid', lastSeen: '2026-11-03T10:00:00.000Z' }));
    const list = await store.listSignatures();
    expect(list.map((s) => s.id)).toEqual(['sig-new', 'sig-mid', 'sig-old']);
  });

  it('finds the signatures of a family', async () => {
    const store = new MemoryStore();
    await store.saveSignature(signature({ id: 'sig-1', familyId: 'fam-1' }));
    await store.saveSignature(signature({ id: 'sig-2', familyId: 'fam-2' }));
    const found = await store.findSignaturesByFamily('fam-1');
    expect(found.map((s) => s.id)).toEqual(['sig-1']);
  });

  it('purges the expired excerpts and returns the count', async () => {
    const store = new MemoryStore();
    const excerpts: RawExcerpt[] = [
      { occurrenceId: 'occ-1', text: 'old', expiresAt: '2026-11-01T00:00:00.000Z' },
      { occurrenceId: 'occ-2', text: 'fresh', expiresAt: '2026-12-01T00:00:00.000Z' },
    ];
    for (const e of excerpts) await store.saveRawExcerpt(e);
    const removed = await store.purgeExpired(new Date('2026-11-10T00:00:00.000Z'));
    expect(removed).toBe(1);
    expect(await store.purgeExpired(new Date('2026-11-10T00:00:00.000Z'))).toBe(0);
  });

  it('keeps the settings and gives them back as a copy', async () => {
    const store = new MemoryStore();
    const defaults = await store.getSettings();
    expect(defaults.flakyMinOccurrences).toBe(3);
    const next: Settings = { ...defaults, issueProjectKey: 'PAY' };
    await store.saveSettings(next);
    expect((await store.getSettings()).issueProjectKey).toBe('PAY');
    next.issueProjectKey = 'MUTATED';
    expect((await store.getSettings()).issueProjectKey).toBe('PAY');
  });

  it('stores the test statistics, flakiest first, and filters by repository', async () => {
    const store = new MemoryStore();
    const stats: TestStats[] = [
      { repo: 'a', testName: 't1', runsFailed: 1, runsPassedSameCommit: 0, branches: 1, flakyIndex: 0.1, updatedAt: '2026-11-01T00:00:00.000Z' },
      { repo: 'b', testName: 't2', runsFailed: 5, runsPassedSameCommit: 3, branches: 3, flakyIndex: 0.9, updatedAt: '2026-11-01T00:00:00.000Z' },
    ];
    for (const s of stats) await store.saveTestStats(s);
    const all = await store.listTestStats();
    expect(all.map((t) => t.testName)).toEqual(['t2', 't1']);
    expect((await store.listTestStats('b')).map((t) => t.testName)).toEqual(['t2']);
  });

  it('stores an outbreak and finds it by family', async () => {
    const store = new MemoryStore();
    const outbreak: Outbreak = {
      id: 'out-1',
      familyId: 'fam-1',
      startedAt: '2026-11-02T09:00:00.000Z',
      repos: ['a', 'b', 'c'],
    };
    await store.saveOutbreak(outbreak);
    expect((await store.findOutbreak('fam-1'))?.repos).toHaveLength(3);
    expect(await store.findOutbreak('fam-x')).toBeUndefined();
  });

  it('accepts a seed and keeps it queryable', async () => {
    const store = new MemoryStore({
      signatures: [signature({ id: 'sig-seed' })],
      occurrences: [occurrence({ id: 'occ-seed' })],
      resolutions: [resolution({ signatureId: 'sig-seed' })],
    });
    expect((await store.listSignatures()).map((s) => s.id)).toEqual(['sig-seed']);
    expect((await store.listOccurrences('sig-1')).map((o) => o.id)).toEqual(['occ-seed']);
    expect((await store.getResolution('sig-seed'))?.id).toBe('res-1');
  });

  it('implements the Store interface', async () => {
    const store: Store = new MemoryStore();
    await store.saveSignature(signature());
    expect(await store.listSignatures()).toHaveLength(1);
  });
});

describe('SQL_SCHEMA', () => {
  it('declares the nine tables of the data model', () => {
    for (const table of [
      'signature',
      'occurrence',
      'test_stats',
      'resolution',
      'raw_excerpt',
      'llm_template_cache',
      'outbreak',
      'pairing',
      'settings',
    ]) {
      expect(SQL_SCHEMA).toContain(`CREATE TABLE ${table}`);
    }
  });

  it('declares the two indexes the screens rely on', () => {
    expect(SQL_SCHEMA).toContain('CREATE INDEX signature_family_id ON signature (family_id)');
    expect(SQL_SCHEMA).toContain(
      'CREATE INDEX occurrence_signature_occurred ON occurrence (signature_id, occurred_at)',
    );
  });

  it('declares no referential constraint', () => {
    expect(SQL_SCHEMA.toUpperCase()).not.toMatch(/\bFOREIGN\s+KEY\b/);
    expect(SQL_SCHEMA.toUpperCase()).not.toMatch(/\bREFERENCES\b/);
  });

  it('uses only the Forge SQL types', () => {
    const forbidden = ['BOOLEAN', 'DOUBLE', 'FLOAT', 'NUMERIC', 'DECIMAL', 'REAL', 'SERIAL', 'BLOB', 'JSON'];
    for (const type of forbidden) {
      expect(SQL_SCHEMA.toUpperCase()).not.toMatch(new RegExp(`\\b${type}\\b`));
    }
    for (const type of ['VARCHAR', 'INT', 'BIGINT', 'TEXT', 'TIMESTAMP']) {
      expect(SQL_SCHEMA).toContain(type);
    }
  });

  it('documents the platform limits', () => {
    expect(SQL_SCHEMA).toContain('1 GiB');
    expect(SQL_SCHEMA).toContain('5 s');
  });
});
