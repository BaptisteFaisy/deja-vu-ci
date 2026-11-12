/**
 * Signature computation (§ 9.3).
 *
 * Produces deterministic 16-hex fingerprints via SHA-256 (crypto).
 * - signatureOf: category | errorType | message | frames (without line numbers)
 * - familyOf: category | errorType | message
 * - signatureShort: "S-" + 3 decimal digits derived from the fingerprint.
 */

import { createHash } from 'crypto';
import type { ErrorBlock, SignatureKey } from './types.js';

/**
 * Format frames for the signature hash.
 * Per § 9.2 and types.ts: line numbers are removed from the fingerprint,
 * keeping only normalized file and function name.
 */
function serializeFrames(block: ErrorBlock): string {
  if (!block.frames || block.frames.length === 0) return '';
  return block.frames
    .map((f) => `${f.file}:${f.fn ?? ''}`)
    .join(';');
}

/** Compute a SHA-256 hash truncated to 16 lowercase hex characters. */
function sha256Hex16(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Family fingerprint: category + errorType + normalized message.
 * Leaves out the stack frames so occurrences across refactorings share a family.
 */
export function familyOf(block: ErrorBlock): string {
  const payload = [block.category, block.errorType, block.message].join('|');
  return sha256Hex16(payload);
}

/**
 * Full signature fingerprint: category + errorType + normalized message + frames.
 */
export function signatureOf(block: ErrorBlock): string {
  const payload = [
    block.category,
    block.errorType,
    block.message,
    serializeFrames(block),
  ].join('|');
  return sha256Hex16(payload);
}

/** Return both the full signature and family key for an error block. */
export function signatureKeys(block: ErrorBlock): SignatureKey {
  return {
    signature: signatureOf(block),
    family: familyOf(block),
  };
}

/**
 * Short human-readable signature tag, e.g. "S-204" (§ 9.3).
 * Derives a stable 3-digit number (000-999) from the fingerprint.
 */
export function signatureShort(id: string): string {
  const hexPart = id.replace(/[^0-9a-fA-F]/g, '');
  const slice = hexPart.length >= 6 ? hexPart.slice(-6) : hexPart.padEnd(6, '0');
  const numeric = parseInt(slice, 16);
  const code = (numeric % 1000).toString().padStart(3, '0');
  return `S-${code}`;
}
