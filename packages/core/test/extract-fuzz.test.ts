/**
 * Deterministic fuzzing of the extraction (§ 9.1).
 *
 * The extractor is the first thing that touches an arbitrary CI log: it must
 * never throw, never exceed its byte ceiling, never leak a secret, and always
 * answer the same thing for the same input. This file mutates the real logs of
 * the labelled corpus (`data/labeled/100-failures.json`) with a home-made,
 * **seeded** generator — no new dependency, and a failing case can be replayed
 * bit for bit.
 *
 * Mutations: truncation, residual ANSI colours, line permutation, CRLF,
 * unicode noise, duplicated lines, oversized logs, injected secrets.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractErrorBlocks } from '../src/extract.js';
import type { ExtractResult, LabeledCorpus } from '../src/types.js';

const CORPUS_URL = new URL('../../../data/labeled/100-failures.json', import.meta.url);
const corpus = JSON.parse(readFileSync(CORPUS_URL, 'utf8')) as LabeledCorpus;

/** Fixed seed: the suite is reproducible run after run, machine after machine. */
const SEED = 0x5eed2f7a;
/** Number of mutated logs checked per invariant ("several hundreds"). */
const CASE_COUNT = 320;
/** The extraction ceiling of § 9.1, and the blocks it retains at most. */
const DEFAULT_MAX_BYTES = 51200;
const MAX_BLOCKS = 3;

// ---------------------------------------------------------------------------
// Generator: a seeded PRNG, no dependency
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, deterministic pseudo-random generator. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One element of `items`, drawn with the generator. */
function pick<T>(rnd: () => number, items: T[]): T {
  return items[Math.floor(rnd() * items.length)];
}

/** An integer in [0, bound[. */
function int(rnd: () => number, bound: number): number {
  return Math.floor(rnd() * bound);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** A named transformation of a log. */
interface Mutation {
  name: string;
  apply(log: string, rnd: () => number): string;
}

const ANSI_CODES = ['\u001b[31m', '\u001b[0m', '\u001b[1m', '\u001b[38;5;208m', '\u001b[2K'];
const UNICODE_NOISE = ['é', '✓', '«', '»', '日本語', '🔥', '\u200b', 'ñ', '—', 'ü'];

const MUTATIONS: Mutation[] = [
  {
    name: 'truncate',
    apply: (log, rnd) => log.slice(0, int(rnd, log.length + 1)),
  },
  {
    name: 'ansi',
    apply: (log, rnd) =>
      log
        .split('\n')
        .map((line) => (rnd() < 0.35 ? `${pick(rnd, ANSI_CODES)}${line}${pick(rnd, ANSI_CODES)}` : line))
        .join('\n'),
  },
  {
    name: 'permute',
    apply: (log, rnd) => {
      const lines = log.split('\n');
      for (let i = lines.length - 1; i > 0; i--) {
        const j = int(rnd, i + 1);
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      return lines.join('\n');
    },
  },
  {
    name: 'crlf',
    apply: (log) => log.replace(/\r?\n/g, '\r\n'),
  },
  {
    name: 'unicode',
    apply: (log, rnd) => {
      let out = log;
      for (let i = 0; i < 1 + int(rnd, 8); i++) {
        const at = int(rnd, out.length + 1);
        out = out.slice(0, at) + pick(rnd, UNICODE_NOISE) + out.slice(at);
      }
      return out;
    },
  },
  {
    name: 'duplicates',
    apply: (log, rnd) => {
      const lines = log.split('\n');
      if (lines.length === 0) return log;
      for (let i = 0; i < 1 + int(rnd, 4); i++) {
        const at = int(rnd, lines.length);
        lines.splice(at, 0, lines[at]);
      }
      return lines.join('\n');
    },
  },
  {
    name: 'oversize',
    apply: (log, rnd) => {
      const target = DEFAULT_MAX_BYTES * (1.2 + rnd() * 0.3);
      const unit = log.length > 0 ? log : 'line';
      // Repeat (not double) so the result stays just above the ceiling.
      return Array.from({ length: Math.ceil(target / unit.length) + 1 }, () => unit).join('\n');
    },
  },
];

/** Secrets built at runtime: no clear-text credential ever sits in the repo. */
function fakeSecrets(): { kind: string; value: string }[] {
  return [
    { kind: 'github-token', value: ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_') },
    { kind: 'gitlab-token', value: ['glpat', 'Zk3Jd8sLa9Qw2ErTy7Ui'].join('-') },
    { kind: 'aws-key', value: ['AKIA', 'Z9Y8X7W6V5U4T3S2'].join('') },
    { kind: 'google-key', value: ['AIza', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW2xY'].join('') },
    { kind: 'npm-token', value: ['npm', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'].join('_') },
    { kind: 'jwt', value: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJjaS1ib3QifQ', 'c2lnbmF0dXJlLXBhcnQ'].join('.') },
    { kind: 'email', value: ['ci-bot', 'example.com'].join('@') },
    { kind: 'url-credentials', value: ['postgres://payments', 'w7rXc9pQ@db.internal:5432/ledger'].join(':') },
    { kind: 'password', value: 'api_key = "aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW"' },
  ];
}

/** A mutated log, with the secrets it still carries whole. */
interface FuzzCase {
  id: string;
  log: string;
  secrets: string[];
  maxTotalBytes: number;
}

/** Insert the secrets on their own line, so masking sees them whole. */
function withSecrets(log: string, rnd: () => number): { log: string; secrets: string[] } {
  const chosen = fakeSecrets().filter(() => rnd() < 0.45);
  if (chosen.length === 0) return { log, secrets: [] };
  const lines = log.split('\n');
  for (const secret of chosen) {
    lines.splice(int(rnd, lines.length + 1), 0, `    leaked ${secret.value} here`);
  }
  return { log: lines.join('\n'), secrets: chosen.map((s) => s.value) };
}

/** Build every fuzz case once, from the fixed seed. */
function buildCases(count: number): FuzzCase[] {
  const rnd = mulberry32(SEED);
  const logs = corpus.failures.map((failure) => failure.log);
  const cases: FuzzCase[] = [];
  for (let i = 0; i < count; i++) {
    let log = pick(rnd, logs);
    const applied: string[] = [];
    const rounds = 1 + int(rnd, 3);
    for (let round = 0; round < rounds; round++) {
      const mutation = pick(rnd, MUTATIONS);
      log = mutation.apply(log, rnd);
      applied.push(mutation.name);
    }
    const leaked = withSecrets(log, rnd);
    // Most cases keep the default ceiling; some stress a tight one.
    const maxTotalBytes = rnd() < 0.25 ? 64 + int(rnd, 900) : DEFAULT_MAX_BYTES;
    cases.push({
      id: `fuzz-${String(i).padStart(3, '0')} (${applied.join('+')})`,
      log: leaked.log,
      secrets: leaked.secrets,
      maxTotalBytes,
    });
  }
  return cases;
}

/** One extraction attempt: either a result or the error it threw. */
interface Attempt {
  testCase: FuzzCase;
  result?: ExtractResult;
  error?: unknown;
  /** Serialised result of a second, identical run (determinism). */
  again?: string;
}

/** Run every case twice: the first run feeds the invariants, the second proves determinism. */
function runAll(cases: FuzzCase[]): Attempt[] {
  return cases.map((testCase) => {
    const input = { stepLog: testCase.log, maxTotalBytes: testCase.maxTotalBytes };
    try {
      const result = extractErrorBlocks(input);
      return {
        testCase,
        result,
        again: JSON.stringify(extractErrorBlocks(input)),
      };
    } catch (error) {
      return { testCase, error };
    }
  });
}

const cases = buildCases(CASE_COUNT);
const attempts = runAll(cases);

// ---------------------------------------------------------------------------

describe('fuzzing of extractErrorBlocks (seeded, reproducible)', () => {
  it('covers several hundreds of mutated logs, all mutations included', () => {
    expect(cases.length).toBeGreaterThanOrEqual(300);
    const covered = new Set(cases.flatMap((c) => c.id.match(/[a-z]+(?=[+)])/g) ?? []));
    for (const mutation of MUTATIONS) expect(covered.has(mutation.name), mutation.name).toBe(true);
  });

  it('never throws, whatever the log looks like', () => {
    const thrown = attempts.filter((attempt) => attempt.error !== undefined);
    expect(thrown.map((attempt) => `${attempt.testCase.id}: ${String(attempt.error)}`)).toEqual([]);
  });

  it('keeps every block inside the byte ceiling', () => {
    for (const attempt of attempts) {
      const { maxTotalBytes } = attempt.testCase;
      let total = 0;
      for (const block of attempt.result?.blocks ?? []) {
        const size = Buffer.byteLength(block.rawText, 'utf8');
        expect(size, `${attempt.testCase.id}: one block over the ceiling`).toBeLessThanOrEqual(maxTotalBytes);
        total += size;
      }
      expect(total, `${attempt.testCase.id}: blocks over the ceiling`).toBeLessThanOrEqual(maxTotalBytes);
    }
  });

  it('bounds the number of blocks: no explosion', () => {
    for (const attempt of attempts) {
      const count = attempt.result?.blocks.length ?? 0;
      expect(count, attempt.testCase.id).toBeLessThanOrEqual(MAX_BLOCKS);
    }
  });

  it('is deterministic: the same input gives exactly the same output', () => {
    for (const attempt of attempts) {
      expect(attempt.again, attempt.testCase.id).toBe(JSON.stringify(attempt.result));
    }
  });

  it('never lets a secret survive inside a block', () => {
    const leaks: string[] = [];
    for (const attempt of attempts) {
      const alive = attempt.testCase.secrets.filter((secret) => attempt.testCase.log.includes(secret));
      if (alive.length === 0) continue;
      for (const block of attempt.result?.blocks ?? []) {
        const fields = { rawText: block.rawText, rawMessage: block.rawMessage, message: block.message };
        for (const secret of alive) {
          for (const [field, value] of Object.entries(fields)) {
            if (value.includes(secret)) leaks.push(`${attempt.testCase.id} → ${field}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('masks at least one secret when the log carries one in a retained block', () => {
    const masked = attempts.filter((attempt) =>
      (attempt.result?.blocks ?? []).some((block) => block.rawText.includes('«[masqué:')),
    );
    expect(masked.length).toBeGreaterThan(0);
  });

  it('answers a valid source for every mutated log', () => {
    for (const attempt of attempts) {
      expect(['report', 'log', 'tail'], attempt.testCase.id).toContain(attempt.result?.source);
    }
  });
});
