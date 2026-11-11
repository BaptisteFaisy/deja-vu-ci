/**
 * Categorization (§ 9.4) and canonical error typing.
 *
 * A single ordered table of patterns drives both `categorize` and
 * `detectErrorType`: the table is sorted by specificity, so infrastructure
 * and timeout patterns are tested before test patterns. A network outage
 * inside a test therefore stays an infrastructure problem (§ 9.4).
 */

import type { Category, ExtractSource } from './types.js';

export interface CategorizeInput {
  rawText: string;
  source: ExtractSource;
  testName?: string;
  errorType?: string;
}

/** One entry of the ordered pattern table. */
interface CategoryPattern {
  category: Category;
  /** Canonical error type produced when the pattern matches. */
  errorType: string;
  re: RegExp;
}

/**
 * Ordered by specificity: the most specific evidence wins.
 * - infrastructure and timeout come before test (a network cut inside a test
 *   is an infrastructure problem),
 * - dependency comes before compile (a package that cannot be downloaded is
 *   not a compilation problem),
 * - compile and style come before config, and test comes last.
 */
const PATTERNS: CategoryPattern[] = [
  // --- Infrastructure (§ 9.4: network, disk, memory, missing image, quota) ---
  {
    category: 'infrastructure',
    errorType: 'ETIMEDOUT',
    re: /\b(?:ETIMEDOUT|EAI_AGAIN)\b/i,
  },
  {
    category: 'infrastructure',
    errorType: 'NetworkError',
    re: /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|connection (?:refused|reset|closed|interrupted)|network (?:is )?unreachable|unable to connect|connection timed out|dns (?:error|failure)|temporary failure in name resolution)\b/i,
  },
  {
    category: 'infrastructure',
    errorType: 'OutOfMemory',
    re: /\b(?:out of memory|outofmemoryerror|heap out of memory|cannot allocate memory|std::bad_alloc|oom[- ]kill|memory exhausted|insufficient memory)\b/i,
  },
  {
    category: 'infrastructure',
    errorType: 'DiskFull',
    re: /\b(?:no space left on device|disk (?:is )?full|disk quota exceeded|write failed: no space)\b/i,
  },
  {
    category: 'infrastructure',
    errorType: 'ImageNotFound',
    re: /\b(?:image not found|no such image|manifest unknown|pull access denied|repository does not exist|unable to find image)\b/i,
  },
  {
    category: 'infrastructure',
    errorType: 'QuotaExceeded',
    re: /\b(?:quota exceeded|rate limit exceeded|too many requests|resource limit exceeded)\b/i,
  },

  // --- Timeout (§ 9.4: step interrupted because it ran too long) ---
  {
    category: 'timeout',
    errorType: 'Timeout',
    re: /(?:timed? out|timeout exceeded|timeout of \d+\s*ms exceeded|async callback was not invoked|execution timed out|job (?:was )?(?:canceled|cancelled) due to timeout|step timed out|seconds timeout for|timeout:\s*the step exceeded|TimeoutException)/i,
  },

  // --- Dependency (§ 9.4: package resolution or download) ---
  {
    category: 'dependency',
    errorType: 'DependencyResolution',
    re: /(?:\bnpm\s+(?:err!|error\b)|\bERESOLVE\b|\bENOTCACHED\b|\bcould not resolve (?:dependency|dependencies|artifact|package)|\bno matching distribution found|\bcould not find artifact|\bfailed to download (?:package|artifact|module)|\bpackage .* not found in|\bunable to resolve (?:dependency|package)|\bno required module provides|\bmodulenotfounderror\b)/i,
  },

  // --- Style (§ 9.4: lint or formatting tool) ---
  {
    category: 'style',
    errorType: 'LintError',
    re: /\b(?:eslint|prettier|golangci-lint|checkstyle|rubocop|flake8|pylint|tslint|stylelint|standardrb|lint(?:ing)? (?:failed|error))\b/i,
  },

  // --- Compile (§ 9.4: compiler or type checker) ---
  {
    category: 'compile',
    errorType: 'CompileError',
    re: /(?:error TS\d{3,4}|error\[E\d{3,4}\]|cannot find symbol|undefined reference to|compilation (?:failed|error)|compile error|build failed|expected (?:type|expression)|type error|undefined: [A-Za-z0-9_.]+|syntax error:|cannot use [A-Za-z0-9_.]+ \(.*\) as [A-Za-z0-9_.]+)/i,
  },

  // --- Config (§ 9.4: missing variable, invalid pipeline file) ---
  {
    category: 'config',
    errorType: 'ConfigError',
    re: /\b(?:ENOENT\b|no such file or directory|environment variable \S+ (?:is not set|not set|is missing)|missing required (?:variable|config|configuration|option)|invalid (?:yaml|json|toml|configuration|config file)|could not parse (?:config|configuration)|bitbucket-pipelines\.yml)\b/i,
  },

  // --- Test (§ 9.4: from a test report or a test pattern) ---
  {
    category: 'test',
    errorType: 'AssertionError',
    re: /(?:assertionerror|assert(?:ion)? failed|expected .+ to (?:equal|be|match|contain|have)|--- FAIL:|FAIL(?:ED)?\s+(?:test|spec)|✕|✗|\bfailing\b|\b\d+ (?:tests?|specs?) failed|panicked at|panic: |<testcase |<failure |=== RUN |FAILED tests\/|ERROR collecting |ImportError while importing test module|expect\(received\)|FAIL [A-Za-z0-9_./]+\.test\.[jt]sx?)/i,
  },
];

/** Canonical error type of each known type, derived from the table (no duplication). */
const CATEGORY_BY_ERROR_TYPE = new Map<string, Category>(
  PATTERNS.map((p) => [p.errorType, p.category]),
);

/** First matching entry of the ordered table, or undefined. */
function firstMatch(rawText: string): CategoryPattern | undefined {
  for (const pattern of PATTERNS) {
    if (pattern.re.test(rawText)) return pattern;
  }
  return undefined;
}

/**
 * Canonical error type of a raw block.
 * Known patterns first; then the first exception-like name in the text
 * (`TypeError`, `NullPointerException`…); otherwise `UnknownError`.
 */
export function detectErrorType(rawText: string): string {
  const matched = firstMatch(rawText);
  if (matched) return matched.errorType;
  const exception = /\b([A-Za-z_$][A-Za-z0-9_$]*(?:Error|Exception))\b/.exec(rawText);
  return exception ? exception[1] : 'UnknownError';
}

/**
 * Category of a raw block (§ 9.4).
 *
 * Order: the ordered pattern table, then the canonical type when it is known,
 * then the report/test heuristic, and finally `unknown`.
 */
export function categorize(input: CategorizeInput): Category {
  const matched = firstMatch(input.rawText);
  if (matched) return matched.category;

  const fromType = input.errorType ? CATEGORY_BY_ERROR_TYPE.get(input.errorType) : undefined;
  if (fromType) return fromType;

  if (input.source === 'report' || input.testName) return 'test';
  return 'unknown';
}
