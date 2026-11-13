/**
 * The project the tickets are created in — one rule, one place.
 *
 * Before this lot, the app wrote every ticket into the project named by the
 * `issueProjectKey` setting, whose engine default (`CI`) exists on no Jira
 * site: on a tenant where nothing was configured the write was refused with
 * HTTP 400 ("the target project does not exist"). The rule is now:
 *
 *  1. the operator's **explicit choice** primes — a filled register keeps
 *     exactly the behaviour it had;
 *  2. without an explicit choice, the project the operator is **looking at**
 *     (the project page where they clicked) is used;
 *  3. with neither — a background call, the queue consumer — there is **no
 *     target**: no ticket is created, and the caller is told why.
 *
 * This module holds the **single** helper that decides the effective target,
 * and the empty-register value the app's own storage uses. Pure module: no
 * `@forge/*` import, no store, no clock.
 */

/**
 * The register value of an installation whose operator chose no project.
 *
 * The engine's default is the placeholder `CI`; it names no project on a real
 * tenant, so the app does not treat it as a choice. An empty register means
 * "the project on screen" — in the background path it means "nothing".
 */
export const UNCHOSEN_PROJECT_KEY = '';

/** Where the effective project key comes from. */
export type ProjectTargetSource = 'setting' | 'screen' | 'none';

/** The effective project the tickets are created in. */
export interface ProjectTarget {
  /** The Jira project key; `''` when none could be decided. */
  projectKey: string;
  /** Which rule decided it. */
  source: ProjectTargetSource;
  /** Why there is no key — only when `source` is `none`. */
  reason?: string;
}

/**
 * The reason the app gives when it knows no project to write in. English, like
 * every other diagnostic of the product.
 */
export const NO_PROJECT_REASON =
  'no target project: the operator has not chosen one, and this call carries no project context';

/** A project key as Jira writes it: trimmed, upper case, `''` when unset. */
function normalizeProjectKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/**
 * The effective target project of one call.
 *
 * The setting wins when it is filled; the screen answers when it is not; with
 * neither, the app has no project and must not write.
 */
export function resolveProjectTarget(input: {
  /** The operator's explicit choice — empty when they chose none. */
  chosen: string;
  /** The project of the screen the call comes from — empty when unknown. */
  screenProjectKey?: unknown;
}): ProjectTarget {
  const chosen = normalizeProjectKey(input.chosen);
  if (chosen) return { projectKey: chosen, source: 'setting' };
  const screen = normalizeProjectKey(input.screenProjectKey);
  if (screen) return { projectKey: screen, source: 'screen' };
  return { projectKey: '', source: 'none', reason: NO_PROJECT_REASON };
}

/** A decision on one `create` action: the project key, or the reason to refuse. */
export type CreateDecision = { ok: true; projectKey: string } | { ok: false; reason: string };

/**
 * The project a `create` ticket action must go to, or the reason the app
 * refuses to create one. Kept apart from the Jira adapter so the refusal is
 * tested without a tenant — and so no adapter ever invents a fallback key.
 */
export function createDecision(target: ProjectTarget): CreateDecision {
  if (target.projectKey) return { ok: true, projectKey: target.projectKey };
  return { ok: false, reason: target.reason ?? NO_PROJECT_REASON };
}