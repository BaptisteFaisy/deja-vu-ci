/**
 * Adapter to the masking engine of `@dejavu/core`.
 *
 * The Sensor never copies the masking logic (§ 18, "Secrets"): it calls
 * `maskSecrets` from the engine, exactly as `docs/CONTRACTS.md` (section A)
 * defines it.
 *
 * The import is dynamic for two reasons: the pure modules stay free of any
 * runtime dependency on the engine, and the app starts even when the
 * engine is not bundled yet. If the engine cannot be reached, the caller
 * must **fail closed** — an unmasked excerpt never leaves Bitbucket.
 */

import type { Masker } from './pure/payload';

/** Shape of the masking result, as the engine returns it. */
export interface MaskResult {
  text: string;
  masked: number;
  kinds: string[];
}

/** The part of the engine the Sensor uses. */
export interface CoreEngine {
  maskSecrets?: (text: string) => MaskResult;
}

/** Specifier of the engine package (kept in a constant: see the header). */
const CORE_PACKAGE = '@dejavu/core';

let cached: Masker | undefined;

/**
 * Returns the masker of the engine.
 *
 * Throws when the engine does not expose `maskSecrets`: the caller then
 * refuses to send anything.
 */
export async function coreMasker(): Promise<Masker> {
  if (cached) return cached;
  const core = (await import(CORE_PACKAGE)) as unknown as CoreEngine;
  const maskSecrets = core.maskSecrets;
  if (typeof maskSecrets !== 'function') {
    throw new Error('the masking engine is not available');
  }
  const masker: Masker = (text: string) => maskSecrets(text);
  cached = masker;
  return masker;
}

/** Replaces the masker (used by the tests and by the local rehearsal). */
export function setMasker(masker: Masker | undefined): void {
  cached = masker;
}
