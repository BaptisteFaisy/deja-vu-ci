/**
 * Tests of the shared loader (`packages/present/src/invoke.ts`).
 *
 * The bridge is injected, so the test drives both answers a Forge resolver
 * can give — a bare body and a `{ body }` envelope — and checks that a screen
 * sees the same thing in both cases.
 */

import { describe, expect, it } from 'vitest';
import { createLoader, unwrapBody, type InvokeFn } from '../src/index.js';

interface Card {
  ok: boolean;
  title: string;
}

const CARD: Card = { ok: true, title: 'Known flaky failure' };

describe('déballage d’une réponse Forge', () => {
  it('rend le corps quand la réponse est enveloppée', () => {
    expect(unwrapBody<Card>({ body: CARD, metadata: { id: 1 } })).toEqual(CARD);
  });

  it('rend la réponse telle quelle quand elle ne l’est pas', () => {
    expect(unwrapBody<Card>(CARD)).toEqual(CARD);
  });

  it('ne prend pas un objet sans `body` pour une enveloppe', () => {
    expect(unwrapBody<Card>({ ok: true, title: 'x' })).toEqual({ ok: true, title: 'x' });
    expect(unwrapBody<undefined>(undefined)).toBeUndefined();
    expect(unwrapBody<string>('texte')).toBe('texte');
  });
});

describe('chargeur d’un écran', () => {
  it('appelle le résolveur nommé, avec sa charge utile', async () => {
    const seen: Array<[string, Record<string, unknown> | undefined]> = [];
    const invoke: InvokeFn = async (name, payload) => {
      seen.push([name, payload]);
      return CARD;
    };
    const load = createLoader(invoke);
    await load<Card>('getPrCard', { branch: 'main' });
    expect(seen).toEqual([['getPrCard', { branch: 'main' }]]);
  });

  it('envoie une charge utile vide par défaut', async () => {
    let payload: Record<string, unknown> | undefined;
    const load = createLoader(async (_name, sent) => {
      payload = sent;
      return CARD;
    });
    await load<Card>('getSettings');
    expect(payload).toEqual({});
  });

  it('rend le corps, enveloppé ou non', async () => {
    const wrapped = createLoader(async () => ({ body: CARD }));
    const bare = createLoader(async () => CARD);
    expect(await wrapped<Card>('getPrCard')).toEqual(CARD);
    expect(await bare<Card>('getPrCard')).toEqual(CARD);
  });

  it('laisse remonter l’échec : c’est l’écran qui l’affiche', async () => {
    const load = createLoader(async () => {
      throw new Error('the Brain did not answer');
    });
    await expect(load<Card>('getPrCard')).rejects.toThrow('the Brain did not answer');
  });
});
