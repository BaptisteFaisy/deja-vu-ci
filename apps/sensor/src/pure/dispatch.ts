/**
 * Dispatch of a Forge resolver call — pure, no Forge import.
 *
 * A UI Kit module declares one resolver function; every `invoke('<name>')` of
 * its screen reaches it inside an envelope:
 * `{ call: { functionKey, payload }, context }`. This module reads the name,
 * the arguments and the context out of that envelope, and accepts the bare
 * shapes too (a trigger payload has no `call`), so one dispatch serves the
 * card, the settings page and the generic `handler`.
 */

/** A resolver as the Sensor writes them: never throws, always answers. */
export type ResolverFn = (payload: unknown, context?: unknown) => Promise<unknown>;

/** The envelope Forge hands to a resolver function. */
interface Envelope {
  call?: { functionKey?: string; name?: string; payload?: unknown; arguments?: unknown };
  context?: unknown;
}

/** A value as an object, or `undefined` when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** The `invoke()` name of an envelope ('' when there is no call). */
export function invokeName(payload: unknown): string {
  const call = asRecord(asRecord(payload)?.call);
  if (!call) return '';
  for (const key of ['functionKey', 'name']) {
    const value = call[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/** The arguments the screen sent, unwrapped from the envelope. */
export function invokeArguments(payload: unknown): unknown {
  const call = asRecord(asRecord(payload)?.call);
  if (!call) return payload;
  for (const key of ['payload', 'arguments']) {
    if (call[key] !== undefined) return call[key];
  }
  return undefined;
}

/** The Forge context: the second argument when given, else the envelope's. */
export function invokeContext(payload: unknown, context: unknown): unknown {
  if (context !== undefined && context !== null) return context;
  const envelope = asRecord(payload) as Envelope | undefined;
  return envelope?.call === undefined ? undefined : envelope?.context;
}

/**
 * Answers one `invoke()` call.
 *
 * An unknown name is answered, never thrown: a Forge function that raises is
 * retried by the platform, and the screen would show a spinner forever.
 */
export async function dispatchInvoke(
  table: Record<string, ResolverFn>,
  payload: unknown,
  context?: unknown,
): Promise<unknown> {
  const name = invokeName(payload);
  const invocation = table[name];
  if (!invocation) return { ok: false, error: `unknown function ${name || '(none)'}` };
  return invocation(invokeArguments(payload), invokeContext(payload, context));
}
