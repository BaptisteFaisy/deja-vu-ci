/**
 * Tests of the issue-key lookup (`src/pure/invokeContext.ts`).
 *
 * The panel and the Rovo text are reached through different platform shapes:
 * a bare payload, a UI Kit 2 `invoke()` envelope, and a product context. All
 * three must give the same issue — and a call without one must stay empty
 * rather than guess.
 */

import { describe, expect, it } from 'vitest';
import { issueKeyFrom } from '../src/pure/invokeContext.js';

describe('clé de ticket d’une invocation', () => {
  it('lit une clé posée dans la charge utile', () => {
    expect(issueKeyFrom({ payload: { issueKey: 'PAY-1' } })).toBe('PAY-1');
    expect(issueKeyFrom({ payload: { issue: { key: 'PAY-2' } } })).toBe('PAY-2');
  });

  it('lit une clé posée dans le contexte', () => {
    expect(issueKeyFrom({ context: { issueKey: 'PAY-3' } })).toBe('PAY-3');
    expect(issueKeyFrom({ context: { issue: { key: 'PAY-4' } } })).toBe('PAY-4');
  });

  it('lit l’enveloppe d’un invoke() UI Kit 2', () => {
    expect(
      issueKeyFrom({
        payload: { call: { functionKey: 'issue-context', payload: { issueKey: 'PAY-5' } } },
        context: {},
      }),
    ).toBe('PAY-5');
    expect(
      issueKeyFrom({
        payload: { call: { functionKey: 'issue-context', arguments: { issueKey: 'PAY-6' } } },
      }),
    ).toBe('PAY-6');
  });

  it('lit le contexte produit d’un encart de ticket', () => {
    expect(
      issueKeyFrom({ context: { extension: { issue: { key: 'PAY-7', id: '10010' } } } }),
    ).toBe('PAY-7');
    expect(issueKeyFrom({ payload: { context: { extension: { issue: { key: 'PAY-8' } } } } })).toBe(
      'PAY-8',
    );
  });

  it('rend une chaîne vide plutôt que de deviner', () => {
    expect(issueKeyFrom({})).toBe('');
    expect(issueKeyFrom({ payload: undefined, context: undefined })).toBe('');
    expect(issueKeyFrom({ payload: { issueKey: '' }, context: null })).toBe('');
    expect(issueKeyFrom({ payload: 'PAY-9' })).toBe('');
    expect(issueKeyFrom({ context: { extension: {} } })).toBe('');
  });

  it('préfère la charge utile au contexte quand les deux parlent', () => {
    expect(
      issueKeyFrom({ payload: { issueKey: 'PAY-10' }, context: { issueKey: 'PAY-11' } }),
    ).toBe('PAY-10');
  });
});
