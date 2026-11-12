/**
 * Applying the retention policy of the raw excerpts (§ 18, CI-18).
 *
 * Split out of `excerptPolicy.ts`: hashing (`crypto`) and masking (the engine
 * barrel) are backend-only — the Forge UI Kit bundle is compiled for a web
 * target where Node built-ins are disabled. The screens import the constants
 * and the types from `excerptPolicy.ts`; only `src/consumer.ts` and the tests
 * import this file. `test/ui-bundle.test.ts` guards the boundary.
 */

import { createHash } from 'crypto';
import { maskSecrets } from '@dejavu/core';
import {
  DEFAULT_EXCERPT_POLICY,
  SNIPPET_CHARS,
  type MinimizePolicy,
  type MinimizedExcerpt,
} from './excerptPolicy';

/** Stable 16-hex fingerprint of a raw excerpt. */
export function excerptFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** UTF-8 size of a text, in bytes. */
function byteSize(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Reduces an excerpt to the strict minimum `policy` allows.
 *
 * The fingerprint is derived from the **raw** text, so the same excerpt
 * fingerprints identically under every policy; secrets are masked before
 * anything is retained — even under `full`, a raw secret never persists.
 * Pure: it never mutates its input and depends on no clock or storage.
 */
export function applyExcerptPolicy(
  excerpt: { text: string; fingerprint?: string },
  policy: MinimizePolicy = DEFAULT_EXCERPT_POLICY,
  maxChars: number = SNIPPET_CHARS,
): MinimizedExcerpt {
  const fingerprint = excerpt.fingerprint ?? excerptFingerprint(excerpt.text);

  if (policy === 'hash-only') {
    return { fingerprint, masked: false, truncated: false, bytes: 0 };
  }

  const maskedText = maskSecrets(excerpt.text).text;

  if (policy === 'full') {
    return {
      fingerprint,
      text: maskedText,
      masked: true,
      truncated: false,
      bytes: byteSize(maskedText),
    };
  }

  const truncated = maskedText.length > maxChars;
  const text = truncated ? maskedText.slice(0, maxChars) : maskedText;
  return { fingerprint, text, masked: true, truncated, bytes: byteSize(text) };
}
