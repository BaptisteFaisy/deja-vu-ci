/**
 * The collection flow, rehearsed offline: a simulated Bitbucket, a local
 * masker and a local transport to the Brain.
 *
 * What is checked here is the wiring of the Sensor (E brief): the payload is
 * built from what the Pipelines API returned, the secrets are masked before
 * anything leaves, and the ancestor verdict of § 10.2 is attached when the
 * Brain knows a fix.
 */

import { describe, expect, it } from 'vitest';
import {
  askResolutionCommit,
  attachResolutionVerdict,
  collectAndBuildPayload,
  resolveEvent,
  type BrainTransport,
  type SensorDeps,
} from '../src/buildPayload.js';
import type { ApiAnswer, BitbucketReader } from '../src/pipelines.js';
import { fakeMaskSecrets } from './fakes/mask.js';

const COMMIT = 'a'.repeat(40);
const FIX = 'c'.repeat(40);

function answer(body: unknown, status = 200): ApiAnswer {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

/** A Bitbucket that answers one failed step and a short history. */
const reader: BitbucketReader = async (path) => {
  if (path.includes('/pipelines/?commit=')) {
    return answer({ values: [{ uuid: '{p1}', build_number: 12, commit: { hash: COMMIT } }] });
  }
  if (path.includes('/log')) return answer('token ghp_SECRET0123456789 refused', 206);
  if (path.includes('/testReports')) return answer({ values: [] });
  if (path.includes('/steps/')) {
    return answer({
      values: [
        {
          uuid: '{s1}',
          name: 'Test',
          state: { result: 'FAILED' },
          started_on: '2026-11-11T08:00:00Z',
          completed_on: '2026-11-11T08:00:42Z',
        },
      ],
    });
  }
  if (path.includes('/commits')) return answer({ values: [{ hash: COMMIT }] });
  if (path.includes('/commit/')) return answer({ parents: [] });
  return answer({}, 404);
};

const storage = {
  get: async () => undefined,
  set: async () => undefined,
  getSecret: async () => undefined,
  setSecret: async () => undefined,
};

function depsOf(transport?: BrainTransport): SensorDeps {
  return {
    read: reader,
    storage,
    masker: async () => fakeMaskSecrets,
    transport: transport ?? { post: async () => ({ ok: true, status: 200 }) },
  };
}

const EVENT = {
  data: {
    commit: { hash: COMMIT, refName: 'feature/pr-42' },
    state: 'FAILED',
    buildUrl: 'https://bitbucket.org/acme/payments/pipelines/results/12',
    buildNumber: 12,
    repository: { slug: 'payments', workspace: { slug: 'acme' } },
    pullRequest: { id: 42 },
  },
};

const event = resolveEvent(EVENT, 'acme');

describe('resolveEvent', () => {
  it('resolves the workspace, the repository and the commit', () => {
    expect(event?.workspace).toBe('acme');
    expect(event?.repository).toBe('payments');
    expect(event?.commit).toBe(COMMIT);
    expect(event?.prId).toBe(42);
  });

  it('returns undefined when a mandatory field is missing', () => {
    expect(resolveEvent({ data: {} }, 'acme')).toBeUndefined();
    expect(resolveEvent({ data: { commit: { hash: COMMIT } } }, '')).toBeUndefined();
  });
});

describe('collectAndBuildPayload', () => {
  it('builds a payload from what the Pipelines API returned', async () => {
    if (!event) throw new Error('event not resolved');
    const built = await collectAndBuildPayload(event, depsOf(), 4096);
    expect(built.payload).toMatchObject({
      version: 1,
      workspace: 'acme',
      repository: 'payments',
      branch: 'feature/pr-42',
      commit: COMMIT,
      prId: 42,
      stepName: 'Test',
      stepUuid: '{s1}',
      buildNumber: 12,
      durationS: 42,
      failedAt: '2026-11-11T08:00:42Z',
      branchHistory: [COMMIT],
    });
  });

  it('masks the secret of the log before anything leaves Bitbucket', async () => {
    if (!event) throw new Error('event not resolved');
    const built = await collectAndBuildPayload(event, depsOf(), 4096);
    const blocks = built.payload?.errorBlocks.join('\n') ?? '';
    expect(blocks).not.toContain('ghp_SECRET0123456789');
    expect(blocks).toContain('«[masqué:token]»');
  });

  it('says why nothing was built when no failed step can be read', async () => {
    if (!event) throw new Error('event not resolved');
    const built = await collectAndBuildPayload(event, { ...depsOf(), read: async () => answer({ values: [] }) }, 4096);
    expect(built.payload).toBeUndefined();
    expect(built.reason).toBe('no failed step could be read');
  });

  it('refuses to build anything when the masking engine is unavailable', async () => {
    if (!event) throw new Error('event not resolved');
    const broken: SensorDeps = {
      ...depsOf(),
      masker: async () => {
        throw new Error('the masking engine is not available');
      },
    };
    await expect(collectAndBuildPayload(event, broken, 4096)).rejects.toThrow(/masking engine/);
  });
});

describe('askResolutionCommit', () => {
  const brainSays = (body: unknown): BrainTransport => ({
    post: async () => ({ ok: true, status: 200, body }),
  });

  it('reads the commit of the fix from the answer of the Brain', async () => {
    if (!event) throw new Error('event not resolved');
    const deps = depsOf(brainSays({ ok: true, diagnostic: { resolution: { commit: FIX } } }));
    expect(await askResolutionCommit(deps, 'https://brain', 'secret', event)).toBe(FIX);
  });

  it('returns nothing when the Brain knows no fix', async () => {
    if (!event) throw new Error('event not resolved');
    const deps = depsOf(brainSays({ ok: true }));
    expect(await askResolutionCommit(deps, 'https://brain', 'secret', event)).toBeUndefined();
  });

  it('returns nothing when the Brain does not answer', async () => {
    if (!event) throw new Error('event not resolved');
    const deps = depsOf({ post: async () => ({ ok: false, error: 'the Brain answered 500' }) });
    expect(await askResolutionCommit(deps, 'https://brain', 'secret', event)).toBeUndefined();
  });
});

describe('attachResolutionVerdict', () => {
  it('attaches the verdict when the branch contains the fix', async () => {
    if (!event) throw new Error('event not resolved');
    const built = await collectAndBuildPayload(event, depsOf(), 4096);
    if (!built.payload) throw new Error('no payload');
    const deps: SensorDeps = {
      ...depsOf(),
      read: async (path) => (path.includes('/commit/') ? answer({ parents: [{ hash: FIX }] }) : reader(path)),
    };
    const enriched = await attachResolutionVerdict(deps, built.payload, FIX);
    expect(enriched.containsResolution).toEqual({ commit: FIX, contains: true });
  });

  it('leaves the payload without a verdict when the history is unreadable', async () => {
    if (!event) throw new Error('event not resolved');
    const built = await collectAndBuildPayload(event, depsOf(), 4096);
    if (!built.payload) throw new Error('no payload');
    const deps: SensorDeps = { ...depsOf(), read: async () => answer({}, 404) };
    const enriched = await attachResolutionVerdict(deps, built.payload, FIX);
    expect(enriched.containsResolution).toBeUndefined();
  });
});
