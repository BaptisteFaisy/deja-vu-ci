/**
 * Données de test partagées (signatures, occurrences, résolution).
 *
 * Un scénario simple : deux signatures de catégorie `test`, l'une instable
 * (trois branches, un succès au même commit), l'autre inconnue, plus une
 * résolution confirmée sur une troisième signature.
 */

import type { Occurrence, Resolution, Signature } from '@dejavu/core';
import { fakeSignatureOf } from './engine.js';

/**
 * Empreinte de la signature d'un extrait « expected true to be false ».
 * La pile est vide dans l'extrait : la signature correspond donc à une
 * signature mémorisée sans frame.
 */
export const EXCERPT_SIGNATURE = fakeSignatureOf([
  'test',
  'AssertionError',
  'expected true to be false',
  '<none>',
]);

/** Empreinte de la famille du même extrait. */
export const EXCERPT_FAMILY = fakeSignatureOf([
  'test',
  'AssertionError',
  'expected true to be false',
]);

/** Signature instable. */
export const FLAKY_SIGNATURE: Signature = {
  id: 'aaaaaaaaaaaaaaaa',
  familyId: 'ffffffffffffffff',
  category: 'test',
  errorType: 'AssertionError',
  template: 'expected true to be false',
  frames: [{ file: 'src/limiter.ts', fn: 'check', line: 42, isProject: true }],
  status: 'flaky',
  firstSeen: '2026-11-01T08:00:00Z',
  lastSeen: '2026-11-10T08:00:00Z',
  occurrences: 4,
  issueKey: 'PAY-88',
  testName: 'check.limiter',
};

/** Signature inconnue. */
export const NEW_SIGNATURE: Signature = {
  id: 'bbbbbbbbbbbbbbbb',
  familyId: 'eeeeeeeeeeeeeeee',
  category: 'test',
  errorType: 'AssertionError',
  template: 'connection refused to db.internal:5432',
  frames: [{ file: 'src/db.ts', fn: 'connect', line: 10, isProject: true }],
  status: 'new',
  firstSeen: '2026-11-11T07:00:00Z',
  lastSeen: '2026-11-11T07:00:00Z',
  occurrences: 1,
};

/** Signature résolue. */
export const RESOLVED_SIGNATURE: Signature = {
  id: 'cccccccccccccccc',
  familyId: 'dddddddddddddddd',
  category: 'dependency',
  errorType: 'ENOTFOUND',
  template: 'getaddrinfo ENOTFOUND registry.internal',
  frames: [],
  status: 'resolved',
  firstSeen: '2026-10-20T08:00:00Z',
  lastSeen: '2026-11-01T08:00:00Z',
  occurrences: 3,
  issueKey: 'PAY-42',
};

/** Résolution confirmée de la signature résolue. */
export const RESOLUTION: Resolution = {
  id: 'res-1',
  signatureId: RESOLVED_SIGNATURE.id,
  commit: 'abc1234567890abcdef',
  author: 'marie',
  files: ['package.json'],
  note: 'pinned the registry mirror',
  confidence: 1,
  confirmedBy: 'marie',
  confirmedAt: '2026-11-02T08:00:00Z',
};

/** Occurrences de la signature instable (trois branches, un succès au même commit). */
export const FLAKY_OCCURRENCES: Occurrence[] = [
  {
    id: 'occ-1',
    signatureId: FLAKY_SIGNATURE.id,
    familyId: FLAKY_SIGNATURE.familyId,
    workspace: 'acme',
    repo: 'web',
    branch: 'main',
    commit: 'c1',
    author: 'marie',
    stepName: 'test',
    durationS: 420,
    buildUrl: 'https://bitbucket.org/acme/web/builds/1',
    occurredAt: '2026-11-08T10:00:00Z',
    passedOnRetry: true,
    testName: 'check.limiter',
  },
  {
    id: 'occ-2',
    signatureId: FLAKY_SIGNATURE.id,
    familyId: FLAKY_SIGNATURE.familyId,
    workspace: 'acme',
    repo: 'web',
    branch: 'feature/a',
    commit: 'c2',
    author: 'luc',
    stepName: 'test',
    durationS: 900,
    buildUrl: 'https://bitbucket.org/acme/web/builds/2',
    occurredAt: '2026-11-09T10:00:00Z',
    passedOnRetry: false,
    testName: 'check.limiter',
  },
  {
    id: 'occ-3',
    signatureId: FLAKY_SIGNATURE.id,
    familyId: FLAKY_SIGNATURE.familyId,
    workspace: 'acme',
    repo: 'web',
    branch: 'feature/b',
    commit: 'c3',
    author: 'marie',
    stepName: 'test',
    durationS: 1800,
    buildUrl: 'https://bitbucket.org/acme/web/builds/3',
    occurredAt: '2026-11-10T10:00:00Z',
    passedOnRetry: false,
    testName: 'check.limiter',
  },
];

/** Occurrence de la signature inconnue. */
export const NEW_OCCURRENCE: Occurrence = {
  id: 'occ-4',
  signatureId: NEW_SIGNATURE.id,
  familyId: NEW_SIGNATURE.familyId,
  workspace: 'acme',
  repo: 'web',
  branch: 'feature/c',
  commit: 'c4',
  author: 'luc',
  prId: 7,
  stepName: 'test',
  durationS: 60,
  buildUrl: 'https://bitbucket.org/acme/web/builds/4',
  occurredAt: '2026-11-11T07:00:00Z',
  passedOnRetry: false,
};

/** Occurrence de la signature résolue. */
export const RESOLVED_OCCURRENCE: Occurrence = {
  id: 'occ-5',
  signatureId: RESOLVED_SIGNATURE.id,
  familyId: RESOLVED_SIGNATURE.familyId,
  workspace: 'acme',
  repo: 'web',
  branch: 'main',
  commit: 'c0',
  author: 'marie',
  stepName: 'build',
  durationS: 120,
  occurredAt: '2026-11-01T08:00:00Z',
  passedOnRetry: false,
};

/** Seconde signature instable, moins coûteuse que la première. */
export const SECOND_FLAKY_SIGNATURE: Signature = {
  id: 'eeee1111eeee1111',
  familyId: 'ffff2222ffff2222',
  category: 'test',
  errorType: 'TimeoutError',
  template: 'timed out after 5000 ms',
  frames: [],
  status: 'flaky',
  firstSeen: '2026-11-05T08:00:00Z',
  lastSeen: '2026-11-09T08:00:00Z',
  occurrences: 3,
  testName: 'check.timeout',
};

/** Occurrences de la seconde signature instable (coût plus faible). */
export const SECOND_FLAKY_OCCURRENCES: Occurrence[] = [1, 2, 3].map((index) => ({
  id: `occ-1${index}`,
  signatureId: SECOND_FLAKY_SIGNATURE.id,
  familyId: SECOND_FLAKY_SIGNATURE.familyId,
  workspace: 'acme',
  repo: 'web',
  branch: `branch-${index}`,
  commit: `d${index}`,
  author: 'marie',
  stepName: 'test',
  durationS: 60,
  occurredAt: `2026-11-0${index + 5}T10:00:00Z`,
  passedOnRetry: index === 1,
  testName: 'check.timeout',
}));

/** Signature mémorisée dont l'identifiant est **exactement** celui de l'extrait. */
export const EXACT_SIGNATURE: Signature = {
  id: EXCERPT_SIGNATURE,
  familyId: EXCERPT_FAMILY,
  category: 'test',
  errorType: 'AssertionError',
  template: 'expected true to be false',
  frames: [],
  status: 'known',
  firstSeen: '2026-11-02T08:00:00Z',
  lastSeen: '2026-11-06T08:00:00Z',
  occurrences: 2,
};

/** Variante de la même famille : autre pile, même message. */
export const FAMILY_VARIANT_SIGNATURE: Signature = {
  id: '9999888877776666',
  familyId: EXCERPT_FAMILY,
  category: 'test',
  errorType: 'AssertionError',
  template: 'expected true to be false',
  frames: [{ file: 'src/other.ts', fn: 'check', line: 7, isProject: true }],
  status: 'known',
  firstSeen: '2026-11-03T08:00:00Z',
  lastSeen: '2026-11-07T08:00:00Z',
  occurrences: 1,
};

/** Graine complète du magasin de test. */
export const SEED = {
  signatures: [FLAKY_SIGNATURE, NEW_SIGNATURE, RESOLVED_SIGNATURE],
  occurrences: [...FLAKY_OCCURRENCES, NEW_OCCURRENCE, RESOLVED_OCCURRENCE],
  resolutions: [RESOLUTION],
};

/** Graine avec deux tests instables de coûts différents. */
export const SEED_TWO_FLAKY = {
  signatures: [...SEED.signatures, SECOND_FLAKY_SIGNATURE],
  occurrences: [...SEED.occurrences, ...SECOND_FLAKY_OCCURRENCES],
  resolutions: SEED.resolutions,
};
