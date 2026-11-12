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
  const plain = (name: string, answer: unknown) => async () => {
    calls.push(name);
    return answer;
  };
  const withPayload = (name: string, answer: unknown) => async (payload: unknown) => {
    calls.push(`${name}:${JSON.stringify(payload)}`);
    return answer;
  };
  return {
    calls,
    ports: {
      memoryPage: plain('memoryPage', { signatures: [] }),
      issuePanel: async (payload, context) => {
        calls.push(`issuePanel:${JSON.stringify(payload)}`);
        return { problem: false, ...(context ? { context } : {}) };
      },
      settings: plain('settings', { issueProjectKey: 'CI' }),
      saveSettings: withPayload('saveSettings', { ok: true }),
      replaySample: plain('replaySample', { ok: true, seeded: true }),
      curateMerge: withPayload('curateMerge', { ok: true, data: { movedOccurrences: 0 } }),
      curateSplit: withPayload('curateSplit', { ok: true, data: { groups: [] } }),
      quarantineProposal: withPayload('quarantine', { ok: true, data: { flaky: false, reasons: [] } }),
      auditLog: plain('auditLog', { ok: true, entries: [] }),
      memoryExport: withPayload('memoryExport', { ok: true, format: 'csv', filename: 'm.csv' }),
      memoryHealth: plain('memoryHealth', { ok: true, health: { totalRows: 0 } }),
    },
  };
}

describe('résolveurs des écrans UI Kit', () => {
  it('enregistre les onze noms appelés par l’interface', () => {
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

  it('route `curate-merge` vers l’aperçu de fusion (CI-17)', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    await defined.get('curate-merge')?.({ payload: { keepId: 'a', dropId: 'b' }, context: undefined });
    expect(calls).toEqual(['curateMerge:{"keepId":"a","dropId":"b"}']);
  });

  it('route `curate-split` vers l’aperçu de scission (CI-17)', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    await defined.get('curate-split')?.({
      payload: { signatureId: 'a', criterion: 'branch' },
      context: undefined,
    });
    expect(calls).toEqual(['curateSplit:{"signatureId":"a","criterion":"branch"}']);
  });

  it('route `quarantine-proposal` vers la proposition de quarantaine (CI-19)', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    await defined.get('quarantine-proposal')?.({ payload: { signatureId: 'a' }, context: undefined });
    expect(calls).toEqual(['quarantine:{"signatureId":"a"}']);
  });

  it('route `audit-log` vers le journal de ce que l’app a fait', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    const answer = await defined.get('audit-log')?.({ payload: undefined, context: undefined });
    expect(calls).toEqual(['auditLog']);
    expect(answer).toEqual({ ok: true, entries: [] });
  });

  it('route `memory-export` vers l’export, avec le format demandé', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    await defined.get('memory-export')?.({ payload: { format: 'json' }, context: undefined });
    expect(calls).toEqual(['memoryExport:{"format":"json"}']);
  });

  it('route `memory-health` vers la santé de la mémoire', async () => {
    const { resolver, defined } = fakeResolver();
    const { ports, calls } = fakePorts();
    registerUiResolvers(resolver, ports);
    await defined.get('memory-health')?.({ payload: undefined, context: undefined });
    expect(calls).toEqual(['memoryHealth']);
  });
});
