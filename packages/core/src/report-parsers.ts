/**
 * Test report parsers (§ 9.1).
 *
 * The universal entry (CI-16) accepts any CI: pytest, jest/vitest, Go, Rust,
 * .NET, Gradle/Kotest. Each parser turns a raw log into `FailedTestCase`s, so
 * the extraction can expose a `testName` — the key the flakiness detector needs
 * (§ 10.1).
 *
 * The parsers are deliberately narrow: they recognise the *report* markers of
 * one ecosystem, never the noise of a build log. A parser that stays silent
 * lets the log-pattern path (§ 9.1) do its job, which keeps compile, style and
 * dependency failures categorised exactly as before.
 */

import { stripAnsi } from './normalize.js';
import {
  collectBlock,
  contentLines,
  linesAbove,
  neutralizeAngleNumbers,
  shortKey,
  stackOf,
  stripLocation,
  toLines,
} from './report-shared.js';
import type { FailedTestCase } from './types.js';

/** A parser for one ecosystem: recognise the report, list the failed tests. */
export interface ReportParser {
  /** Ecosystem name (English — the code and the tests are in English). */
  ecosystem: string;
  /** True when the log carries this ecosystem's report markers. */
  detect(text: string): boolean;
  /** Failed test cases of the report (empty when the report holds none). */
  parse(text: string): FailedTestCase[];
}

// ---------------------------------------------------------------------------
// pytest
// ---------------------------------------------------------------------------

/** "FAILED path/to/test.py::test_name - message" (pytest short summary). */
const PYTEST_SUMMARY = /^FAILED\s+(\S+)\s+-\s*(.+)$/;
/** "____ test_name ____" (pytest failure section). */
const PYTEST_SECTION = /^_{3,}\s*(.+?)\s*_{3,}$/;
/** "E   AssertionError: ..." (pytest error detail). */
const PYTEST_ERROR_LINE = /^E\s+\S/;
/** "tests/test_x.py:42: AssertionError" (pytest location line). */
const PYTEST_LOCATION = /^[\w./\\-]+\.[a-z]+:\d+:\s*\S/;

/** Build a pytest case from the lines of its failure section. */
function pytestCase(name: string, detail: string[]): FailedTestCase {
  const lines = detail.map((line) => line.trim());
  const error = lines.find((line) => PYTEST_ERROR_LINE.test(line));
  const location = lines.find((line) => PYTEST_LOCATION.test(line));
  const raw = error ?? location ?? '';
  const message = stripLocation(raw.replace(/^E\s+/, '')).trim();
  return {
    name,
    message: message || `test failed: ${name}`,
    stack: stackOf(lines.filter((line) => line !== raw)),
  };
}

/** Split a pytest log into its failure sections. */
function pytestSections(lines: string[]): { name: string; detail: string[] }[] {
  const sections: { name: string; detail: string[] }[] = [];
  let current: { name: string; detail: string[] } | undefined;
  for (const line of lines) {
    const header = PYTEST_SECTION.exec(line);
    if (header) {
      if (current) sections.push(current);
      current = { name: header[1].trim(), detail: [] };
      continue;
    }
    if (current) current.detail.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

/** The "E" detail lines of a log that carries no per-test section. */
function pytestErrorLines(lines: string[]): string[] {
  return contentLines(lines)
    .filter((line) => PYTEST_ERROR_LINE.test(line))
    .map((line) => line.replace(/^E\s+/, '').trim());
}

/** Parse a pytest log into failed test cases. */
function parsePytest(text: string): FailedTestCase[] {
  const lines = toLines(text);
  const sections = pytestSections(lines);
  const summary = lines
    .map((line) => PYTEST_SUMMARY.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  if (summary.length === 0) {
    return sections.map((section) => pytestCase(section.name, section.detail));
  }
  const errorLines = pytestErrorLines(lines);
  return summary.map((match) => {
    const name = match[1];
    const section = sections.find((item) => shortKey(item.name) === shortKey(name));
    return { name, message: match[2].trim(), stack: stackOf(section ? section.detail : errorLines) };
  });
}

const pytest: ReportParser = {
  ecosystem: 'pytest',
  detect: (text) =>
    /^=+\s*(?:FAILURES|ERRORS)\s*=+$/m.test(text) ||
    /short test summary info/i.test(text) ||
    /^FAILED\s+\S+::\S+/m.test(text) ||
    /^_{3,}\s+.+\s+_{3,}$/m.test(text),
  parse: parsePytest,
};

// ---------------------------------------------------------------------------
// jest / vitest
// ---------------------------------------------------------------------------

/** "● suite > test" (jest), "✕ suite > test" (jest and vitest). */
const JEST_NAME = /^\s*[●✕✗×]\s+(.+)$/;
/** "FAIL  src/foo.test.ts > suite > test" (vitest). */
const VITEST_NAME = /^\s*FAIL\s+\S+\s+>\s+(.+)$/;
/** A stack frame of a jest report ("    at fn (file:line:col)"). */
const JEST_FRAME = /^at\s/;

/** Test name of a jest/vitest failure line, or undefined. */
function jestName(line: string): string | undefined {
  const marker = JEST_NAME.exec(line);
  if (marker) return marker[1].trim();
  const vitest = VITEST_NAME.exec(line);
  if (vitest) return vitest[1].trim();
  return undefined;
}

/** True when the line starts another jest failure or the report summary. */
function jestStop(line: string): boolean {
  return (
    jestName(line) !== undefined ||
    /^\s*FAIL\s/.test(line) ||
    /^\s*(?:Test Suites:|Tests:|Snapshots:|Time:|Ran all test suites)/.test(line)
  );
}

/** Build a jest case from the lines that follow its failure header. */
function jestCase(name: string, detail: string[]): FailedTestCase {
  const frames = detail.filter((line) => JEST_FRAME.test(line));
  const prose = contentLines(detail).filter((line) => !JEST_FRAME.test(line));
  const message = prose[0] ?? frames[0] ?? `test failed: ${name}`;
  const stack = [...prose.slice(1), ...frames].join('\n');
  return { name, message: message.trim(), stack: stack || undefined };
}

/** Parse a jest or vitest log into failed test cases. */
function parseJest(text: string): FailedTestCase[] {
  const lines = toLines(text);
  const cases: FailedTestCase[] = [];
  for (let i = 0; i < lines.length; i++) {
    const name = jestName(lines[i]);
    if (!name) continue;
    const block = collectBlock(lines, i + 1, jestStop);
    cases.push(jestCase(name, block.lines));
    i = block.next - 1;
  }
  return cases;
}

const jest: ReportParser = {
  ecosystem: 'jest',
  detect: (text) => {
    const hasHeader = /^\s*FAIL\s+\S/m.test(text);
    const hasSummary = /^\s*Tests?:?\s+\d+\s+failed/m.test(text);
    if (!hasHeader && !hasSummary) return false;
    return /^\s*[●✕✗×]\s+\S/m.test(text) || /^\s*FAIL\s+\S+\s+>\s/m.test(text);
  },
  parse: parseJest,
};

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

/** "--- FAIL: TestName (0.00s)" (go test). */
const GO_FAIL = /^\s*---\s+FAIL:\s+(\S+)/;
/** "internal/ledger/ledger.go:64: runtime error: ..." (go test detail). */
const GO_LOCATION = /^[\w./\\-]+\.[a-z]+:\d+:/;

/** True when the line starts another go test case (markers sit at column 0). */
function goStop(line: string): boolean {
  return /^(?:=== RUN|=== CONT|=== PAUSE|--- FAIL|--- PASS|FAIL\b|PASS\b|ok\s)/.test(line);
}

/** Build a go case from the lines that follow its "--- FAIL" header. */
function goCase(name: string, detail: string[]): FailedTestCase {
  const lines = contentLines(detail);
  const raw = lines.find((line) => GO_LOCATION.test(line)) ?? lines[0] ?? '';
  return { name, message: stripLocation(raw).trim() || `test failed: ${name}`, stack: stackOf(lines) };
}

/** Parse a go test log into failed test cases. */
function parseGo(text: string): FailedTestCase[] {
  const lines = toLines(text);
  const cases: FailedTestCase[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = GO_FAIL.exec(lines[i]);
    if (!match) continue;
    // Go writes the test output *above* its "--- FAIL:" marker, and a panic
    // trace below it: read both directions. The marker itself is kept in the
    // stack, so the categorizer still sees the evidence of a test failure.
    const above = linesAbove(lines, i);
    const after = collectBlock(lines, i + 1, goStop).lines;
    cases.push(goCase(match[1], [lines[i].trim(), ...above, ...after]));
  }
  return cases;
}

const go: ReportParser = {
  ecosystem: 'go',
  detect: (text) => /^\s*---\s+FAIL:/m.test(text),
  parse: parseGo,
};

// ---------------------------------------------------------------------------
// Rust (cargo test)
// ---------------------------------------------------------------------------

/** "---- tests::test_name stdout ----" (cargo test). */
const RUST_BLOCK = /^----\s+(.+?)\s+(?:stdout|stderr)\s+----$/;

/** True when the line starts another rust failure block or the run summary. */
function rustStop(line: string): boolean {
  return /^(?:----\s|failures:|test result:)/.test(line);
}

/** Build a rust case from the lines that follow its "---- name stdout ----". */
function rustCase(name: string, detail: string[]): FailedTestCase {
  const lines = contentLines(detail);
  const panicAt = lines.findIndex((line) => /panicked at/.test(line));
  const raw = (panicAt >= 0 ? lines[panicAt + 1] : lines[0]) ?? '';
  return { name, message: raw.trim() || `test failed: ${name}`, stack: stackOf(lines) };
}

/** Parse a cargo test log into failed test cases. */
function parseRust(text: string): FailedTestCase[] {
  const lines = toLines(text);
  const cases: FailedTestCase[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = RUST_BLOCK.exec(lines[i]);
    if (!match) continue;
    const block = collectBlock(lines, i + 1, rustStop);
    cases.push(rustCase(match[1], block.lines));
    i = block.next - 1;
  }
  return cases;
}

const rust: ReportParser = {
  ecosystem: 'rust',
  detect: (text) =>
    /^test result: FAILED/m.test(text) || /^----\s+\S+\s+stdout\s+----$/m.test(text),
  parse: parseRust,
};

// ---------------------------------------------------------------------------
// .NET (xUnit and NUnit)
// ---------------------------------------------------------------------------

/** "Failed TestName [42 ms]" (xUnit). */
const XUNIT_NAME = /^\s*Failed\s+(.+?)\s*(?:\[[\d.,]+\s*ms\])?\s*$/;
/** "1) Failed : Tests.Foo" (NUnit). */
const NUNIT_NAME = /^\s*\d+\)\s*Failed\s*:\s*(.+)$/;
/** "X TestName [42 ms]" (NUnit legacy runner). */
const NUNIT_LEGACY_NAME = /^\s*X\s+(.+?)\s*(?:\[[\d.,]+\s*ms\])?\s*$/;

/** True when the line starts another test or the run summary. */
function dotnetStop(line: string): boolean {
  return (
    /^(?:Failed!|Passed!|Skipped!|Total tests:|Test Run)/.test(line) ||
    XUNIT_NAME.test(line) ||
    NUNIT_NAME.test(line) ||
    NUNIT_LEGACY_NAME.test(line)
  );
}

/** Build a .NET case from the lines that follow its failure header. */
function dotnetCase(name: string, detail: string[]): FailedTestCase {
  const lines = contentLines(detail);
  const messageAt = lines.findIndex((line) => /^Error Message:/i.test(line));
  const raw = (messageAt >= 0 ? lines[messageAt + 1] : lines[0]) ?? '';
  return { name, message: raw.trim() || `test failed: ${name}`, stack: stackOf(lines) };
}

/** Parse a .NET test log into failed test cases. */
function parseDotNet(text: string): FailedTestCase[] {
  const lines = toLines(text);
  const cases: FailedTestCase[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = XUNIT_NAME.exec(lines[i]) ?? NUNIT_NAME.exec(lines[i]) ?? NUNIT_LEGACY_NAME.exec(lines[i]);
    const name = match?.[1]?.trim();
    if (!name) continue;
    const block = collectBlock(lines, i + 1, dotnetStop);
    cases.push(dotnetCase(name, block.lines));
    i = block.next - 1;
  }
  return cases;
}

const dotnet: ReportParser = {
  ecosystem: 'dotnet',
  detect: (text) =>
    /^\s*Failed!\s+-/m.test(text) ||
    /^Total tests:/m.test(text) ||
    /^\s*\d+\)\s*Failed\s*:/m.test(text) ||
    /^\s*Failed\s+\S+\s+\[[\d.,]+\s*ms\]/m.test(text) ||
    /^\s*X\s+\S.*\[[\d.,]+\s*ms\]/m.test(text),
  parse: parseDotNet,
};

// ---------------------------------------------------------------------------
// Gradle and Kotest
// ---------------------------------------------------------------------------

/** "com.acme.FooTest > testBar() FAILED" (gradle, kotest). */
const GRADLE_NAME = /^([\w.$]+)\s+>\s+(.+?)\s+FAILED\s*$/;
/** "❌ io.acme.SampleTest > should work" (kotest). */
const KOTEST_NAME = /^\s*❌\s+(.+)$/;

/** True when the line starts another failure or leaves the detail (not indented). */
function gradleStop(line: string): boolean {
  return GRADLE_NAME.test(line) || KOTEST_NAME.test(line) || /^\S/.test(line);
}

/** Build a gradle case from the lines that follow its failure header. */
function gradleCase(
  name: string,
  classname: string | undefined,
  detail: string[],
): FailedTestCase {
  const lines = contentLines(detail).map((line) => neutralizeAngleNumbers(line));
  return {
    name,
    classname,
    message: lines[0]?.trim() || `test failed: ${name}`,
    stack: stackOf(lines),
  };
}

/** Parse a gradle or kotest log into failed test cases. */
function parseGradle(text: string): FailedTestCase[] {
  const lines = toLines(text);
  const cases: FailedTestCase[] = [];
  for (let i = 0; i < lines.length; i++) {
    const gradle = GRADLE_NAME.exec(lines[i]);
    const kotest = KOTEST_NAME.exec(lines[i]);
    const classname = gradle?.[1];
    const method = gradle?.[2] ?? kotest?.[1];
    if (!method) continue;
    const block = collectBlock(lines, i + 1, gradleStop);
    cases.push(gradleCase(classname ? `${classname} ${method}` : method.trim(), classname, block.lines));
    i = block.next - 1;
  }
  return cases;
}

const gradle: ReportParser = {
  ecosystem: 'gradle',
  detect: (text) =>
    /^> Task :(?:test|[A-Za-z]*Test)\s+FAILED/m.test(text) ||
    /^\S+\s+>\s+\S+.*\s+FAILED\s*$/m.test(text) ||
    /^\s*❌\s+\S/m.test(text) ||
    /There were failing tests/.test(text),
  parse: parseGradle,
};

// ---------------------------------------------------------------------------
// French reports
// ---------------------------------------------------------------------------

/** "ÉCHEC : tests/test_x.py::test_y" (French CI log). */
const FRENCH_FAIL = /^\s*(?:ÉCHEC|ECHEC)\s*[:\-–]?\s*(.+)$/m;
/** "Assertion échouée : ..." (French assertion failure). */
const FRENCH_ASSERT = /^\s*(?:Assertion échouée|Erreur d'assertion)\s*[:\-–]?\s*(.+)$/im;

/** Split a French failure line into a test name and a message. */
function frenchCase(text: string): FailedTestCase {
  const [head, ...rest] = text.split(/\s+-\s+/);
  const name = (head ?? text).trim();
  const message = rest.length > 0 ? rest.join(' - ').trim() : name;
  return { name, message };
}

/** Parse a French failure log into failed test cases. */
function parseFrench(text: string): FailedTestCase[] {
  const cases: FailedTestCase[] = [];
  for (const line of toLines(text)) {
    const match = FRENCH_FAIL.exec(line) ?? FRENCH_ASSERT.exec(line);
    if (match?.[1]) cases.push(frenchCase(match[1]));
  }
  return cases;
}

const french: ReportParser = {
  ecosystem: 'french',
  detect: (text) => FRENCH_FAIL.test(text) || FRENCH_ASSERT.test(text),
  parse: parseFrench,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Every ecosystem parser, in detection order. */
export const REPORT_PARSERS: ReportParser[] = [pytest, jest, go, rust, dotnet, gradle, french];

/**
 * Parse the failed test cases of a test report.
 *
 * Every parser that recognises its own markers contributes, so a log that
 * mixes two ecosystems yields the failures of both. Cases are deduplicated by
 * ecosystem and test name, so a report that both details and summarises a
 * failure yields one case.
 *
 * Residual ANSI colours are removed once, up front: a coloured CI log must be
 * read exactly like a plain one.
 */
export function parseTestReport(text: string): FailedTestCase[] {
  if (!text) return [];
  const cleaned = stripAnsi(text);
  const seen = new Set<string>();
  const cases: FailedTestCase[] = [];
  for (const parser of REPORT_PARSERS) {
    if (!parser.detect(cleaned)) continue;
    for (const testCase of parser.parse(cleaned)) {
      const key = `${parser.ecosystem}:${testCase.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push(testCase);
    }
  }
  return cases;
}
