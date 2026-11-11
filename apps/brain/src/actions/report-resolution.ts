/**
 * Action `report-resolution` (§ 13) — CREATE, `signatureId`, `commit`, `note`.
 *
 * Enregistre une résolution **candidate** : le commit qui a fait disparaître
 * la signature, son auteur et une note. La confiance reste faible tant qu'un
 * humain n'a pas confirmé (§ 10.5) — la confirmation passe par
 * `confirm-resolution`.
 */

import type { Resolution } from '@dejavu/core';
import { fail, ok, nowIso, type ActionResult, type BrainEngine } from './engine';
import { defineAction, type RawInput } from './descriptor';
import { optionalText, requireText } from './validate';

/** Confiance d'une résolution candidate, sous le seuil de confirmation (0,6). */
export const CANDIDATE_CONFIDENCE = 0.5;

/** Réponse de l'action. */
export interface ReportResolutionData {
  resolution: Resolution;
  /** Vrai si la résolution a été enregistrée comme confirmée. */
  confirmed: boolean;
  summary: string;
}

/** Exécute l'action. */
export async function runReportResolution(
  engine: BrainEngine,
  raw: RawInput,
): Promise<ActionResult<ReportResolutionData>> {
  const signatureId = requireText(raw.signatureId, 'signatureId', 200);
  if (!signatureId.ok) return fail(signatureId.error);
  const commit = requireText(raw.commit, 'commit', 64);
  if (!commit.ok) return fail(commit.error);
  const note = optionalText(raw.note, 'note');
  if (!note.ok) return fail(note.error);
  const author = optionalText(raw.author, 'author');
  if (!author.ok) return fail(author.error);

  const signature = await engine.store.getSignature(signatureId.value);
  if (!signature) return fail(`unknown signature: ${signatureId.value}`);
  const existing = await engine.store.getResolution(signature.id);
  if (existing && existing.confirmedAt) {
    return fail('this signature already has a confirmed resolution');
  }

  const resolution: Resolution = {
    id: `${signature.id}:${commit.value.slice(0, 12)}`,
    signatureId: signature.id,
    commit: commit.value,
    author: author.value || 'unknown',
    files: [],
    note: note.value || undefined,
    confidence: CANDIDATE_CONFIDENCE,
  };
  await engine.store.saveResolution(resolution);
  return ok({
    resolution,
    confirmed: false,
    summary: `resolution recorded for ${signature.id}, waiting for a human confirmation`,
  });
}

/** Descripteur de l'action (§ 13). */
export const reportResolution = defineAction<ReportResolutionData>({
  key: 'report-resolution',
  verb: 'CREATE',
  description:
    'Record a candidate resolution for a known signature: the commit that fixed it, its author and an optional note.',
  inputs: {
    signatureId: { type: 'string', description: 'Identifier of the signature.', required: true },
    commit: { type: 'string', description: 'Commit that made the failure disappear.', required: true },
    note: { type: 'string', description: 'Optional explanation of the fix.' },
    author: { type: 'string', description: 'Optional author of the fix.' },
  },
  run: runReportResolution,
});

/** Horodatage ISO de l'horloge du moteur (utilisé par la confirmation). */
export const resolutionTimestamp = nowIso;
