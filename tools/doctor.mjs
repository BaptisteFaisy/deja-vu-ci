#!/usr/bin/env node
/**
 * tools/doctor.mjs — one command that verifies everything, offline.
 *
 * Runs every check the repository owns and prints one verdict per check:
 * `OK` (passed), `KO` (failed) or `PASSÉ` (not applicable in this workspace,
 * e.g. no `origin/main` to diff against). The exit code is non-zero as soon
 * as one check is `KO`. Every check has its own timeout; nothing touches the
 * network. See docs/VERIFY.md for what each check proves — and for what
 * cannot be verified offline (the real Forge rendering, Bitbucket itself).
 *
 * Usage:
 *   node tools/doctor.mjs                     # every check
 *   node tools/doctor.mjs --only types,tests  # a subset (comma-separated)
 *   node tools/doctor.mjs --list              # the catalogue of checks
 *   node tools/doctor.mjs --json              # machine-readable report
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  KO,
  OK,
  SKIPPED,
  checkResult,
  firstLines,
  renderDetails,
  renderTable,
  repoRoot,
  run,
  trackedFiles,
  withTimeout,
} from './lib/verify.mjs';
import { MAX_FILE_LINES, MAX_FUNCTION_LINES, scanFile } from './lib/limits.mjs';
import { checkDocs } from './check-docs.mjs';
import { checkLicences } from './check-licences.mjs';
import { MANIFESTS, summarize, validateManifest } from './validate-manifest.mjs';
import { OUTPUT_PATH, buildSbom, renderSbom } from './sbom.mjs';
import { PUBLIC, fingerprint } from './build-site.mjs';

/** Local binaries: no `npx`, no network, no surprise version. */
const TSC = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const VITEST = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

/** Trees where the <50-line function rule is enforced (engine + tooling). */
const ENFORCED_FUNCTION_SCOPE = ['packages/', 'tools/'];

/** Trees reported as observations: declarative Forge screens, public site. */
const OBSERVED_FUNCTION_SCOPE = ['apps/', 'site/'];

/** Types: `present` reads the emitted declarations of `core`. */
async function checkTypes() {
  const declarations = path.join(repoRoot, 'packages', 'core', 'dist', 'index.d.ts');
  if (!existsSync(declarations)) {
    const build = run(process.execPath, [TSC, '-p', 'packages/core'], { timeoutMs: 120_000 });
    if (build.code !== 0) {
      return checkResult(KO, 'packages/core does not build', [firstLines(build.stdout + build.stderr, 6)]);
    }
  }
  const failures = [];
  for (const pkg of ['core', 'bridge', 'present']) {
    const res = run(process.execPath, [TSC, '-p', `packages/${pkg}`, '--noEmit'], { timeoutMs: 90_000 });
    if (res.timedOut) failures.push(`${pkg}: tsc timed out`);
    else if (res.code !== 0) failures.push(`${pkg}: ${firstLines(res.stdout + res.stderr, 4)}`);
  }
  if (failures.length > 0) return checkResult(KO, `${failures.length} package(s) fail the typecheck`, failures);
  return checkResult(OK, 'core, bridge, present typecheck clean');
}

/** The whole test suite, exactly as the CI runs it. */
async function checkTests() {
  const res = run(process.execPath, [VITEST, 'run', '--reporter=dot'], { timeoutMs: 240_000 });
  const output = res.stdout + res.stderr;
  const passed = output.match(/Tests\s+(\d+) passed/);
  const failed = output.match(/Tests\s+.*?(\d+) failed/);
  if (res.timedOut) return checkResult(KO, 'vitest timed out after 240 s', [firstLines(output, 6)]);
  if (res.code !== 0 || failed) {
    return checkResult(KO, `${failed ? failed[1] : '?'} test(s) failed`, [firstLines(output, 8)]);
  }
  return checkResult(OK, `${passed ? passed[1] : 'all'} tests passed`);
}

/** The Forge manifests against the official Atlassian schema. */
async function checkManifests() {
  const failures = [];
  let modules = 0;
  for (const file of MANIFESTS) {
    if (!existsSync(file)) {
      failures.push(`missing manifest: ${path.relative(repoRoot, file)}`);
      continue;
    }
    const result = validateManifest(file);
    modules += result.modules;
    if (!result.ok) failures.push(summarize(result).split('\n').slice(0, 4).join('\n    '));
  }
  if (failures.length > 0) return checkResult(KO, 'manifest(s) not conformant', failures);
  return checkResult(OK, `${MANIFESTS.length} manifests conformant (${modules} modules)`);
}

/** The sample dataset and the labeled corpus (delegated, never recopied). */
async function checkDataset() {
  const script = path.join(repoRoot, 'tools', 'check-dataset.mjs');
  const res = run(process.execPath, [script], { timeoutMs: 60_000 });
  const output = res.stdout + res.stderr;
  if (res.timedOut) return checkResult(KO, 'check-dataset timed out');
  if (res.code !== 0) return checkResult(KO, 'datasets not conformant', output.split('\n').filter(Boolean).slice(0, 8));
  return checkResult(OK, firstLines(output, 2) || 'datasets conformant');
}

/** The committed SBOM matches a fresh deterministic generation. */
async function checkSbom() {
  const expected = renderSbom(buildSbom());
  if (!existsSync(OUTPUT_PATH)) {
    return checkResult(KO, 'docs/SBOM.json is missing', ['regenerate: node tools/sbom.mjs']);
  }
  const committed = readFileSync(OUTPUT_PATH, 'utf8');
  if (committed !== expected) {
    return checkResult(KO, 'docs/SBOM.json is stale', ['regenerate: node tools/sbom.mjs']);
  }
  const runtime = JSON.parse(expected).components.filter(
    (component) => !(component.properties ?? []).some((p) => p.name === 'dejavu:first-party'),
  ).length;
  return checkResult(OK, `SBOM fresh (${runtime} third-party runtime component(s))`);
}

/** The committed site bundle matches the sources (fingerprint). */
async function checkSiteBundle() {
  const manifestFile = path.join(PUBLIC, 'build-manifest.json');
  if (!existsSync(manifestFile)) {
    return checkResult(SKIPPED, 'site/public not built in this workspace');
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const current = fingerprint();
  if (manifest.empreinte !== current) {
    return checkResult(KO, 'the site bundle is older than its sources', ['rebuild: npm run build:site']);
  }
  return checkResult(OK, `bundle fingerprint fresh (${manifest.octets} bytes)`);
}

/** Internal links, anchors, empty documents, conflict markers in the docs. */
async function checkDocumentation() {
  const result = checkDocs();
  if (!result.ok) {
    return checkResult(KO, `${result.problems.length} documentation problem(s)`, result.problems.slice(0, 10));
  }
  return checkResult(OK, `${result.stats.documents} docs, ${result.stats.links} internal links valid`);
}

/** Runtime licences: nothing copyleft ships inside an MIT repository. */
async function checkLicenceDeclarations() {
  const result = checkLicences();
  if (!result.ok) {
    return checkResult(KO, `${result.incompatible.length} licence(s) incompatible with MIT`, result.incompatible);
  }
  const permissive = result.components.filter((component) => component.bucket === 'permissive').length;
  return checkResult(
    OK,
    `${result.components.length} runtime component(s): ${permissive} permissive, ${result.reported.length} reported`,
    result.reported.slice(0, 10),
  );
}

/** No merge conflict marker left anywhere in the tracked files. */
async function checkConflicts() {
  const res = run('git', ['grep', '-nI', '-E', '^(<{7}|>{7}|\\|{7})( |$)', '--', '.'], { timeoutMs: 30_000 });
  if (res.code === 0) {
    return checkResult(KO, 'merge conflict markers found', res.stdout.split('\n').filter(Boolean).slice(0, 10));
  }
  if (res.code === 1) return checkResult(OK, 'no conflict marker in the tracked files');
  return checkResult(KO, `git grep failed: ${firstLines(res.stderr, 2)}`);
}

/** Files < 500 lines, functions < 50 lines, on the tracked TypeScript. */
async function checkSizes() {
  const files = trackedFiles(['*.ts', '*.tsx']);
  const blocking = [];
  const observations = [];
  for (const file of files) {
    const scan = scanFile(path.join(repoRoot, file));
    if (scan.lines >= MAX_FILE_LINES) blocking.push(`${file}: ${scan.lines} lines (>= ${MAX_FILE_LINES})`);
    for (const span of scan.oversized) {
      const entry = `${file}:${span.startLine} ${span.name}() is ${span.lines} lines (> ${MAX_FUNCTION_LINES})`;
      if (ENFORCED_FUNCTION_SCOPE.some((prefix) => file.startsWith(prefix))) blocking.push(entry);
      else if (OBSERVED_FUNCTION_SCOPE.some((prefix) => file.startsWith(prefix))) observations.push(entry);
    }
  }
  const details = [...blocking, ...observations.map((item) => `observation (not enforced): ${item}`)];
  if (blocking.length > 0) return checkResult(KO, `${blocking.length} size violation(s)`, details.slice(0, 12));
  return checkResult(OK, `${files.length} TypeScript files within limits (${observations.length} observation(s))`, details.slice(0, 12));
}

/** Loads the real forbidden patterns from the guard itself (never recopied). */
function loadCouche0Guard() {
  const script = [
    'import json, sys',
    "sys.path.insert(0, '.github/couche0')",
    'import check_couche0 as c',
    'print(json.dumps({"patterns": [list(p) for p in c.FORBIDDEN_PATTERNS], "guards": list(c.GUARD_FILES)}))',
  ].join('; ');
  const res = run('python3', ['-c', script], { timeoutMs: 15_000 });
  if (res.code !== 0) return undefined;
  try {
    return JSON.parse(res.stdout.trim());
  } catch {
    return undefined;
  }
}

/** The added lines of the branch (committed diff + untracked files). */
function addedLines(baseRef) {
  const lines = [];
  const diff = run('git', ['diff', '--unified=0', baseRef], { timeoutMs: 30_000 });
  let current = '';
  for (const line of diff.stdout.split('\n')) {
    if (line.startsWith('+++ b/')) current = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) lines.push([current, line.slice(1)]);
  }
  for (const file of run('git', ['ls-files', '--others', '--exclude-standard'], { timeoutMs: 15_000 }).stdout.split('\n')) {
    if (file.length === 0) continue;
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const added of text.split('\n')) lines.push([file, added]);
  }
  return lines;
}

/** The `couche0` guard, replayed locally: forbidden patterns on added lines. */
async function checkCouche0() {
  const guard = loadCouche0Guard();
  if (!guard) return checkResult(SKIPPED, 'python3 or the guard script is unavailable');
  const base = run('git', ['merge-base', 'origin/main', 'HEAD'], { timeoutMs: 15_000 });
  if (base.code !== 0) return checkResult(SKIPPED, 'origin/main is unknown in this clone');
  const changed = run('git', ['diff', '--name-only', base.stdout.trim()], { timeoutMs: 15_000 })
    .stdout.split('\n').filter(Boolean);
  const violations = [];
  for (const file of changed) {
    if (guard.guards.some((prefix) => file.startsWith(prefix))) {
      violations.push(`guard file modified: ${file}`);
    }
  }
  const compiled = guard.patterns.map(([pattern, message, exempt]) => [new RegExp(pattern), message, exempt]);
  for (const [file, line] of addedLines(base.stdout.trim())) {
    if (file.startsWith('.github/couche0/')) continue;
    for (const [regex, message, exempt] of compiled) {
      if (exempt && line.includes(exempt)) continue;
      if (regex.test(line)) violations.push(`${message} — ${file}: ${line.trim().slice(0, 80)}`);
    }
  }
  if (violations.length > 0) return checkResult(KO, `${violations.length} forbidden pattern(s)`, violations.slice(0, 10));
  return checkResult(OK, `no forbidden pattern on ${changed.length} changed file(s)`);
}

/** The catalogue: name, title, timeout and implementation of every check. */
const CHECKS = [
  { name: 'types', title: 'TypeScript types (core, bridge, present)', timeoutMs: 240_000, run: checkTypes },
  { name: 'tests', title: 'the whole vitest suite', timeoutMs: 260_000, run: checkTests },
  { name: 'manifests', title: 'Forge manifests vs the official schema', timeoutMs: 60_000, run: checkManifests },
  { name: 'dataset', title: 'sample dataset + labeled corpus', timeoutMs: 70_000, run: checkDataset },
  { name: 'sbom', title: 'docs/SBOM.json is fresh', timeoutMs: 30_000, run: checkSbom },
  { name: 'site-bundle', title: 'the public site bundle fingerprint', timeoutMs: 30_000, run: checkSiteBundle },
  { name: 'docs', title: 'documentation links and anchors', timeoutMs: 60_000, run: checkDocumentation },
  { name: 'licences', title: 'runtime licences vs MIT', timeoutMs: 30_000, run: checkLicenceDeclarations },
  { name: 'conflicts', title: 'no merge conflict marker', timeoutMs: 40_000, run: checkConflicts },
  { name: 'sizes', title: 'files < 500 lines, functions < 50 lines', timeoutMs: 90_000, run: checkSizes },
  { name: 'couche0', title: 'the CI guard, replayed locally', timeoutMs: 60_000, run: checkCouche0 },
];

/** Parses the command line: `--only`, `--json`, `--list`. */
function parseArgs(argv) {
  const args = { only: undefined, json: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--list') args.list = true;
    else if (argv[i] === '--only') args.only = (argv[i + 1] ?? '').split(',');
    else if (argv[i].startsWith('--only=')) args.only = argv[i].slice('--only='.length).split(',');
  }
  if (args.only) args.only = args.only.map((name) => name.trim()).filter((name) => name.length > 0);
  return args;
}

/** Runs one check: measures it, caps it, never lets an exception escape. */
async function runCheck(check, position, total, json) {
  if (!json) process.stdout.write(`[${position}/${total}] ${check.name}…\n`);
  const started = Date.now();
  let result;
  try {
    const outcome = await withTimeout(Promise.resolve().then(() => check.run()), check.timeoutMs, check.name);
    result = outcome?.timedOut
      ? checkResult(KO, `timed out after ${check.timeoutMs} ms`)
      : outcome;
  } catch (error) {
    result = checkResult(KO, `exception: ${error.message}`);
  }
  return { name: check.name, title: check.title, ms: Date.now() - started, ...result };
}

/** Entry point: runs the selected checks, prints the verdicts, exits. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const check of CHECKS) console.log(`${check.name.padEnd(12)} ${check.title}`);
    return 0;
  }
  let selected = CHECKS;
  if (args.only) {
    selected = CHECKS.filter((check) => args.only.includes(check.name));
    const unknown = args.only.filter((name) => !CHECKS.some((check) => check.name === name));
    if (unknown.length > 0) {
      console.error(`unknown check(s): ${unknown.join(', ')}`);
      console.error(`known checks: ${CHECKS.map((check) => check.name).join(', ')}`);
      return 2;
    }
  }
  const results = [];
  for (let i = 0; i < selected.length; i += 1) {
    results.push(await runCheck(selected[i], i + 1, selected.length, args.json));
  }
  const failures = results.filter((result) => result.verdict === KO).length;
  if (args.json) {
    console.log(JSON.stringify({ ok: failures === 0, failures, checks: results }, null, 2));
  } else {
    console.log('');
    console.log(renderTable(results));
    const details = renderDetails(results);
    if (details.length > 0) console.log(`\nDetails:\n${details}`);
    console.log(`\ndoctor: ${failures === 0 ? 'OK — every check passed' : `KO — ${failures} check(s) failed`}`);
  }
  return failures === 0 ? 0 : 1;
}

process.exit(await main());
