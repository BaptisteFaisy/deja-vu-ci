/**
 * Accès aux données du Cerveau pour les écrans (§ 14).
 *
 * Les composants `.tsx` ne parlent pas directement à `invoke()` : ils
 * appellent `loadData`, qui fait l'appel, déballe la réponse de Forge
 * (`body` quand la plateforme ajoute des métadonnées) et rend une erreur
 * explicite plutôt qu'une exception.
 *
 * Ce module n'importe pas `@forge/react` : il reste testable.
 */

import { invoke } from '@forge/bridge';

/** Enveloppe possible de la réponse de Forge (corps + métadonnées). */
interface ForgeEnvelope {
  body: unknown;
  metadata?: unknown;
}

/** Déballe une réponse de Forge : rend le corps, qu'il soit enveloppé ou non. */
export function unwrap<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    return (response as ForgeEnvelope).body as T;
  }
  return response as T;
}

/** Appelle un résolveur du Cerveau et rend son corps. */
export async function loadData<T>(
  functionKey: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await invoke<Record<string, unknown>>(functionKey, payload);
  return unwrap<T>(response);
}
