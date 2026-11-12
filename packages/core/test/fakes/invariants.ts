/**
 * Shared invariant checks of the diagnostic engine (lot `core-inv`).
 *
 * The same rules are verified in two places: on the real sample dataset
 * (`invariants.test.ts`) and on a generated corpus (`invariants-fuzz.test.ts`).
 * The rules therefore live here, once, and both test files call them. Nothing
 * here duplicates engine logic: each check re-derives the expected property
 * from the *data* the diagnostic was built on, never from the engine's own
 * verdict, so a diagnostic that asserts something the data does not prove is
 * reported as a violation.
 *
 * Pure module: no I/O, no clock — every reference date is injected.
 */

import { DEFAULT_SETTINGS } from '../../src/types.js';
import type {
  Diagnostic,
  Occurrence,
  Resolution,
  Settings,
  Signature,
  TicketAction,
} from '../../src/types.js';

/** One broken rule, with enough detail to reproduce it. */
export interface Violation {
  /** Short identifier of the rule (used in test messages). */
  invariant: string;
  /** What was observed, with the values that broke the rule. */
  detail: string;
}

/** Verdicts that excuse the pull request (§ 18 "Prudence"). */
const EXCUSING_KINDS: ReadonlySet<Diagnostic['kind']> = new Set(['flaky', 'infrastructure']);

/** Maximum length of a diagnostic title (§ 10, `diagnose.ts`). */
const MAX_TITLE_LENGTH = 90;

/** Merge the caller settings over the frozen defaults. */
export function resolveSettings(settings?: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...settings };
}

/** Value of one fact of a diagnostic, by label. */
export function factValue(diagnostic: Diagnostic, label: string): string | undefined {
  return diagnostic.facts?.find((fact) => fact.label === label)?.value;
}

/** UTC day (`YYYY-MM-DD`) of an ISO instant, used by the comment brake. */
export function dayKey(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

/** Distinct UTC days on which each family had an occurrence. */
export function familyDays(occurrences: Occurrence[]): Map<string, Set<string>> {
  const days = new Map<string, Set<string>>();
  for (const occurrence of occurrences) {
    const day = dayKey(occurrence.occurredAt);
    if (day === '') continue;
    const set = days.get(occurrence.familyId) ?? new Set<string>();
    set.add(day);
    days.set(occurrence.familyId, set);
  }
  return days;
}

/** Every diagnostic must carry the facts that justify it (§ 18). */
function checkEvidence(diagnostic: Diagnostic): Violation[] {
  const violations: Violation[] = [];
  const label = `${diagnostic.kind}/${diagnostic.signatureId}`;
  if (!diagnostic.facts || diagnostic.facts.length === 0) {
    violations.push({ invariant: 'facts-required', detail: `${label}: no fact at all` });
  }
  if (!(diagnostic.confidence >= 0 && diagnostic.confidence <= 1)) {
    violations.push({
      invariant: 'confidence-range',
      detail: `${label}: confidence ${diagnostic.confidence} is outside 0..1`,
    });
  }
  if (diagnostic.title.length > MAX_TITLE_LENGTH) {
    violations.push({
      invariant: 'title-length',
      detail: `${label}: title is ${diagnostic.title.length} characters`,
    });
  }
  if (!diagnostic.signatureId) {
    violations.push({ invariant: 'signature-required', detail: `${label}: no signature id` });
  }
  if (!/^S-\d{3}$/.test(diagnostic.signatureShort)) {
    violations.push({
      invariant: 'short-id-format',
      detail: `${label}: short id "${diagnostic.signatureShort}" is not S-nnn`,
    });
  }
  return violations;
}

/** Below the confidence line, a verdict that excuses becomes `uncertain`. */
function checkPrudence(diagnostic: Diagnostic, settings: Settings): Violation[] {
  const violations: Violation[] = [];
  const label = `${diagnostic.kind}/${diagnostic.signatureId}`;
  if (EXCUSING_KINDS.has(diagnostic.kind) && diagnostic.confidence < settings.minConfidenceNotYourFault) {
    violations.push({
      invariant: 'prudence',
      detail:
        `${label}: excusing verdict rendered with confidence ${diagnostic.confidence} ` +
        `< ${settings.minConfidenceNotYourFault} (must be uncertain)`,
    });
  }
  if (diagnostic.kind === 'uncertain' && diagnostic.action !== 'none') {
    violations.push({
      invariant: 'uncertain-no-action',
      detail: `${label}: uncertain verdict proposes action "${diagnostic.action}"`,
    });
  }
  return violations;
}

/** `flaky` needs a same-commit success, or at least the thresholds met. */
function checkFlaky(diagnostic: Diagnostic, settings: Settings): Violation[] {
  if (diagnostic.kind !== 'flaky') return [];
  const passed = factValue(diagnostic, 'Passed at the same commit') === 'yes';
  const stats = diagnostic.stats;
  const thresholds =
    stats !== undefined &&
    stats.occurrences >= settings.flakyMinOccurrences &&
    stats.branches >= settings.flakyMinBranches;
  if (passed || thresholds) return [];
  return [
    {
      invariant: 'flaky-needs-proof',
      detail:
        `flaky/${diagnostic.signatureId}: neither a same-commit success nor the thresholds ` +
        `(${stats?.occurrences ?? '?'} occurrence(s) on ${stats?.branches ?? '?'} branch(es), ` +
        `required ${settings.flakyMinOccurrences} on ${settings.flakyMinBranches})`,
    },
  ];
}

/** `already-fixed` cites a real resolution: commit, author, confirmation. */
function checkAlreadyFixed(diagnostic: Diagnostic): Violation[] {
  if (diagnostic.kind !== 'already-fixed') return [];
  const resolution = diagnostic.resolution;
  if (!resolution) {
    return [{ invariant: 'fix-needs-resolution', detail: `already-fixed/${diagnostic.signatureId}: no resolution cited` }];
  }
  const violations: Violation[] = [];
  if (!resolution.commit) {
    violations.push({
      invariant: 'fix-needs-commit',
      detail: `already-fixed/${diagnostic.signatureId}: resolution has no commit`,
    });
  }
  if (!resolution.author) {
    violations.push({
      invariant: 'fix-needs-author',
      detail: `already-fixed/${diagnostic.signatureId}: resolution has no author`,
    });
  }
  // A candidate (unconfirmed) resolution must never look like a confirmed fix.
  if (resolution.confirmed && diagnostic.confidence < 0.9) {
    violations.push({
      invariant: 'confirmed-fix-confidence',
      detail: `already-fixed/${diagnostic.signatureId}: confirmed resolution with confidence ${diagnostic.confidence}`,
    });
  }
  if (!resolution.confirmed && diagnostic.confidence >= 0.9) {
    violations.push({
      invariant: 'candidate-fix-confidence',
      detail: `already-fixed/${diagnostic.signatureId}: candidate resolution presented at confidence ${diagnostic.confidence}`,
    });
  }
  return violations;
}

/** `new` never claims a fix: it points at the change, not at a resolution. */
function checkNew(diagnostic: Diagnostic): Violation[] {
  if (diagnostic.kind !== 'new') return [];
  const violations: Violation[] = [];
  if (diagnostic.resolution) {
    violations.push({
      invariant: 'new-claims-fix',
      detail: `new/${diagnostic.signatureId}: cites resolution ${diagnostic.resolution.commit}`,
    });
  }
  if (diagnostic.action === 'rebase') {
    violations.push({
      invariant: 'new-claims-fix',
      detail: `new/${diagnostic.signatureId}: asks to rebase onto an unknown fix`,
    });
  }
  return violations;
}

/** `infrastructure` that cites repositories cites enough of them (§ 10.3). */
function checkInfrastructure(diagnostic: Diagnostic, settings: Settings): Violation[] {
  if (diagnostic.kind !== 'infrastructure') return [];
  const hit = Number(factValue(diagnostic, 'Repositories hit') ?? '0');
  if (!Number.isFinite(hit) || hit === 0) return [];
  const listed = (factValue(diagnostic, 'Repositories') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const violations: Violation[] = [];
  if (hit < settings.outbreakRepos) {
    violations.push({
      invariant: 'infrastructure-needs-repos',
      detail: `infrastructure/${diagnostic.signatureId}: ${hit} repositories < ${settings.outbreakRepos}`,
    });
  }
  if (new Set(listed).size !== hit) {
    violations.push({
      invariant: 'infrastructure-repos-consistent',
      detail: `infrastructure/${diagnostic.signatureId}: ${hit} claimed, ${new Set(listed).size} listed`,
    });
  }
  return violations;
}

/** All the rules a single diagnostic must satisfy. */
export function checkDiagnostic(diagnostic: Diagnostic, settings?: Partial<Settings>): Violation[] {
  const resolved = resolveSettings(settings);
  return [
    ...checkEvidence(diagnostic),
    ...checkPrudence(diagnostic, resolved),
    ...checkFlaky(diagnostic, resolved),
    ...checkAlreadyFixed(diagnostic),
    ...checkNew(diagnostic),
    ...checkInfrastructure(diagnostic, resolved),
  ];
}

/**
 * Ticket rules (§ 11): one ticket per family, one issue key per family, and at
 * most one synthesis comment per day and per family.
 *
 * `familyDays` is optional: when given, the comment count of a family is
 * checked against the number of distinct days on which it had occurrences.
 */
export function checkTicketActions(
  actions: TicketAction[],
  familyDays?: Map<string, Set<string>>,
): Violation[] {
  const violations: Violation[] = [];
  const creates = new Map<string, number>();
  const comments = new Map<string, number>();
  const keys = new Map<string, Set<string>>();
  for (const action of actions) {
    if (action.kind === 'create') {
      creates.set(action.familyId, (creates.get(action.familyId) ?? 0) + 1);
    } else {
      const set = keys.get(action.familyId) ?? new Set<string>();
      if (action.issueKey) set.add(action.issueKey);
      keys.set(action.familyId, set);
    }
    if (action.kind === 'comment') {
      comments.set(action.familyId, (comments.get(action.familyId) ?? 0) + 1);
    }
  }
  for (const [family, count] of creates) {
    if (count > 1) {
      violations.push({ invariant: 'one-ticket-per-family', detail: `family ${family}: ${count} creations` });
    }
  }
  for (const [family, set] of keys) {
    if (set.size > 1) {
      violations.push({
        invariant: 'one-ticket-per-family',
        detail: `family ${family}: actions target ${set.size} different issues (${[...set].join(', ')})`,
      });
    }
  }
  if (familyDays) {
    for (const [family, count] of comments) {
      const days = familyDays.get(family)?.size ?? 0;
      if (count > days) {
        violations.push({
          invariant: 'one-comment-per-day',
          detail: `family ${family}: ${count} synthesis comments for ${days} day(s) with occurrences`,
        });
      }
    }
  }
  return violations;
}

/** An occurrence with sensible defaults; every field can be overridden. */
export function makeOccurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: 'occ-1',
    signatureId: 'sig-1',
    familyId: 'fam-1',
    workspace: 'sample',
    repo: 'acme/api',
    branch: 'feature/a',
    commit: 'c0ffee1',
    author: 'dev-1',
    stepName: 'test',
    durationS: 90,
    occurredAt: '2026-11-10T10:00:00.000Z',
    passedOnRetry: false,
    ...overrides,
  };
}

/** A resolution with sensible defaults. */
export function makeResolution(overrides: Partial<Resolution> = {}): Resolution {
  return {
    id: 'res-1',
    signatureId: 'sig-1',
    commit: 'abc1234deadbeef',
    author: 'dev-2',
    files: ['src/main.java'],
    note: 'fixed the null token',
    confidence: 0.9,
    ...overrides,
  };
}

/** A signature with sensible defaults. */
export function makeSignature(overrides: Partial<Signature> = {}): Signature {
  return {
    id: 'sig-1',
    familyId: 'fam-1',
    category: 'test',
    errorType: 'AssertionError',
    template: 'expected 1 to be 2',
    frames: [],
    status: 'known',
    firstSeen: '2026-11-01T10:00:00.000Z',
    lastSeen: '2026-11-10T10:00:00.000Z',
    occurrences: 1,
    ...overrides,
  };
}

/** A diagnostic with sensible defaults, for the checks' own tests. */
export function makeDiagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    kind: 'uncertain',
    confidence: 0.4,
    title: 'Uncertain — not enough history',
    summary: 'Facts below.',
    action: 'none',
    facts: [{ label: 'Occurrences', value: '1' }],
    signatureId: 'sig-1',
    signatureShort: 'S-001',
    ...overrides,
  };
}

/** Formats violations so a failure reads as a reproduction recipe. */
export function describe(violations: Violation[]): string {
  return violations.map((v) => `[${v.invariant}] ${v.detail}`).join('\n');
}
