/**
 * Generated corpus of failures (lot `core-inv`).
 *
 * The real sample set proves the engine on forty curated failures. This file
 * proves it on five hundred *generated* ones: random but reproducible (fixed
 * seed, no clock, no network), built from realistic failure shapes — flaky
 * tests, timeouts, network cuts, dependency resolution, missing images.
 *
 * The hunt is for the cases where the engine **asserts without proof**: a
 * failure called unstable without a same-commit success, a fix cited without a
 * resolution, an outbreak announced with a single repository, an excuse below
 * the confidence threshold, a second ticket for a family, a second synthesis
 * comment on the same day.
 *
 * The generator lives in `test/fakes/corpus.ts` and the rules in
 * `test/fakes/invariants.ts`, both shared with `invariants.test.ts`: written
 * once, checked twice.
 */

import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnose.js';
import { extractErrorBlocks } from '../src/extract.js';
import { signatureKeys } from '../src/sign.js';
import type { Diagnostic } from '../src/types.js';
import {
  BASE_SETTINGS,
  CASES,
  SEED,
  TEMPLATES,
  buildCorpus,
  diagnoseScenario,
  evidenceViolations,
  planScenarioTickets,
  type Verdict,
} from './fakes/corpus.js';
import {
  checkDiagnostic,
  checkTicketActions,
  describe as describeViolations,
  familyDays,
  makeOccurrence,
  type Violation,
} from './fakes/invariants.js';

/** The corpus, built once with the fixed seed. */
const corpus = buildCorpus();

/** A stricter confidence line, to exercise the prudence rule (§ 18). */
const STRICT_SETTINGS = { ...BASE_SETTINGS, minConfidenceNotYourFault: 0.9 };

/** Every diagnosis of the corpus, under both confidence lines. */
function allVerdicts(): Array<{ verdict: Verdict; strict: boolean }> {
  const entries: Array<{ verdict: Verdict; strict: boolean }> = [];
  for (const scenario of corpus) {
    for (const verdict of diagnoseScenario(scenario, BASE_SETTINGS)) entries.push({ verdict, strict: false });
    for (const verdict of diagnoseScenario(scenario, STRICT_SETTINGS)) entries.push({ verdict, strict: true });
  }
  return entries;
}

describe('generated corpus (500 reproducible cases)', () => {
  it('is reproducible: the same seed gives the same corpus', () => {
    const rebuilt = buildCorpus();
    expect(rebuilt.map((scenario) => scenario.occurrences.map((g) => g.occurrence.id))).toEqual(
      corpus.map((scenario) => scenario.occurrences.map((g) => g.occurrence.id)),
    );
    expect(rebuilt.map((scenario) => scenario.occurrences.map((g) => g.occurrence.signatureId))).toEqual(
      corpus.map((scenario) => scenario.occurrences.map((g) => g.occurrence.signatureId)),
    );
    expect(buildCorpus(SEED + 1, 20).map((s) => s.occurrences[0].occurrence.signatureId)).not.toEqual(
      buildCorpus(SEED, 20).map((s) => s.occurrences[0].occurrence.signatureId),
    );
  });

  it('never renders a diagnostic that breaks a rule', () => {
    const violations: Violation[] = [];
    for (const { verdict, strict } of allVerdicts()) {
      const settings = strict ? STRICT_SETTINGS : BASE_SETTINGS;
      violations.push(...checkDiagnostic(verdict.diagnostic, settings));
      violations.push(...evidenceViolations(verdict, settings));
    }
    expect(violations, describeViolations(violations.slice(0, 20))).toEqual([]);
  });

  it('keeps one ticket per family and one synthesis comment per day', () => {
    const violations: Violation[] = [];
    for (const scenario of corpus) {
      const actions = planScenarioTickets(scenario, BASE_SETTINGS);
      const days = familyDays(scenario.occurrences.map((generated) => generated.occurrence));
      violations.push(...checkTicketActions(actions, days));
    }
    expect(violations, describeViolations(violations.slice(0, 20))).toEqual([]);
  });

  it('gives the same identifier to the same failure, noise aside', () => {
    const byTemplate = new Map<string, Set<string>>();
    for (const scenario of corpus) {
      for (const generated of scenario.occurrences) {
        const set = byTemplate.get(generated.templateId) ?? new Set<string>();
        set.add(generated.occurrence.signatureId);
        byTemplate.set(generated.templateId, set);
      }
    }
    // Every shape of failure keeps one single signature, even though its stack
    // carries a different line number on every occurrence (§ 9.2).
    for (const [templateId, signatures] of byTemplate) {
      expect(signatures.size, `${templateId} produced ${signatures.size} signatures`).toBe(1);
    }
    expect(byTemplate.size).toBe(TEMPLATES.length);
  });

  it('never lets an exception escape the engine', () => {
    const pieces = ['', '   ', '\n\n', 'at x (y:1:2)', 'ERROR', '{}', 'null', 'é'.repeat(50), '<failure', 'npm ERR!'];
    for (let index = 0; index < 200; index += 1) {
      const junk = Array.from({ length: 1 + (index % 40) }, (_, piece) => pieces[(index + piece) % pieces.length]).join('\n');
      expect(() => extractErrorBlocks({ stepLog: junk })).not.toThrow();
      for (const block of extractErrorBlocks({ stepLog: junk }).blocks) {
        expect(() => signatureKeys(block)).not.toThrow();
        const diagnostic: Diagnostic = diagnose({
          occurrence: makeOccurrence({ signatureId: 'sig-junk', familyId: 'fam-junk' }),
          history: [],
          familyHistory: [],
          branchContainsResolution: true,
          settings: BASE_SETTINGS,
          category: block.category,
          frames: block.frames,
        });
        expect(checkDiagnostic(diagnostic, BASE_SETTINGS)).toEqual([]);
      }
    }
  });

  it('is rich enough to exercise every verdict and every ticket action', () => {
    const kinds = new Map<Diagnostic['kind'], number>();
    let outbreaks = 0;
    for (const scenario of corpus) {
      for (const verdict of diagnoseScenario(scenario, BASE_SETTINGS)) {
        kinds.set(verdict.diagnostic.kind, (kinds.get(verdict.diagnostic.kind) ?? 0) + 1);
        if (verdict.repos > 0) outbreaks += 1;
      }
    }
    const actions = new Map<string, number>();
    const scenarioKinds = new Map<string, number>();
    for (const scenario of corpus) {
      scenarioKinds.set(scenario.kind, (scenarioKinds.get(scenario.kind) ?? 0) + 1);
      for (const action of planScenarioTickets(scenario, BASE_SETTINGS)) {
        actions.set(action.kind, (actions.get(action.kind) ?? 0) + 1);
      }
    }
    // Otherwise the rules above would be checked on a corner of the engine.
    expect([...kinds.keys()].sort()).toEqual(['already-fixed', 'flaky', 'infrastructure', 'new', 'uncertain']);
    expect(outbreaks, 'no outbreak ever detected').toBeGreaterThan(0);
    expect(CASES).toBe(500);
    expect(scenarioKinds.get('outbreak') ?? 0).toBeGreaterThan(0);
    expect(scenarioKinds.get('aged') ?? 0).toBeGreaterThan(0);
    expect(actions.get('create') ?? 0).toBeGreaterThan(0);
    expect(actions.get('comment') ?? 0).toBeGreaterThan(0);
    expect(actions.get('update') ?? 0).toBeGreaterThan(0);
    expect(actions.get('reopen') ?? 0, 'no ticket ever reopened').toBeGreaterThan(0);
  });
});
