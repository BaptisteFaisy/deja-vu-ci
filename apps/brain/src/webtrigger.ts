/**
 * Le contrat **réel** des web triggers Forge (format v2).
 *
 * La plateforme appelle une fonction de web trigger avec
 * `(payload: WebTriggerRequest, context: WebTriggerContext)` — et attend un
 * objet `{ statusCode, headers, body }`. Ce n'est **pas** l'API `Request`/
 * `Response` du Web : un `Request` n'existe pas dans ce runtime, et un
 * `Response` renvoyé tel quel n'est pas sérialisé par la plateforme. Écrire
 * `await request.text()`levait une `TypeError`, et la plateforme répondait
 * « 424 Failed Dependency » sans jamais appeler la fonction — vérifié en
 * réel, sur l'app installée.
 *
 * Ce module est la **seule** implémentation du contrat : les trois routes
 * (`/ingest`, `/query`, `/universal`) l'utilisent, sans duplication.
 */

import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';

export type { WebTriggerRequest, WebTriggerResponse };

/** Une réponse JSON, dans la forme que Forge renvoie à l'appelant. */
export function jsonResponse(status: number, body: unknown): WebTriggerResponse {
  return {
    statusCode: status,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify(body),
  };
}

/**
 * Le corps brut de la requête (chaîne), ou `''` quand il est absent.
 *
 * Le format v2 donne toujours une chaîne ; un corps vide ou absent donne `''`.
 */
export function bodyOf(payload: WebTriggerRequest | undefined): string {
  return typeof payload?.body === 'string' ? payload.body : '';
}

/**
 * Les en-têtes de la requête, à plat et en minuscules.
 *
 * Le format v2 donne un tableau de valeurs par nom ; la vérification HMAC du
 * pont (`@dejavu/bridge`) compare des noms en minuscules avec une seule
 * valeur : on prend donc la première, comme le fait `verifyRequest`.
 */
export function headersOf(payload: WebTriggerRequest | undefined): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, values] of Object.entries(payload?.headers ?? {})) {
    headers[name.toLowerCase()] = Array.isArray(values)
      ? values[0]
      : (values as unknown as string | undefined);
  }
  return headers;
}
