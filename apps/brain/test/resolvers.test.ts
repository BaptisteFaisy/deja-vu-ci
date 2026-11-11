/**
 * Tests of the UI Kit resolver wiring (`src/resolvers.ts`).
 *
 * The resolver is injected, so the test records the definitions and checks
 * that each `invoke()` name of the screens reaches the right data function —
 * without Forge, without a tenant, without React.
 */

import { describe, expect, it } from 'vitest';
import {
  UI_CALL_NAMES,
  registerUiResolvers,
  type ResolverLike,
  type ResolverRequest,
  type UiDataPorts,
} from '../src/resolvers';

/** A resolver that records what is defined on it. */
function fakeResolver(): { resolver: ResolverLike; defined: Map<string, (r: ResolverRequest) => unknown> } {
  const defined = new Map<string, (request: ResolverRequest) => unknown>();
  return {
    defined,
    resolver: {
      define(name: string, fn: (request: ResolverRequest) => unknown) {
        defined.set(name, fn);
        return undefined;
      },
    },
  };
}

/** Data ports that record the calls and answer a distinguishable value. */
function fakePorts(): { ports: UiDataPorts; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      async memoryPage() {
        calls.push('memoryPage');
        return { signatures: [] };
      },
      async issuePanel(payload, context) {
        calls.push(`issuePanel:${JSON.stringify(payload)}`);
        return { problem: false, ...(context ? { context } : {}) };
      },
      async settings() {
        calls.push('settings');
        return { issueProjectKey: 'CI' };
      },
      async saveSettings(payload) {
        calls.push(`saveSettings:${JSON.stringify(payload)}`);
        return { ok: true };
      },
      async replaySample() {
        calls.push('replaySample');
        return { ok: true, seeded: true };
      },
    },
  };
}

describe('résolveurs des écrans UI Kit', () => {
  it('enregistre les cinq noms appelés par l’interface', () => {
    const { resolver, defined } = fakeResolver();
    const { ports } = fakePorts();
    registerUiResolvers(resolver, ports);
    expect([...defined.keys()].sort()).toEqual([...UI_CALL_NAMES].sort());
  });

  it('route `memory-page` vers les données de la page projet', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    await defined.get('memory-page')?.({ payload: undefined, context: undefined });
    expect(calls).toEqual(['memoryPage']);
  });

  it('route `issue-context` vers l’encart, avec la charge et le contexte', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    const context = { extension: { issue: { key: 'PAY-1' } } };
    await defined.get('issue-context')?.({ payload: { issueKey: 'PAY-1' }, context });
    expect(calls).toEqual(['issuePanel:{"issueKey":"PAY-1"}']);
  });

  it('route `settings` et `save-settings` vers la page de réglages', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    await defined.get('settings')?.({ payload: undefined, context: undefined });
    await defined.get('save-settings')?.({ payload: { issueProjectKey: 'CI' }, context: undefined });
    expect(calls).toEqual(['settings', 'saveSettings:{"issueProjectKey":"CI"}']);
  });

  it('route `replay-sample` vers le rejeu du jeu d’exemple', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    const answer = await defined.get('replay-sample')?.({ payload: undefined, context: undefined });
    expect(calls).toEqual(['replaySample']);
    expect(answer).toEqual({ ok: true, seeded: true });
  });
});
