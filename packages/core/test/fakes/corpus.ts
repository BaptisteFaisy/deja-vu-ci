/**
 * Generator of the failure corpus used by `invariants-fuzz.test.ts`.
 *
 * Random but reproducible: one seeded generator (no dependency, no clock, no
 * network), a fixed number of cases, and three shapes of scenario so that the
 * corpus exercises every verdict of the engine:
 *
 *  - `plain`    — ordinary failures spread over a fortnight;
 *  - `outbreak` — the same family hitting several repositories within minutes
 *                 (§ 10.3), the only way to reach the infrastructure verdict
 *                 that cites repositories;
 *  - `aged`     — failures spread over six weeks, so that some of them fall
 *                 outside the flakiness window and the signature statuses move
 *                 along `new → known → resolved → regression` (§ 8.2, § 8.4).
 *
 * The scenarios are then run through the real engine functions, and the ticket
 * plans are computed with a simulated Jira ledger, exactly like `replay.ts`
 * does: the corpus checks the engine, never a copy of it.
 */

import { assessFlakiness } from '../../src/flaky.js';
import { detectOutbreak } from '../../src/outbreak.js';
import { diagnose } from '../../src/diagnose.js';
import { extractErrorBlocks } from '../../src/extract.js';
import { planTicketActions } from '../../src/tickets.js';
import { signatureKeys } from '../../src/sign.js';
import { statusAfterOccurrence } from '../../src/replay-state.js';
import {
  DEFAULT_SETTINGS,
  type Diagnostic,
  type ErrorBlock,
  type Occurrence,
  type Resolution,
  type Settings,
  type Signature,
  type SignatureStatus,
  type TicketAction,
} from '../../src/types.js';
import { makeOccurrence, makeResolution, type Violation } from './invariants.js';

/** Fixed seed: the corpus is identical on every run, on every machine. */
export const SEED = 0x5eed1234;

/** Number of generated scenarios. */
export const CASES = 500;

/** Reference instant of the corpus: the end of the simulated fortnight. */
export const NOW = new Date('2026-11-15T00:00:00.000Z');

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** Settings of the corpus. */
export const BASE_SETTINGS: Settings = { ...DEFAULT_SETTINGS };

/** Deterministic pseudo-random generator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shape of failure the generator can produce. */
export interface Template {
  id: string;
  /** Builds the log of one failure; only the stack carries the noise. */
  log(rng: () => number): string;
}

/**
 * Failure shapes of the corpus.
 *
 * The first line of each log is stable — it is what the engine keeps as the
 * normalized message — while the stack carries a different line number on
 * every occurrence: two failures of the same shape must therefore land on the
 * same signature (§ 9.2, § 9.3).
 */
export const TEMPLATES: Template[] = [
  {
    id: 'jest-assertion',
    log: (r) =>
      `FAIL src/auth/login.test.ts\n  ● login › accepts a valid user\n\n    Expected: 200\n    Received: 500\n\n      at Object.<anonymous> (src/auth/login.test.ts:${40 + Math.floor(r() * 50)}:21)\n`,
  },
  {
    id: 'junit-assertion',
    log: (r) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="com.acme.LimiterTest" tests="12" failures="1">\n  <testcase classname="com.acme.LimiterTest" name="limitsRefund">\n    <failure message="expected 3 to be 4" type="java.lang.AssertionError">\n\tat com.acme.Limiter.limits(Limiter.java:${40 + Math.floor(r() * 50)})\n    </failure>\n  </testcase>\n</testsuite>`,
  },
  {
    id: 'timeout',
    log: (r) =>
      `Error: Test timed out after 300 seconds\n    at Runner.run(Runner.ts:${40 + Math.floor(r() * 50)}:5)\n    at async Promise.all (index 0)`,
  },
  {
    id: 'network',
    log: (r) =>
      `Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:${1000 + Math.floor(r() * 900)}:8)`,
  },
  {
    id: 'dependency',
    log: (r) =>
      `npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree\nnpm ERR! found: react@18.2.0\n    at Arborist.idealTree (arborist.js:${400 + Math.floor(r() * 300)}:11)`,
  },
  {
    id: 'image-missing',
    log: (r) =>
      `docker: Error response from daemon: pull access denied for registry.internal.example/app, repository does not exist or may require 'docker login'\n    at applyMiddleware (docker.js:${300 + Math.floor(r() * 200)}:4)`,
  },
  {
    id: 'compile',
    log: (r) =>
      `src/app.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.\n    at check (app.ts:${40 + Math.floor(r() * 50)}:12)`,
  },
  {
    id: 'out-of-memory',
    log: (r) =>
      `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n    at GC (node:internal/gc:12:3)\n    at alloc (node:internal:9:${10 + Math.floor(r() * 90)})`,
  },
];

/** Repositories and branches the generator draws from. */
const REPOS = ['acme/api', 'acme/web', 'acme/mobile', 'acme/infra'];
const BRANCHES = ['main', 'feature/a', 'feature/b', 'release/1.2'];
const STEPS = ['gradle test', 'npm test', 'docker build', 'integration-tests'];

/** One generated failure: its occurrence, its extracted block, its shape. */
export interface Generated {
  occurrence: Occurrence;
  block: ErrorBlock;
  templateId: string;
}

/** Kind of scenario, which decides how the failures are spread. */
export type ScenarioKind = 'plain' | 'outbreak' | 'aged';

/** One generated scenario: its failures and the resolutions it may know. */
export interface Scenario {
  kind: ScenarioKind;
  occurrences: Generated[];
  resolutions: Map<string, Resolution>;
}

/** Random pick inside a list. */
function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

/** Random instant of the corpus, `daysAgo` days before the reference instant. */
function instantAt(rng: () => number, daysAgo: number): Date {
  const minutes = Math.floor(rng() * 60 * 24);
  return new Date(NOW.getTime() - daysAgo * DAY_MS - minutes * 60_000);
}

/** Builds one failure of the corpus out of a shape and an instant. */
function buildGenerated(index: number, step: number, template: Template, at: Date, rng: () => number): Generated {
  const log = template.log(rng);
  const block = extractErrorBlocks({ stepLog: log }).blocks[0];
  const keys = signatureKeys(block);
  const occurrence = makeOccurrence({
    id: `occ-${index}-${step}`,
    signatureId: keys.signature,
    familyId: keys.family,
    repo: pick(REPOS, rng),
    branch: pick(BRANCHES, rng),
    commit: `c${Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0')}`,
    author: `dev-${1 + Math.floor(rng() * 4)}`,
    stepName: pick(STEPS, rng),
    durationS: 30 + Math.floor(rng() * 300),
    occurredAt: at.toISOString(),
    passedOnRetry: rng() < 0.3,
    testName: block.testName,
  });
  return { occurrence, block, templateId: template.id };
}

/** The shape of the scenario: one family, or two when the draw allows it. */
function scenarioShapes(rng: () => number, kind: ScenarioKind): Template[] {
  if (kind === 'outbreak') return [pick(TEMPLATES, rng)];
  const shapes = [pick(TEMPLATES, rng)];
  if (rng() < 0.5) shapes.push(pick(TEMPLATES, rng));
  return shapes;
}

/**
 * Spread of the failures of one scenario.
 *
 * An outbreak puts every failure of one family in a different repository
 * inside the outbreak window; an aged scenario spreads them over six weeks so
 * that the flakiness window drops some of them.
 */
function scenarioInstants(kind: ScenarioKind, count: number, rng: () => number): Date[] {
  if (kind === 'outbreak') {
    const start = instantAt(rng, Math.floor(rng() * 13));
    return Array.from({ length: count }, (_, step) => new Date(start.getTime() + step * 2 * 60_000));
  }
  const span = kind === 'aged' ? 45 : 14;
  return Array.from({ length: count }, () => instantAt(rng, Math.floor(rng() * span)));
}

/** Adds a known fix to one signature of the scenario, most of the time. */
function buildResolutions(occurrences: Generated[], rng: () => number): Map<string, Resolution> {
  const resolutions = new Map<string, Resolution>();
  if (rng() >= 0.35 || occurrences.length === 0) return resolutions;
  const target = pick(occurrences, rng).occurrence;
  const confirmed = rng() < 0.5;
  const resolution = makeResolution({
    signatureId: target.signatureId,
    commit: `a${Math.floor(rng() * 0xffffffffffff).toString(16).padStart(12, '0')}`,
    author: `dev-${1 + Math.floor(rng() * 4)}`,
    confidence: confirmed ? 0.9 : 0.45,
    ...(confirmed ? { confirmedBy: 'dev-1', confirmedAt: new Date(NOW.getTime() - 3 * DAY_MS).toISOString() } : {}),
  });
  resolutions.set(target.signatureId, resolution);
  return resolutions;
}

/** Builds one scenario: its failures, sorted chronologically, and its fixes. */
export function buildScenario(index: number, rng: () => number): Scenario {
  const draw = rng();
  const kind: ScenarioKind = draw < 0.15 ? 'outbreak' : draw < 0.3 ? 'aged' : 'plain';
  const count = kind === 'outbreak' ? 3 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 6);
  const shapes = scenarioShapes(rng, kind);
  const instants = scenarioInstants(kind, count, rng);
  const occurrences = instants.map((at, step) =>
    buildGenerated(index, step, kind === 'outbreak' ? shapes[0] : pick(shapes, rng), at, rng),
  );
  if (kind === 'outbreak') {
    // One repository per failure: the outbreak needs distinct repositories.
    occurrences.forEach((generated, step) => {
      generated.occurrence.repo = REPOS[step % REPOS.length];
    });
  }
  occurrences.sort((a, b) => a.occurrence.occurredAt.localeCompare(b.occurrence.occurredAt));
  return { kind, occurrences, resolutions: buildResolutions(occurrences, rng) };
}

/** Builds the whole corpus with the fixed seed. */
export function buildCorpus(seed: number = SEED, cases: number = CASES): Scenario[] {
  const rng = mulberry32(seed);
  return Array.from({ length: cases }, (_, index) => buildScenario(index, rng));
}

/** True when the branch of the occurrence already carries the fix (§ 10.2). */
export function branchCarriesFix(occurrence: Occurrence, resolution?: Resolution): boolean {
  if (!resolution) return true;
  if (!resolution.confirmedAt) return false;
  return occurrence.occurredAt >= resolution.confirmedAt;
}

/** Occurrences of the same signature seen at or before the current one. */
function historyOf(occurrences: Occurrence[], current: Occurrence, family: boolean): Occurrence[] {
  return occurrences.filter((occurrence) => {
    const same = family
      ? occurrence.familyId === current.familyId
      : occurrence.signatureId === current.signatureId;
    return same && occurrence.id !== current.id && occurrence.occurredAt <= current.occurredAt;
  });
}

/** One diagnosis of the corpus, with the data it was built on. */
export interface Verdict {
  occurrence: Occurrence;
  diagnostic: Diagnostic;
  /** History of the signature plus the current occurrence. */
  pool: Occurrence[];
  resolution?: Resolution;
  /** Repositories of the outbreak in the window, 0 when there is none. */
  repos: number;
}

/** Runs the engine over one scenario, exactly like the live pipeline does. */
export function diagnoseScenario(scenario: Scenario, settings: Settings): Verdict[] {
  const all = scenario.occurrences.map((generated) => generated.occurrence);
  const verdicts: Verdict[] = [];
  for (const generated of scenario.occurrences) {
    const occurrence = generated.occurrence;
    const asOf = new Date(occurrence.occurredAt);
    const history = historyOf(all, occurrence, false);
    const family = historyOf(all, occurrence, true);
    const resolution = scenario.resolutions.get(occurrence.signatureId);
    const outbreak = detectOutbreak([...family, occurrence], { settings, now: asOf });
    const diagnostic = diagnose({
      occurrence,
      history,
      familyHistory: family,
      ...(resolution ? { resolution } : {}),
      branchContainsResolution: branchCarriesFix(occurrence, resolution),
      ...(outbreak ? { outbreak } : {}),
      settings,
      now: asOf,
      category: generated.block.category,
      frames: generated.block.frames,
      errorText: generated.block.rawText,
    });
    verdicts.push({
      occurrence,
      diagnostic,
      pool: [...history, occurrence],
      ...(resolution ? { resolution } : {}),
      repos: outbreak ? outbreak.repos.length : 0,
    });
  }
  return verdicts;
}

/**
 * Checks that every claim is backed by the data the verdict was built on.
 *
 * The rules are re-derived here from the raw occurrences, never from the
 * engine's own bookkeeping: a verdict that asserts something the data does
 * not prove is reported.
 */
export function evidenceViolations(verdict: Verdict, settings: Settings): Violation[] {
  const violations: Violation[] = [];
  const { diagnostic, pool } = verdict;
  const label = `${diagnostic.kind}/${diagnostic.signatureId} (${verdict.occurrence.id})`;
  if (diagnostic.kind === 'flaky') {
    const branches = new Set(pool.map((occurrence) => occurrence.branch)).size;
    if (pool.length < settings.flakyMinOccurrences || branches < settings.flakyMinBranches) {
      violations.push({
        invariant: 'flaky-needs-thresholds',
        detail: `${label}: ${pool.length} occurrence(s) on ${branches} branch(es)`,
      });
    }
    if (!pool.some((occurrence) => occurrence.passedOnRetry)) {
      violations.push({ invariant: 'flaky-needs-same-commit-pass', detail: label });
    }
  }
  if (diagnostic.kind === 'new' && pool.length > 1) {
    violations.push({ invariant: 'new-needs-empty-history', detail: `${label}: ${pool.length} occurrence(s)` });
  }
  if (diagnostic.kind === 'already-fixed' && !verdict.resolution) {
    violations.push({ invariant: 'fix-needs-resolution', detail: label });
  }
  if (diagnostic.kind === 'infrastructure' && verdict.repos > 0 && verdict.repos < settings.outbreakRepos) {
    violations.push({ invariant: 'infrastructure-needs-repos', detail: `${label}: ${verdict.repos} repositories` });
  }
  return violations;
}

/** Signature record of one occurrence, with its status moved by the engine. */
function signatureFor(generated: Generated, status: SignatureStatus, occurrences: number): Signature {
  return {
    id: generated.occurrence.signatureId,
    familyId: generated.occurrence.familyId,
    category: generated.block.category,
    errorType: generated.block.errorType,
    template: generated.block.message,
    frames: generated.block.frames,
    status,
    firstSeen: generated.occurrence.occurredAt,
    lastSeen: generated.occurrence.occurredAt,
    occurrences,
  };
}

/**
 * Plans the tickets of one scenario, keeping the ledger of each family.
 *
 * The ledger plays the part of Jira: one issue key per family and the date of
 * the last synthesis comment, so that "one ticket per family" and "one comment
 * per day" can be checked over a whole scenario.
 */
export function planScenarioTickets(scenario: Scenario, settings: Settings): TicketAction[] {
  const all = scenario.occurrences.map((generated) => generated.occurrence);
  const ledger = new Map<string, { issueKey?: string; lastCommentAt?: string }>();
  const statuses = new Map<string, SignatureStatus>();
  const applied = new Set<string>();
  const actions: TicketAction[] = [];
  let nextIssue = 1;
  for (const generated of scenario.occurrences) {
    const occurrence = generated.occurrence;
    const asOf = new Date(occurrence.occurredAt);
    const history = historyOf(all, occurrence, false);
    const verdict = assessFlakiness([...history, occurrence], { settings, now: asOf });
    const resolution = scenario.resolutions.get(occurrence.signatureId);
    const status = nextStatus(generated, history, verdict, resolution, statuses, applied);
    const signature = signatureFor(generated, status, history.length + 1);
    const state = ledger.get(occurrence.familyId) ?? {};
    const planned = planTicketActions({
      signature,
      occurrences: [...history, occurrence],
      verdict,
      ...(state.issueKey ? { existingIssueKey: state.issueKey } : {}),
      ...(state.lastCommentAt ? { lastCommentAt: state.lastCommentAt } : {}),
      now: asOf,
      settings,
    });
    actions.push(...planned);
    for (const action of planned) {
      if (action.kind === 'create' && !state.issueKey) state.issueKey = `CI-${nextIssue++}`;
      if (action.kind === 'create' || action.kind === 'comment' || action.kind === 'reopen') {
        state.lastCommentAt = occurrence.occurredAt;
      }
    }
    ledger.set(occurrence.familyId, state);
  }
  return actions;
}

/** Status of a signature after one more occurrence (§ 8.2, § 8.4). */
function nextStatus(
  generated: Generated,
  history: Occurrence[],
  verdict: { flaky: boolean },
  resolution: Resolution | undefined,
  statuses: Map<string, SignatureStatus>,
  applied: Set<string>,
): SignatureStatus {
  const occurrence = generated.occurrence;
  const previous = statuses.get(occurrence.signatureId);
  const hasFix = branchCarriesFix(occurrence, resolution);
  let status = statusAfterOccurrence(previous, resolution, hasFix);
  // A resolution that becomes known resolves the signature, like the replay.
  if (resolution && !applied.has(occurrence.signatureId)) {
    applied.add(occurrence.signatureId);
    status = 'resolved';
  }
  if (verdict.flaky && status === 'new' && history.length > 0) status = 'flaky';
  statuses.set(occurrence.signatureId, status);
  return status;
}
