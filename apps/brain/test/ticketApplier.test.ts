/**
 * L'invariant du journal : une action n'est écrite **réussie** que si Jira a
 * répondu 2xx.
 *
 * Constat de production (14/11/2026, site `one-atlas-cndz`) : le journal de
 * l'app revendiquait `ticket-updated` et `comment-posted` sur CI-1, alors que
 * le vrai ticket restait vierge (`updated == created`, 0 commentaire,
 * description vide). Cause : `requestJira` ne lève **pas** sur un refus HTTP —
 * il rend la réponse. Sans lecture du statut, chaque 403 passait pour un succès
 * et s'écrivait au journal. Ces tests figent le comportement inverse, sur le
 * chemin exact que la prod a emprunté.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Signature, TicketAction } from '@dejavu/core';
import { resolveProjectTarget } from '../src/pure/projectTarget';
import { jiraTicketApplier } from '../src/ticketApplier';

/** Une réponse Jira programmée, et l'appel qui l'a déclenchée. */
interface Stub {
  ok: boolean;
  status: number;
  body: string;
}

/** État partagé: file de réponses + traces d'appels (mock hoisté, donc vi.hoisted). */
const h = vi.hoisted(() => ({
  replies: [] as Stub[],
  calls: [] as { path: string; method: string; body?: string }[],
  boom: undefined as string | undefined,
}));

vi.mock('@forge/api', () => ({
  assumeTrustedRoute: (path: string) => path,
  requestJira: async (path: string, init: { method?: string; body?: string } = {}) => {
    h.calls.push({ path, method: init.method ?? 'GET', ...(init.body ? { body: init.body } : {}) });
    if (h.boom) throw new Error(h.boom);
    const reply = h.replies.shift() ?? { ok: true, status: 200, body: '{}' };
    return {
      ok: reply.ok,
      status: reply.status,
      async text() {
        return reply.body;
      },
    };
  },
}));

/** Le faux journal : la liste de ce que l'app a réellement écrit au opérateur. */
function journal() {
  const entries: Array<{ action: string; issueKey?: string; detail?: string }> = [];
  return { entries, sink: { saveAuditEntry: async (e: { action: string; issueKey?: string; detail?: string }) => { entries.push(e); } } };
}

const TARGET = resolveProjectTarget({ chosen: 'CI' });
const SIGNATURE = {
  id: 'sig-1', familyId: 'fam-1', category: 'test', errorType: 'AssertionError',
  template: 'x', frames: [], status: 'new',
  firstSeen: '2026-11-01T00:00:00.000Z', lastSeen: '2026-11-11T00:00:00.000Z',
  occurrences: 3, issueKey: 'CI-1',
} as unknown as Signature;

const UPDATE = {
  kind: 'update', familyId: 'fam-1', signatureId: 'sig-1', issueKey: 'CI-1',
  summary: 'Build rouge sur payments-api', description: '3 echecs en 24 h',
} as unknown as TicketAction;

const COMMENT = {
  kind: 'comment', familyId: 'fam-1', signatureId: 'sig-1', issueKey: 'CI-1',
  summary: 'Build rouge sur payments-api', comment: 'Synthese du jour',
} as unknown as TicketAction;

const CREATE = {
  kind: 'create', familyId: 'fam-1', signatureId: 'sig-1',
  summary: 'Build rouge sur payments-api', labels: [],
} as unknown as TicketAction;

const REFUSED = { ok: false, status: 403, body: '{"errorMessages":["you do not have permission"]}' };

beforeEach(() => {
  h.replies.length = 0;
  h.calls.length = 0;
  h.boom = undefined;
});

describe('un refus HTTP n\'est jamais un succes journalise', () => {
  it('update 403 -> ticket-refused, pas ticket-updated', async () => {
    h.replies.push(REFUSED);
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(UPDATE, SIGNATURE);

    expect(applied.error).toContain('403');
    expect(log.entries.map((e) => e.action)).toEqual(['ticket-refused']);
    expect(log.entries[0].detail).toContain('permission');
    expect(log.entries[0].issueKey).toBe('CI-1');
  });

  it('comment 403 -> ticket-refused, pas comment-posted', async () => {
    h.replies.push(REFUSED);
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(COMMENT, SIGNATURE);

    expect(applied.error).toContain('403');
    expect(log.entries.map((e) => e.action)).toEqual(['ticket-refused']);
    expect(h.calls[0].path).toBe('/rest/api/3/issue/CI-1/comment');
  });

  it('create 201 sans cle -> un refus, pas un ticket invente', async () => {
    h.replies.push({ ok: true, status: 201, body: '{}' });
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(CREATE, SIGNATURE);

    expect(applied.issueKey).toBeUndefined();
    expect(applied.error).toContain('aucune cle');
    expect(log.entries.map((e) => e.action)).toEqual(['ticket-refused']);
  });

  it('une exception reseau est journalisee comme refus, pas comme succes', async () => {
    h.boom = 'ECONNREFUSED';
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(UPDATE, SIGNATURE);

    expect(applied.error).toBe('ECONNREFUSED');
    expect(applied.issueKey).toBe('CI-1');
    expect(log.entries.map((e) => e.action)).toEqual(['ticket-refused']);
    expect(log.entries[0].detail).toContain('ECONNREFUSED');
  });
});

describe('le chemin heureux garde sa forme', () => {
  it('update 204 -> ticket-updated, avec la cle', async () => {
    h.replies.push({ ok: true, status: 204, body: '' });
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(UPDATE, SIGNATURE);

    expect(applied).toEqual({ issueKey: 'CI-1' });
    expect(log.entries.map((e) => e.action)).toEqual(['ticket-updated']);
    expect(h.calls[0].method).toBe('PUT');
  });

  it('comment 201 -> comment-posted', async () => {
    h.replies.push({ ok: true, status: 201, body: '{"id":"10011"}' });
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(COMMENT, SIGNATURE);

    expect(applied.error).toBeUndefined();
    expect(log.entries.map((e) => e.action)).toEqual(['comment-posted']);
  });

  it('create 201 avec cle -> ticket-created et la cle rendue', async () => {
    h.replies.push({ ok: true, status: 201, body: '{"key":"CI-2","id":"10002"}' });
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(CREATE, SIGNATURE);

    expect(applied.issueKey).toBe('CI-2');
    expect(log.entries.map((e) => e.action)).toEqual(['ticket-created']);
  });

  it('reopen sans transition -> un commentaire de repli, journalise', async () => {
    h.replies.push({ ok: true, status: 200, body: '{"transitions":[{"id":"11","name":"Start Progress"}]}' });
    h.replies.push({ ok: true, status: 201, body: '' });
    const log = journal();
    const applied = await jiraTicketApplier(TARGET, { audit: log.sink }).apply(
      { ...COMMENT, kind: 'reopen', comment: undefined } as unknown as TicketAction,
      SIGNATURE,
    );

    expect(applied.error).toBeUndefined();
    expect(log.entries.map((e) => e.action)).toEqual(['ticket-reopened']);
    expect(h.calls.map((c) => c.path)).toEqual([
      '/rest/api/3/issue/CI-1/transitions',
      '/rest/api/3/issue/CI-1/comment',
    ]);
  });
});
