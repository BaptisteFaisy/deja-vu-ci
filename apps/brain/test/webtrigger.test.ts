/**
 * Le contrat des web triggers Forge — format v2.
 *
 * Ce que la plateforme appelle et ce qu'elle attend a été **vérifié en réel**
 * (app installée, tunnel, appel HTTP) : un `Request` n'existe pas dans ce
 * runtime, et un `Response` renvoyé tel quel n'est pas sérialisé (la
 * plateforme répondait « 424 Failed Dependency » sans appeler la fonction).
 * Ces tests verrouillent le contrat pour que le bug ne revienne pas.
 */

import { describe, expect, it } from 'vitest';
import {
  bodyOf,
  headersOf,
  jsonResponse,
  type WebTriggerRequest,
} from '../src/webtrigger';

/** A request as the platform sends it (format v2). */
function trigger(overrides: Partial<WebTriggerRequest> = {}): WebTriggerRequest {
  return {
    method: 'POST',
    body: '',
    path: '/x1/cle',
    headers: {},
    queryParameters: {},
    ...overrides,
  };
}

describe('contrat des web triggers', () => {
  it('répond au format que Forge sérialise', () => {
    const reponse = jsonResponse(202, { ok: true });
    expect(reponse.statusCode).toBe(202);
    expect(reponse.headers?.['Content-Type']).toEqual(['application/json']);
    expect(JSON.parse(reponse.body ?? '')).toEqual({ ok: true });
    expect(reponse).not.toHaveProperty('ok');
  });

  it('lit le corps brut', () => {
    expect(bodyOf(trigger({ body: '{"a":1}' }))).toBe('{"a":1}');
    expect(bodyOf(trigger())).toBe('');
    expect(bodyOf(undefined)).toBe('');
  });

  it('aplatit et met en minuscules les en-têtes', () => {
    const entetes = headersOf(
      trigger({ headers: { 'X-Deja-Vu-Signature': ['abc', 'def'], 'Content-Type': ['application/json'] } }),
    );
    expect(entetes['x-deja-vu-signature']).toBe('abc');
    expect(entetes['content-type']).toBe('application/json');
    expect(headersOf(undefined)).toEqual({});
  });

  it('ne confond pas corps et charge utile', () => {
    const reponse = jsonResponse(400, { ok: false, error: 'champ manquant' });
    expect(reponse.statusCode).toBe(400);
    expect(JSON.parse(reponse.body ?? '')).toEqual({ ok: false, error: 'champ manquant' });
  });
});
