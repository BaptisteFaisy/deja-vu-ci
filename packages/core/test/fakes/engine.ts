/**
 * Local doubles of the engine modules (lots A, B and C).
 *
 * These doubles are only used by the tests of this lot: they implement the
 * contracts declared in `docs/CONTRACTS.md` with a deterministic behaviour, so
 * the replay can be exercised before the other lots land. No production code
 * lives here.
 */

import { createHash } from 'node:crypto';
import type {
  Category,
  DiagnoseContext,
  Diagnostic,
  ErrorBlock,
  ExtractResult,
  FailedTestCase,
  FlakyVerdict,
  Occurrence,
  Resolution,
  Settings,
  Signature,
  TicketAction,
} from '../../src/types.js';
import type { ReplayEngine } from '../../src/replay.js';

/** The fake engine, with the registry it uses to remember the categories. */
export interface FakeEngine extends ReplayEngine {
  categoriesBySignature: Map<string, Category>;
  /** Number of times the diagnosis was asked, to observe the flow. */
  diagnoseCalls: number;
}

/** Short hash used as a signature by the double. */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Category guessed from a few well known markers of the log. */
export function guessCategory(text: string): Category {
  const lower = text.toLowerCase();
  if (lower.includes('registry') || lower.includes('connection refused')) return 'infrastructure';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('cannot find module') || lower.includes('ts2345')) return 'compile';
  return 'unknown';
}

/** Build the error blocks of a step, one per failed test case, else one for the log. */
export function fakeExtract(input: {
  stepLog?: string;
  testCases?: FailedTestCase[];
}): ExtractResult {
  const cases = input.testCases ?? [];
  if (cases.length > 0) {
    return {
      blocks: cases.map((tc) => ({
        category: 'test' as Category,
        errorType: 'AssertionError',
        message: tc.name,
        rawMessage: tc.message,
        frames: [],
        testName: tc.name,
        source: 'report' as const,
        rawText: tc.message,
      })),
      source: 'report',
      dropped: 0,
    };
  }
  const log = input.stepLog ?? '';
  const lines = log.trim().split('\n').filter((l) => l.trim().length > 0);
  const message = lines[lines.length - 1] ?? 'empty log';
  return {
    blocks: [
      {
        category: guessCategory(log),
        errorType: 'UnknownError',
        message,
        rawMessage: message,
        frames: [],
        source: 'log',
        rawText: log,
      },
    ],
    source: 'log',
    dropped: 0,
  };
}

/** True when the history already proves the flakiness of the signature. */
function isFlakyHistory(history: Occurrence[], current: Occurrence): boolean {
  const all = [...history, current];
  const branches = new Set(all.map((o) => o.branch));
  return all.length >= 3 && branches.size >= 2 && all.some((o) => o.passedOnRetry);
}

/** Build a diagnostic of the given kind, with a fact and a title. */
function diagnostic(
  kind: Diagnostic['kind'],
  ctx: DiagnoseContext,
  confidence: number,
): Diagnostic {
  return {
    kind,
    confidence,
    title: `diagnostic ${kind}`,
    summary: `the failure was diagnosed as ${kind}`,
    action: kind === 'flaky' ? 'retry' : kind === 'already-fixed' ? 'rebase' : 'fix',
    facts: [{ label: 'signature', value: ctx.occurrence.signatureId }],
    signatureId: ctx.occurrence.signatureId,
    signatureShort: `S-${ctx.occurrence.signatureId.slice(-3)}`,
  };
}

/** The signing double: a short hash, with the category kept aside. */
function makeSigning(categories: Map<string, Category>): ReplayEngine['signing'] {
  return {
    signatureOf(block: ErrorBlock): string {
      const frames = block.frames.map((f) => `${f.file}:${f.fn ?? ''}`).join(',');
      const id = shortHash(`${block.category}|${block.errorType}|${block.message}|${frames}`);
      categories.set(id, block.category);
      return id;
    },
    familyOf(block: ErrorBlock): string {
      return shortHash(`${block.category}|${block.errorType}|${block.message}`);
    },
  };
}

/** The diagnosis double: the four verdicts, in the order of the contract. */
function makeDiagnosis(
  categories: Map<string, Category>,
  count: { calls: number },
): ReplayEngine['diagnosis'] {
  return {
    diagnose(ctx: DiagnoseContext): Diagnostic {
      count.calls += 1;
      const category = categories.get(ctx.occurrence.signatureId) ?? 'unknown';
      if (ctx.outbreak) return diagnostic('infrastructure', ctx, 0.9);
      if (category === 'infrastructure' || category === 'dependency') {
        return diagnostic('infrastructure', ctx, 0.9);
      }
      if (ctx.resolution) return diagnostic('already-fixed', ctx, 0.85);
      if (isFlakyHistory(ctx.history, ctx.occurrence)) return diagnostic('flaky', ctx, 0.8);
      if (ctx.history.length === 0) return diagnostic('new', ctx, 0.8);
      return diagnostic('uncertain', ctx, 0.4);
    },
  };
}

/** The flakiness double: three occurrences, two branches and a retry pass. */
function makeFlakiness(): ReplayEngine['flakiness'] {
  return {
    assessFlakiness(occs: Occurrence[], opts?: { settings?: Partial<Settings>; now?: Date }): FlakyVerdict {
      const branches = new Set(occs.map((o) => o.branch));
      const sameCommitPass = occs.some((o) => o.passedOnRetry);
      const flaky = occs.length >= 3 && branches.size >= 2 && sameCommitPass;
      return {
        flaky,
        reasons: flaky ? ['three occurrences on two branches with a retry pass'] : [],
        occurrences: occs.length,
        branches: branches.size,
        sameCommitPass,
        flakyIndex: sameCommitPass ? 0.5 : 0,
      };
    },
  };
}

/** The ticket double: one ticket per flaky family, then a single update. */
function makeTickets(): ReplayEngine['tickets'] {
  return {
    planTicketActions(input: {
      signature: Signature;
      occurrences: Occurrence[];
      verdict?: FlakyVerdict;
      existingIssueKey?: string;
      now?: Date;
      settings?: Partial<Settings>;
    }): TicketAction[] {
      if (input.verdict?.flaky && !input.existingIssueKey) {
        return [
          {
            kind: 'create',
            familyId: input.signature.familyId,
            signatureId: input.signature.id,
            summary: `Flaky signature ${input.signature.id}`,
          },
        ];
      }
      if (input.occurrences.length > 1) {
        return [
          {
            kind: 'update',
            familyId: input.signature.familyId,
            signatureId: input.signature.id,
            summary: `Signature ${input.signature.id} seen again`,
          },
        ];
      }
      return [];
    },
  };
}

/** The resolution double: the last commit between failure and success. */
function makeResolutions(): ReplayEngine['resolutions'] {
  return {
    inferCandidateResolution(input: {
      signatureId: string;
      history: Occurrence[];
      commitsBetween: Array<{ sha: string; author: string; files: string[]; message: string }>;
      now?: Date;
    }): Resolution | undefined {
      const last = input.commitsBetween[input.commitsBetween.length - 1];
      if (!last) return undefined;
      return {
        id: `res-${input.signatureId}`,
        signatureId: input.signatureId,
        commit: last.sha,
        author: last.author,
        files: last.files,
        confidence: 0.4,
      };
    },
  };
}

/** The masking double: hides the access tokens it recognizes. */
function makeMasking(): ReplayEngine['masking'] {
  return {
    maskSecrets(text: string): { text: string; masked: number; kinds: string[] } {
      const matches = text.match(/gh[pousr]_[A-Za-z0-9]{10,}/g) ?? [];
      if (matches.length === 0) return { text, masked: 0, kinds: [] };
      return {
        text: text.replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, '[redacted]'),
        masked: matches.length,
        kinds: ['token'],
      };
    },
  };
}

/** Build a deterministic engine, close to the contracts of the other lots. */
export function makeFakeEngine(): FakeEngine {
  const categoriesBySignature = new Map<string, Category>();
  const count = { calls: 0 };
  return {
    categoriesBySignature,
    get diagnoseCalls(): number {
      return count.calls;
    },
    extraction: { extractErrorBlocks: fakeExtract },
    signing: makeSigning(categoriesBySignature),
    diagnosis: makeDiagnosis(categoriesBySignature, count),
    flakiness: makeFlakiness(),
    tickets: makeTickets(),
    resolutions: makeResolutions(),
    masking: makeMasking(),
  };
}
