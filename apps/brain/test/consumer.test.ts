/**
 * Tests of the ticket applier's refusal (`src/consumer.ts`).
 *
 * The applier is the one place that talks to Jira; when no target project was
 * decided, it must **not** call Jira at all — it refuses the create with the
 * reason from `pure/projectTarget.ts`. The refusal path never reaches
 * `requestJira`, so the test needs no tenant: if it tried, the platform SDK
 * would throw and the assertion on the error would fail.
 */

import { describe, expect, it } from 'vitest';
import type { Signature, TicketAction } from '@dejavu/core';
import { jiraTicketApplier } from '../src/ticketApplier';
import { NO_PROJECT_REASON } from '../src/pure/projectTarget';

/** Un `create`, signé : tout ce que l'applicateur refuse de traiter. */
const createAction = { kind: 'create', summary: 'CI keeps failing', labels: [] } as unknown as TicketAction;
const signature = {
  id: 's1', familyId: 'f1', category: 'test', errorType: 'AssertionError',
  template: 'x', frames: [], status: 'new', firstSeen: '2026-11-01T00:00:00.000Z',
  lastSeen: '2026-11-01T00:00:00.000Z', occurrences: 1,
} as unknown as Signature;

describe('applicateur Jira sans projet cible', () => {
  it('refuse de créer un ticket et dit pourquoi', async () => {
    const applier = jiraTicketApplier({ projectKey: '', source: 'none', reason: NO_PROJECT_REASON });
    const applied = await applier.apply(createAction, signature);
    expect(applied.issueKey).toBeUndefined();
    expect(applied.error).toBe(NO_PROJECT_REASON);
  });

  it('journalise le refus, jamais une création qui n\'a pas eu lieu', async () => {
    const actions: string[] = [];
    const sink = { saveAuditEntry: async (e: { action: string }) => void actions.push(e.action) };
    const applier = jiraTicketApplier(
      { projectKey: '', source: 'none', reason: NO_PROJECT_REASON },
      { audit: sink, now: () => new Date('2026-11-12T00:00:00.000Z') },
    );
    await applier.apply(createAction, signature);
    // Le refus est raconté, mais jamais comme « ticket créé ».
    expect(actions).toEqual(['ticket-refused']);
  });
});