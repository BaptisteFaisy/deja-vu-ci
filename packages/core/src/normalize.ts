/**
 * Normalization utilities (§ 9.2).
 *
 * Strips volatile runtime information (timestamps, memory addresses, UUIDs,
 * line numbers, container IDs, temp paths, etc.) replacing them with stable
 * neutral tokens. Also trims stack frames to the first 5 project frames.
 */

import type { Frame } from './types.js';

export interface ReplacementRule {
  kind: string;
  re: RegExp;
  replace: string;
}

// Neutral tokens (§ 9.2):
// <TS>, <DATE>, <DURATION>, <ADDR>, <UUID>, <SHA>, <HEX>, <TMPPATH>, <CONTAINER>, <PORT>, <LINE>, <NUM>
export const TOKENS = {
  TS: '<TS>',
  DATE: '<DATE>',
  DURATION: '<DURATION>',
  ADDR: '<ADDR>',
  UUID: '<UUID>',
  SHA: '<SHA>',
  HEX: '<HEX>',
  TMPPATH: '<TMPPATH>',
  CONTAINER: '<CONTAINER>',
  PORT: '<PORT>',
  LINE: '<LINE>',
  NUM: '<NUM>',
} as const;

/** ANSI escape code matcher. */
const ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Ordered replacement table for normalizeMessage.
 * More specific patterns (UUID, SHA, ISO date-time, URLs/paths) run before
 * generic numbers and hex sequences.
 */
const NORMALIZATION_RULES: ReplacementRule[] = [
  // ISO 8601 timestamps (e.g. 2026-11-11T03:50:00.123Z, 2026-11-11 03:50:00,123)
  {
    kind: 'TS',
    re: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    replace: TOKENS.TS,
  },
  // Time-only timestamps (HH:MM:SS or HH:MM:SS.mmm)
  {
    kind: 'TS',
    re: /\b\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\b/g,
    replace: TOKENS.TS,
  },
  // RFC 2822 dates (e.g. Wed, 11 Nov 2026 03:50:00 GMT)
  {
    kind: 'TS',
    re: /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+\d{2}:\d{2}:\d{2}(?:\s+[A-Z0-9+-]+)?\b/g,
    replace: TOKENS.TS,
  },
  // Simple YYYY-MM-DD or DD/MM/YYYY dates
  {
    kind: 'DATE',
    re: /\b\d{4}[-/]\d{2}[-/]\d{2}\b/g,
    replace: TOKENS.DATE,
  },
  // Durations: 123ms, 12.3s, 1.2 s, 3 min, 45 seconds, 2h 15m
  {
    kind: 'DURATION',
    re: /\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|sec|seconds?|min|minutes?|h|hours?)\b/gi,
    replace: TOKENS.DURATION,
  },
  // Memory addresses: 0x7fff5fbff8e0
  {
    kind: 'ADDR',
    re: /\b0x[0-9a-fA-F]{6,16}\b/g,
    replace: TOKENS.ADDR,
  },
  // UUIDs: 8-4-4-4-12 hex digits
  {
    kind: 'UUID',
    re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    replace: TOKENS.UUID,
  },
  // Git commit SHAs (40 hex) and SHA-256 (64 hex)
  {
    kind: 'SHA',
    re: /\b[0-9a-fA-F]{40}\b|\b[0-9a-fA-F]{64}\b/g,
    replace: TOKENS.SHA,
  },
  // Temp paths: /tmp/..., /var/folders/..., C:\Users\..., /private/var/...
  {
    kind: 'TMPPATH',
    re: /(?:(?:\/tmp|\/var\/folders|\/private\/var\/tmp|[A-Z]:\\(?:Users|Temp|AppData\\Local\\Temp))\S+)/g,
    replace: TOKENS.TMPPATH,
  },
  // Ports: :8080, :3000, :5432 (preceded by localhost, 127.0.0.1, or word boundary)
  {
    kind: 'PORT',
    re: /(?<=localhost|127\.0\.0\.1|0\.0\.0\.0|:\d+):\d{2,5}\b|(?<=\s|^):[1-9]\d{2,4}\b/g,
    replace: TOKENS.PORT,
  },
  // Container IDs (e.g. docker container hex identifiers 12 or 64 hex characters)
  {
    kind: 'CONTAINER',
    re: /\b((?:container[ =:]+|docker:\/\/))[0-9a-fA-F]{12,64}\b/gi,
    replace: `$1${TOKENS.CONTAINER}`,
  },
  // Line numbers in stack traces or error contexts (e.g., :42:15, line 42, L42)
  {
    kind: 'LINE',
    re: /(?<=[a-zA-Z0-9_.-]+):\d+(?::\d+)?\b/g,
    replace: `:${TOKENS.LINE}`,
  },
  {
    kind: 'LINE',
    re: /\b(?:line|Line|L)\s*#?\d+\b/g,
    replace: `line ${TOKENS.LINE}`,
  },
  // Remaining Hex sequences >= 8 characters (object ids, build hashes)
  {
    kind: 'HEX',
    re: /\b[0-9a-fA-F]{8,39}\b/g,
    replace: TOKENS.HEX,
  },
  // Isolated numbers (e.g., counts, IDs, iteration numbers)
  {
    kind: 'NUM',
    re: /(?<=\s|^|\(|\[)-?\d+(?:\.\d+)?(?=\s|$|\)|\]|,|\.)/g,
    replace: TOKENS.NUM,
  },
];

/**
 * Normalize an error message by stripping ANSI sequences and volatile tokens.
 */
export function normalizeMessage(message: string): string {
  let cleaned = stripAnsi(message);
  for (const rule of NORMALIZATION_RULES) {
    cleaned = cleaned.replace(rule.re, rule.replace);
  }
  // Condense runs of whitespace
  return cleaned.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

/**
 * Filter frames to the first 5 project frames (§ 9.2).
 * Line numbers are kept on the Frame object for display, but caller/sign uses
 * them or ignores them according to contract.
 */
export function normalizeFrames(frames: Frame[], maxProject = 5): Frame[] {
  const projectFrames = frames.filter((f) => f.isProject);
  const selected = projectFrames.length > 0 ? projectFrames : frames;
  return selected.slice(0, maxProject).map((f) => ({
    file: f.file.replace(/\\/g, '/'),
    fn: f.fn,
    line: f.line,
    isProject: f.isProject,
  }));
}
