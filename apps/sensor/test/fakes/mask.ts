/**
 * Local double of the masking engine (`maskSecrets`, `docs/CONTRACTS.md`
 * section A, implemented in `packages/core/src/mask.ts` by lot A).
 *
 * The double only reproduces the *contract shape* — `{ text, masked, kinds }`
 * and a stable neutral token — so the Sensor's payload can be checked while
 * the engine lands in parallel. It masks two obvious patterns and stays
 * linear (no backtracking), because the payload tests feed it 50 KiB blocks.
 */

import type { Masker } from '../../src/pure/payload';

/** Result of a masking pass, as the engine returns it. */
export interface MaskResult {
  text: string;
  masked: number;
  kinds: string[];
}

function maskToken(token: string): string | undefined {
  if (token.startsWith('ghp_') || token.startsWith('github_pat_')) return 'token';
  if (token.includes('@') && token.includes('.')) return 'email';
  return undefined;
}

/** A minimal masker replacing the obvious secrets with a neutral token. */
export function fakeMaskSecrets(text: string): MaskResult {
  let masked = 0;
  const kinds = new Set<string>();
  const output = text.replace(/\S+/g, (token) => {
    const kind = maskToken(token);
    if (!kind) return token;
    masked += 1;
    kinds.add(kind);
    return `«[masqué:${kind}]»`;
  });
  return { text: output, masked, kinds: [...kinds] };
}

/** The masker injected into the pure modules by the tests. */
export const masker: Masker = fakeMaskSecrets;
