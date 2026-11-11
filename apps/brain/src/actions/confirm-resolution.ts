/**
 * Action `confirm-resolution` (§ 13) — UPDATE, `signatureId`, `confirmed`.
 *
 * Confirme ou rejette une résolution candidate. Une confirmation passe la
 * confiance à 1 et marque la résolution comme confirmée : elle sera alors citée
 * aux prochains qui croiseront la signature. Un rejet la laisse en place, non
 * confirmée, pour que l'hypothèse reste visible sans être affirmée.
 */

import type { Resolution } from '@dejavu/core';
import { fail, ok, type ActionResult, type BrainEngine } from './engine';
import { defineAction, type RawInput } from './descriptor';
import { requireBoolean, requireText } from './validate';
import { CANDIDATE_CONFIDENCE } from './report-resolution';

/** Confiance d'une résolution confirmée par un humain. */
export const CONFIRMED_CONFIDENCE = 1;

/** Réponse de l'action. */
export interface ConfirmResolutionData {
  resolution: Resolution;
  confirmed: boolean;
  summary: string;
}

/** Exécute l'action. */
export async function runConfirmResolution(
  engine: BrainEngine,
  raw: RawInput,
): Promise<ActionResult<ConfirmResolutionData>> {
  const signatureId = requireText(raw.signatureId, 'signatureId', 200);
  if (!signatureId.ok) return fail(signatureId.error);
  const confirmed = requireBoolean(raw.confirmed, 'confirmed');
  if (!confirmed.ok) return fail(confirmed.error);

  const signature = await engine.store.getSignature(signatureId.value);
  if (!signature) return fail(`unknown signature: ${signatureId.value}`);
  const existing = await engine.store.getResolution(signature.id);
  if (!existing) return fail(`no resolution recorded for ${signature.id}`);

  const at = engine.now().toISOString();
  const resolution: Resolution = confirmed.value
    ? {
        ...existing,
        confidence: CONFIRMED_CONFIDENCE,
        confirmedBy: 'human',
        confirmedAt: at,
      }
    : {
        ...existing,
        confidence: CANDIDATE_CONFIDENCE,
        confirmedBy: undefined,
        confirmedAt: undefined,
      };
  await engine.store.saveResolution(resolution);

  return ok({
    resolution,
    confirmed: confirmed.value,
    summary: confirmed.value
      ? `resolution confirmed for ${signature.id}`
      : `resolution rejected for ${signature.id}`,
  });
}

/** Descripteur de l'action (§ 13). */
export const confirmResolution = defineAction<ConfirmResolutionData>({
  key: 'confirm-resolution',
  verb: 'UPDATE',
  description:
    'Confirm or reject a candidate resolution for a signature. A confirmed resolution is cited to the next developers.',
  inputs: {
    signatureId: { type: 'string', description: 'Identifier of the signature.', required: true },
    confirmed: { type: 'boolean', description: 'True to confirm, false to reject.', required: true },
  },
  run: runConfirmResolution,
});
