/**
 * Pairing and workspace settings — the Forge layer.
 *
 * The Sensor keeps no memory of the builds (§ 7): the only durable data is
 * the pairing with a Brain and the preferences of the workspace (§ 14
 * screen 2). The shared secret of the signed bridge lives in the Forge
 * secret storage; the application storage keeps its identifier only
 * (§ 16, `pairing.secretId`). No secret is ever written in clear text,
 * returned to a resolver, or logged.
 */

import { BRIDGE_SECRET_KEY, defaultSettings, readSettings, type SensorSettings } from './pure/settings';

/** The part of the Forge storage API the Sensor uses. */
export interface StoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  setSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<unknown>;
}

/** Storage key of the settings of one workspace. */
export function settingsKey(workspace: string): string {
  return `dejavu.settings.${workspace || 'default'}`;
}

/** Reads the settings of a workspace, with the defaults when absent. */
export async function loadSettings(
  storage: StoragePort,
  workspace: string,
): Promise<SensorSettings> {
  try {
    return readSettings(await storage.get(settingsKey(workspace)));
  } catch {
    return defaultSettings();
  }
}

/** Writes the settings of a workspace. */
export async function saveWorkspaceSettings(
  storage: StoragePort,
  workspace: string,
  settings: SensorSettings,
): Promise<void> {
  await storage.set(settingsKey(workspace), settings as unknown as Record<string, unknown>);
}

/**
 * Writes the shared secret of the bridge to the Forge secret storage and
 * returns the identifier to keep in the settings.
 */
export async function storeBridgeSecret(
  storage: StoragePort,
  secret: string,
): Promise<string> {
  await storage.setSecret(BRIDGE_SECRET_KEY, secret);
  return BRIDGE_SECRET_KEY;
}

/**
 * Reads the shared secret of the bridge.
 *
 * Returns `undefined` when the workspace is not paired or when the secret
 * storage refuses to answer: the caller then refuses to send anything.
 */
export async function loadBridgeSecret(
  storage: StoragePort,
  secretId: string | undefined,
): Promise<string | undefined> {
  if (!secretId) return undefined;
  try {
    const secret = await storage.getSecret(secretId);
    return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a repository is watched.
 *
 * An empty watch list means "every repository of the workspace": the
 * pairing is explicit, the list is only a restriction.
 */
export function isTracked(settings: SensorSettings, slug: string): boolean {
  if (settings.trackedRepositories.length === 0) return true;
  return settings.trackedRepositories.includes(slug);
}
