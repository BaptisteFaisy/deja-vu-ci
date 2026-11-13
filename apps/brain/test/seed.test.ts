/**
 * Tests du rejeu du jeu d'exemple dans l'app Cerveau (§ 22, CI-11).
 *
 * Le rejeu est joué sur le **vrai moteur** (`packages/core/src/index`) et la
 * **vraie mémoire** en mémoire (`MemoryStore`) ; seule la Jira est double,
 * comme partout ailleurs dans les tests de l'app (§ 20).
 *
 * Ce que ces tests verrouillent :
 *  - un rejeu remplit la mémoire et produit les quatre diagnostics ;
 *  - un seul ticket par famille (§ 11) ;
 *  - les clés de tickets **réelles** remplacent les placeholders du rejeu ;
 *  - un second rejeu ne duplique rien (ni occurrence, ni ticket).
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore, type Signature, type TicketAction } from '../../../packages/core/src/index';
import { SAMPLE_DATASET, replaySample } from '../src/seed';

/** La Jira du test : une clé réelle par ticket créé, et un relevé des appels. */
class FakeJira {
  readonly applied: TicketAction[] = [];
  private next = 1;
  /** Le projet des créations, tel que le résout l'applicateur réel. */
  projectKey = 'PAY';

  async apply(action: TicketAction): Promise<{ issueKey?: string; error?: string }> {
    this.applied.push(action);
    if (action.kind !== 'create') return {};
    if (!this.projectKey) return { error: 'no target project' };
    const key = `${this.projectKey}-${900 + this.next}`;
    this.next += 1;
    return { issueKey: key };
  }
}

/** Les clés de tickets mémorisées après le rejeu. */
async function ticketKeys(store: MemoryStore): Promise<string[]> {
  const signatures: Signature[] = await store.listSignatures();
  return signatures.map((s) => s.issueKey).filter((key): key is string => Boolean(key));
}

describe('rejeu du jeu d’exemple', () => {
  it('remplit la mémoire et produit les quatre diagnostics', async () => {
    const store = new MemoryStore();
    const jira = new FakeJira();
    const result = await replaySample({ store, tickets: jira });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seeded).toBe(true);
    expect(result.occurrences).toBeGreaterThan(0);
    expect(result.signatures).toBeGreaterThan(0);
    expect(result.byKind.flaky).toBeGreaterThan(0);
    expect(result.byKind['already-fixed']).toBeGreaterThan(0);
    expect(result.byKind.new).toBeGreaterThan(0);
    expect(result.byKind.infrastructure).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('crée un seul ticket et le mémorise sous sa clé réelle', async () => {
    const store = new MemoryStore();
    const jira = new FakeJira();
    const result = await replaySample({ store, tickets: jira });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const creations = jira.applied.filter((action) => action.kind === 'create');
    expect(creations).toHaveLength(result.ticketsCreated);
    expect(result.ticketsCreated).toBeGreaterThan(0);

    // Les placeholders du rejeu (`CI-1`) sont remplacés par la clé Jira.
    const keys = await ticketKeys(store);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^PAY-\d+$/);
  });

  it('un second rejeu ne duplique ni occurrence ni ticket', async () => {
    const store = new MemoryStore();
    const jira = new FakeJira();
    const first = await replaySample({ store, tickets: jira });
    expect(first.ok).toBe(true);
    const signaturesBefore = (await store.listSignatures()).length;
    const occurrencesBefore = (await store.listSignatures()).reduce(
      (total, s) => total + s.occurrences,
      0,
    );
    const callsBefore = jira.applied.length;

    const second = await replaySample({ store, tickets: jira });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.seeded).toBe(false);
    expect(second.ticketsCreated).toBe(0);
    expect(jira.applied.length).toBe(callsBefore);
    expect((await store.listSignatures()).length).toBe(signaturesBefore);
    expect(
      (await store.listSignatures()).reduce((total, s) => total + s.occurrences, 0),
    ).toBe(occurrencesBefore);
  });

  it('remplit la mémoire même sans appliquant de tickets', async () => {
    const store = new MemoryStore();
    const result = await replaySample({ store });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticketsCreated).toBe(0);
    expect((await store.listSignatures()).length).toBeGreaterThan(0);
  });

  it('répond par une erreur au lieu de lever', async () => {
    const store = new MemoryStore();
    const casse = {
      ...store,
      listSignatures: async () => {
        throw new Error('mémoire absente');
      },
    };
    const result = await replaySample({ store: casse });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('mémoire absente');
  });

  it('embarque le jeu livré dans le dépôt', () => {
    expect(SAMPLE_DATASET.name).toBe('payments-api-ci-memory');
    expect(SAMPLE_DATASET.occurrences.length).toBeGreaterThan(0);
  });

  it('dit dans quel projet les tickets ont été créés', async () => {
    const store = new MemoryStore();
    const jira = new FakeJira();
    jira.projectKey = 'PAY';
    const result = await replaySample({ store, tickets: jira, projectKey: 'PAY' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projectKey).toBe('PAY');
    expect('refusal' in result).toBe(false);
    // Les clés créées sont dans le projet déclaré.
    const keys = await ticketKeys(store);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^PAY-\d+$/);
  });

  it('signale un refus quand il n’y a aucun projet cible', async () => {
    const store = new MemoryStore();
    const jira = new FakeJira();
    jira.projectKey = '';
    const result = await replaySample({ store, tickets: jira, projectKey: '' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projectKey).toBe('');
    expect(result.ticketsCreated).toBe(0);
    expect(result.refusal).toBe('no target project');
    // La mémoire est remplie, même sans ticket.
    expect((await store.listSignatures()).length).toBeGreaterThan(0);
  });
});
