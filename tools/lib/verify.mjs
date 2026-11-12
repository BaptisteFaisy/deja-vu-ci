/**
 * Shared primitives for the verification tools (`tools/doctor.mjs`,
 * `tools/check-docs.mjs`, `tools/check-licences.mjs`).
 *
 * Everything here is offline: the repository is read through `git` and the
 * filesystem, never over the network. The helpers exist once and are shared —
 * a rule (a size limit, a conflict marker, a timeout) must be expressed in a
 * single place, otherwise two tools drift apart and the doctor reports
 * something its own siblings do not.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of the repository (this file lives in `tools/lib/`). */
export const repoRoot = path.resolve(here, '..', '..');

/** Verdict of a check: `OK` passed, `KO` failed, `PASSÉ` not applicable. */
export const OK = 'OK';
export const KO = 'KO';
export const SKIPPED = 'PASSÉ';

/**
 * A merge left in the tree looks like a line starting with three markers.
 * Written as a pattern (not as a literal) so that this file never contains a
 * line the conflict scanner would flag.
 */
export const CONFLICT_PATTERN = /^(<{7}|>{7}|\|{7})( |$)/;

/**
 * Runs a command and returns its outcome. The child process is killed when it
 * exceeds the timeout: a check that hangs must not block the whole doctor.
 */
export function run(command, args, options = {}) {
  const { cwd = repoRoot, timeoutMs = 60_000 } = options;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT',
    error: result.error?.message,
  };
}

/**
 * Files tracked by git, matching the given pathspecs. Returns POSIX paths
 * relative to the repository root.
 */
export function trackedFiles(patterns = ['*'], options = {}) {
  const { cwd = repoRoot } = options;
  const result = run('git', ['ls-files', '-z', '--', ...patterns], { cwd });
  if (result.code !== 0) return [];
  return result.stdout.split('\0').filter((entry) => entry.length > 0);
}

/** Reads a file as text, or `undefined` when it does not exist. */
export function readTextIfExists(file) {
  if (!existsSync(file)) return undefined;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Line numbers of the conflict markers found in a text. */
export function conflictLines(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (CONFLICT_PATTERN.test(line)) found.push(index + 1);
  });
  return found;
}

/**
 * Races a promise against a timeout. The promise is not cancelled (JavaScript
 * has no cancellation), but the caller stops waiting and reports the timeout.
 */
export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, label }), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** First lines of a command output, for a one-line summary. */
export function firstLines(text, count = 2) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, count)
    .join(' · ');
}

/** Shortens a string to `max` characters, on a word boundary when possible. */
export function shorten(text, max = 160) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/** Builds the result of a check. */
export function checkResult(verdict, summary, details = []) {
  return { verdict, summary, details };
}

/** Renders the table of results — one line per check, details below. */
export function renderTable(results) {
  const rows = results.map((result) => [
    result.verdict,
    result.name,
    `${result.ms} ms`,
    shorten(result.summary || '', 90),
  ]);
  const headers = ['VERDICT', 'CHECK', 'DURATION', 'DETAIL'];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  const out = [line(headers), line(widths.map((width) => '─'.repeat(width)))];
  for (const row of rows) out.push(line(row));
  return out.join('\n');
}

/** Renders the details of the checks that need them. */
export function renderDetails(results) {
  const blocks = [];
  for (const result of results) {
    const details = result.details ?? [];
    if (details.length === 0) continue;
    blocks.push(`${result.name}:\n${details.map((detail) => `  - ${detail}`).join('\n')}`);
  }
  return blocks.join('\n');
}
