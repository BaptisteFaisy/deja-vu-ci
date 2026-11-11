/**
 * Descripteur d'action (§ 13).
 *
 * Une action est décrite une seule fois : le module `action` de Forge, l'agent
 * Rovo et l'exposition `rovo:mcp` consomment tous le même objet. Les noms,
 * les entrées et le format de sortie sont donc identiques partout — un agent
 * qui appelle `explain-build-failure` par MCP obtient exactement ce que rend
 * la carte de PR.
 *
 * Un descripteur est **appelable** : `(engine, raw) => Promise<ActionResult>`.
 * Il porte en plus ses métadonnées (`key`, `verb`, `inputs`), ce qui permet
 * au manifeste Forge et au serveur MCP de le décrire sans écrire de table
 * parallèle.
 */

import { fail, getDefaultEngine, type ActionResult, type BrainEngine } from './engine';

/** Verbe de l'action (colonne « Verbe » du § 13). */
export type ActionVerb = 'GET' | 'CREATE' | 'UPDATE';

/** Sous-schéma JSON d'un champ d'entrée. */
export interface FieldSchema {
  type: 'string' | 'boolean' | 'integer';
  description: string;
  required?: boolean;
}

/** Schéma des entrées d'une action. */
export type InputSchema = Record<string, FieldSchema>;

/** Entrées brutes d'une action, telles que reçues d'un agent. */
export type RawInput = Record<string, unknown>;

/** Descripteur complet d'une action. */
export interface ActionDescriptor<TData> {
  (engine: BrainEngine, raw: RawInput): Promise<ActionResult<TData>>;
  /** Clé de l'action — identique en Forge, en Rovo et en MCP. */
  readonly key: string;
  readonly verb: ActionVerb;
  readonly description: string;
  readonly inputs: InputSchema;
}

/**
 * Reconnaît un moteur : objet portant un magasin et la fonction de diagnostic.
 */
function isEngine(value: unknown): value is BrainEngine {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BrainEngine>;
  return typeof candidate.diagnose === 'function' && typeof candidate.store === 'object';
}

/**
 * Normalise les arguments d'un appel.
 *
 * L'action s'appelle normalement `(engine, payload)`, comme dans les tests et
 * dans le serveur MCP. L'ordre inverse `(payload, engine)` est aussi accepté :
 * le Cerveau expose des gestionnaires Forge, dont la signature est imposée
 * par la plateforme.
 */
export function normalizeArgs(
  first: unknown,
  second: unknown,
): { engine?: BrainEngine; raw: RawInput } {
  if (isEngine(first)) return { engine: first, raw: (second as RawInput) ?? {} };
  const explicit = isEngine(second)
    ? second
    : ((second as { engine?: BrainEngine } | undefined)?.engine ?? undefined);
  return {
    engine: explicit ?? getDefaultEngine(),
    raw: (first as RawInput) ?? {},
  };
}

/**
 * Construit un descripteur appelable à partir de son exécution.
 * L'exception ne remonte jamais : elle devient une erreur explicite.
 */
export function defineAction<TData>(spec: {
  key: string;
  verb: ActionVerb;
  description: string;
  inputs: InputSchema;
  run: (engine: BrainEngine, raw: RawInput) => Promise<ActionResult<TData>>;
}): ActionDescriptor<TData> {
  const descriptor = (async (first: unknown, second?: unknown) => {
    try {
      const { engine, raw } = normalizeArgs(first, second);
      if (!engine) return fail('no memory engine was provided to this action');
      return await spec.run(engine, raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(`internal error: ${message}`);
    }
  }) as ActionDescriptor<TData>;
  Object.defineProperties(descriptor, {
    key: { value: spec.key, enumerable: true },
    verb: { value: spec.verb, enumerable: true },
    description: { value: spec.description, enumerable: true },
    inputs: { value: spec.inputs, enumerable: true },
  });
  return descriptor;
}
