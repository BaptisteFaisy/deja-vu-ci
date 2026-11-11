/**
 * How the Brain's screens reach its data (§ 14).
 *
 * The components `.tsx` never call `invoke()` directly: they call `loadData`,
 * which makes the call and hands back the resolver's body. The unwrapping is
 * shared with the Sensor (`@dejavu/present`), so both apps read a Forge
 * answer the same way.
 *
 * This module is the only one importing `@forge/bridge`, and it exports no
 * JSX: it stays testable.
 */

import { invoke } from '@forge/bridge';
import { createLoader, unwrapBody, type InvokeFn } from '@dejavu/present';

/** Unwraps a Forge answer: the body, wrapped or not. */
export const unwrap = unwrapBody;

/** The bridge call, shaped for the shared loader. */
const bridgeInvoke: InvokeFn = (functionKey, payload) => invoke(functionKey, payload);

/** Calls a resolver of the Brain and returns its body. */
export const loadData = createLoader(bridgeInvoke);
