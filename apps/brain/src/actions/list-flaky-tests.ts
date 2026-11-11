/**
 * Action `list-flaky-tests` (§ 13) — GET, `repository`, `days`.
 *
 * Rend les tests instables d'un dépôt, classés par **coût** décroissant
 * (minutes de CI perdues), comme l'onglet « Tests instables » de la page
 * « Mémoire de CI ». L'instabilité est décidée par le moteur
 * (`assessFlakiness`), le coût par le moteur (`computeCost`) : l'action ne
 * recalcule rien.
 */

import type { FlakyVerdict, Signature } from '@dejavu/core';
import { fail, ok, type ActionResult, type BrainEngine } from './engine.js';
import { defineAction, type RawInput } from './descriptor.js';
import { optionalCount, optionalText } from './validate.js';

/** Une ligne de la liste des tests instables. */
export interface FlakyTestRow {
  signatureId: string;
  signatureShort: string;
  testName: string;
  repository: string;
  category: Signature['category'];
  errorType: string;
  occurrences: number;
  branches: number;
  flakyIndex: number;
  ciMinutesLost: number;
  peopleAffected: number;
  retries: number;
  lastSeen: string;
  issueKey?: string;
}

/** Réponse de l'action. */
export interface ListFlakyTestsData {
  tests: FlakyTestRow[];
  windowDays: number;
  totalCiMinutesLost: number;
  summary: string;
}

/** Entrées de l'action. */
export interface ListFlakyTestsInput {
  repository?: string;
  days?: number;
}

/** Fenêtre par défaut (14 jours, comme le moteur). */
export const DEFAULT_WINDOW_DAYS = 14;

/** Déduit la ligne de coût d'une signature instable. */
function toRow(
  engine: BrainEngine,
  signature: Signature,
  verdict: FlakyVerdict,
  cost: { ciMinutesLost: number; peopleAffected: number; retries: number },
  repository: string,
): FlakyTestRow {
  return {
    signatureId: signature.id,
    signatureShort: engine.signatureShort(signature.id),
    testName: signature.testName ?? signature.template,
    repository,
    category: signature.category,
    errorType: signature.errorType,
    occurrences: verdict.occurrences,
    branches: verdict.branches,
    flakyIndex: verdict.flakyIndex,
    ciMinutesLost: cost.ciMinutesLost,
    peopleAffected: cost.peopleAffected,
    retries: cost.retries,
    lastSeen: signature.lastSeen,
    issueKey: signature.issueKey,
  };
}

/** Exécute l'action. */
export async function runListFlakyTests(
  engine: BrainEngine,
  raw: RawInput,
): Promise<ActionResult<ListFlakyTestsData>> {
  const repository = optionalText(raw.repository, 'repository');
  if (!repository.ok) return fail(repository.error);
  const days = optionalCount(raw.days, 'days', 365);
  if (!days.ok) return fail(days.error);
  const windowDays = days.value ? Number(days.value) : DEFAULT_WINDOW_DAYS;
  const settings = await engine.store.getSettings();

  const signatures = await engine.store.listSignatures();
  const groups = await Promise.all(
    signatures.map(async (signature) => {
      const occurrences = await engine.store.listOccurrences(signature.id);
      const scoped = repository.value
        ? occurrences.filter((o) => o.repo === repository.value)
        : occurrences;
      return { signature, occurrences: scoped };
    }),
  );

  const rows: FlakyTestRow[] = [];
  let totalCiMinutesLost = 0;
  for (const { signature, occurrences } of groups) {
    const verdict = engine.assessFlakiness(occurrences, { settings, now: engine.now() });
    if (!verdict.flaky) continue;
    const cost = engine.computeCost(occurrences, {
      windowDays,
      signatures: [signature],
      now: engine.now(),
    });
    const detail = cost.perSignature.find((c) => c.signatureId === signature.id);
    const minutes = detail?.ciMinutesLost ?? cost.ciMinutesLost;
    totalCiMinutesLost += minutes;
    rows.push(
      toRow(
        engine,
        signature,
        verdict,
        {
          ciMinutesLost: minutes,
          peopleAffected: detail?.peopleAffected ?? cost.peopleAffected,
          retries: detail?.retries ?? cost.retries,
        },
        repository.value || occurrences[0]?.repo || '',
      ),
    );
  }
  rows.sort((a, b) => (b.ciMinutesLost - a.ciMinutesLost) || (b.occurrences - a.occurrences));

  return ok({
    tests: rows,
    windowDays,
    totalCiMinutesLost,
    summary: `${rows.length} flaky test(s), ${totalCiMinutesLost} CI minute(s) lost`,
  });
}

/** Descripteur de l'action (§ 13). */
export const listFlakyTests = defineAction<ListFlakyTestsData>({
  key: 'list-flaky-tests',
  verb: 'GET',
  description:
    'List the flaky tests of a repository, ranked by CI cost (minutes lost), over a rolling window.',
  inputs: {
    repository: { type: 'string', description: 'Repository to inspect.' },
    days: { type: 'integer', description: 'Rolling window in days (default 14).' },
  },
  run: runListFlakyTests,
});
