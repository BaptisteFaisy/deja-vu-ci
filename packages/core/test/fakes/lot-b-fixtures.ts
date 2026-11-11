/**
 * Local doubles for the diagnostics tests.
 *
 * Only the fields the lot B code reads are filled; the rest keeps the frozen
 * `Occurrence` shape valid.
 */

import type { Frame, Occurrence, Resolution, Signature } from '../../src/types.js';

export interface OccurrenceOverrides {
  id?: string;
  signatureId?: string;
  familyId?: string;
  workspace?: string;
  repo?: string;
  branch?: string;
  commit?: string;
  author?: string;
  prId?: number;
  stepName?: string;
  durationS?: number;
  buildUrl?: string;
  occurredAt?: string;
  passedOnRetry?: boolean;
  testName?: string;
  changedFiles?: string[];
}

/** Build an occurrence with sensible defaults. */
export function makeOccurrence(overrides: OccurrenceOverrides = {}): Occurrence {
  return {
    id: overrides.id ?? 'occ-1',
    signatureId: overrides.signatureId ?? 'sig-aaaa1111bbbb2222',
    familyId: overrides.familyId ?? 'fam-aaaa1111bbbb2222',
    workspace: overrides.workspace ?? 'ACME',
    repo: overrides.repo ?? 'payments',
    branch: overrides.branch ?? 'main',
    commit: overrides.commit ?? 'c0ffee00',
    author: overrides.author ?? 'dev',
    stepName: overrides.stepName ?? 'test',
    durationS: overrides.durationS ?? 120,
    occurredAt: overrides.occurredAt ?? '2026-11-05T10:00:00.000Z',
    passedOnRetry: overrides.passedOnRetry ?? false,
    ...(overrides.prId === undefined ? {} : { prId: overrides.prId }),
    ...(overrides.buildUrl === undefined ? {} : { buildUrl: overrides.buildUrl }),
    ...(overrides.testName === undefined ? {} : { testName: overrides.testName }),
    ...(overrides.changedFiles === undefined ? {} : { changedFiles: overrides.changedFiles }),
  };
}

/** Build a stack frame belonging to the project. */
export function makeFrame(file: string, line = 12): Frame {
  return { file, fn: 'run', line, isProject: true };
}

/** Build a signature record. */
export function makeSignature(overrides: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-aaaa1111bbbb2222',
    familyId: 'fam-aaaa1111bbbb2222',
    category: 'test',
    errorType: 'AssertionError',
    template: 'expected true to be false',
    frames: [],
    status: 'known',
    firstSeen: '2026-11-01T08:00:00.000Z',
    lastSeen: '2026-11-05T10:00:00.000Z',
    occurrences: 1,
    ...overrides,
  };
}

/** Build a resolution. */
export function makeResolution(overrides: Partial<Resolution> = {}): Resolution {
  return {
    id: 'res-1',
    signatureId: 'sig-aaaa1111bbbb2222',
    commit: 'abc1234def5678',
    author: 'marie',
    files: ['src/client.ts'],
    confidence: 0.4,
    ...overrides,
  };
}
