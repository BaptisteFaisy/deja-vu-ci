/**
 * Tests of the pull-request card's view model (`src/pure/prCardView.ts`).
 *
 * The card is the developer's first contact with the product (CI-08): it must
 * show the diagnostic with the same words as the Jira screens, and it must say
 * something in every case — loading, no known failure, unpaired workspace,
 * Brain unreachable.
 */

import { describe, expect, it } from 'vitest';
import type { Diagnostic, QueryResponse } from '@dejavu/core';
import { loadingCard, prCardView } from '../src/pure/prCardView';

const DIAGNOSTIC: Diagnostic = {
  kind: 'already-fixed',
  confidence: 0.91,
  title: 'Connection refused to the database',
  summary: 'Seen 6 times, fixed by 9f2c1ab on the main branch.',
  action: 'rebase',
  facts: [
    { label: 'occurrences', value: '6' },
    { label: 'branches', value: '3' },
  ],
  signatureId: 'bbbbbbbbbbbbbbbb',
  signatureShort: 'S-204',
  issueKey: 'PAY-123',
  resolution: { commit: '9f2c1ab4567', author: 'ana', files: ['src/db.ts'], confirmed: true },
  suspects: ['src/db.ts'],
  evidence: ['Connection refused 127.0.0.1:5432'],
};

const ANSWER: QueryResponse = {
  ok: true,
  diagnostic: DIAGNOSTIC,
  lastFailureAt: '2026-11-03T10:00:00Z',
};

describe('carte de PR — états', () => {
  it('est en cours de chargement tant que le Cerveau n’a pas répondu', () => {
    expect(prCardView(undefined, 'en').state).toBe('loading');
    expect(loadingCard().facts).toEqual([]);
  });

  it('dit pourquoi quand le Cerveau ne répond pas', () => {
    const view = prCardView({ ok: false, error: 'this workspace is not paired with a Brain yet' }, 'en');
    expect(view.state).toBe('error');
    expect(view.error).toContain('not paired');
  });

  it('nomme l’absence de jumelage plutôt que de laisser la carte vide', () => {
    const view = prCardView({ ok: false }, 'fr');
    expect(view.state).toBe('error');
    expect(view.error?.length).toBeGreaterThan(0);
  });

  it('dit quand aucun échec n’est connu sur la branche', () => {
    const view = prCardView({ ok: true }, 'en');
    expect(view.state).toBe('empty');
    expect(view.headline).toBeUndefined();
  });
});

describe('carte de PR — diagnostic', () => {
  it('affiche la nature, la confiance et l’action avec les mots partagés', () => {
    const view = prCardView(ANSWER, 'en');
    expect(view.state).toBe('diagnostic');
    expect(view.headline).toBe('Already seen, already fixed');
    expect(view.tone).toBe('green');
    expect(view.confidence).toBe('91%');
    expect(view.action).toBe('Rebase or cherry-pick the fix');
  });

  it('existe en français, avec les mêmes libellés que le Cerveau', () => {
    const view = prCardView(ANSWER, 'fr');
    expect(view.headline).toBe('Déjà vu, déjà corrigé');
    expect(view.action).toBe('Rebaser ou reprendre le correctif');
    expect(view.lastFailure).toBe('03/11/2026');
  });

  it('montre le titre, le résumé, les faits et le ticket lié', () => {
    const view = prCardView(ANSWER, 'en');
    expect(view.title).toBe('Connection refused to the database');
    expect(view.summary).toContain('fixed by 9f2c1ab');
    expect(view.facts).toEqual(['occurrences: 6', 'branches: 3']);
    expect(view.issueKey).toBe('PAY-123');
  });

  it('cite le correctif, abrégé, avec son auteur', () => {
    expect(prCardView(ANSWER, 'en').resolution).toBe('9f2c1ab — ana');
  });

  it('montre les éléments constatés et les fichiers suspects (§ 18)', () => {
    const view = prCardView(ANSWER, 'en');
    expect(view.evidence).toEqual(['Connection refused 127.0.0.1:5432']);
    expect(view.suspects).toEqual(['src/db.ts']);
  });

  it('n’invente ni ticket, ni correctif, ni fait', () => {
    const bare = prCardView({ ok: true, diagnostic: { ...DIAGNOSTIC, issueKey: undefined, resolution: undefined, facts: [] } }, 'en');
    expect(bare.issueKey).toBeUndefined();
    expect(bare.resolution).toBeUndefined();
    expect(bare.facts).toEqual([]);
    expect(bare.lastFailure).toBeUndefined();
  });
});
