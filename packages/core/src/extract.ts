/**
 * Error extraction (§ 9.1).
 *
 * Extracts up to 3 distinct error blocks from test reports or pipeline logs,
 * bounded to 50 KB total (`maxTotalBytes`, default 51200).
 *
 * Order of preference (§ 9.1):
 * 1. Test report failures (source: 'report')
 * 2. Log patterns: JUnit, pytest, Jest, Go, Cargo, npm, Gradle, Maven,
 *    TypeScript, ESLint, Docker, OOM, timeout, network (source: 'log')
 * 3. Tail: last 80 non-empty lines (source: 'tail')
 */

import { categorize, detectErrorType } from './categorize.js';
import { maskSecrets } from './mask.js';
import { normalizeFrames, normalizeMessage } from './normalize.js';
import type { ErrorBlock, ExtractResult, FailedTestCase, Frame } from './types.js';

export interface ExtractInput {
  stepLog?: string;
  testCases?: FailedTestCase[];
  maxTotalBytes?: number;
}

const DEFAULT_MAX_TOTAL_BYTES = 51200;
const MAX_BLOCKS = 3;
const TAIL_LINES = 80;

/** Return the last n non-empty lines from a text string. */
export function lastNonEmptyLines(text: string, n: number): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(-n);
}

/** Check whether a file path likely belongs to the user project. */
function isProjectPath(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  if (norm.includes('node_modules/')) return false;
  if (norm.includes('/vendor/') || norm.startsWith('vendor/')) return false;
  if (norm.includes('.cargo/registry') || norm.includes('.rustup')) return false;
  if (norm.startsWith('internal/') || norm.startsWith('node:')) return false;
  if (norm.startsWith('/usr/') || norm.startsWith('/lib')) return false;
  return true;
}

/** Parse stack frames from a trace text block. */
function parseFrames(text: string): Frame[] {
  const frames: Frame[] = [];
  // Match standard Node/V8: at [fn] (path:line:col) or at path:line:col
  const v8Regex = /^\s*at (?:(.+?)\s+\((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = v8Regex.exec(text)) !== null) {
    const fn = match[1];
    const file = match[2] ?? match[5];
    const line = Number(match[3] ?? match[6]);
    if (file) {
      frames.push({ file, fn, line, isProject: isProjectPath(file) });
    }
  }
  if (frames.length > 0) return frames;

  // Match Python: File "path", line 12, in fn
  const pyRegex = /File "([^"]+)", line (\d+)(?:, in (\w+))?/g;
  while ((match = pyRegex.exec(text)) !== null) {
    const file = match[1];
    const line = Number(match[2]);
    const fn = match[3];
    frames.push({ file, fn, line, isProject: isProjectPath(file) });
  }
  return frames;
}

/** Build an ErrorBlock from raw inputs, applying mask, normalize and categorize. */
function buildErrorBlock(input: {
  raw: string;
  source: 'report' | 'log' | 'tail';
  testName?: string;
  messageOverride?: string;
}): ErrorBlock {
  const masked = maskSecrets(input.raw).text;
  const rawMessage = input.messageOverride ?? masked.split(/\r?\n/)[0] ?? '';
  const errorType = detectErrorType(masked);
  const category = categorize({
    rawText: masked,
    source: input.source,
    testName: input.testName,
    errorType,
  });
  const message = normalizeMessage(rawMessage);
  const rawFrames = parseFrames(masked);
  const frames = normalizeFrames(rawFrames);

  return {
    category,
    errorType,
    message,
    rawMessage,
    frames,
    testName: input.testName,
    source: input.source,
    rawText: masked,
  };
}

/** Patterns that identify the start of an error block in logs (§ 9.1). */
const LOG_ERROR_STARTERS = [
  /^\s*(?:--- FAIL:|\s*FAIL\b|FAIL:)\s*(.+)$/m,
  /^\s*(?:npm ERR!|yarn error|pnpm ERR!)\s*(.+)$/m,
  /^\s*(?:error\[E\d+\]|error:)\s*(.+)$/m,
  /^\s*(?:ERROR\b|\[ERROR\])\s*(.+)$/m,
  /^\s*(?:.*?(?:AssertionError|Exception|Error|Fatal|Timeout):?\s*.+)$/m,
  /^\s*(?:.+?\(\d+,\d+\):\s*error TS\d+:\s*.+)$/m,
  /^\s*(?:eslint|prettier).*?(?:error|problem)/im,
  /^\s*(?:panic:|=== \d+ seconds timeout|<failure|<error)/m,
  /^\s*[\w./-]+\.go:\d+:\d+:/m,
  /^\s*> Task :\S+ FAILED/m,
];

/** Extract error chunks from a raw step log using known markers. */
function extractLogChunks(log: string): string[] {
  const lines = log.split(/\r?\n/);
  const chunks: string[] = [];
  let i = 0;

  while (i < lines.length && chunks.length < 10) {
    const line = lines[i];
    const isStart = LOG_ERROR_STARTERS.some((re) => re.test(line));
    if (isStart) {
      // Gather up to 40 lines around the error
      const chunkLines = lines.slice(i, i + 40);
      chunks.push(chunkLines.join('\n'));
      i += 15; // Skip ahead to avoid overlapping blocks from same error
    } else {
      i += 1;
    }
  }
  return chunks;
}

/** Clamp total bytes across retained blocks to maxTotalBytes. */
function enforceByteLimit(blocks: ErrorBlock[], maxBytes: number): ErrorBlock[] {
  let used = 0;
  const result: ErrorBlock[] = [];
  for (const block of blocks) {
    const remaining = maxBytes - used;
    if (remaining <= 0) break;
    if (block.rawText.length > remaining) {
      result.push({
        ...block,
        rawText: block.rawText.slice(0, remaining),
      });
      break;
    }
    used += block.rawText.length;
    result.push(block);
  }
  return result;
}

/** Extract error blocks from test cases (source: 'report'). */
function fromTestCases(cases: FailedTestCase[]): ErrorBlock[] {
  return cases.map((tc) => {
    const fullText = tc.stack ? `${tc.message}\n${tc.stack}` : tc.message;
    return buildErrorBlock({
      raw: fullText,
      source: 'report',
      testName: tc.name,
      messageOverride: tc.message,
    });
  });
}

/** Extract error blocks from step log using pattern matching (source: 'log'). */
function fromLogPatterns(stepLog: string): ErrorBlock[] {
  const chunks = extractLogChunks(stepLog);
  return chunks.map((chunk) => buildErrorBlock({ raw: chunk, source: 'log' }));
}

/** Fallback extraction taking the last 80 non-empty lines (source: 'tail'). */
function fromTail(stepLog: string): ErrorBlock[] {
  const tail = lastNonEmptyLines(stepLog, TAIL_LINES);
  if (tail.length === 0) return [];
  const text = tail.join('\n');
  return [buildErrorBlock({ raw: text, source: 'tail' })];
}

/**
 * Main entry point: extracts error blocks per § 9.1 precedence.
 */
export function extractErrorBlocks(input: ExtractInput): ExtractResult {
  const maxBytes = input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  let rawBlocks: ErrorBlock[] = [];
  let source: 'report' | 'log' | 'tail' = 'tail';

  if (input.testCases && input.testCases.length > 0) {
    rawBlocks = fromTestCases(input.testCases);
    source = 'report';
  } else if (input.stepLog) {
    rawBlocks = fromLogPatterns(input.stepLog);
    if (rawBlocks.length > 0) {
      source = 'log';
    } else {
      rawBlocks = fromTail(input.stepLog);
      source = 'tail';
    }
  }

  const dropped = Math.max(0, rawBlocks.length - MAX_BLOCKS);
  const boundedBlocks = rawBlocks.slice(0, MAX_BLOCKS);
  const finalBlocks = enforceByteLimit(boundedBlocks, maxBytes);

  return {
    blocks: finalBlocks,
    source,
    dropped,
  };
}
