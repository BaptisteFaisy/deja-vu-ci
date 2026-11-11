/**
 * « Rejouer le jeu d'exemple » — the button a judge clicks (§ 22, CI-11).
 *
 * The sample set (`data/sample/occurrences.json`, copied into `src/data/` by
 * `tools/copy-sample.mjs`) is replayed through the **real** engine and the
 * **real** Forge SQL memory: 40 failures over 14 days become signatures,
 * diagnostics and, on the Jira side, one ticket per problem family.
 *
 * Two rules shape this module:
 *  - **idempotent**: the replay runs only on an empty memory. When signatures
 *    already exist, nothing is injected and the screen is told so — a judge
 *    who clicks twice never gets duplicated occurrences or duplicated
 *    tickets;
 *  - **no Forge import here**: the memory (`Store`) and the Jira side
 *    (`SeedTickets`) are injected, so the whole seeding is unit-tested with an
 *    in-memory store and a fake applier. `index.ts` passes the real ones.
 *
 * The replay itself simulates Jira: it writes a placeholder issue key
 * (`CI-1`, `CI-2`…) on the signatures it stores. Those placeholders are
 * replaced here by the keys the real Jira answered with, so the memory never
 * shows a ticket that does not exist.
 */

import {
  replayWithEngine,
  staticReplayEngine,
  type DiagnosticKind,
  type ReplayEngine,
  type ReplayResult,
  type SampleDataset,
  type Signature,
  type Store,
  type TicketAction,
} from '@dejavu/core';
import sampleDataset from './data/sample-dataset.json';

/** The sample set, embedded in the bundle (copied by `tools/copy-sample.mjs`). */
export const SAMPLE_DATASET = sampleDataset as unknown as SampleDataset;

/** The Jira side of the seeding: one method, injected by `index.ts`. */
export interface SeedTickets {
  apply(action: TicketAction, signature: Signature): Promise<{ issueKey?: string }>;
}

/** What the screen shows after a replay. */
export interface ReplaySummary {
  ok: true;
  /** False when the memory already held signatures: nothing was injected. */
  seeded: boolean;
  datasetName: string;
  signatures: number;
  occurrences: number;
  byKind: Record<string, number>;
  ticketsCreated: number;
  comments: number;
  elapsedMs: number;
}

/** The outcome of a seeding: a summary, or the reason it did not run. */
export type ReplayOutcome = ReplaySummary | { ok: false; error: string };

/** Everything the seeding needs, injected. */
export interface SeedDeps {
  store: Store;
  /** Jira applier; without it the memory is filled and no ticket is created. */
  tickets?: SeedTickets;
  engine?: ReplayEngine;
  dataset?: SampleDataset;
  now?: Date;
}

/**
 * The real engine, assembled **once** in the core package (`staticReplayEngine`)
 * and shared with the public site's in-browser demo: one implementation, no copy.
 */
export const replayEngine: () => ReplayEngine = staticReplayEngine;

/** One error message, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The summary of a memory that already holds data: nothing is recomputed and
 * nothing is created, so the ticket and comment counters stay at zero — they
 * count what **this** call did, not what the memory holds.
 */
function alreadySeeded(signatures: Signature[], started: number): ReplaySummary {
  const kinds: Record<string, number> = {};
  return {
    ok: true,
    seeded: false,
    datasetName: SAMPLE_DATASET.name,
    signatures: signatures.length,
    occurrences: signatures.reduce((total, s) => total + s.occurrences, 0),
    byKind: kinds,
    ticketsCreated: 0,
    comments: 0,
    elapsedMs: Date.now() - started,
  };
}

/** The real key of a family, once Jira answered, and the placeholder it replaces. */
interface KeyBook {
  byFamily: Map<string, string>;
  byPlaceholder: Map<string, string>;
}

/** Applies one planned action, with the real issue key when one is known. */
async function applyOne(
  action: TicketAction,
  signature: Signature,
  tickets: SeedTickets,
  book: KeyBook,
): Promise<{ created: boolean; commented: boolean }> {
  const real = book.byPlaceholder.get(action.issueKey ?? '') ?? book.byFamily.get(action.familyId);
  const effective = real ? { ...action, issueKey: real } : action;
  const applied = await tickets.apply(effective, real ? { ...signature, issueKey: real } : signature);
  if (action.kind === 'create' && applied.issueKey) {
    book.byFamily.set(action.familyId, applied.issueKey);
    if (signature.issueKey) book.byPlaceholder.set(signature.issueKey, applied.issueKey);
    return { created: true, commented: false };
  }
  return { created: false, commented: action.kind === 'comment' || action.kind === 'reopen' };
}

/**
 * Applies the ticket plan of a replay on the real Jira, then writes the real
 * issue keys over the placeholders the replay stored.
 */
async function applyTickets(
  result: ReplayResult,
  store: Store,
  tickets: SeedTickets | undefined,
): Promise<{ created: number; commented: number }> {
  if (!tickets) return { created: 0, commented: 0 };
  const byId = new Map(result.signatures.map((s) => [s.id, s]));
  const book: KeyBook = { byFamily: new Map(), byPlaceholder: new Map() };
  let created = 0;
  let commented = 0;
  for (const action of result.tickets) {
    const signature = byId.get(action.signatureId);
    if (!signature) continue;
    const done = await applyOne(action, signature, tickets, book);
    if (done.created) created += 1;
    if (done.commented) commented += 1;
  }
  for (const signature of result.signatures) {
    const real = signature.issueKey ? book.byPlaceholder.get(signature.issueKey) : undefined;
    if (real && real !== signature.issueKey) {
      await store.saveSignature({ ...signature, issueKey: real });
    }
  }
  return { created, commented };
}

/**
 * Fills the memory with the sample set, then creates the tickets it implies.
 *
 * Never throws: every failure comes back as `{ ok: false, error }`, so the
 * screen renders the reason instead of breaking.
 */
export async function replaySample(deps: SeedDeps): Promise<ReplayOutcome> {
  const started = Date.now();
  try {
    const existing = await deps.store.listSignatures();
    if (existing.length > 0) return alreadySeeded(existing, started);
    const dataset = deps.dataset ?? SAMPLE_DATASET;
    const engine = deps.engine ?? replayEngine();
    const result = await replayWithEngine(dataset, engine, {
      store: deps.store,
      ...(deps.now ? { now: deps.now } : {}),
    });
    const applied = await applyTickets(result, deps.store, deps.tickets);
    const byKind: Record<DiagnosticKind, number> = result.byKind;
    return {
      ok: true,
      seeded: true,
      datasetName: result.datasetName,
      signatures: result.signatures.length,
      occurrences: result.occurrences,
      byKind,
      ticketsCreated: applied.created,
      comments: applied.commented,
      elapsedMs: result.elapsedMs,
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}
