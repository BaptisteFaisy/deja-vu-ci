/**
 * Reading the Bitbucket build-status event — pure, no Forge import.
 *
 * The trigger payload of `avi:bitbucket:created:build-status` carries the
 * build key, the commit hash, the state, the build address and the branch
 * (§ 17). The exact field names are a point to confirm with a prototype:
 * the reader below accepts the documented names and their usual variants,
 * and never throws.
 */

/** The parts of the event the Sensor needs. */
export interface BuildStatusEvent {
  /** Key of the build status. */
  buildKey?: string;
  /** Hash of the commit that was built. */
  commit?: string;
  /** State of the build: `FAILED`, `SUCCESSFUL`, `INPROGRESS`… */
  state?: string;
  /** Address of the build in the Bitbucket UI. */
  buildUrl?: string;
  /** Branch that was built. */
  branch?: string;
  /** Author of the commit. */
  author?: string;
  /** Workspace of the repository. */
  workspace?: string;
  /** Repository slug. */
  repository?: string;
  /** Pull request the build belongs to, when there is one. */
  prId?: number;
  /** Build number. */
  buildNumber?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Extracts the repository slug (`owner/repo`) from a Bitbucket address. */
export function repositorySlugFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /\/([^\/]+)\/([^\/]+)\/(?:pipelines|commit|branch|commits)\b/.exec(url);
  if (!match) return undefined;
  return `${match[1]}/${match[2]}`;
}

/**
 * Reads the build-status event.
 *
 * The payload is read from the top level, from `data`, and from `context`
 * so that the reader survives the usual shape variations.
 */
export function parseBuildStatusEvent(payload: unknown): BuildStatusEvent {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data) ?? root;
  const context = asRecord(root.context) ?? {};
  const repository = asRecord(data.repository) ?? {};
  const commit = asRecord(data.commit) ?? {};
  const author = asRecord(commit.author) ?? {};
  const pullRequest = asRecord(data.pullRequest) ?? {};
  const buildUrl = asString(data.buildUrl) ?? asString(data.url) ?? asString(data.build_url);
  const prId =
    asNumber(pullRequest.id) ??
    asNumber(data.prId) ??
    asNumber(data.pullRequestId) ??
    undefined;
  return {
    buildKey: asString(data.buildKey) ?? asString(data.key) ?? asString(data.build_key),
    commit: asString(commit.hash) ?? asString(data.commitHash) ?? asString(data.commit),
    state: asString(data.state) ?? asString(data.status) ?? asString(data.buildState),
    buildUrl,
    branch: asString(commit.refName) ?? asString(data.branch) ?? asString(data.refName),
    author: asString(author.raw) ?? asString(author.name) ?? asString(data.author),
    workspace:
      asString(asRecord(repository.workspace)?.slug) ??
      asString(repository.workspace) ??
      asString(data.workspace) ??
      asString(context.workspace),
    repository:
      asString(repository.slug) ?? asString(repository.name) ?? asString(data.repository),
    prId,
    buildNumber: asNumber(data.buildNumber) ?? asNumber(data.build_number),
  };
}

/**
 * Tells whether the event describes a failed build.
 *
 * Only the failure state is treated (§ 15, step 1): the successes are
 * read by the Brain to note "it passed at the same commit".
 */
export function isFailureState(state: string | undefined): boolean {
  if (!state) return false;
  return state.trim().toUpperCase() === 'FAILED';
}
