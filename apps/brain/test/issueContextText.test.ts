/**
 * Tests of the Rovo text context (`src/pure/issueContextText.ts`).
 *
 * `jira:issueContext` renders text, not a panel: what a Rovo agent reads
 * about a ticket. The paragraph must name the diagnostic, its confidence,
 * the action, the ticket of the problem and the CI time already lost — and
 * must say plainly when the memory knows nothing.
 */

import { describe, expect, it } from 'vitest';
import type { Diagnostic, Occurrence } from '@dejavu/core';
import {
  NO_KNOWN_FAILURE,
  issueContextText,
  lostSeconds,
} from '../src/pure/issueContextText';

const DIAGNOSTIC: Diagnostic = {
  kind: 'flaky',
  confidence: 0.83,
  title: 'expected true to be false',
  summary: 'Seen 17 times on 9 branches, and it passed again at the same commit.',
  action: 'retry',
  facts: [{ label: 'occurrences', value: '17' }],
  signatureId: 'aaaaaaaaaaaaaaaa',
  signatureShort: 'S-aaa',
  issueKey: 'PAY-88',
};

/** Two builds of 90 s each. */
const OCCURRENCES: Occurrence[] = [
  { id: '1', signatureId: 'a', familyId: 'f', workspace: 'w', repo: 'web', branch: 'main', commit: 'abc1234', author: 'ana', stepName: 'test', durationS: 90, occurredAt: '2026-11-03T10:00:00Z', passedOnRetry: false },
  { id: '2', signatureId: 'a', familyId: 'f', workspace: 'w', repo: 'web', branch: 'main', commit: 'def5678', author: 'ana', stepName: 'test', durationS: 90, occurredAt: '2026-11-04T10:00:00Z', passedOnRetry: true },
];

describe('contexte texte d’un ticket', () => {
  it('dit franchement quand la mémoire ne connaît rien', () => {
    expect(issueContextText({})).toBe(NO_KNOWN_FAILURE);
    expect(issueContextText({ problem: false })).toBe(NO_KNOWN_FAILURE);
  });

  it('nomme le diagnostic, sa confiance et l’action proposée', () => {
    const text = issueContextText({ diagnostic: DIAGNOSTIC });
    expect(text).toContain('Known flaky failure');
    expect(text).toContain('83%');
    expect(text).toContain('Suggested action: Retry the build.');
  });

  it('cite le ticket du problème', () => {
    expect(issueContextText({ diagnostic: DIAGNOSTIC })).toContain('Ticket: PAY-88.');
    const withoutTicket = issueContextText({ diagnostic: { ...DIAGNOSTIC, issueKey: undefined } });
    expect(withoutTicket).not.toContain('Ticket:');
  });

  it('chiffre le temps de CI perdu sur les occurrences connues', () => {
    const text = issueContextText({ diagnostic: DIAGNOSTIC, occurrences: OCCURRENCES, problem: true });
    expect(text).toContain('CI time lost: 3 min over 2 builds.');
  });

  it('n’invente pas de coût sans occurrence', () => {
    expect(issueContextText({ diagnostic: DIAGNOSTIC })).not.toContain('CI time lost');
  });

  it('existe aussi en français, avec les mêmes mots que l’écran', () => {
    const text = issueContextText({ diagnostic: DIAGNOSTIC }, 'fr');
    expect(text).toContain('Instabilité connue');
    expect(text).toContain('Action proposée: Relancer le build.');
    expect(text).toContain('Ticket: PAY-88.');
  });

  it('additionne les secondes de CI', () => {
    expect(lostSeconds(OCCURRENCES)).toBe(180);
    expect(lostSeconds(undefined)).toBe(0);
    expect(lostSeconds([])).toBe(0);
  });
});
