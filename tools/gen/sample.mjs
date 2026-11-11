// Génère `data/sample/occurrences.json` : le jeu d'exemple rejouable (CI-11).
//
// 40 échecs sur 14 jours, plus les succès qui les expliquent, dans un dépôt
// fictif `payments-api` et deux dépôts voisins. Le jeu est écrit pour produire
// les quatre diagnostics du § 5 et les trois mouvements de statut du § 8 :
//
//   1. un test instable (17 échecs sur 9 branches, dont 3 succès au même
//      commit) → `flaky`, un seul ticket ;
//   2. une erreur corrigée par un commit (résolution confirmée) qui revient sur
//      une branche antérieure au correctif → `already-fixed` ;
//   3. la même erreur qui revient sur `main`, qui contient le correctif →
//      statut `regression` et ticket rouvert ;
//   4. une panne de registre de paquets sur 3 dépôts en 12 minutes →
//      `infrastructure` (épidémie, § 10.3) ;
//   5. douze erreurs jamais vues, dont les fichiers modifiés par la PR
//      apparaissent dans la pile → `new`.
//
// Usage : `node tools/gen/sample.mjs`.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLog } from '../lib/logs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const OUT = path.join(root, 'data', 'sample', 'occurrences.json');

/** Premier instant du jeu : 14 jours avant la fin de la fenêtre. */
const DAY0 = Date.parse('2026-11-01T07:00:00Z');
const DAY = 86_400_000;

/** ISO d'un jour du jeu, avec un décalage en minutes. */
function at(day, minute = 0) {
  return new Date(DAY0 + day * DAY + minute * 60_000).toISOString();
}

const FLAKY_TEST = 'com.payments.RefundLimiterTest#limitsRefundAmount';
const FIX_COMMIT = 'abc1234deadbeef';

/** Le test instable : même erreur, seuls l'horodatage et la ligne bougent. */
function flakyFailure(day, minute, branch, commit, author, line) {
  return {
    at: at(day, minute),
    repo: 'payments-api',
    branch,
    commit,
    author,
    step: 'gradle test',
    durationS: 96,
    buildUrl: `https://bitbucket.org/payments/payments-api/pipelines/results/${commit}`,
    outcome: 'failure',
    log: buildLog({
      kind: 'junit',
      ts: at(day, minute),
      classname: 'com.payments.RefundLimiterTest',
      test: 'limitsRefundAmount',
      message: 'expected:<100> but was:<0>',
      file: 'RefundLimiterTest',
      line,
      uuid: `d3b0c442-98fc-1c14-9afb-${commit.slice(0, 12)}`,
    }),
    expected: { category: 'test', testName: FLAKY_TEST },
  };
}

/** Un succès au même commit : la preuve d'instabilité du § 10.1. */
function sameCommitSuccess(day, minute, branch, commit) {
  return {
    at: at(day, minute),
    repo: 'payments-api',
    branch,
    commit,
    author: 'pipeline-retry',
    step: 'gradle test',
    durationS: 92,
    outcome: 'success',
  };
}

/** L'erreur du client HTTP, avant et après son correctif. */
function clientFailure(day, minute, branch, commit, author, containsCommits) {
  const entry = {
    at: at(day, minute),
    repo: 'payments-api',
    branch,
    commit,
    author,
    step: 'integration-tests',
    durationS: 140,
    outcome: 'failure',
    log: [
      `${at(day, minute)} ./gradlew integrationTest`,
      'com.payments.http.ClientException: token descriptor is null',
      '\tat com.payments.http.Client.refreshToken(Client.java:88)',
      '\tat com.payments.RefundService.charge(RefundService.java:41)',
      '\tat java.base/java.lang.Thread.run(Thread.java:840)',
    ].join('\n'),
  };
  if (containsCommits) entry.containsCommits = containsCommits;
  return entry;
}

/** Une panne de registre de paquets (épidémie d'infrastructure). */
function registryFailure(day, minute, repo, branch, commit, author) {
  return {
    at: at(day, minute),
    repo,
    branch,
    commit,
    author,
    step: 'install-dependencies',
    durationS: 18,
    outcome: 'failure',
    log: buildLog({
      kind: 'npm',
      ts: at(day, minute),
      code: 'ECONNREFUSED',
      url: 'https://registry.npmjs.org/@payments%2fsdk',
      package: '@payments/sdk',
    }),
    expected: { category: 'dependency', diagnostic: 'infrastructure' },
  };
}

/** Une erreur jamais vue, dont le fichier fautif est dans la PR. */
function newFailure(day, minute, spec) {
  return {
    at: at(day, minute),
    repo: spec.repo ?? 'payments-api',
    branch: spec.branch,
    commit: spec.commit,
    author: spec.author,
    step: spec.step,
    durationS: spec.durationS ?? 55,
    prId: spec.prId,
    outcome: 'failure',
    log: spec.log,
    changedFiles: spec.changedFiles,
    expected: { category: spec.category, diagnostic: spec.diagnostic ?? 'new' },
  };
}

const FLAKY_BRANCHES = [
  'feature/refund-limit', 'feature/payout-window', 'feature/ledger-export',
  'feature/fx-rounding', 'feature/settlement-batch', 'feature/fee-schedule',
  'feature/audit-trail', 'feature/idempotency-key', 'main',
];

/** Les 17 échecs du test instable, répartis sur 14 jours et 9 branches. */
function flakyRuns() {
  const runs = [];
  const schedule = [
    [0, 10, 41], [1, 20, 57], [2, 30, 41], [3, 15, 63], [4, 45, 57],
    [5, 25, 41], [6, 50, 72], [7, 35, 57], [8, 12, 41], [9, 40, 63],
    [10, 55, 57], [11, 18, 41], [12, 33, 72], [12, 190, 41], [13, 22, 57],
    [13, 60, 63], [13, 120, 57],
  ];
  // Les trois premiers jours, l'étape est relancée et passe au même commit.
  const retried = [0, 1, 2];
  schedule.forEach(([day, minute, line], index) => {
    const branch = FLAKY_BRANCHES[index % FLAKY_BRANCHES.length];
    const commit = `${index.toString(16).padStart(2, '0')}f1aky${String(index).padStart(4, '0')}`;
    const failure = flakyFailure(day, minute, branch, commit, `dev-${(index % 5) + 1}`, line);
    if (index >= 4) failure.expected.diagnostic = 'flaky';
    runs.push(failure);
    if (retried.includes(index)) runs.push(sameCommitSuccess(day, minute + 6, branch, commit));
  });
  return runs;
}

/** Les douze erreurs jamais vues : une signature chacune (§ 20, point 4). */
const FRESH_FAILURE_CASES = [
    {
      day: 3, minute: 40, branch: 'feature/refund-window', commit: 'new0001aaaaaaa', author: 'amal',
      step: 'gradle test', prId: 431, changedFiles: ['src/main/java/com/payments/refund/Limiter.java'],
      category: 'test',
      log: [
        `${at(3, 40)} ./gradlew test`,
        'com.payments.refund.LimiterTest > rejectsOverLimit FAILED',
        '    java.lang.AssertionError: limit should reject 120 EUR',
        '\tat com.payments.refund.Limiter.apply(Limiter.java:57)',
        '\tat com.payments.refund.LimiterTest.rejectsOverLimit(LimiterTest.java:22)',
      ].join('\n'),
    },
    {
      day: 4, minute: 95, branch: 'feature/payout-export', commit: 'new0002bbbbbbb', author: 'bilal',
      step: 'unit-tests (pytest)', prId: 436, changedFiles: ['ledger/export.py'],
      category: 'test',
      log: buildLog({
        kind: 'pytest', ts: at(4, 95), file: 'tests/test_export.py', test: 'test_csv_columns',
        message: "KeyError: 'settled_at'", line: 88, uuid: 'b7e2f0a1-4444-4a2b-8c3d-0123456789ab',
      }),
    },
    {
      day: 5, minute: 130, branch: 'feature/fx-table', commit: 'new0003ccccccc', author: 'chloé',
      step: 'tsc --noEmit', prId: 440, changedFiles: ['src/fx/table.ts'],
      category: 'compile',
      log: buildLog({
        kind: 'tsc', ts: at(5, 130), file: 'src/fx/table.ts', line: 63, code: '2322',
        message: "Type 'string' is not assignable to type 'number'",
      }),
    },
    {
      day: 6, minute: 25, branch: 'feature/fee-grid', commit: 'new0004ddddddd', author: 'david',
      step: 'eslint', prId: 444, changedFiles: ['src/fees/grid.js'],
      category: 'style',
      log: buildLog({
        kind: 'eslint', ts: at(6, 25), file: 'src/fees/grid.js', line: 31, rule: 'no-unused-vars',
        message: "'rate' is assigned a value but never used",
      }),
    },
    {
      day: 7, minute: 70, branch: 'feature/go-settle', commit: 'new0005eeeeeee', author: 'emma',
      step: 'go test ./...', prId: 449, changedFiles: ['settlement/batch.go'],
      category: 'test',
      log: buildLog({
        kind: 'go', ts: at(7, 70), pkg: 'settlement', test: 'TestBatchCutOff',
        message: 'cut-off should include 18:00 UTC', file: 'settlement/batch.go', line: 104,
        uuid: 'c9d0e1f2-5555-4a2b-8c3d-0123456789ab',
      }),
    },
    {
      day: 8, minute: 110, branch: 'feature/jest-ledger', commit: 'new0006fffffff', author: 'farid',
      step: 'jest', prId: 452, changedFiles: ['src/ledger/entry.ts'],
      category: 'test',
      log: buildLog({
        kind: 'jest', ts: at(8, 110), file: 'src/ledger/entry.test.ts', test: 'balances to zero',
        message: 'expected 0 received 12', line: 44, uuid: 'd1e2f3a4-6666-4a2b-8c3d-0123456789ab',
      }),
    },
    {
      day: 9, minute: 15, branch: 'feature/gradle-compile', commit: 'new0007aaaaaaa', author: 'gwen',
      step: 'gradle compileJava', prId: 458, changedFiles: ['src/main/java/com/payments/fx/Rate.java'],
      category: 'compile',
      log: buildLog({
        kind: 'gradle', ts: at(9, 15), file: 'src/main/java/com/payments/fx/Rate.java', line: 27,
        message: 'cannot find symbol: method scale()',
      }),
    },
    {
      day: 10, minute: 145, repo: 'payments-web', branch: 'feature/checkout-ui', commit: 'new0008bbbbbbb',
      author: 'hugo', step: 'jest', prId: 210, changedFiles: ['src/checkout/Form.tsx'],
      category: 'test',
      log: buildLog({
        kind: 'jest', ts: at(10, 145), file: 'src/checkout/Form.test.tsx', test: 'renders the summary',
        message: 'Unable to find an element with the text: Total', line: 19,
        uuid: 'e3f4a5b6-7777-4a2b-8c3d-0123456789ab',
      }),
    },
    {
      day: 11, minute: 60, repo: 'billing-service', branch: 'feature/invoice-pdf', commit: 'new0009ccccccc',
      author: 'ines', step: 'unit-tests (pytest)', prId: 88, changedFiles: ['billing/pdf.py'],
      category: 'test',
      log: buildLog({
        kind: 'pytest', ts: at(11, 60), file: 'tests/test_pdf.py', test: 'test_invoice_footer',
        message: 'assert None != "TVA intracommunautaire"', line: 51,
        uuid: 'f5a6b7c8-8888-4a2b-8c3d-0123456789ab',
      }),
    },
    {
      day: 12, minute: 85, branch: 'feature/audit-export', commit: 'new0010ddddddd', author: 'julie',
      step: 'go build ./...', prId: 471, changedFiles: ['audit/export.go'],
      category: 'compile',
      log: buildLog({
        kind: 'go-compile', ts: at(12, 85), pkg: 'audit', file: 'audit/export.go', line: 38,
        message: 'undefined: csvWriter.Flush',
      }),
    },
    {
      day: 13, minute: 140, branch: 'feature/timeout-tuning', commit: 'new0011eeeeeee', author: 'karim',
      step: 'integration-tests', prId: 479, changedFiles: ['src/main/java/com/payments/config/Timeouts.java'],
      category: 'timeout',
      log: buildLog({
        kind: 'junit-timeout', ts: at(13, 140), classname: 'com.payments.config.TimeoutsTest',
        test: 'testHttpTimeoutIsApplied', seconds: 300, uuid: 'a7b8c9d0-9999-4a2b-8c3d-0123456789ab',
      }),
    },
    {
      day: 13, minute: 200, repo: 'payments-web', branch: 'feature/docker-base', commit: 'new0012fffffff',
      author: 'lina', step: 'docker build', prId: 223, changedFiles: ['Dockerfile'],
      category: 'infrastructure', diagnostic: 'infrastructure',
      log: buildLog({
        kind: 'docker', ts: at(13, 200), image: 'registry.internal.example/payments/web:3.1.0',
        reason: 'pull access denied for registry.internal.example/payments/web',
      }),
    },
  ];

/** Transforme la table ci-dessus en occurrences du jeu. */
function freshFailures() {
  return FRESH_FAILURE_CASES.map((c) =>
    newFailure(c.day, c.minute, {
      repo: c.repo, branch: c.branch, commit: c.commit, author: c.author, step: c.step,
      prId: c.prId, changedFiles: c.changedFiles, category: c.category, log: c.log,
      diagnostic: c.diagnostic,
      durationS: 40 + (c.day % 5) * 7,
    }),
  );
}

/** L'épidémie : 3 dépôts, 8 échecs, 12 minutes. */
function outbreakRuns() {
  const runs = [];
  const plan = [
    ['payments-api', 'feature/sdk-bump', 'out0001aaaaaa', 'marc', 0],
    ['payments-web', 'feature/sdk-bump', 'out0002bbbbbb', 'nadia', 2],
    ['billing-service', 'feature/sdk-bump', 'out0003cccccc', 'omar', 3],
    ['payments-api', 'main', 'out0004dddddd', 'pipeline', 5],
    ['payments-web', 'main', 'out0005eeeeee', 'pipeline', 7],
    ['billing-service', 'main', 'out0006ffffff', 'pipeline', 8],
    ['payments-api', 'feature/checkout-v2', 'out0007aaaaaa', 'prune', 10],
    ['payments-web', 'feature/checkout-v2', 'out0008bbbbbb', 'quentin', 12],
  ];
  for (const [repo, branch, commit, author, minute] of plan) {
    runs.push(registryFailure(10, 180 + minute, repo, branch, commit, author));
  }
  return runs;
}

/** Les quelques builds verts qui donnent l'échelle du jeu. */
function greenRuns() {
  return [
    { at: at(2, 200), repo: 'payments-api', branch: 'main', commit: 'grn0001aaaaaa', author: 'pipeline', step: 'gradle test', durationS: 88, outcome: 'success' },
    { at: at(6, 240), repo: 'payments-web', branch: 'main', commit: 'grn0002bbbbbb', author: 'pipeline', step: 'jest', durationS: 61, outcome: 'success' },
    { at: at(9, 260), repo: 'billing-service', branch: 'main', commit: 'grn0003cccccc', author: 'pipeline', step: 'unit-tests (pytest)', durationS: 47, outcome: 'success' },
    { at: at(13, 280), repo: 'payments-api', branch: 'main', commit: 'grn0004dddddd', author: 'pipeline', step: 'integration-tests', durationS: 132, outcome: 'success' },
  ];
}

/** Le jeu complet, trié par ordre chronologique. */
export function buildSample() {
  const occurrences = [
    // Jour 2 : l'erreur du client HTTP apparaît sur main.
    { ...clientFailure(2, 60, 'main', 'cli0001aaaaaa', 'marie'), expected: { diagnostic: 'already-fixed' } },
    // Jour 3 : le correctif passe sur main.
    {
      at: at(3, 65), repo: 'payments-api', branch: 'main', commit: FIX_COMMIT, author: 'marie',
      step: 'integration-tests', durationS: 128, outcome: 'success',
    },
    // Jour 6 : une branche antérieure au correctif retombe sur la même erreur.
    {
      ...clientFailure(6, 150, 'feature/legacy-refund', 'cli0002bbbbbb', 'samir', []),
      expected: { diagnostic: 'already-fixed' },
    },
    // Jour 12 : l'erreur revient sur main, qui contient pourtant le correctif.
    {
      ...clientFailure(12, 170, 'main', 'cli0003cccccc', 'tarik', [FIX_COMMIT]),
      expected: { diagnostic: 'uncertain' },
    },
    ...flakyRuns(),
    ...outbreakRuns(),
    ...freshFailures(),
    ...greenRuns(),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return {
    name: 'payments-api-ci-memory',
    description:
      '40 failures over 14 days on a fictional payments monorepo, built to produce the four ' +
      'diagnostics of Déjà-vu CI and the three status moves (flaky, resolved, regression).',
    repository: 'payments-api',
    days: 14,
    occurrences,
    resolutions: [
      {
        match: { contains: 'token descriptor is null' },
        commit: FIX_COMMIT,
        author: 'marie',
        note: 'HTTP client refreshed the token descriptor before every call',
        files: ['src/main/java/com/payments/http/Client.java'],
        confirmed: true,
      },
    ],
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const dataset = buildSample();
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  const failures = dataset.occurrences.filter((o) => o.outcome === 'failure').length;
  console.log(
    `${failures} échecs, ${dataset.occurrences.length - failures} succès → ${path.relative(root, OUT)}`,
  );
}
