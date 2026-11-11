/**
 * Tests de l'agent Rovo et de l'exposition MCP (`src/rovo/`).
 *
 * Le serveur MCP doit exposer **exactement** les six actions du § 13, avec les
 * mêmes noms et les mêmes schémas d'entrées que le module `action` de Forge.
 */

import { describe, expect, it } from 'vitest';
import { AGENT_ACTIONS, AGENT_INSTRUCTIONS, TYPICAL_QUESTIONS, describeAgent, runAgentAction } from '../src/rovo/agent';
import { MCP_TOOLS, callTool, findTool } from '../src/rovo/mcp';
import { makeFakeEngine } from './fakes/engine';
import { FLAKY_SIGNATURE, SEED } from './fakes/fixtures';

const SIX = [
  'confirm-resolution',
  'explain-build-failure',
  'get-signature',
  'list-flaky-tests',
  'report-resolution',
  'search-failures',
];

describe('agent Rovo', () => {
  it('câble les six actions', () => {
    expect(Object.keys(AGENT_ACTIONS).sort()).toEqual(SIX);
  });

  it('interdit d\'affirmer « sans rapport avec ta PR » sous le seuil', () => {
    expect(AGENT_INSTRUCTIONS).toContain('Never state that a failure is unrelated');
    expect(AGENT_INSTRUCTIONS.toLowerCase()).toContain('confidence');
  });

  it('cite le ticket et le correctif', () => {
    expect(AGENT_INSTRUCTIONS).toContain('ticket');
    expect(AGENT_INSTRUCTIONS).toContain('commit');
  });

  it('pose les quatre questions types du § 13', () => {
    expect(TYPICAL_QUESTIONS).toHaveLength(4);
    for (const question of TYPICAL_QUESTIONS) {
      expect(question.question.length).toBeGreaterThan(10);
      expect(SIX).toContain(question.action);
    }
  });

  it('se décrit avec son nom, ses instructions et ses actions', () => {
    const agent = describeAgent();
    expect(agent.name).toBe('Déjà-vu CI');
    expect(agent.instructions).toBe(AGENT_INSTRUCTIONS);
    expect(agent.actions.map((a) => a.key).sort()).toEqual(SIX);
  });

  it('exécute une action par son nom', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runAgentAction(engine, 'get-signature', {
      signatureId: FLAKY_SIGNATURE.id,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('refuse une action inconnue', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runAgentAction(engine, 'inconnu', {});
    expect(result).toMatchObject({ ok: false });
  });
});

describe('serveur MCP', () => {
  it('expose les six actions avec les mêmes noms', () => {
    expect(MCP_TOOLS.map((tool) => tool.name).sort()).toEqual(SIX);
  });

  it('donne à chaque outil un schéma JSON exploitable', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(10);
      for (const field of Object.values(tool.inputSchema.properties)) {
        expect(['string', 'boolean', 'integer']).toContain(field.type);
      }
    }
  });

  it('exige les entrées obligatoires du contrat', () => {
    expect(findTool('explain-build-failure')?.inputSchema.required).toEqual([]);
    expect(findTool('search-failures')?.inputSchema.required).toEqual(['text']);
    expect(findTool('get-signature')?.inputSchema.required).toEqual(['signatureId']);
    expect(findTool('report-resolution')?.inputSchema.required).toEqual(['signatureId', 'commit']);
    expect(findTool('confirm-resolution')?.inputSchema.required).toEqual(['signatureId', 'confirmed']);
  });

  it('appelle un outil et rend le même résultat que l\'action', async () => {
    const engine = makeFakeEngine(SEED);
    const viaTool = await callTool(engine, 'get-signature', { signatureId: FLAKY_SIGNATURE.id });
    const viaAction = await AGENT_ACTIONS['get-signature'](engine, {
      signatureId: FLAKY_SIGNATURE.id,
    });
    expect(viaTool).toEqual(viaAction);
  });

  it('refuse un outil inconnu', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await callTool(engine, 'inconnu', {});
    expect(result).toMatchObject({ ok: false });
  });
});
