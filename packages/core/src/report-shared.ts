/**
 * Shared plumbing of the test report parsers (§ 9.1).
 *
 * The parsers in `report-parsers.ts` are data tables: one marker set per
 * ecosystem. Everything that is not ecosystem-specific — turning a log into
 * lines, collecting the detail block of a failure, building a stack trace —
 * lives here, once, so no parser re-implements it.
 */

import { stripAnsi, TOKENS } from './normalize.js';

/** A detail block collected under a header line. */
export interface Block {
  /** Trimmed lines of the block. */
  lines: string[];
  /** Index of the first line after the block. */
  next: number;
}

/** Upper bound of lines collected under one failure header. */
const BLOCK_LINES = 80;

/** Split a log into lines: ANSI codes removed, CRLF and lone CR tolerated. */
export function toLines(text: string): string[] {
  return stripAnsi(text).replace(/\r\n?/g, '\n').split('\n');
}

/** True when the line holds nothing but spaces. */
export function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** The non-blank lines of a block. */
export function contentLines(lines: string[]): string[] {
  return lines.filter((line) => !isBlank(line));
}

/**
 * Collect the lines that follow a header, until `isStop` says stop.
 * Bounded to {@link BLOCK_LINES} lines: a report never needs more, and a
 * fuzzed log must not make the extraction walk to the end of a huge file.
 */
export function collectBlock(
  lines: string[],
  from: number,
  isStop: (line: string) => boolean,
): Block {
  const collected: string[] = [];
  let i = from;
  while (i < lines.length && collected.length < BLOCK_LINES) {
    if (isStop(lines[i])) break;
    collected.push(lines[i].trim());
    i += 1;
  }
  return { lines: collected, next: i };
}

/** Join the non-blank lines of a block into a stack trace. */
export function stackOf(lines: string[]): string | undefined {
  const kept = contentLines(lines);
  return kept.length > 0 ? kept.join('\n') : undefined;
}

/**
 * The indented detail lines that immediately precede a marker line.
 *
 * Go writes the output of a test *before* its "--- FAIL:" marker, so a parser
 * that only reads downwards would lose the actual error.
 */
export function linesAbove(lines: string[], at: number): string[] {
  const collected: string[] = [];
  for (let i = at - 1; i >= 0; i--) {
    if (isBlank(lines[i]) || !/^\s/.test(lines[i])) break;
    collected.unshift(lines[i].trim());
  }
  return collected;
}

/** Replace numbers wrapped in angle brackets (JUnit/Gradle diffs) by the token. */
export function neutralizeAngleNumbers(text: string): string {
  return text.replace(/<\d+(?:\.\d+)?>/g, TOKENS.NUM);
}

/** Last segment of a test name, used to match a summary with its section. */
export function shortKey(name: string): string {
  const parts = name.split(/[/:]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? name;
}

/** Strip the "path/to/file.ext:42:" prefix a runner puts before a message. */
export function stripLocation(text: string): string {
  return text.replace(/^[\w./\\-]+\.[a-z]+:\d+:\s*/, '');
}
