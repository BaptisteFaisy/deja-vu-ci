/**
 * Action `get-signature` (§ 13) — GET, `signatureId`.
 *
 * Rend l'histoire d'une signature : son statut, son historique d'occurrences,
 * sa résolution (candidate ou confirmée) et son ticket Jira éventuel.
 */

import type { Occurrence, Resolution, Signature } from '@dejavu/core';
import { fail, ok, type ActionResult, type BrainEngine } from './engine';
import { defineAction, type RawInput } from './descriptor';
import { requireText } from './validate';

/** Une occurrence, abrégée pour l'affichage. */
export interface OccurrenceRow {
  id: string;
  repo: string;
  branch: string;
  commit: string;
  author: string;
  stepName: string;
  occurredAt: string;
  durationS: number;
  buildUrl?: string;
  passedOnRetry: boolean;
}

/** Réponse de l'action. */
export interface GetSignatureData {
  signature: {
    id: string;
    signatureShort: string;
    familyId: string;
    category: Signature['category'];
    errorType: string;
    template: string;
    status: Signature['status'];
    firstSeen: string;
    lastSeen: string;
    occurrences: number;
    testName?: string;
  };
  status: Signature['status'];
  history: OccurrenceRow[];
  resolution?: Resolution;
  issueKey?: string;
}

/** Abrège une occurrence pour l'affichage. */
function toRow(occurrence: Occurrence): OccurrenceRow {
  return {
    id: occurrence.id,
    repo: occurrence.repo,
    branch: occurrence.branch,
    commit: occurrence.commit,
    author: occurrence.author,
    stepName: occurrence.stepName,
    occurredAt: occurrence.occurredAt,
    durationS: occurrence.durationS,
    buildUrl: occurrence.buildUrl,
    passedOnRetry: occurrence.passedOnRetry,
  };
}

/** Exécute l'action. */
export async function runGetSignature(
  engine: BrainEngine,
  raw: RawInput,
): Promise<ActionResult<GetSignatureData>> {
  const signatureId = requireText(raw.signatureId, 'signatureId', 200);
  if (!signatureId.ok) return fail(signatureId.error);
  const signature = await engine.store.getSignature(signatureId.value);
  if (!signature) return fail(`unknown signature: ${signatureId.value}`);
  const [occurrences, resolution] = await Promise.all([
    engine.store.listOccurrences(signature.id),
    engine.store.getResolution(signature.id),
  ]);
  const history = [...occurrences]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .map(toRow);
  return ok({
    signature: {
      id: signature.id,
      signatureShort: engine.signatureShort(signature.id),
      familyId: signature.familyId,
      category: signature.category,
      errorType: signature.errorType,
      template: signature.template,
      status: signature.status,
      firstSeen: signature.firstSeen,
      lastSeen: signature.lastSeen,
      occurrences: signature.occurrences,
      testName: signature.testName,
    },
    status: signature.status,
    history,
    resolution,
    issueKey: signature.issueKey,
  });
}

/** Descripteur de l'action (§ 13). */
export const getSignature = defineAction<GetSignatureData>({
  key: 'get-signature',
  verb: 'GET',
  description:
    'Get the history of a known failure signature: status, occurrences, resolution and Jira ticket.',
  inputs: {
    signatureId: { type: 'string', description: 'Identifier of the signature.', required: true },
  },
  run: runGetSignature,
});
