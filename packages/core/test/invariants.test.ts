/**
 * Invariants of the diagnostic engine (lot `core-inv`).
 *
 * The engine must never break the rules of § 5, § 10, § 11 and § 18 — not on
 * the real sample dataset, and not on crafted inputs. This file verifies them
 * on the replay of `data/sample/occurrences.json` (the forty real failures of
 * the sample set) and on generated contexts that isolate one rule at a time.
 *
 * The rules themselves live in `test/fakes/invariants.ts`, shared with the
 * generated corpus of `invariants-fuzz.test.ts`: written once, checked twice.
 *
 * No clock, no network: the reference instant is injected.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectOutbreak } from '../src/outbreak.js';
import { diagnose } from '../src/diagnose.js';
import { extractErrorBlocks } from '../src/extract.js';
import { staticReplayEngine } from '../src/engine.js';
import { replayWithEngine } from '../src/replay.js';
import { planTicketActions } from '../src/tickets.js';
import { signatureKeys } from '../src/sign.js';
import { MemoryStore } from '../src/store.js';
import type {
  Diagnostic,
  Occurrence,
  ReplayResult,
  SampleDataset,
  Settings,
} from '../src/types.js';
import {
  checkDiagnostic,
  checkTicketActions,
  describe as describeViolations,
  familyDays,
  makeDiagnostic,
  makeOccurrence,
  makeResolution,
  makeSignature,
  type Violation,
} from './fakes/invariants.js';

/** The real sample dataset: forty failures over fourteen days. */
const DATASET_URL = new URL('../../../data/sample/occurrences.json', import.meta.url);
const dataset = JSON.parse(readFileSync(DATASET_URL, 'utf8')) as SampleDataset;

/** Reference instant of the replay: the day after the last sample failure. */
const NOW = new Date('2026-11-15T00:00:00.000Z');

/** Settings of the crafted contexts. */
const SETTINGS: Settings = {
  issueProjectKey: 'CI',
  flakyMinOccurrences: 3,
  flakyMinBranches: 2,
  flakyWindowDays: 14,
  outbreakRepos: 3,
  outbreakWindowMin: 15,
  rawRetentionDays: 30,
  minConfidenceNotYourFault: 0.75,
};

describe('sample dataset replayed through the engine', () => {
  let result: ReplayResult;
  let store: MemoryStore;

  beforeAll(async () => {
    store = new MemoryStore();
    result = await replayWithEngine(dataset, staticReplayEngine(), { now: NOW, store });
  });

  it('produces the four diagnostics of the sample set', () => {
    expect(result.byKind.flaky).toBeGreaterThan(0);
    expect(result.byKind['already-fixed']).toBeGreaterThan(0);
    expect(result.byKind.new).toBeGreaterThan(0);
    expect(result.byKind.infrastructure).toBeGreaterThan(0);
    expect(result.occurrences).toBe(40);
  });

  it('never renders a diagnostic without facts', () => {
    const violations = result.diagnostics.flatMap((entry) => checkDiagnostic(entry.diagnostic, SETTINGS));
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('never calls a failure unstable without a same-commit success', async () => {
    const flaky = result.diagnostics.filter((entry) => entry.diagnostic.kind === 'flaky');
    expect(flaky.length).toBeGreaterThan(0);
    const dayMs = 86_400_000;
    for (const entry of flaky) {
      const diagnostic = entry.diagnostic;
      expect(diagnostic.facts.map((fact) => `${fact.label}=${fact.value}`)).toContain(
        'Passed at the same commit=yes',
      );
      // Re-derive § 10.1 from the memory alone: the claim must be backed by
      // stored data, not by the engine's own bookkeeping.
      const known = await store.listOccurrences(diagnostic.signatureId);
      const asOf = Date.parse(entry.occurrence.occurredAt);
      const since = asOf - SETTINGS.flakyWindowDays * dayMs;
      const windowed = known.filter((occurrence) => {
        const at = Date.parse(occurrence.occurredAt);
        return at >= since && at <= asOf;
      });
      expect(windowed.length, `fewer than ${SETTINGS.flakyMinOccurrences} stored occurrences`).toBeGreaterThanOrEqual(
        SETTINGS.flakyMinOccurrences,
      );
      expect(new Set(windowed.map((occurrence) => occurrence.branch)).size).toBeGreaterThanOrEqual(
        SETTINGS.flakyMinBranches,
      );
      expect(
        windowed.some((occurrence) => occurrence.passedOnRetry),
        `no same-commit success stored for ${diagnostic.signatureId}`,
      ).toBe(true);
    }
  });

  it('never cites a fix without a resolution behind it', () => {
    const fixed = result.diagnostics.filter((entry) => entry.diagnostic.kind === 'already-fixed');
    expect(fixed.length).toBeGreaterThan(0);
    for (const entry of fixed) {
      const resolution = entry.diagnostic.resolution;
      expect(resolution).toBeDefined();
      expect(resolution?.commit).not.toBe('');
      expect(resolution?.author).not.toBe('');
      // A candidate fix is never dressed up as a confirmed one.
      if (resolution?.confirmed) expect(entry.diagnostic.confidence).toBeGreaterThanOrEqual(0.9);
      else expect(entry.diagnostic.confidence).toBeLessThan(0.9);
    }
  });

  it('never claims a fix on a new failure', () => {
    const fresh = result.diagnostics.filter((entry) => entry.diagnostic.kind === 'new');
    expect(fresh.length).toBeGreaterThan(0);
    for (const entry of fresh) {
      expect(entry.diagnostic.resolution).toBeUndefined();
      expect(entry.diagnostic.action).toBe('fix');
    }
  });

  it('never blames the infrastructure without several repositories', () => {
    const infra = result.diagnostics.filter((entry) => entry.diagnostic.kind === 'infrastructure');
    expect(infra.length).toBeGreaterThan(0);
    for (const entry of infra) {
      const hit = entry.diagnostic.facts.find((fact) => fact.label === 'Repositories hit');
      // No outbreak cited: the verdict rests on the category alone (§ 10.3).
      if (hit && Number(hit.value) > 0) {
        expect(Number(hit.value)).toBeGreaterThanOrEqual(SETTINGS.outbreakRepos);
      }
    }
  });

  it('never excuses a pull request below the confidence threshold', () => {
    for (const entry of result.diagnostics) {
      const diagnostic = entry.diagnostic;
      if (diagnostic.kind === 'flaky' || diagnostic.kind === 'infrastructure') {
        expect(diagnostic.confidence).toBeGreaterThanOrEqual(SETTINGS.minConfidenceNotYourFault);
      }
      if (diagnostic.kind === 'uncertain') expect(diagnostic.action).toBe('none');
    }
  });

  it('keeps one ticket per family and one synthesis comment per day', () => {
    const days = familyDays(result.diagnostics.map((entry) => entry.occurrence));
    const violations = checkTicketActions(result.tickets, days);
    expect(violations, describeViolations(violations)).toEqual([]);
    const created = result.tickets.filter((action) => action.kind === 'create');
    expect(new Set(created.map((action) => action.familyId)).size).toBe(created.length);
  });

  it('gives the same identifier to the same signature, on every replay', async () => {
    const again = await replayWithEngine(dataset, staticReplayEngine(), { now: NOW });
    expect(again.signatures.map((signature) => signature.id)).toEqual(
      result.signatures.map((signature) => signature.id),
    );
    const failure = dataset.occurrences.find((occurrence) => occurrence.outcome === 'failure');
    expect(failure).toBeDefined();
    const first = extractErrorBlocks({ stepLog: failure?.log });
    const second = extractErrorBlocks({ stepLog: failure?.log });
    expect(first.blocks.length).toBeGreaterThan(0);
    expect(signatureKeys(first.blocks[0])).toEqual(signatureKeys(second.blocks[0]));
  });

  it('keeps every raw excerpt until the configured retention expires', async () => {
    const memory = new MemoryStore();
    const alive = '2026-11-15T00:00:00.000Z';
    const expired = '2026-11-01T00:00:00.000Z';
    await memory.saveRawExcerpt({ occurrenceId: 'occ-alive', text: 'fresh', expiresAt: alive });
    await memory.saveRawExcerpt({ occurrenceId: 'occ-expired', text: 'old', expiresAt: expired });
    const purged = await memory.purgeExpired(NOW);
    expect(purged).toBe(1);
    expect(await memory.purgeExpired(NOW)).toBe(0);
  });
});

/** Three occurrences on two branches, one of them passed at the same commit. */
function flakyHistory(): Occurrence[] {
  return [
    makeOccurrence({ id: 'o1', branch: 'feature/a', commit: 'c1', occurredAt: '2026-11-10T10:00:00.000Z' }),
    makeOccurrence({ id: 'o2', branch: 'feature/b', commit: 'c2', occurredAt: '2026-11-11T10:00:00.000Z' }),
    makeOccurrence({
      id: 'o3',
      branch: 'feature/a',
      commit: 'c3',
      occurredAt: '2026-11-12T10:00:00.000Z',
      passedOnRetry: true,
    }),
  ];
}

describe('generated inputs', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');

  it('calls a failure unstable only with a same-commit success', () => {
    const history = flakyHistory().map((occurrence) => ({ ...occurrence, passedOnRetry: false }));
    const diagnostic = diagnose({
      occurrence: makeOccurrence({ id: 'o4', branch: 'feature/c', commit: 'c4' }),
      history,
      familyHistory: history,
      branchContainsResolution: true,
      settings: SETTINGS,
      now,
      category: 'test',
    });
    expect(diagnostic.kind).toBe('uncertain');
    expect(checkDiagnostic(diagnostic, SETTINGS)).toEqual([]);
  });

  it('calls a failure unstable with a same-commit success', () => {
    const history = flakyHistory();
    const diagnostic = diagnose({
      occurrence: makeOccurrence({ id: 'o4', branch: 'feature/c', commit: 'c4' }),
      history,
      familyHistory: history,
      branchContainsResolution: true,
      settings: SETTINGS,
      now,
      category: 'test',
    });
    expect(diagnostic.kind).toBe('flaky');
    expect(checkDiagnostic(diagnostic, SETTINGS)).toEqual([]);
  });

  it('tells a confirmed fix from a candidate one', () => {
    const base = {
      occurrence: makeOccurrence({ id: 'o1' }),
      history: [],
      familyHistory: [],
      branchContainsResolution: false,
      settings: SETTINGS,
      now,
      category: 'test' as const,
    };
    const confirmed = diagnose({
      ...base,
      resolution: makeResolution({ confirmedBy: 'dev-2', confirmedAt: '2026-11-09T10:00:00.000Z' }),
    });
    const candidate = diagnose({ ...base, resolution: makeResolution({ confidence: 0.45 }) });
    expect(confirmed.kind).toBe('already-fixed');
    expect(confirmed.resolution?.confirmed).toBe(true);
    expect(confirmed.confidence).toBeGreaterThanOrEqual(0.9);
    expect(candidate.kind).toBe('already-fixed');
    expect(candidate.resolution?.confirmed).toBe(false);
    expect(candidate.confidence).toBeLessThan(0.9);
    expect(checkDiagnostic(confirmed, SETTINGS)).toEqual([]);
    expect(checkDiagnostic(candidate, SETTINGS)).toEqual([]);
  });

  it('falls back to uncertain below the confidence threshold', () => {
    const diagnostic = diagnose({
      occurrence: makeOccurrence({ id: 'o1' }),
      history: [],
      familyHistory: [],
      branchContainsResolution: true,
      settings: { ...SETTINGS, minConfidenceNotYourFault: 0.9 },
      now,
      category: 'dependency',
    });
    expect(diagnostic.kind).toBe('uncertain');
    expect(diagnostic.action).toBe('none');
    expect(diagnostic.facts.length).toBeGreaterThan(0);
  });

  it('requires several repositories inside the window for an outbreak', () => {
    const two = [
      makeOccurrence({ id: 'o1', repo: 'acme/a', occurredAt: '2026-11-12T10:00:00.000Z' }),
      makeOccurrence({ id: 'o2', repo: 'acme/b', occurredAt: '2026-11-12T10:05:00.000Z' }),
    ];
    expect(detectOutbreak(two, { settings: SETTINGS, now })).toBeUndefined();
    const three = [
      ...two,
      makeOccurrence({ id: 'o3', repo: 'acme/c', occurredAt: '2026-11-12T10:10:00.000Z' }),
    ];
    const outbreak = detectOutbreak(three, { settings: SETTINGS, now });
    expect(outbreak?.repos).toEqual(['acme/a', 'acme/b', 'acme/c']);
    const diagnostic: Diagnostic = diagnose({
      occurrence: makeOccurrence({ id: 'o3', repo: 'acme/c' }),
      history: [],
      familyHistory: [],
      branchContainsResolution: true,
      outbreak,
      settings: SETTINGS,
      now,
      category: 'test',
    });
    expect(diagnostic.kind).toBe('infrastructure');
    expect(checkDiagnostic(diagnostic, SETTINGS)).toEqual([]);
  });
});

describe('ticket planner (§ 11)', () => {
  const signature = makeSignature({ id: 'sig-1', familyId: 'fam-1' });

  it('opens at most one ticket per family and comments once per day', () => {
    const occurrences = [
      makeOccurrence({ id: 'o1', occurredAt: '2026-11-10T09:00:00.000Z' }),
      makeOccurrence({ id: 'o2', branch: 'feature/b', commit: 'c2', occurredAt: '2026-11-10T15:00:00.000Z' }),
    ];
    const verdict = { flaky: true, reasons: [], occurrences: 2, branches: 2, sameCommitPass: true, flakyIndex: 0.5 };
    const first = planTicketActions({
      signature,
      occurrences: [occurrences[0]],
      verdict,
      now: new Date(occurrences[0].occurredAt),
      settings: SETTINGS,
    });
    expect(first.map((action) => action.kind)).toEqual(['create']);
    // The same day, on the same family: the ticket exists, no second comment.
    const second = planTicketActions({
      signature,
      occurrences,
      verdict,
      existingIssueKey: 'CI-1',
      lastCommentAt: occurrences[0].occurredAt,
      now: new Date(occurrences[1].occurredAt),
      settings: SETTINGS,
    });
    expect(second.map((action) => action.kind)).not.toContain('create');
    expect(second.map((action) => action.kind)).not.toContain('comment');
    expect(checkTicketActions([...first, ...second], familyDays(occurrences))).toEqual([]);
  });

  it('proposes closure after a fortnight of silence, without a comment', () => {
    const stale = [makeOccurrence({ id: 'o1', occurredAt: '2026-10-27T09:00:00.000Z' })];
    const actions = planTicketActions({
      signature,
      occurrences: stale,
      existingIssueKey: 'CI-1',
      lastCommentAt: stale[0].occurredAt,
      now: NOW,
      settings: SETTINGS,
    });
    expect(actions.map((action) => action.kind)).toContain('close-suggested');
    expect(actions.map((action) => action.kind)).not.toContain('comment');
    expect(checkTicketActions(actions, familyDays(stale))).toEqual([]);
  });
});

/**
 * The checks themselves.
 *
 * An invariant test that cannot fail is worse than no test at all: these cases
 * feed the shared rules deliberately broken diagnostics and ticket plans, and
 * require a violation for each one. They are what proves that the assertions
 * above are not vacuous.
 */
describe('the rules catch the violations they exist for', () => {
  const broken: Array<[string, Violation[]]> = [
    ['facts-required', checkDiagnostic(makeDiagnostic({ facts: [] }))],
    ['confidence-range', checkDiagnostic(makeDiagnostic({ confidence: 1.5 }))],
    ['title-length', checkDiagnostic(makeDiagnostic({ title: 'x'.repeat(91) }))],
    ['short-id-format', checkDiagnostic(makeDiagnostic({ signatureShort: 'sig-1' }))],
    [
      'prudence',
      checkDiagnostic(makeDiagnostic({ kind: 'flaky', confidence: 0.5, action: 'retry' }), SETTINGS),
    ],
    ['uncertain-no-action', checkDiagnostic(makeDiagnostic({ kind: 'uncertain', action: 'retry' }))],
    [
      'flaky-needs-proof',
      checkDiagnostic(
        makeDiagnostic({
          kind: 'flaky',
          confidence: 0.95,
          action: 'retry',
          facts: [{ label: 'Passed at the same commit', value: 'no' }],
          stats: { occurrences: 1, branches: 1, repos: 1, firstSeen: '', lastSeen: '' },
        }),
        SETTINGS,
      ),
    ],
    ['fix-needs-resolution', checkDiagnostic(makeDiagnostic({ kind: 'already-fixed', confidence: 0.9, action: 'rebase' }))],
    [
      'candidate-fix-confidence',
      checkDiagnostic(
        makeDiagnostic({
          kind: 'already-fixed',
          confidence: 0.95,
          action: 'rebase',
          resolution: { commit: 'abc1234', author: 'dev-2', files: [], confirmed: false },
        }),
      ),
    ],
    [
      'new-claims-fix',
      checkDiagnostic(
        makeDiagnostic({
          kind: 'new',
          confidence: 0.85,
          action: 'fix',
          resolution: { commit: 'abc1234', author: 'dev-2', files: [], confirmed: true },
        }),
      ),
    ],
    [
      'infrastructure-needs-repos',
      checkDiagnostic(
        makeDiagnostic({
          kind: 'infrastructure',
          confidence: 0.9,
          action: 'wait',
          facts: [
            { label: 'Repositories hit', value: '2' },
            { label: 'Repositories', value: 'acme/a, acme/b' },
          ],
        }),
        SETTINGS,
      ),
    ],
    [
      'infrastructure-repos-consistent',
      checkDiagnostic(
        makeDiagnostic({
          kind: 'infrastructure',
          confidence: 0.9,
          action: 'wait',
          facts: [
            { label: 'Repositories hit', value: '3' },
            { label: 'Repositories', value: 'acme/a, acme/a, acme/b' },
          ],
        }),
        SETTINGS,
      ),
    ],
    [
      'one-ticket-per-family',
      checkTicketActions([
        { kind: 'create', familyId: 'fam-1', signatureId: 'sig-1', summary: 'a' },
        { kind: 'create', familyId: 'fam-1', signatureId: 'sig-2', summary: 'b' },
      ]),
    ],
    [
      'one-comment-per-day',
      checkTicketActions(
        [
          { kind: 'comment', familyId: 'fam-1', signatureId: 'sig-1', summary: 'a', issueKey: 'CI-1' },
          { kind: 'comment', familyId: 'fam-1', signatureId: 'sig-1', summary: 'a', issueKey: 'CI-1' },
        ],
        new Map([['fam-1', new Set(['2026-11-10'])]]),
      ),
    ],
  ];

  it.each(broken)('reports %s', (invariant, violations) => {
    expect(violations.map((violation) => violation.invariant)).toContain(invariant);
  });

  it('accepts a well-formed diagnostic', () => {
    expect(checkDiagnostic(makeDiagnostic(), SETTINGS)).toEqual([]);
    expect(
      checkDiagnostic(
        makeDiagnostic({
          kind: 'flaky',
          confidence: 0.95,
          action: 'retry',
          facts: [{ label: 'Passed at the same commit', value: 'yes' }],
        }),
        SETTINGS,
      ),
    ).toEqual([]);
    expect(checkTicketActions([])).toEqual([]);
  });
});
