// CLI entry: parse the arguments, build the idempotent payload, ship it.
// Zero npm dependencies — node:fs, node:process and the local lib modules.

import { readFileSync } from 'node:fs';
import { buildPayload } from './payload.js';
import { postWithRetry } from './transport.js';

const USAGE = `deja-vu — report a failing build to the Déjà-vu CI universal entry

Usage:
  deja-vu report --url <brain-url> --key <project-key> --repo <owner/name> \\
      --log <path-or-dash> [--branch <name>] [--commit <sha>] [--author <name>] \\
      [--step <name>] [--dry-run] [--json] [--timeout <ms>] [--retries <n>]

Options:
  --url <url>       Brain /universal web trigger (required)
  --key <key>       per-project key, DEJAVU_PROJECT_KEY (required)
  --repo <owner/n>  repository name (required)
  --log <path>      path to the build log; "-" reads stdin (required, or --log-file)
  --log-file <path> alias of --log
  --branch <name>   branch name (default: unknown-branch)
  --commit <sha>    commit SHA
  --author <name>   commit/actor name
  --step <name>     step name (default: build)
  --dry-run         print the payload and exit 0 without sending
  --json            machine-readable output (one JSON object)
  --timeout <ms>    per-attempt HTTP timeout (default 20000)
  --retries <n>     max attempts, backoff 0.5s/1s/2s (default 3)

Return codes: 0 sent (or dry-run), 1 send error, 2 usage/input error.
A red build never changes the return code: only the ability to ship matters.`;

function fail(msg) {
  return { ok: false, error: msg };
}

/** Parse argv into a command + options object. Two-value and --flag=value. */
function parseArgs(argv) {
  const opts = { branch: undefined, commit: undefined, author: undefined, step: undefined, dryRun: false, json: false, timeout: 20000, retries: 3, logFile: undefined };
  let command = null;
  let i = 0;
  const names = { '--url': 'url', '--key': 'key', '--repo': 'repo', '--branch': 'branch', '--commit': 'commit', '--author': 'author', '--step': 'step', '--log': 'log', '--log-file': 'logFile', '--timeout': 'timeout', '--retries': 'retries' };
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { ok: true, command: 'help' };
    if (arg === '--dry-run') { opts.dryRun = true; i += 1; continue; }
    if (arg === '--json') { opts.json = true; i += 1; continue; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const key = names[name];
      if (!key) return fail(`unknown option: ${name}`);
      if (eq !== -1) { opts[key] = arg.slice(eq + 1); i += 1; continue; }
      if (i + 1 >= argv.length) return fail(`missing value for ${name}`);
      opts[key] = argv[i + 1];
      i += 2;
      continue;
    }
    if (command === null) { command = arg; i += 1; continue; }
    return fail(`unexpected argument: ${arg}`);
  }
  return { ok: true, command: command ?? 'report', opts };
}

function parseNumber(raw, name, fallback) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return NaN;
  return Math.floor(n);
}

/** Resolve the log text from --log/--log-file, a path or stdin ("-"). */
function resolveLog(opts) {
  const spec = opts.log !== undefined ? opts.log : opts.logFile;
  if (spec === undefined || spec === '') return fail('a --log (or --log-file) is required');
  if (spec === '-') {
    return { ok: true, log: readFileSync(0, 'utf8') };
  }
  try {
    return { ok: true, log: readFileSync(spec, 'utf8') };
  } catch {
    return fail(`cannot read log file: ${spec}`);
  }
}

/** Validate the options and build the payload (or explain why not). */
function prepare(opts) {
  if (!opts.url) return fail('--url is required');
  if (!opts.key) return fail('--key is required');
  if (!opts.repo) return fail('--repo is required');
  const log = resolveLog(opts);
  if (!log.ok) return log;
  const timeout = parseNumber(opts.timeout, 'timeout', 20000);
  const retries = parseNumber(opts.retries, 'retries', 3);
  if (Number.isNaN(timeout)) return fail('--timeout must be a positive integer');
  if (Number.isNaN(retries)) return fail('--retries must be a positive integer');
  const payload = buildPayload({
    key: opts.key,
    repository: opts.repo,
    branch: opts.branch ?? 'unknown-branch',
    commit: opts.commit,
    author: opts.author,
    step: opts.step,
    log: log.log,
  });
  return { ok: true, payload, timeout, retries };
}

function humanLine(payload, result) {
  const ok = result.status === 200 || result.status === 202;
  if (ok) return `reported to the Brain (HTTP ${result.status})`;
  if (result.error) return `send error after ${result.attempts} attempt(s): ${result.error}`;
  return `Brain answered HTTP ${result.status}: ${result.body.slice(0, 200) || '(empty body)'}`;
}

function jsonObject(payload, result) {
  const ok = result.status === 200 || result.status === 202;
  return {
    ok,
    status: result.status,
    attempts: result.attempts,
    idempotencyKey: payload.idempotencyKey,
    diagnostic: ok ? result.body || 'accepted' : result.error || result.body,
  };
}

/** The `run(argv) -> exitCode` entry used by the binary. */
export async function run(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`deja-vu: ${parsed.error}\n\n${USAGE}\n`);
    return 2;
  }
  if (parsed.command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.command !== 'report') {
    process.stderr.write(`deja-vu: unknown command '${parsed.command}'\n\n${USAGE}\n`);
    return 2;
  }

  const prepared = prepare(parsed.opts);
  if (!prepared.ok) {
    process.stderr.write(`deja-vu: ${prepared.error}\n`);
    return 2;
  }
  const { payload, timeout, retries } = prepared;

  if (parsed.opts.dryRun) {
    const out = { dryRun: true, idempotencyKey: payload.idempotencyKey, payload };
    process.stdout.write(`${parsed.opts.json ? JSON.stringify(out) : `dry-run: payload ready (key ${payload.idempotencyKey.slice(0, 12)}…)`}\n`);
    return 0;
  }

  const result = await postWithRetry(parsed.opts.url.trim(), JSON.stringify(payload), { retries, timeoutMs: timeout });
  const ok = result.status === 200 || result.status === 202;
  if (parsed.opts.json) {
    process.stdout.write(`${JSON.stringify(jsonObject(payload, result))}\n`);
  } else {
    process.stdout.write(`${ok ? '✓' : '✗'} deja-vu: ${humanLine(payload, result)}\n`);
    process.stdout.write(`  idempotency key: ${payload.idempotencyKey}\n`);
  }
  return ok ? 0 : 1;
}