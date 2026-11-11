/**
 * Pairing and workspace settings of the Sensor — pure, no Forge import.
 *
 * Specification § 14 (screen 2, Bitbucket side): "pairing, tracked
 * repositories, maximum excerpt size". The pairing is what establishes the
 * shared secret of the signed bridge (§ 15).
 *
 * The shared secret never lives in the application storage: it is written
 * to the Forge secret storage and only its identifier is kept in the
 * regular storage (§ 16, `pairing.secretId`).
 */

/** Maximum size of an excerpt kept by the Sensor, in bytes (50 KiB). */
export const MAX_EXCERPT_BYTES = 50 * 1024;

/** Minimum size of an excerpt, in bytes (1 KiB). */
export const MIN_EXCERPT_BYTES = 1024;

/** Identifier of the Forge secret holding the shared bridge secret. */
export const BRIDGE_SECRET_KEY = 'dejavu-bridge-secret';

/** Settings of one Bitbucket workspace, as stored in `storage:app`. */
export interface SensorSettings {
  /** Base URL of the Brain web trigger (the Jira app). */
  brainUrl?: string;
  /** Identifier of the Forge secret holding the shared secret. */
  secretId?: string;
  /** Repositories the Sensor watches, as `workspace/repo` slugs. */
  trackedRepositories: string[];
  /** Maximum size of the excerpts sent to the Brain. */
  maxExcerptBytes: number;
  /** ISO-8601, UTC — when the pairing was established. */
  pairedAt?: string;
  /** Who established the pairing. */
  pairedBy?: string;
}

/** Settings of a workspace that is not paired yet. */
export const DEFAULT_SENSOR_SETTINGS: SensorSettings = {
  trackedRepositories: [],
  maxExcerptBytes: MAX_EXCERPT_BYTES,
};

/** The pairing form of the settings page. */
export interface PairingInput {
  brainUrl?: string;
  /** The shared secret, given once at pairing time. */
  secret?: string;
  pairedBy?: string;
  /** ISO-8601, UTC. */
  now?: string;
}

/** Result of a pairing attempt. */
export type PairingResult =
  | { ok: true; settings: SensorSettings }
  | { ok: false; error: string };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Settings of a fresh workspace. */
export function defaultSettings(): SensorSettings {
  return { ...DEFAULT_SENSOR_SETTINGS, trackedRepositories: [] };
}

/**
 * Validates a pairing form and builds the settings to store.
 *
 * The secret itself is not returned: the caller writes it to the Forge
 * secret storage and keeps only the identifier.
 */
export function buildPairing(input: PairingInput): PairingResult {
  const brainUrl = (input.brainUrl ?? '').trim();
  if (!brainUrl) return { ok: false, error: 'the Brain URL is required' };
  if (!isHttpUrl(brainUrl)) return { ok: false, error: 'the Brain URL is not a valid URL' };
  const secret = input.secret ?? '';
  if (secret.length < 16) {
    return { ok: false, error: 'the shared secret must be at least 16 characters long' };
  }
  return {
    ok: true,
    settings: {
      ...defaultSettings(),
      brainUrl,
      secretId: BRIDGE_SECRET_KEY,
      pairedAt: input.now ?? new Date().toISOString(),
      pairedBy: (input.pairedBy ?? '').trim() || 'unknown',
    },
  };
}

/**
 * Reads the settings stored for a workspace, filling the defaults.
 *
 * The stored value is untrusted: a malformed entry falls back on the
 * defaults instead of raising.
 */
export function readSettings(stored: unknown): SensorSettings {
  if (typeof stored !== 'object' || stored === null) return defaultSettings();
  const record = stored as Record<string, unknown>;
  const repositories = Array.isArray(record.trackedRepositories)
    ? record.trackedRepositories.filter((item): item is string => typeof item === 'string')
    : [];
  const maxExcerptBytes =
    typeof record.maxExcerptBytes === 'number' && Number.isFinite(record.maxExcerptBytes)
      ? Math.min(MAX_EXCERPT_BYTES, Math.max(MIN_EXCERPT_BYTES, Math.trunc(record.maxExcerptBytes)))
      : MAX_EXCERPT_BYTES;
  return {
    ...(typeof record.brainUrl === 'string' ? { brainUrl: record.brainUrl } : {}),
    ...(typeof record.secretId === 'string' ? { secretId: record.secretId } : {}),
    trackedRepositories: repositories,
    maxExcerptBytes,
    ...(typeof record.pairedAt === 'string' ? { pairedAt: record.pairedAt } : {}),
    ...(typeof record.pairedBy === 'string' ? { pairedBy: record.pairedBy } : {}),
  };
}

/** True when the workspace is paired with a Brain. */
export function isPaired(settings: SensorSettings): boolean {
  return Boolean(settings.brainUrl && settings.secretId);
}

/** Adds a repository to the watch list, without duplicates. */
export function addRepository(settings: SensorSettings, slug: string): SensorSettings {
  const trimmed = slug.trim();
  if (!trimmed || settings.trackedRepositories.includes(trimmed)) return settings;
  return { ...settings, trackedRepositories: [...settings.trackedRepositories, trimmed] };
}

/** Removes a repository from the watch list. */
export function removeRepository(settings: SensorSettings, slug: string): SensorSettings {
  return {
    ...settings,
    trackedRepositories: settings.trackedRepositories.filter((item) => item !== slug.trim()),
  };
}
