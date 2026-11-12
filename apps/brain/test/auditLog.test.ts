/**
 * Tests of the journal of what the app did (`src/pure/auditLog.ts`).
 *
 * The journal is append-only, idempotent under a platform retry, and never the
 * reason an action fails: a storage error is swallowed. Both rules are verified
 * here, with the mapping from the ticket actions of § 11.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  auditActionOfTicket,
  auditEntry,
  auditId,
  auditSinkOf,
  isAuditAction,
  recordAudit,
  sortAuditEntries,
  ticketAuditDetail,
  type AuditEntry,
  type AuditSink,
} from '../src/pure/auditLog';

const AT = new Date('2026-11-12T10:00:00.000Z');

/** A sink that records what it is asked to store. */
function fakeSink(fails = false): { sink: AuditSink; saved: AuditEntry[] } {
  const saved: AuditEntry[] = [];
  return {
    saved,
    sink: {
      async saveAuditEntry(entry: AuditEntry) {
        if (fails) throw new Error('sql is down');
        saved.push(entry);
      },
    },
  };
}

describe('auditEntry', () => {
  it('stamps the instant and derives a stable id', () => {
    const entry = auditEntry({ action: 'ticket-created', signatureId: 'sig-1', at: AT });
    expect(entry.createdAt).toBe('2026-11-12T10:00:00.000Z');
    expect(entry.action).toBe('ticket-created');
    expect(entry.id).toMatch(/^[0-9a-f]{32}$/);
    expect(entry.id).toBe(auditId('ticket-created', 'sig-1', undefined, entry.createdAt, undefined));
  });

  it('is idempotent: the same action at the same instant keeps one id', () => {
    const input = { action: 'comment-posted' as const, signatureId: 'sig-1', issueKey: 'CI-7', at: AT };
    expect(auditEntry(input).id).toBe(auditEntry(input).id);
  });

  it('changes with the action, the signature, the ticket, the instant or the detail', () => {
    const base = auditEntry({ action: 'ticket-created', signatureId: 's', at: AT }).id;
    expect(auditEntry({ action: 'ticket-updated', signatureId: 's', at: AT }).id).not.toBe(base);
    expect(auditEntry({ action: 'ticket-created', signatureId: 'other', at: AT }).id).not.toBe(base);
    expect(auditEntry({ action: 'ticket-created', signatureId: 's', issueKey: 'CI-1', at: AT }).id)
      .not.toBe(base);
    expect(auditEntry({ action: 'ticket-created', signatureId: 's', detail: 'x', at: AT }).id)
      .not.toBe(base);
    expect(
      auditEntry({ action: 'ticket-created', signatureId: 's', at: new Date('2026-11-12T11:00:00.000Z') }).id,
    ).not.toBe(base);
  });

  it('leaves the optional fields absent rather than undefined', () => {
    const entry = auditEntry({ action: 'excerpts-purged', at: AT });
    expect('signatureId' in entry).toBe(false);
    expect('issueKey' in entry).toBe(false);
    expect('detail' in entry).toBe(false);
  });
});

describe('the action vocabulary', () => {
  it('recognises its own actions and nothing else', () => {
    for (const action of AUDIT_ACTIONS) expect(isAuditAction(action)).toBe(true);
    expect(isAuditAction('dropped-table')).toBe(false);
    expect(isAuditAction(undefined)).toBe(false);
    expect(isAuditAction(42)).toBe(false);
  });

  it('maps every ticket action of § 11 to one journal action', () => {
    expect(auditActionOfTicket('create')).toBe('ticket-created');
    expect(auditActionOfTicket('update')).toBe('ticket-updated');
    expect(auditActionOfTicket('comment')).toBe('comment-posted');
    expect(auditActionOfTicket('reopen')).toBe('ticket-reopened');
    expect(auditActionOfTicket('close-suggested')).toBe('closure-suggested');
  });

  it('explains each ticket action in the detail column', () => {
    expect(ticketAuditDetail({ kind: 'create', summary: 'Flaky test check.limiter' }))
      .toBe('Flaky test check.limiter');
    expect(ticketAuditDetail({ kind: 'comment', summary: 's' })).toBe('daily synthesis');
    expect(ticketAuditDetail({ kind: 'reopen', summary: 's' })).toBe('the failure came back');
    expect(ticketAuditDetail({ kind: 'close-suggested', summary: 's' })).toBe('no recent occurrence');
    expect(ticketAuditDetail({ kind: 'update', summary: 's' })).toBe('description refreshed');
  });
});

describe('recordAudit', () => {
  it('writes the entry through the sink', async () => {
    const { sink, saved } = fakeSink();
    const entry = await recordAudit(sink, { action: 'ticket-created', signatureId: 'sig-1', at: AT });
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(entry?.id);
  });

  it('does nothing without a sink', async () => {
    expect(await recordAudit(undefined, { action: 'ticket-created', at: AT })).toBeUndefined();
  });

  it('swallows a storage failure: the journal never breaks the action', async () => {
    const { sink } = fakeSink(true);
    await expect(
      recordAudit(sink, { action: 'ticket-created', signatureId: 'sig-1', at: AT }),
    ).resolves.toBeUndefined();
  });

  it('views a store that carries a journal as a sink', async () => {
    const { sink, saved } = fakeSink();
    const store = { saveAuditEntry: sink.saveAuditEntry };
    const adapted = auditSinkOf(store);
    expect(adapted).toBeDefined();
    await recordAudit(adapted, { action: 'quarantine-proposed', at: AT });
    expect(saved).toHaveLength(1);
  });

  it('gives no sink for a store without a journal', () => {
    expect(auditSinkOf({})).toBeUndefined();
    expect(auditSinkOf(undefined)).toBeUndefined();
  });
});

describe('sortAuditEntries', () => {
  it('reads newest first, ties broken by id', () => {
    const older = auditEntry({ action: 'ticket-created', signatureId: 'a', at: new Date('2026-11-11T10:00:00.000Z') });
    const newer = auditEntry({ action: 'comment-posted', signatureId: 'a', at: AT });
    const tie = { ...newer, id: 'aaa', createdAt: newer.createdAt };
    const tie2 = { ...newer, id: 'zzz', createdAt: newer.createdAt };
    const sorted = sortAuditEntries([older, tie2, tie]);
    expect(sorted.map((entry) => entry.id)).toEqual(['aaa', 'zzz', older.id]);
  });

  it('does not mutate the list it sorts', () => {
    const a = auditEntry({ action: 'ticket-created', at: AT });
    const b = auditEntry({ action: 'comment-posted', at: new Date('2026-11-11T10:00:00.000Z') });
    const input = [b, a];
    sortAuditEntries(input);
    expect(input[0].id).toBe(b.id);
  });
});
