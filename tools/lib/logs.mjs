// Realistic CI log renderers used by the sample dataset and the labeled corpus.
//
// Each renderer takes a small parameter object and returns the plain-text log a
// real runner prints (JUnit XML, pytest, Jest, Go, npm, pip, Maven, Gradle,
// ESLint, tsc, Docker). Volatile details (timestamp, duration, line number,
// UUID, port) are parameters so the corpus can build pairs of failures that
// differ only by those details — the normalization of § 9.2 must fold them
// back onto one signature.

/** pytest output (one failing test). */
export function pytestLog({ ts, file, test, message, line = 42, uuid }) {
  return [
    ts + ' pytest session start',
    'platform linux -- Python 3.12.3, pytest-8.3.2, pluggy-1.5.0',
    'rootdir: /opt/atlassian/pipelines/agent/build',
    'plugins: timeout-2.3.1, xdist-3.5.0',
    'collected 42 items',
    '',
    `${file}::${test} FAILED`,
    '',
    '=================================== FAILURES ===================================',
    `________________________________ ${test} __________________________________`,
    `    def ${test}():`,
    `>       ${message}`,
    `E       AssertionError: ${message}`,
    `E        request-id: ${uuid}`,
    `${file}:${line}: AssertionError`,
    '=========================== short test summary info ============================',
    `FAILED ${file}::${test} - AssertionError: ${message}`,
    '========================= 1 failed, 41 passed in 12.84s ===========================',
  ].join('\n');
}

/** pytest collection error (import failure). */
export function pytestImportLog({ ts, file, test, message, line = 12, uuid }) {
  return [
    ts + ' pytest session start',
    'platform linux -- Python 3.12.3, pytest-8.3.2, pluggy-1.5.0',
    'collected 42 items',
    '',
    '==================================== ERRORS ====================================',
    '______________________________ ERROR collecting ' + file + ' ______________________________',
    'ImportError while importing test module "' + file + '".',
    'E   ImportError: ' + message,
    'E   request-id: ' + uuid,
    file + ':' + line + ': in <module>',
    '    import ledger',
    '======= 1 error in 1.42s ========',
  ].join('\n');
}

/** pytest step timeout (the runner itself gives up). */
export function pytestTimeoutLog({ ts, file, test, seconds = 600, uuid }) {
  return [
    ts + ' pytest session start',
    'platform linux -- Python 3.12.3, pytest-8.3.2, pluggy-1.5.0',
    'plugins: timeout-2.3.1, xdist-3.5.0',
    'collected 42 items',
    '',
    file + '::' + test + ' ',
    '',
    '=== ' + seconds + ' seconds timeout for ' + file + '::' + test + ' ===',
    'E   Timeout: the step exceeded ' + seconds + ' seconds and was interrupted.',
    'E   request-id: ' + uuid,
    '========================= 1 timeout, 41 passed in 600.31s ========================',
  ].join('\n');
}

/** JUnit XML report produced by Gradle / Maven surefire. */
export function junitLog({ ts, classname, test, message, errorType = 'java.lang.AssertionError', file, line = 118, uuid }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${classname}" tests="37" failures="1" errors="0" skipped="0" time="9.412">`,
    `  <testcase classname="${classname}" name="${test}" time="0.081">`,
    `    <failure message="${message}" type="${errorType}">${errorType}: ${message}`,
    `request-id: ${uuid}`,
    `\tat com.payments.settlement.SettlementService.round(SettlementService.java:${line})`,
    `\tat ${classname}.${test}(${file}.java:${line})`,
    '    </failure>',
    '  </testcase>',
    '</testsuite>',
  ].join('\n');
}

/** JUnit XML report carrying a test timeout. */
export function junitTimeoutLog({ ts, classname, test, seconds = 300, uuid }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${classname}" tests="22" failures="1" errors="1" skipped="0" time="${seconds}.109">`,
    `  <testcase classname="${classname}" name="${test}" time="${seconds}.109">`,
    `    <error message="Test timed out after ${seconds} seconds" type="org.junit.jupiter.api.TimeoutException">`,
    'request-id: ' + uuid,
    `\tat ${classname}.${test}(${classname.split('.').pop()}.java:210)`,
    '    </error>',
    '  </testcase>',
    '</testsuite>',
  ].join('\n');
}

/** Go `go test` output. */
export function goLog({ ts, pkg, test, message, file, line = 64, uuid }) {
  return [
    ts + ' go test ' + pkg,
    '=== RUN   ' + test,
    '    ' + file + ':' + line + ': ' + message,
    '    request-id: ' + uuid,
    '--- FAIL: ' + test + ' (0.00s)',
    'FAIL',
    'FAIL\t' + pkg + '\t0.032s',
    'FAIL',
  ].join('\n');
}

/** Go build failure. */
export function goCompileLog({ ts, pkg, file, message, line = 31 }) {
  return [
    ts + ' go build ./...',
    '# ' + pkg,
    file + ':' + line + ':' + line + ': ' + message,
    'FAIL\t' + pkg + '\t0.412s',
  ].join('\n');
}

/** Jest output. */
export function jestLog({ ts, file, test, message, line = 27, uuid }) {
  return [
    ts + ' jest run',
    'FAIL ' + file,
    '  ● ' + test,
    '',
    '    ' + message,
    '    request-id: ' + uuid,
    '',
    '    at Object.<anonymous> (' + file + ':' + line + ':18)',
    '    at ' + test + ' (' + file + ':' + line + ':9)',
    '',
    'Test Suites: 1 failed, 11 passed, 12 total',
    'Tests:       1 failed, 218 passed, 219 total',
    'Time:        4.812 s',
  ].join('\n');
}

/** Jest test timeout. */
export function jestTimeoutLog({ ts, file, test, seconds = 5000, uuid }) {
  return [
    ts + ' jest run',
    'FAIL ' + file,
    '  ● ' + test,
    '',
    '   Exceeded timeout of ' + seconds + ' ms for a test.',
    '    request-id: ' + uuid,
    '',
    '    at ' + test + ' (' + file + ':' + (Number(seconds) / 1000 + 0.031).toFixed(3) + ')',
    '',
    'Test Suites: 1 failed, 11 passed, 12 total',
    'Tests:       1 failed, 218 passed, 219 total',
    'Time:        12.904 s',
  ].join('\n');
}

/** npm install / npm ci failure (package registry outage). */
export function npmLog({ ts, code, url, package: pkg }) {
  return [
    ts + ' npm ci',
    'npm error code ' + code,
    'npm error 404 Not Found - GET ' + url + ' - Not found',
    "npm error 404 '" + pkg + "' is not in this registry.",
    'npm error',
    'npm error A complete log of this run can be found in:',
    'npm error     /opt/atlassian/pipelines/agent/build/npm-debug-0.log',
    'npm error',
    'npm error ERR! code ' + code,
    'npm error ERR! 404 ' + pkg + " is not in this registry.",
  ].join('\n');
}

/** pip resolution failure. */
export function pipLog({ ts, pkg, version }) {
  return [
    ts + ' pip install -r requirements.txt',
    'Collecting ' + pkg,
    '  ERROR: Could not find a version that satisfies the requirement ' +
      pkg + '==' + version + ' (from versions: 1.0.0, 1.1.0)',
    'ERROR: No matching distribution found for ' + pkg + '==' + version,
    'ERROR: Could not install packages due to an OSError',
  ].join('\n');
}

/** Maven dependency resolution failure. */
export function mavenLog({ ts, pkg, version }) {
  return [
    ts + ' mvn -B verify',
    '[INFO] Scanning for projects...',
    '[INFO] --- maven-dependency-plugin:3.6.0:tree (default-cli) @ payments-api ---',
    '[ERROR] Failed to execute goal on project payments-api: Could not resolve dependencies',
    '[ERROR] ' + pkg + ':jar:' + version + ': Could not find artifact',
    '[ERROR]   in central (https://repo.maven.apache.org/maven2)',
    '[ERROR] -> [Help 1]',
    '[ERROR] After correcting the problems, you can resume the build with the command',
    '[ERROR]   mvn <args> -rf :payments-api',
  ].join('\n');
}

/** Gradle compilation failure. */
export function gradleLog({ ts, file, line = 74, message }) {
  return [
    ts + ' gradle compileJava',
    '> Task :compileJava FAILED',
    'FAILURE: Build failed with an exception.',
    '',
    '* What went wrong:',
    "Execution failed for task ':compileJava'.",
    '> Compilation failed; see the compiler error output for details.',
    '',
    file + ':' + line + ': error: ' + message,
    '  ' + line + ' errors',
    '',
    '* Try:',
    '> Run with --stacktrace option to get the stack trace.',
  ].join('\n');
}

/** ESLint report (single rule). */
export function eslintLog({ ts, file, line = 12, rule, message }) {
  return [
    ts + ' eslint .',
    '',
    file,
    '  ' + line + ':5  error  ' + message + '  ' + rule,
    '',
    '✖ 1 problem (1 error, 0 warnings)',
  ].join('\n');
}

/** TypeScript compiler error. */
export function tscLog({ ts, file, line = 42, code, message }) {
  return [
    ts + ' tsc --noEmit',
    file + '(' + line + ',18): error TS' + code + ': ' + message + '.',
    '',
    'Found 1 error in ' + file + ':' + line,
    '',
  ].join('\n');
}

/** Docker image pull failure. */
export function dockerLog({ ts, image, reason }) {
  return [
    ts + ' docker build',
    "Unable to find image '" + image + "' locally",
    reason,
    "docker: Error response from daemon: pull access denied for " + image +
      ", repository does not exist or may require 'docker login'",
    'See https://docs.docker.com/engine/reference/commandline/pull/',
  ].join('\n');
}

/** Generic CI failure with no recognized pattern (unknown category). */
export function unknownLog({ ts, message, uuid }) {
  return [
    ts + ' deploy manifests',
    'Build step failed.',
    'request-id: ' + uuid,
    message,
    'The step exited with code 1.',
  ].join('\n');
}

/** Connection refused to a database (the port is a parameter on purpose). */
export function dbConnectionLog({ ts, file, test, port = 5432, host = 'postgres.internal', uuid }) {
  return [
    ts + ' pytest session start',
    'platform linux -- Python 3.12.3, pytest-8.3.2, pluggy-1.5.0',
    'collected 18 items',
    '',
    file + '::' + test + ' FAILED',
    '',
    '=================================== FAILURES ===================================',
    'E       sqlalchemy.exc.OperationalError: (psycopg2.OperationalError)',
    'E       could not connect to server: Connection refused',
    'E       Is the server running on host "' + host + '" and accepting TCP/IP connections on port ' + port + '?',
    'E       request-id: ' + uuid,
    '=========================== short test summary info ============================',
    'FAILED ' + file + '::' + test + ' - OperationalError',
    '========================= 1 failed, 17 passed in 6.208s ===========================',
  ].join('\n');
}

/** Builds the log of a corpus member from its descriptor. */
export function buildLog(descriptor) {
  const builders = {
    pytest: pytestLog,
    'pytest-import': pytestImportLog,
    'pytest-timeout': pytestTimeoutLog,
    junit: junitLog,
    'junit-timeout': junitTimeoutLog,
    go: goLog,
    'go-compile': goCompileLog,
    jest: jestLog,
    'jest-timeout': jestTimeoutLog,
    npm: npmLog,
    pip: pipLog,
    maven: mavenLog,
    gradle: gradleLog,
    eslint: eslintLog,
    tsc: tscLog,
    docker: dockerLog,
    unknown: unknownLog,
    db: dbConnectionLog,
  };
  const build = builders[descriptor.kind];
  if (!build) throw new Error('unknown log kind: ' + descriptor.kind);
  return build(descriptor);
}
