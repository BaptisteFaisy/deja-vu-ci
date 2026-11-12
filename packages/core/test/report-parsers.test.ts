/**
 * Report parsers: one test block per ecosystem (§ 9.1, CI-16).
 *
 * Each parser must (1) recognise its own report, (2) yield a `FailedTestCase`
 * with a usable `testName`, and (3) stay silent on a build log that is not a
 * test report — otherwise a compile or dependency failure would be recategorised
 * as a test failure.
 */

import { describe, expect, it } from 'vitest';
import { extractErrorBlocks } from '../src/extract.js';
import { parseTestReport, REPORT_PARSERS } from '../src/report-parsers.js';

// ---------------------------------------------------------------------------
// Fixtures: one real report per ecosystem
// ---------------------------------------------------------------------------

const PYTEST = [
  '============================= test session starts ==============================',
  'collected 42 items',
  '',
  'tests/test_settlement.py::test_rounding FAILED',
  '',
  '=================================== FAILURES ===================================',
  '_____________________________ test_rounding ______________________________',
  '    def test_rounding():',
  '>       assert 2.675 == 2.68',
  'E       AssertionError: assert 2.675 == 2.68',
  'tests/test_settlement.py:42: AssertionError',
  '=========================== short test summary info ============================',
  'FAILED tests/test_settlement.py::test_rounding - AssertionError: assert 2.675 == 2.68',
  '========================= 1 failed, 41 passed in 12.84s =========================',
].join('\n');

const PYTEST_COLLECTION_ERROR = [
  '==================================== ERRORS ====================================',
  '______________________ ERROR collecting tests/test_payout.py ______________________',
  'ImportError while importing test module "tests/test_payout.py".',
  'E   ImportError: cannot import name PayoutClient from ledger',
  'tests/test_payout.py:12: in <module>',
  '    import ledger',
  '======= 1 error in 1.42s ========',
].join('\n');

const JEST = [
  'FAIL src/checkout/total.test.js',
  '  ● checkout > totals the basket',
  '',
  '    expect(received).toBe(expected) // expected 42 but received 41',
  '',
  '      at Object.<anonymous> (src/checkout/total.test.js:27:18)',
  '',
  'Test Suites: 1 failed, 11 passed, 12 total',
  'Tests:       1 failed, 218 passed, 219 total',
].join('\n');

const VITEST = [
  ' FAIL  src/round.test.ts > rounding > rounds half to even',
  'AssertionError: expected 2.675 to be 2.68',
  ' ❯ src/round.test.ts:12:21',
  '',
  ' Tests  1 failed | 41 passed (42)',
].join('\n');

const GO = [
  '=== RUN   TestPostLedgerEntry',
  '    internal/ledger/ledger.go:64: runtime error: index out of range [3] with length 3',
  '--- FAIL: TestPostLedgerEntry (0.00s)',
  'FAIL',
  'FAIL\tgithub.com/payments/ledger/internal/ledger\t0.032s',
  'FAIL',
].join('\n');

const RUST = [
  'running 3 tests',
  'test tests::test_rounding ... FAILED',
  '',
  'failures:',
  '',
  '---- tests::test_rounding stdout ----',
  "thread 'tests::test_rounding' panicked at src/rounding.rs:42:9:",
  'assertion `left == right` failed',
  '  left: 2.67',
  ' right: 2.68',
  '',
  'failures:',
  '    tests::test_rounding',
  '',
  'test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 3 finished in 0.00s',
].join('\n');

const XUNIT = [
  'Microsoft (R) Test Execution Command Line Tool Version 17.9.0',
  '  Failed Round_HalfEven [42 ms]',
  '  Error Message:',
  '   Assert.Equal() Failure',
  '   Expected: 2.68',
  '   Actual:   2.67',
  '  Stack Trace:',
  '     at Payments.RoundTests.Round_HalfEven() in /src/RoundTests.cs:line 42',
  '',
  'Failed!  - Failed:     1, Passed:     5, Skipped:     0, Total:     6',
].join('\n');

const NUNIT = [
  'NUnit Console Runner 3.16.0',
  '1) Failed : Payments.RoundTests.Round_HalfEven',
  '  Expected: 2.68',
  '  But was:  2.67',
  '  at Payments.RoundTests.Round_HalfEven() in /src/RoundTests.cs:line 42',
  'Failed!  - Failed:     1, Passed:     5, Skipped:     0, Total:     6, Duration: 42 ms',
].join('\n');

const GRADLE = [
  '> Task :compileJava',
  '> Task :test FAILED',
  '',
  'com.payments.settlement.AmountTest > testRoundingHalfEven() FAILED',
  '    org.opentest4j.AssertionFailedError: expected: <2.68> but was: <2.67>',
  '        at com.payments.settlement.AmountTest.testRoundingHalfEven(AmountTest.java:118)',
  '',
  '1 test completed, 1 failed',
].join('\n');

const KOTEST = [
  'io.kotest.engine.TestEngineLauncher',
  '❌ io.payments.RoundTest > rounds half to even',
  '    expected:<2.68> but was:<2.67>',
  '',
  'Tests 1 failed, 5 passed',
].join('\n');

const FRENCH = [
  '=== Exécution des tests ===',
  'ÉCHEC : tests/test_export.py::test_csv_columns - AssertionError: 3 colonnes attendues',
  'Assertion échouée : le solde ne tombe pas juste',
].join('\n');

/** Build logs that must NOT be mistaken for a test report. */
const NOT_A_REPORT: Record<string, string> = {
  'go build': [
    '# github.com/payments/ledger/internal/ledger',
    'internal/ledger/ledger.go:31:31: cannot use amount (variable of type float64) as int value',
    'FAIL\tgithub.com/payments/ledger/internal/ledger\t0.412s',
  ].join('\n'),
  'gradle compileJava': [
    '> Task :compileJava FAILED',
    'FAILURE: Build failed with an exception.',
    '* What went wrong:',
    "Execution failed for task ':compileJava'.",
    '> Compilation failed; see the compiler error output for details.',
    'src/main/java/LedgerClient.java:74: error: cannot find symbol: method amountOf(BigDecimal)',
  ].join('\n'),
  junit: [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuite name="com.payments.AmountTest" tests="37" failures="1">',
    '  <testcase classname="com.payments.AmountTest" name="testRounding" time="0.081">',
    '    <failure message="expected:<2.68> but was:<2.67>" type="java.lang.AssertionError">',
    '    </failure>',
    '  </testcase>',
    '</testsuite>',
  ].join('\n'),
  eslint: ['src/checkout/total.js', "  12:5  error  'basketTotal' is never used", '✖ 1 problem (1 error, 0 warnings)'].join('\n'),
  npm: ['npm error code E404', 'npm error 404 Not Found - GET https://registry.npmjs.org/@payments/ds'].join('\n'),
  pip: ['ERROR: No matching distribution found for payments-ledger-sdk==4.2.0'].join('\n'),
  tsc: ["src/api/amount.ts(42,18): error TS2322: Type 'string' is not assignable to type 'number'."].join('\n'),
  docker: ["docker: Error response from daemon: pull access denied for registry.internal/payments/api"].join('\n'),
  maven: ['[ERROR] Failed to execute goal on project payments-api: Could not resolve dependencies'].join('\n'),
};

/** The single case a fixture is expected to yield. */
function only(log: string) {
  const cases = parseTestReport(log);
  expect(cases.length).toBeGreaterThanOrEqual(1);
  return cases[0];
}

// ---------------------------------------------------------------------------

describe('report parsers — one ecosystem each', () => {
  it('recognises at least five ecosystems', () => {
    expect(REPORT_PARSERS.length).toBeGreaterThanOrEqual(5);
  });

  it('pytest: summary line gives the node id and the assertion message', () => {
    const testCase = only(PYTEST);
    expect(testCase.name).toBe('tests/test_settlement.py::test_rounding');
    expect(testCase.message).toBe('AssertionError: assert 2.675 == 2.68');
    expect(testCase.stack).toContain('tests/test_settlement.py:42: AssertionError');
  });

  it('pytest: a collection error is reported with its module', () => {
    const testCase = only(PYTEST_COLLECTION_ERROR);
    expect(testCase.name).toBe('ERROR collecting tests/test_payout.py');
    expect(testCase.message).toBe('ImportError: cannot import name PayoutClient from ledger');
  });

  it('jest: the describe path is the test name, the expectation the message', () => {
    const testCase = only(JEST);
    expect(testCase.name).toBe('checkout > totals the basket');
    expect(testCase.message).toBe('expect(received).toBe(expected) // expected 42 but received 41');
    expect(testCase.stack).toContain('at Object.<anonymous> (src/checkout/total.test.js:27:18)');
  });

  it('vitest: the FAIL header carries the suite path', () => {
    const testCase = only(VITEST);
    expect(testCase.name).toBe('rounding > rounds half to even');
    expect(testCase.message).toBe('AssertionError: expected 2.675 to be 2.68');
  });

  it('go: the failing test and the located runtime error', () => {
    const testCase = only(GO);
    expect(testCase.name).toBe('TestPostLedgerEntry');
    expect(testCase.message).toBe('runtime error: index out of range [3] with length 3');
    expect(testCase.stack).toContain('internal/ledger/ledger.go:64');
  });

  it('rust: the panicking test and the assertion detail', () => {
    const testCase = only(RUST);
    expect(testCase.name).toBe('tests::test_rounding');
    expect(testCase.message).toBe('assertion `left == right` failed');
    expect(testCase.stack).toContain('panicked at src/rounding.rs:42:9');
  });

  it('.NET xUnit: the test name and the Error Message section', () => {
    const testCase = only(XUNIT);
    expect(testCase.name).toBe('Round_HalfEven');
    expect(testCase.message).toBe('Assert.Equal() Failure');
    expect(testCase.stack).toContain('Stack Trace:');
  });

  it('.NET NUnit: the numbered failure and its first detail line', () => {
    const testCase = only(NUNIT);
    expect(testCase.name).toBe('Payments.RoundTests.Round_HalfEven');
    expect(testCase.message).toBe('Expected: 2.68');
  });

  it('gradle: class and method, angle-bracket diff neutralised', () => {
    const testCase = only(GRADLE);
    expect(testCase.name).toBe('com.payments.settlement.AmountTest testRoundingHalfEven()');
    expect(testCase.classname).toBe('com.payments.settlement.AmountTest');
    expect(testCase.message).toBe('org.opentest4j.AssertionFailedError: expected: <NUM> but was: <NUM>');
  });

  it('kotest: the ❌ marker carries the spec path', () => {
    const testCase = only(KOTEST);
    expect(testCase.name).toBe('io.payments.RoundTest > rounds half to even');
    expect(testCase.message).toBe('expected:<NUM> but was:<NUM>');
  });

  it('french logs: ÉCHEC and the translated assertion', () => {
    const cases = parseTestReport(FRENCH);
    expect(cases.map((c) => c.name)).toEqual([
      'tests/test_export.py::test_csv_columns',
      'le solde ne tombe pas juste',
    ]);
    expect(cases[0].message).toBe('AssertionError: 3 colonnes attendues');
    expect(cases[1].message).toBe('le solde ne tombe pas juste');
  });
});

describe('report parsers stay silent on build logs', () => {
  for (const [name, log] of Object.entries(NOT_A_REPORT)) {
    it(`does not fire on ${name}`, () => {
      expect(parseTestReport(log)).toEqual([]);
    });
  }
});

describe('extraction wires the report parsers in', () => {
  it('yields report blocks with a testName instead of a log tail', () => {
    const result = extractErrorBlocks({ stepLog: PYTEST });
    expect(result.source).toBe('report');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].testName).toBe('tests/test_settlement.py::test_rounding');
    expect(result.blocks[0].category).toBe('test');
    expect(result.blocks[0].errorType).toBe('AssertionError');
  });

  it('keeps an infrastructure failure inside a test as infrastructure', () => {
    const log = [
      '=================================== FAILURES ===================================',
      'E       sqlalchemy.exc.OperationalError: (psycopg2.OperationalError)',
      'E       could not connect to server: Connection refused',
      '=========================== short test summary info ============================',
      'FAILED tests/test_ledger.py::test_post - OperationalError',
    ].join('\n');
    const result = extractErrorBlocks({ stepLog: log });
    expect(result.source).toBe('report');
    expect(result.blocks[0].testName).toBe('tests/test_ledger.py::test_post');
    expect(result.blocks[0].category).toBe('infrastructure');
  });

  it('still prefers explicitly parsed test cases over the log', () => {
    const result = extractErrorBlocks({
      stepLog: PYTEST,
      testCases: [{ name: 'given#test', message: 'AssertionError: boom' }],
    });
    expect(result.source).toBe('report');
    expect(result.blocks[0].testName).toBe('given#test');
  });

  it('caps report blocks at three and counts the rest as dropped', () => {
    const many = Array.from(
      { length: 5 },
      (_, i) => `--- FAIL: TestNumber${i} (0.00s)\n    ledger.go:1: boom ${i}`,
    ).join('\n');
    const result = extractErrorBlocks({ stepLog: many });
    expect(result.source).toBe('report');
    expect(result.blocks).toHaveLength(3);
    expect(result.dropped).toBe(2);
  });

  it('leaves a non-report log on the log-pattern path', () => {
    const result = extractErrorBlocks({ stepLog: NOT_A_REPORT['gradle compileJava'] });
    expect(result.source).toBe('log');
    expect(result.blocks[0].category).toBe('compile');
    expect(result.blocks[0].testName).toBeUndefined();
  });
});

describe('robustness of the report parsers', () => {
  it('reads a jest report through residual ANSI colours', () => {
    const red = '\u001b[31m';
    const bold = '\u001b[1m';
    const reset = '\u001b[0m';
    const log = [
      `${red}FAIL${reset} src/checkout/total.test.js`,
      `  ${red}●${reset} ${bold}checkout > totals the basket${reset}`,
      '',
      `    ${red}expect(received).toBe(expected)${reset} // expected 42 but received 41`,
      '',
      '      at Object.<anonymous> (src/checkout/total.test.js:27:18)',
      '',
      'Tests:       1 failed, 218 passed',
    ].join('\n');
    const testCase = only(log);
    expect(testCase.name).toBe('checkout > totals the basket');
    expect(testCase.message).toBe('expect(received).toBe(expected) // expected 42 but received 41');
    const result = extractErrorBlocks({ stepLog: log });
    expect(result.source).toBe('report');
    expect(result.blocks[0].rawText).not.toContain('\u001b');
    expect(result.blocks[0].rawText).not.toContain('[31m');
  });

  it('reads a report whose lines end with CRLF', () => {
    const crlf = GO.replace(/\n/g, '\r\n');
    const testCase = only(crlf);
    expect(testCase.name).toBe('TestPostLedgerEntry');
    expect(testCase.message).toBe('runtime error: index out of range [3] with length 3');
    expect(extractErrorBlocks({ stepLog: crlf }).source).toBe('report');
  });

  it('keeps a multi-line failure readable: first line is the message, the rest the stack', () => {
    const log = [
      'FAIL src/a.test.js',
      '  ● suite > a long failure',
      '',
      '    Error: first line of the message',
      '    second line of the detail',
      '    third line of the detail',
      '',
      '      at Object.<anonymous> (src/a.test.js:3:1)',
      '',
      'Tests:       1 failed',
    ].join('\n');
    const testCase = only(log);
    expect(testCase.message).toBe('Error: first line of the message');
    expect(testCase.stack).toContain('second line of the detail');
    expect(testCase.stack).toContain('third line of the detail');
    expect(testCase.stack).toContain('at Object.<anonymous> (src/a.test.js:3:1)');
  });

  it('reads a log that mixes two ecosystems', () => {
    const names = parseTestReport(`${PYTEST}\n\n${GO}`).map((c) => c.name);
    expect(names).toContain('tests/test_settlement.py::test_rounding');
    expect(names).toContain('TestPostLedgerEntry');
  });

  it('does not report the same test twice when a log repeats it', () => {
    const cases = parseTestReport(`${GO}\n${GO}`);
    expect(cases.map((c) => c.name)).toEqual(['TestPostLedgerEntry']);
  });

  it('masks a secret carried by the report before it reaches a block', () => {
    // Built at runtime: no clear-text token ever sits in the repository.
    const token = ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_');
    const log = [
      'FAIL src/a.test.js',
      '  ● suite > leaks a token',
      '',
      `    Error: unauthorized with ${token}`,
      '',
      'Tests:       1 failed',
    ].join('\n');
    const result = extractErrorBlocks({ stepLog: log });
    expect(result.source).toBe('report');
    expect(result.blocks[0].rawText).not.toContain(token);
    expect(result.blocks[0].rawText).toContain('«[masqué:token]»');
  });

  it('leaves unicode test names intact', () => {
    const log = [
      'FAIL src/i18n.test.js',
      '  ● accents « çà et là » ✓ unicode 日本語',
      '',
      '    expect(received).toBe(expected)',
      '',
      'Tests:       1 failed',
    ].join('\n');
    expect(only(log).name).toBe('accents « çà et là » ✓ unicode 日本語');
  });
});
