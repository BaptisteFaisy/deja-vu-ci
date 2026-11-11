/**
 * How the Sensor's screens reach its resolvers.
 *
 * Same loader as the Brain (`@dejavu/present`): the unwrapping of a Forge
 * answer is written once for both apps. With `src/ui/custom.tsx` (which reads
 * the platform context), this module is the only one that imports
 * `@forge/bridge`.
 */

import { invoke } from '@forge/bridge';
import { createLoader, type InvokeFn } from '@dejavu/present';

/** The bridge call, shaped for the shared loader. */
const bridgeInvoke: InvokeFn = (functionKey, payload) => invoke(functionKey, payload);

/** Calls a resolver of the Sensor and returns its body. */
export const loadData = createLoader(bridgeInvoke);
