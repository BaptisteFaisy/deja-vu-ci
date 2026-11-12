/**
 * Data minimization for raw error excerpts (§ 18 "Secrets", § 16 retention).
 *
 * `minimizeExcerpt` is a **pure** function: it reduces a raw excerpt to the
 * strict minimum needed for a given retention policy, so that the memory
 * never keeps more personal/secret data than necessary.
 *
 * Three policies:
 *  - `hash-only`      → keep only the fingerprint; the text is dropped.
 *  - `masked-snippet` → keep the fingerprint plus a masked, truncated excerpt.
 *  - `full`           → keep the fingerprint plus the full masked excerpt.
 *
 * Secrets are always masked before anything is retained (even under `full`):
 * a raw secret never persists. The fingerprint is derived from the **raw**
 * text so the same excerpt yields the same fingerprint under every policy.
 *
 * This module is intentionally **not** wired into the apps yet — a follow-up
 * lot decides where to call it (see `docs/DATA-MINIMIZATION.md`).
 */

import { createHash } from 'crypto';
import { maskSecrets } from './mask.js';

/** Retention policies, from the most to the least minimizing. */
export const MINIMIZE_POLICIES = ['hash-only', 'masked-snippet', 'full'] as const;
export type MinimizePolicy = (typeof MINIMIZE_POLICIES)[number];

/** Default character budget of a `masked-snippet`. */
export const DEFAULT_SNIPPET_CHARS = 512;

/** The excerpt handed to the minimizer. */
export interface ExcerptInput {
  /** Raw excerpt text (may contain secrets/PII). */
  text: string;
  /** Optional precomputed fingerprint; otherwise derived from `text`. */
  fingerprint?: string;
}

/** Extra knobs of the minimizer. */
export interface MinimizeOptions {
  /** Character budget of a `masked-snippet` (default {@link DEFAULT_SNIPPET_CHARS}). */
  maxChars?: number;
}

/** What survives minimization. */
export interface MinimizedExcerpt {
  /** Stable fingerprint — always kept, even under `hash-only`. */
  fingerprint: string;
  /** Retained text; absent under `hash-only`. */
  text?: string;
  /** True when secrets were masked out of the retained text. */
  masked: boolean;
  /** True when the retained text was truncated to the budget. */
  truncated: boolean;
  /** UTF-8 byte size of the retained text (0 under `hash-only`). */
  bytes: number;
}

/** Stable 16-hex fingerprint of a raw excerpt (matches `signatureOf` length). */
export function excerptFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Reduces an excerpt to the strict minimum allowed by `policy`. Pure: it never
 * mutates its input and depends on no clock or storage.
 */
export function minimizeExcerpt(
  excerpt: ExcerptInput,
  policy: MinimizePolicy = 'masked-snippet',
  options: MinimizeOptions = {},
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
      bytes: Buffer.byteLength(maskedText, 'utf8'),
    };
  }

  // 'masked-snippet'
  const maxChars = options.maxChars ?? DEFAULT_SNIPPET_CHARS;
  const truncated = maskedText.length > maxChars;
  const text = truncated ? maskedText.slice(0, maxChars) : maskedText;
  return {
    fingerprint,
    text,
    masked: true,
    truncated,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}
