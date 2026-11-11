/**
 * Universal entry point (CI-16, § 15).
 *
 * Any CI can feed the Cerveau by sending a JSON payload to the universal web
 * trigger. The payload is validated strictly, its journal is bounded to 50 KiB
 * and its secrets are masked before anything leaves the machine.
 *
 * The masking helper belongs to the masking module of the package. It is
 * loaded on demand (`initUniversal`), never at the top level of the module: a
 * top-level await would break a CommonJS bundling. When no masker is
 * available the entry point fails closed — an unmasked journal never leaves
 * the process.
 */

import type { FailedTestCase, IngestPayload, Settings, UniversalPayload } from './types.js';

/** Maximum size of the journal kept for one payload (50 KiB). */
export const MAX_LOG_BYTES = 51200;

/** Masking helper, as provided by the masking module of the package. */
export type Masker = (text: string) => { text: string; masked: number; kinds: string[] };

/** Result of the validation of a universal payload. */
export type ParseResult =
  | { ok: true; payload: UniversalPayload }
  | { ok: false; error: string };

/** Specifier of the masking module, kept out of the static import graph. */
const MASK_MODULE = './mask.js';

let registeredMasker: Masker | undefined;

/**
 * Generation of the masker registry.
 *
 * It invalidates a loading in flight when the registry changes meanwhile, so
 * that an explicit registration always wins over the automatic one.
 */
let generation = 0;

/** Register the masker used to hide the secrets. */
export function setMasker(masker: Masker | undefined): void {
  generation += 1;
  registeredMasker = masker;
}

/** Forget the registered masker (the entry point closes again). */
export function clearMasker(): void {
  setMasker(undefined);
}

/** True when a masker is available. */
export function maskingAvailable(): boolean {
  return Boolean(registeredMasker);
}

/**
 * Load the masking module of the package and register it.
 *
 * The function never throws: a missing masking module only means that the
 * entry point stays closed until a masker is registered. A registration made
 * meanwhile always wins.
 */
export async function initUniversal(): Promise<boolean> {
  if (registeredMasker) return true;
  const started = generation;
  try {
    const mod = (await import(/* @vite-ignore */ MASK_MODULE)) as { maskSecrets?: Masker };
    if (typeof mod?.maskSecrets !== 'function') return false;
    if (started !== generation) return false;
    registeredMasker = mod.maskSecrets;
    return true;
  } catch {
    return false;
  }
}

// The masking module is wired as soon as it is reachable; a caller that needs
// the masker right away awaits `initUniversal()` itself.
void initUniversal();

/** True when the value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the value is a non-empty string. */
function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Check an optional string field. */
function checkOptionalString(
  body: Record<string, unknown>,
  field: string,
): { ok: true } | { ok: false; error: string } {
  const value = body[field];
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` };
  return { ok: true };
}

/** Check the optional list of failed test cases. */
function checkTestCases(
  body: Record<string, unknown>,
): { ok: true; value?: FailedTestCase[] } | { ok: false; error: string } {
  const value = body.testCases;
  if (value === undefined || value === null) return { ok: true };
  if (!Array.isArray(value)) return { ok: false, error: 'testCases must be an array' };
  for (const item of value) {
    if (!isRecord(item)) return { ok: false, error: 'each test case must be an object' };
    if (!isFilledString(item.name)) return { ok: false, error: 'each test case needs a name' };
    if (typeof item.message !== 'string') {
      return { ok: false, error: 'each test case needs a message' };
    }
  }
  return { ok: true, value: value as FailedTestCase[] };
}

/** Truncate a text to a maximum number of bytes, without splitting a char. */
export function truncateBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '');
}

/**
 * Validate a universal payload.
 *
 * The check is strict and the messages name the faulty field, so the caller
 * can fix its CI command without guessing. The journal is bounded to 50 KiB.
 */
export function parseUniversalPayload(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, error: 'payload must be a JSON object' };
  for (const field of ['projectKey', 'repository', 'branch', 'log']) {
    if (!isFilledString(body[field])) return { ok: false, error: `${field} is required` };
  }
  for (const field of ['commit', 'author', 'step', 'failedAt']) {
    const check = checkOptionalString(body, field);
    if (!check.ok) return check;
  }
  const testCases = checkTestCases(body);
  if (!testCases.ok) return testCases;
  return { ok: true, payload: toPayload(body, testCases.value) };
}

/** Build the validated payload out of the accepted body. */
function toPayload(body: Record<string, unknown>, testCases?: FailedTestCase[]): UniversalPayload {
  const optional = (field: string): string | undefined =>
    typeof body[field] === 'string' ? (body[field] as string) : undefined;
  return {
    projectKey: (body.projectKey as string).trim(),
    repository: (body.repository as string).trim(),
    branch: (body.branch as string).trim(),
    commit: optional('commit'),
    author: optional('author'),
    step: optional('step'),
    log: truncateBytes(body.log as string, MAX_LOG_BYTES),
    testCases,
    failedAt: optional('failedAt'),
  };
}

/** The masker in use; throws when nothing can mask the text. */
export function resolveMasker(): Masker {
  if (!registeredMasker) {
    throw new Error('masking is unavailable: call initUniversal or register a masker');
  }
  return registeredMasker;
}

/**
 * Convert a universal payload into the payload the Cerveau already knows.
 *
 * The result goes through the very same path as the Bitbucket sensor: the log
 * and the test case messages are masked first.
 */
export function universalToIngest(
  payload: UniversalPayload,
  opts?: { settings?: Partial<Settings>; now?: Date },
): IngestPayload {
  const settings = opts?.settings;
  if (settings?.universalKey !== undefined && settings.universalKey !== payload.projectKey) {
    throw new Error('invalid universal key');
  }
  const masker = resolveMasker();
  const now = opts?.now ?? new Date();
  const testCases = (payload.testCases ?? []).map((tc) => ({
    ...tc,
    message: masker(tc.message).text,
    stack: tc.stack === undefined ? undefined : masker(tc.stack).text,
  }));
  return {
    version: 1,
    workspace: 'universal',
    repository: payload.repository,
    branch: payload.branch,
    commit: payload.commit ?? '',
    author: payload.author ?? 'unknown',
    stepName: payload.step ?? 'build',
    durationS: 0,
    failedAt: payload.failedAt ?? now.toISOString(),
    errorBlocks: [masker(payload.log).text],
    testCases: testCases.length > 0 ? testCases : undefined,
  };
}
