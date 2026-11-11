/**
 * Reading of the Bitbucket build-status event — specification § 17: the
 * payload carries the status key, the commit hash, the state, the build
 * address and the branch.
 */

import { describe, expect, it } from 'vitest';
import {
  isFailureState,
  parseBuildStatusEvent,
  repositorySlugFromUrl,
} from '../src/pure/event.js';

const EVENT = {
  data: {
    buildKey: 'pipeline-status-1',
    commit: { hash: 'a'.repeat(40), refName: 'feature/pr-42', author: { raw: 'Alice <alice@example.com>' } },
    state: 'FAILED',
    buildUrl: 'https://bitbucket.org/acme/payments/pipelines/results/1234',
    buildNumber: 1234,
    repository: { slug: 'payments', workspace: { slug: 'acme' } },
    pullRequest: { id: 42 },
  },
};

describe('parseBuildStatusEvent', () => {
  it('reads the documented fields of the event', () => {
    const parsed = parseBuildStatusEvent(EVENT);
    expect(parsed).toMatchObject({
      buildKey: 'pipeline-status-1',
      commit: 'a'.repeat(40),
      state: 'FAILED',
      branch: 'feature/pr-42',
      workspace: 'acme',
      repository: 'payments',
      prId: 42,
      buildNumber: 1234,
    });
    expect(parsed.author).toContain('alice@example.com');
  });

  it('accepts the flat variant of the payload', () => {
    const parsed = parseBuildStatusEvent({
      buildStatusKey: 'k',
      commitHash: 'c'.repeat(40),
      state: 'FAILED',
      branch: 'main',
      workspace: 'ws',
      repository: 'repo',
    });
    expect(parsed.commit).toBe('c'.repeat(40));
    expect(parsed.branch).toBe('main');
    expect(parsed.workspace).toBe('ws');
  });

  it('reads the workspace from the resolver context when absent', () => {
    const parsed = parseBuildStatusEvent({ context: { workspace: 'from-context' } });
    expect(parsed.workspace).toBe('from-context');
  });

  it('never throws on an unexpected shape', () => {
    for (const input of [undefined, null, 42, 'text', [], {}]) {
      expect(() => parseBuildStatusEvent(input)).not.toThrow();
      expect(parseBuildStatusEvent(input).commit).toBeUndefined();
    }
  });
});

describe('isFailureState', () => {
  it('only treats the failure state as a failure', () => {
    expect(isFailureState('FAILED')).toBe(true);
    expect(isFailureState('failed')).toBe(true);
    expect(isFailureState(' FAILED ')).toBe(true);
    expect(isFailureState('SUCCESSFUL')).toBe(false);
    expect(isFailureState('INPROGRESS')).toBe(false);
    expect(isFailureState(undefined)).toBe(false);
  });
});

describe('repositorySlugFromUrl', () => {
  it('extracts the owner/repo slug from a build address', () => {
    expect(repositorySlugFromUrl('https://bitbucket.org/acme/payments/pipelines/results/12'))
      .toBe('acme/payments');
  });

  it('returns undefined when the address does not match', () => {
    expect(repositorySlugFromUrl(undefined)).toBeUndefined();
    expect(repositorySlugFromUrl('https://example.com/nothing')).toBeUndefined();
  });
});
