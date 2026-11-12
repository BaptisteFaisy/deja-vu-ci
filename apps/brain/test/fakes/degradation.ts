/**
 * Local doubles for the degradation tests (lot `core-inv`).
 *
 * The Brain degrades instead of breaking: a store that refuses a connection, a
 * SELECT over the platform budget, a Jira that answers 403/429/500, a model
 * that answers nonsense, a payload that arrives truncated. Each double below is
 * one of the existing doubles of `test/fakes/` plus a single failure switch —
 * by subclassing, so that no engine or adapter logic is duplicated here.
 *
 * Pure modules only: the platform adapters (`src/consumer.ts`, `src/sql.ts`)
 * pull in `@forge/*`, which is not resolvable from the repository root.
 */

import type {
  ErrorBlock,
  IngestPayload,
  LlmFallback,
  Occurrence,
  Outbreak,
  RawExcerpt,
  Resolution,
  Settings,
  Signature,
  TicketAction,
} from '@dejavu/core';
import {
  assessFlakiness,
  detectOutbreak,
  detectRegression,
  diagnose,
  extractErrorBlocks,
  planTicketActions,
  signatureKeys,
  testStats,
} from '@dejavu/core';
import type { ConsumerDeps, ConsumerEngine, ConsumerStore, LlmPort } from '../../src/pure/consume';
import { FakeStore } from './store';
import { FakeConsumerStore, FakeTicketApplier } from './consumer';

// ---------------------------------------------------------------------------
// Local doubles, extended with one failure switch each
// ---------------------------------------------------------------------------

/**
 * The Forge SQL store when the platform lets it down: a refused connection, a
 * SELECT over the 5 s budget, or a row that is simply not there.
 */
export class FailingSqlStore extends FakeConsumerStore {
  /** Method that must fail, e.g. `getSettings` or `saveOccurrence`. */
  failOn: string | undefined;
  /** The platform error the method raises. */
  failure = 'connection terminated unexpectedly';

  private boom(method: string): void {
    if (this.failOn === method) throw new Error(this.failure);
  }

  override async getSettings(): Promise<Settings> {
    this.boom('getSettings');
    return super.getSettings();
  }
  override async getSignature(id: string): Promise<Signature | undefined> {
    this.boom('getSignature');
    return super.getSignature(id);
  }
  override async saveSignature(s: Signature): Promise<void> {
    this.boom('saveSignature');
    return super.saveSignature(s);
  }
  override async saveOccurrence(o: Occurrence): Promise<void> {
    this.boom('saveOccurrence');
    return super.saveOccurrence(o);
  }
  override async listOccurrences(signatureId: string): Promise<Occurrence[]> {
    this.boom('listOccurrences');
    return super.listOccurrences(signatureId);
  }
  override async listFamilyOccurrences(familyId: string): Promise<Occurrence[]> {
    this.boom('listFamilyOccurrences');
    return super.listFamilyOccurrences(familyId);
  }
  override async getResolution(signatureId: string): Promise<Resolution | undefined> {
    this.boom('getResolution');
    return super.getResolution(signatureId);
  }
  override async saveRawExcerpt(e: RawExcerpt): Promise<void> {
    this.boom('saveRawExcerpt');
    return super.saveRawExcerpt(e);
  }
  override async findOutbreak(familyId: string): Promise<Outbreak | undefined> {
    this.boom('findOutbreak');
    return super.findOutbreak(familyId);
  }
}

/** The Jira side when the REST API refuses the call. */
export class FailingJira extends FakeTicketApplier {
  /** HTTP status Jira answers with, when it answers at all. */
  status: number | undefined;

  private boom(): void {
    if (this.status) throw new Error(`Jira answered ${this.status}`);
  }

  override async apply(action: TicketAction): Promise<{ issueKey?: string }> {
    this.boom();
    return super.apply(action);
  }
  override async lastCommentAt(): Promise<string | undefined> {
    this.boom();
    return super.lastCommentAt();
  }
}

/**
 * The real engine of `@dejavu/core`, wired exactly like `coreConsumerEngine()`
 * of `src/consumer.ts`: a degradation test must exercise the real pipeline,
 * only the platform ports are doubles.
 */
export function coreEngine(): ConsumerEngine {
  return {
    extractErrorBlocks,
    signatureKeys,
    diagnose,
    assessFlakiness,
    planTicketActions,
    detectOutbreak,
    testStats,
    detectRegression,
  };
}

/** The real engine, planning one ticket action so that Jira is reached. */
export function ticketingEngine(): ConsumerEngine {
  const create: TicketAction = {
    kind: 'create',
    familyId: 'fam-1',
    signatureId: 'sig-1',
    summary: '[CI] problem (1 occurrence)',
  };
  return { ...coreEngine(), planTicketActions: () => [create] };
}

/** The memory store of an action, when the platform drops the connection. */
export class FailingStoreLike extends FakeStore {
  failure: string | undefined;

  override async listSignatures(): Promise<Signature[]> {
    if (this.failure) throw new Error(this.failure);
    return super.listSignatures();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A Jest failure, the shape the Sensor sends over the signed bridge. */
export const JEST_LOG = [
  'FAIL src/auth/login.test.ts',
  '  ● login › accepts a valid user',
  '',
  '    Expected: 200',
  '    Received: 500',
  '',
  '      at Object.<anonymous> (src/auth/login.test.ts:42:21)',
].join('\n');

/** One valid ingest payload; every field can be overridden. */
export function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    version: 1,
    workspace: 'acme',
    repository: 'acme/payments',
    branch: 'feature/login',
    commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    author: 'marie',
    prId: 42,
    stepName: 'test',
    durationS: 95,
    failedAt: '2026-11-05T09:00:00.000Z',
    errorBlocks: [JEST_LOG],
    changedFiles: ['src/auth/login.ts'],
    ...overrides,
  };
}

/** The consumer dependencies, with an injected store, Jira side and clock. */
export function deps(
  store: ConsumerStore,
  tickets: FailingJira = new FailingJira(),
  engine: ConsumerEngine = coreEngine(),
  llm?: LlmPort,
): ConsumerDeps {
  return {
    store,
    engine,
    tickets,
    now: () => new Date('2026-11-05T09:05:00.000Z'),
    ...(llm ? { llm } : {}),
  };
}

/** An `unknown` block: the only kind the model fallback is ever shown. */
export function unknownBlock(): ErrorBlock {
  return {
    category: 'unknown',
    errorType: 'UnknownError',
    message: 'something happened somewhere',
    rawMessage: 'something happened somewhere',
    frames: [],
    source: 'tail',
    rawText: 'something happened somewhere',
  };
}

/** A model that answers a fixed text, counting its calls. */
export function model(answer: () => string): LlmFallback & { calls: number } {
  const fallback = {
    calls: 0,
    async complete(): Promise<string> {
      fallback.calls += 1;
      return answer();
    },
  };
  return fallback;
}

