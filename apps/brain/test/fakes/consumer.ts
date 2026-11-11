/**
 * Local doubles for the consumer core tests (lot F).
 *
 * The consumer talks to three injected ports: the memory (`ConsumerStore`),
 * the engine (`ConsumerEngine`) and the Jira side (`TicketApplier`). These
 * doubles implement the ports with deterministic, recordable behaviour: the
 * tests verify the wiring and the idempotency, never engine logic.
 */

import { createHash } from 'node:crypto';
import type {
  Category,
  Diagnostic,
  ErrorBlock,
  Occurrence,
  Outbreak,
  RawExcerpt,
  Resolution,
  Settings,
  Signature,
  TestStats,
  TicketAction,
} from '@dejavu/core';
import type {
  AppliedTicket,
  ConsumerEngine,
  ConsumerStore,
  TicketApplier,
} from '../../src/pure/consume.js';
import { DEFAULT_SETTINGS } from '../../src/pure/defaults.js';

/** In-memory store double implementing the consumer port. */
export class FakeConsumerStore implements ConsumerStore {
  readonly signatures = new Map<string, Signature>();
  readonly occurrences = new Map<string, Occurrence>();
  readonly excerpts = new Map<string, RawExcerpt>();
  readonly stats = new Map<string, TestStats>();
  readonly outbreaks = new Map<string, Outbreak>();
  readonly resolutions = new Map<string, Resolution>();
  settings: Settings = { ...DEFAULT_SETTINGS };

  async getSignature(id: string): Promise<Signature | undefined> {
    return this.signatures.get(id);
  }
  async saveSignature(s: Signature): Promise<void> {
    this.signatures.set(s.id, s);
  }
  async saveOccurrence(o: Occurrence): Promise<void> {
    this.occurrences.set(o.id, o);
  }
  async listOccurrences(signatureId: string): Promise<Occurrence[]> {
    return [...this.occurrences.values()].filter((o) => o.signatureId === signatureId);
  }
  async listFamilyOccurrences(familyId: string): Promise<Occurrence[]> {
    return [...this.occurrences.values()].filter((o) => o.familyId === familyId);
  }
  async getResolution(signatureId: string): Promise<Resolution | undefined> {
    return this.resolutions.get(signatureId);
  }
  async saveRawExcerpt(e: RawExcerpt): Promise<void> {
    this.excerpts.set(e.occurrenceId, e);
  }
  async saveTestStats(t: TestStats): Promise<void> {
    this.stats.set(`${t.repo}|${t.testName}`, t);
  }
  async saveOutbreak(o: Outbreak): Promise<void> {
    this.outbreaks.set(o.familyId, o);
  }
  async findOutbreak(familyId: string): Promise<Outbreak | undefined> {
    return this.outbreaks.get(familyId);
  }
  async getSettings(): Promise<Settings> {
    return this.settings;
  }
}

/** Deterministic engine double: one block per raw excerpt, fake digests. */
export class FakeConsumerEngine implements ConsumerEngine {
  /** Set to make `extractErrorBlocks` (or any call) throw. */
  failure: string | undefined;
  /** Category of the produced blocks (`unknown` exercises the LLM port). */
  blockCategory: Category = 'test';
  diagnoseCalls = 0;

  private failIfAsked(): void {
    if (this.failure) throw new Error(this.failure);
  }

  extractErrorBlocks(input: { stepLog?: string }): { blocks: ErrorBlock[]; source: 'log'; dropped: number } {
    this.failIfAsked();
    const chunks = (input.stepLog ?? '').split('\n\n').filter((c) => c.trim() !== '');
    return {
      blocks: chunks.map((raw) => ({
        category: this.blockCategory,
        errorType: 'AssertionError',
        message: raw.split('\n')[0],
        rawMessage: raw,
        frames: [],
        source: 'log' as const,
        rawText: raw,
      })),
      source: 'log',
      dropped: 0,
    };
  }

  signatureKeys(block: ErrorBlock): { signature: string; family: string } {
    const digest = createHash('sha256').update(block.message).digest('hex');
    return { signature: digest.slice(0, 16), family: digest.slice(16, 32) };
  }

  diagnose(): Diagnostic {
    this.failIfAsked();
    this.diagnoseCalls += 1;
    return {
      kind: 'new',
      confidence: 0.85,
      title: 'New failure',
      summary: 'never seen before',
      action: 'fix',
      facts: [{ label: 'seen', value: '1 time' }],
      signatureId: 'sig',
      signatureShort: 'S-000',
    };
  }

  assessFlakiness(): { flaky: boolean; reasons: string[]; occurrences: number; branches: number; sameCommitPass: boolean; flakyIndex: number } {
    return { flaky: false, reasons: [], occurrences: 0, branches: 0, sameCommitPass: false, flakyIndex: 0 };
  }

  planTicketActions(): TicketAction[] {
    return [];
  }

  detectOutbreak(): Outbreak | undefined {
    return undefined;
  }

  testStats(occs: Occurrence[], testName: string): TestStats {
    return {
      repo: occs[0]?.repo ?? '',
      testName,
      runsFailed: occs.length,
      runsPassedSameCommit: 0,
      branches: new Set(occs.map((o) => o.branch)).size,
      flakyIndex: 0,
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
  }

  detectRegression(): boolean {
    return false;
  }
}

/** Jira double: records the applied actions. */
export class FakeTicketApplier implements TicketApplier {
  applied: TicketAction[] = [];
  /** Key returned by `apply`, simulating an issue creation. */
  issueKey: string | undefined;
  /** Date returned by `lastCommentAt`. */
  lastComment: string | undefined;

  async lastCommentAt(): Promise<string | undefined> {
    return this.lastComment;
  }

  async apply(action: TicketAction): Promise<AppliedTicket> {
    this.applied.push(action);
    return this.issueKey ? { issueKey: this.issueKey } : {};
  }
}
