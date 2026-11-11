/**
 * Action `explain-build-failure` (§ 13) — GET, `issueKey` ou `buildUrl`.
 *
 * Le diagnostic rendu est **le même** que celui de la carte de PR : la
 * fonction `diagnose` du moteur est appelée une seule fois, avec le contexte
 * construit par `buildDiagnoseContext`. Aucun calcul parallèle n'existe dans
 * le Cerveau (recette § 20, point 8).
 */

import type { Diagnostic } from '@dejavu/core';
import { diagnoseFor, latestOccurrence, signatureForIssue } from './context.js';
import { defineAction, type RawInput } from './descriptor.js';
import { fail, ok, type ActionResult, type BrainEngine } from './engine.js';
import { optionalText } from './validate.js';

/** Réponse de l'action. */
export interface ExplainBuildFailureData {
  diagnostic: Diagnostic;
  confidence: number;
  justification: string[];
  action: Diagnostic['action'];
}

/** Entrées de l'action. */
export interface ExplainBuildFailureInput {
  issueKey?: string;
  buildUrl?: string;
}

/** Trouve l'occurrence visée par une clé de ticket ou une URL de build. */
async function locateOccurrence(
  engine: BrainEngine,
  input: ExplainBuildFailureInput,
): Promise<Awaited<ReturnType<typeof latestOccurrence>>> {
  if (input.buildUrl) {
    const signatures = await engine.store.listSignatures();
    const groups = await Promise.all(signatures.map((s) => engine.store.listOccurrences(s.id)));
    return groups.flat().find((o) => o.buildUrl === input.buildUrl);
  }
  const signature = await signatureForIssue(engine, input.issueKey ?? '');
  if (!signature) return undefined;
  return latestOccurrence(await engine.store.listOccurrences(signature.id));
}

/** Justification lisible : les faits, puis les preuves brutes. */
function justification(diagnostic: Diagnostic): string[] {
  const facts = diagnostic.facts.map((fact) => `${fact.label}: ${fact.value}`);
  const evidence = (diagnostic.evidence ?? []).map((item) => item);
  return [...facts, ...evidence];
}

/** Exécute l'action. */
export async function runExplainBuildFailure(
  engine: BrainEngine,
  raw: RawInput,
): Promise<ActionResult<ExplainBuildFailureData>> {
  const issueKey = optionalText(raw.issueKey, 'issueKey');
  if (!issueKey.ok) return fail(issueKey.error);
  const buildUrl = optionalText(raw.buildUrl, 'buildUrl');
  if (!buildUrl.ok) return fail(buildUrl.error);
  if (!issueKey.value && !buildUrl.value) {
    return fail('issueKey or buildUrl is required');
  }
  const occurrence = await locateOccurrence(engine, {
    issueKey: issueKey.value || undefined,
    buildUrl: buildUrl.value || undefined,
  });
  if (!occurrence) return fail('no known failure matches this request');
  const diagnostic = await diagnoseFor(engine, occurrence);
  return ok({
    diagnostic,
    confidence: diagnostic.confidence,
    justification: justification(diagnostic),
    action: diagnostic.action,
  });
}

/** Descripteur de laction (§ 13). */
export const explainBuildFailure = defineAction<ExplainBuildFailureData>({
  key: 'explain-build-failure',
  verb: 'GET',
  description:
    'Explain why a CI build failed: returns the diagnostic, its confidence, the facts behind it and the action to take.',
  inputs: {
    issueKey: { type: 'string', description: 'Key of the Jira issue carrying the failure.' },
    buildUrl: { type: 'string', description: 'URL of the failing Bitbucket build.' },
  },
  run: runExplainBuildFailure,
});
