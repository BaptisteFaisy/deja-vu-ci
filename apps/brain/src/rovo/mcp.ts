/**
 * Exposition `rovo:mcp` des six actions du § 13.
 *
 * Le serveur MCP rend les **mêmes** actions que le module `action` de Forge :
 * mêmes clés, mêmes entrées, mêmes sorties. Un agent de code qui appelle
 * `explain-build-failure` par MCP obtient exactement ce que rend la carte de
 * PR, parce que les deux passent par la même fonction du moteur.
 */

import type { ActionDescriptor, RawInput } from '../actions/descriptor';
import type { BrainEngine } from '../actions/engine';
import { AGENT_ACTIONS } from './agent';

/** Un outil exposé par le serveur MCP. */
export interface McpTool {
  /** Nom de l'outil — identique à la clé de l'action. */
  name: string;
  /** Description lue par l'agent. */
  description: string;
  /** Schéma JSON des entrées. */
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  /** Exécute l'outil. */
  run(engine: BrainEngine, raw: RawInput): Promise<unknown>;
}

/** Schéma JSON des entrées d'une action. */
function toInputSchema(action: ActionDescriptor<unknown>): McpTool['inputSchema'] {
  const properties: McpTool['inputSchema']['properties'] = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(action.inputs)) {
    properties[name] = { type: field.type, description: field.description };
    if (field.required) required.push(name);
  }
  return { type: 'object', properties, required };
}

/** Les six outils MCP, dans l'ordre du § 13. */
export const MCP_TOOLS: McpTool[] = Object.values(AGENT_ACTIONS).map((action) => ({
  name: action.key,
  description: action.description,
  inputSchema: toInputSchema(action),
  run: (engine, raw) => action(engine, raw),
}));

/** Cherche un outil par son nom. */
export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}

/** Exécute un outil par son nom ; erreur explicite si le nom est inconnu. */
export async function callTool(
  engine: BrainEngine,
  name: string,
  raw: RawInput,
): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  return tool.run(engine, raw);
}
