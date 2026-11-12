/**
 * The eight sample logs of the « Your error » panel — one per ecosystem.
 *
 * Every log is **fictional but realistic**: it is shaped exactly like the CI
 * output the parser of its ecosystem recognises (pytest short summary, jest
 * `FAIL … >` header, Go `--- FAIL:`, cargo `test result: FAILED`, .NET
 * `Failed X [ms]`, Maven surefire `[ERROR]` + JUnit XML, Docker daemon
 * failure, npm 401). No real secret lives here: the tokens the masking step
 * must catch are **built at runtime** (the repository guard rejects literal
 * keys, even fake ones), and no URL is used beyond the two origins the
 * published bundle already contains (`registry.npmjs.org`, `docs.docker.com`).
 */

/** One sample: a stable id (also the i18n key `erreur.sample.<id>`) + text. */
export interface ErrorSample {
  id: string;
  text: string;
}

/** Fake npm token, assembled at runtime so no literal secret is committed. */
const NPM_TOKEN = ['npm', 'Q7xK2mZ9pR4vL8nW3jT6yB1cF5hD0gA7sE2u'].join('_');

/** Fake bearer token for the Docker registry example, built at runtime. */
const BEARER_TOKEN = ['tok', 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV'].join('-');

/** The fake tokens, exported so the tests can assert masking catches them. */
export const FAKE_TOKENS = { npm: NPM_TOKEN, bearer: BEARER_TOKEN };

/** Maven + JUnit XML: surefire summary and an XML `<failure>` block. */
const MAVEN = [
  '[INFO] --- maven-surefire-plugin:3.2.5:test (default-test) @ payments-api ---',
  '[INFO] Running com.payments.RefundServiceTest',
  '[ERROR] Tests run: 14, Failures: 1, Errors: 0, Skipped: 2, Time elapsed: 3.41 s <<< FAILURE!',
  '[ERROR] Failures:',
  '[ERROR]   RefundServiceTest.shouldRefundFullAmount:87 expected: <50.00> but was: <49.99>',
  '[INFO]',
  '[ERROR] Tests run: 14, Failures: 1, Errors: 0, Skipped: 2',
  '[INFO]',
  '<testcase name="shouldRefundFullAmount" classname="com.payments.RefundServiceTest" time="0.214">',
  '  <failure message="expected: &lt;50.00&gt; but was: &lt;49.99&gt;" type="java.lang.AssertionError">',
  'java.lang.AssertionError: expected: <50.00> but was: <49.99>',
  '\tat org.junit.Assert.fail(Assert.java:89)',
  '\tat com.payments.RefundServiceTest.shouldRefundFullAmount(RefundServiceTest.java:87)',
  '  </failure>',
  '</testcase>',
  '[ERROR] BUILD FAILURE',
].join('\n');

/** pytest: failure section plus the short test summary. */
const PYTEST = [
  '============================= test session starts ==============================',
  'collected 44 items',
  '',
  'tests/test_checkout.py ..................................              [ 79%]',
  'tests/test_refunds.py F...                                              [100%]',
  '',
  '================================== FAILURES ===================================',
  '__________________________ test_refund_exceeds_balance __________________________',
  '',
  '    def test_refund_exceeds_balance():',
  '        order = make_order(total_cents=5000)',
  '>       refund(order, cents=7500)',
  'E       AssertionError: refund of 7500 cents exceeds the balance of 5000',
  'E       Traceback (most recent call last):',
  'E         File "tests/test_refunds.py", line 31, in test_refund_exceeds_balance',
  'E           refund(order, cents=7500)',
  'E         File "payments/refunds.py", line 88, in refund',
  'E           raise AssertionError(message)',
  '',
  'tests/test_refunds.py:31: AssertionError',
  '=========================== short test summary info ============================',
  'FAILED tests/test_refunds.py::test_refund_exceeds_balance - AssertionError: refund of 7500 cents exceeds the balance of 5000',
  '=============================== 1 failed, 43 passed =============================',
].join('\n');

/** jest/vitest: FAIL header, stack frames, summary counts. */
const JEST = [
  ' FAIL  src/pricing/tax.test.ts > tax > applies the reduced rate for books',
  'AssertionError: expected 5.5 to be 2.1',
  'at taxRateFor (src/pricing/tax.ts:42:11)',
  'at src/pricing/tax.test.ts:18:24',
  '',
  ' Test Files  1 failed | 6 passed (7)',
  '      Tests  1 failed | 84 passed (85)',
  '   Duration  4.31s',
].join('\n');

/** Go: go test output with a failing test. */
const GO = [
  '=== RUN   TestCartTotal',
  '    cart_test.go:47: total mismatch: got 12.50 EUR, want 10.00 EUR',
  '--- FAIL: TestCartTotal (0.02s)',
  'FAIL',
  'FAIL\tpayments/cart\t0.312s',
  'FAIL',
].join('\n');

/** Rust: cargo test output with a panic block. */
const RUST = [
  'running 12 tests',
  'test tests::test_vat ... ok',
  'test tests::test_euro_rounding ... FAILED',
  '',
  'failures:',
  '',
  '---- tests::test_euro_rounding stdout ----',
  "thread 'tests::test_euro_rounding' panicked at src/money.rs:88:5:",
  'assertion `left == right` failed: rounding 2.675 EUR to cents',
  '  left: 267',
  ' right: 268',
  '',
  'failures:',
  '    tests::test_euro_rounding',
  '',
  'test result: FAILED. 11 passed; 1 failed; 0 ignored; 0 measured',
].join('\n');

/** .NET: vstest output with a failed xUnit test. */
const DOTNET = [
  'Microsoft (R) Test Execution Command Line Tool Version 17.9.0',
  'Starting test execution, please wait...',
  '',
  '  Failed PaymentFeeTests.ConvertsCurrency [32 ms]',
  '  Error Message:',
  '   Assert.Equal() Failure: Values differ',
  '  Expected: 1.20',
  '  Actual:   1.19',
  '  Stack Trace:',
  '     at PaymentFeeTests.ConvertsCurrency() in /_/tests/PaymentFeeTests.cs:line 24',
  '',
  'Failed!  - Failed:     1, Passed:    18, Skipped:     0, Total:    19',
].join('\n');

/** Docker/network: daemon unreachable and pull timeout — infrastructure. */
const DOCKER = [
  'Step 3/9 : RUN docker build -t payments-api:ci .',
  'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
  'Is the docker daemon running?',
  // No external URL here on purpose: the published bundle must keep the exact
  // set of origins `site/test/bundle.test.mjs` allows, so the fictional
  // registry appears as a bare host (as Docker prints it in some errors).
  `+ curl -H "authorization: Bearer ${BEARER_TOKEN}" internal-registry:443/v2/payments/manifests/ci`,
  'curl: (7) Failed to connect to internal-registry port 443: Connection refused',
  'Error response from daemon: Get "internal-registry:443/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded)',
  'ETIMEDOUT: build stage "pull base image" failed after 120s',
  'See https://docs.docker.com/engine/reference/commandline/build/ for the build reference',
].join('\n');

/** npm: 401 on publish with a leaked token — masking catches it. */
const NPM = [
  `npm ERR! code E401`,
  `npm ERR! 401 Unauthorized - PUT https://registry.npmjs.org/@acme%2fpayments-sdk`,
  `npm ERR! 401 Invalid token found in .npmrc: //registry.npmjs.org/:_authToken=${NPM_TOKEN}`,
  `npm ERR! 401`,
  `npm ERR! 401 The token was rejected by the registry: you are not authenticated.`,
  `npm ERR! A complete log of this run can be found in: /home/runner/.npm/_logs/build-debug-0.log`,
  `npm ERR! node v20.11.1`,
  `npm ERR! npm  v10.2.4`,
].join('\n');

/** The eight samples, in the order the panel displays them. */
export const SAMPLES: ErrorSample[] = [
  { id: 'maven', text: MAVEN },
  { id: 'pytest', text: PYTEST },
  { id: 'jest', text: JEST },
  { id: 'go', text: GO },
  { id: 'rust', text: RUST },
  { id: 'dotnet', text: DOTNET },
  { id: 'docker', text: DOCKER },
  { id: 'npm', text: NPM },
];
