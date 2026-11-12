// Shared builder of the golden memory snapshot (data/golden/).
//
// One implementation, two consumers:
//  - `tools/gen/golden.mjs` — regenerates (or `--check`s) the committed files;
//  - `packages/core/test/golden-memory.test.ts` — rebuilds the snapshot in
//    memory from the TypeScript sources and compares it with the committed
//    files, so any drift of the real engine breaks the CI.
//
// The snapshot is metadata only: identifiers, counters, kinds, statuses.
// No free text (diagnostic titles, ticket summaries) and no raw log excerpt
// ever enters it — `findRawLogLeaks` enforces that rule at generation time
// and at test time.
//
// Determinism: every instant is derived from the dataset (`referenceNow`),
// lists are sorted by a stable key, and `serialize` is the single writer
// (2-space JSON, trailing newline), so the same replay always gives the
// same bytes.

import { createHash } from 'node:crypto';

/** Version of the snapshot layout: bump it when the shape changes. */
export const GOLDEN_VERSION = 1;

/** The committed files, in a stable order. */
export const GOLDEN_FILES = ['meta.json', 'signatures.json', 'diagnostics.json', 'tickets.json', 'cost.json'];

/** Relative directory of the snapshot, from the repository root. */
export const GOLDEN_DIR = 'data/golden';

/** Command that regenerates the snapshot (quoted in every failure message). */
export const REGEN_COMMAND = 'npm run build && node tools/gen/golden.mjs';

/** SHA-256 of a buffer, as lowercase hex. */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Reference instant of a replay: the last instant of the dataset.
 *
 * Derived from the data, never from the wall clock, so the generator and the
 * test replay the sample set at the exact same moment.
 */
export function referenceNow(dataset) {
  return dataset.occurrences.reduce((max, occurrence) => (occurrence.at > max ? occurrence.at : max), '');
}

/** The single serialization: sorted keys are guaranteed by the builders. */
export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** One signature, as metadata only (no template, no frames). */
function signatureEntry(signature) {
  return {
    id: signature.id,
    familyId: signature.familyId,
    category: signature.category,
    status: signature.status,
    occurrences: signature.occurrences,
    firstSeen: signature.firstSeen,
    lastSeen: signature.lastSeen,
    issueKey: signature.issueKey ?? null,
  };
}

/** One diagnostic, as metadata only (no title, no summary, no facts). */
function diagnosticEntry(entry) {
  return {
    occurrenceId: entry.occurrence.id,
    signatureId: entry.diagnostic.signatureId,
    kind: entry.diagnostic.kind,
    action: entry.diagnostic.action,
    confidence: entry.diagnostic.confidence,
  };
}

/** One planned ticket action, as metadata only (no summary, no comment). */
function ticketEntry(action) {
  return {
    kind: action.kind,
    familyId: action.familyId,
    signatureId: action.signatureId,
    issueKey: action.issueKey ?? null,
    labels: action.labels ? [...action.labels] : [],
  };
}

/** Diagnostic kinds, alphabetically, so `byKind` never moves. */
function sortedByKind(byKind) {
  const sorted = {};
  for (const kind of Object.keys(byKind).sort()) sorted[kind] = byKind[kind];
  return sorted;
}

/**
 * Build the whole snapshot from one replay and its cost report.
 *
 * `result` is a `ReplayResult` of the real engine; `cost` is the report of
 * `computeCost` over the occurrences of that replay, at `referenceNow`.
 */
export function buildGoldenSnapshot({ dataset, datasetSha256, result, cost }) {
  const now = referenceNow(dataset);
  return {
    'meta.json': {
      goldenVersion: GOLDEN_VERSION,
      generator: 'tools/gen/golden.mjs',
      dataset: dataset.name,
      datasetSha256,
      referenceNow: now,
      failures: result.occurrences,
      signatures: result.signatures.length,
      diagnostics: result.diagnostics.length,
      tickets: result.tickets.length,
    },
    'signatures.json': result.signatures
      .map(signatureEntry)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    'diagnostics.json': {
      byKind: sortedByKind(result.byKind),
      perOccurrence: result.diagnostics
        .map(diagnosticEntry)
        .sort((a, b) => (a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0)),
    },
    // The plan order is deterministic (chronological) and meaningful:
    // a `create` always comes before the `comment`s of its family.
    'tickets.json': result.tickets.map(ticketEntry),
    'cost.json': {
      windowDays: cost.windowDays,
      redBuilds: cost.redBuilds,
      ciMinutesLost: cost.ciMinutesLost,
      peopleAffected: cost.peopleAffected,
      retries: cost.retries,
    },
  };
}

/** True for a plain object (not an array, not null). */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Readable one-line form of a leaf value. */
function fmt(value) {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/** Walk two values and collect the leaf differences, deepest path first. */
function walk(path, expected, actual, out, limit) {
  if (out.length >= limit) return;
  if (JSON.stringify(expected) === JSON.stringify(actual)) return;
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) walk(`${path}.${key}`, expected[key], actual[key], out, limit);
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      out.push(`${path}.length: expected ${expected.length}, got ${actual.length}`);
    }
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      walk(`${path}[${index}]`, expected[index], actual[index], out, limit);
    }
    return;
  }
  out.push(`${path}: expected ${fmt(expected)}, got ${fmt(actual)}`);
}

/**
 * Human-readable drift between two snapshots: which file, which field,
 * expected value, observed value (at most `limit` differences).
 */
export function describeDrift(expected, actual, limit = 15) {
  const out = [];
  for (const file of GOLDEN_FILES) {
    walk(file.replace('.json', ''), expected[file], actual[file], out, limit);
    if (out.length >= limit) break;
  }
  return out;
}

/** Distinct log lines of the dataset long enough to be identifiable. */
function logLines(dataset, minLength = 24) {
  const lines = new Set();
  for (const occurrence of dataset.occurrences) {
    for (const line of (occurrence.log ?? '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length >= minLength) lines.add(trimmed);
    }
  }
  return [...lines];
}

/**
 * Raw log excerpts that leaked into serialized snapshot texts.
 *
 * The sample set is fictional, but the snapshot must stay metadata: this
 * guard fails the generation (and the test) if one line of a log reappears
 * verbatim in a committed file.
 */
export function findRawLogLeaks(dataset, texts, limit = 5) {
  const leaked = [];
  for (const line of logLines(dataset)) {
    if (texts.some((text) => text.includes(line))) {
      leaked.push(line);
      if (leaked.length >= limit) break;
    }
  }
  return leaked;
}
