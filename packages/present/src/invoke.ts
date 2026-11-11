/**
 * Calling a resolver from a screen — pure: the bridge is injected.
 *
 * Both apps load their data the same way: `invoke('<name>', payload)` from
 * `@forge/bridge`, and the answer may come back wrapped in a `{ body }`
 * envelope. The unwrapping lives here once, so neither app invents its own —
 * and this package still imports nothing from Forge.
 */

/** The shape of `invoke` this package needs (injected by the app). */
export type InvokeFn = (functionKey: string, payload?: Record<string, unknown>) => Promise<unknown>;

/** A possible Forge envelope: the answer plus platform metadata. */
interface ForgeEnvelope {
  body: unknown;
  metadata?: unknown;
}

/** Unwraps a Forge answer: returns the body, wrapped or not. */
export function unwrapBody<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    return (response as ForgeEnvelope).body as T;
  }
  return response as T;
}

/**
 * Builds the loader of one app.
 *
 * The returned function calls a resolver and hands back its body, typed by
 * the caller: a screen writes `load<PrCard>('getPrCard')` and never sees the
 * envelope.
 */
export function createLoader(invoke: InvokeFn) {
  return async function load<T>(
    functionKey: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    return unwrapBody<T>(await invoke(functionKey, payload));
  };
}
