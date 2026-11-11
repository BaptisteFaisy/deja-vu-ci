/**
 * Mirror of the engine defaults, readable at runtime by the pure modules.
 *
 * `DEFAULT_SETTINGS` lives in `@dejavu/core`, but the package is not built
 * when the app tests run (it is not part of the root npm workspace), so a
 * runtime import of the value would fail in vitest while type-only imports
 * are erased. The pure modules therefore read this mirror, and
 * `test/defaults.test.ts` asserts that it stays identical to the engine —
 * the mirror can never drift silently.
 */

import type { Settings } from '@dejavu/core';

/** Same table as `DEFAULT_SETTINGS` in `packages/core/src/types.ts`. */
export const DEFAULT_SETTINGS: Settings = {
  issueProjectKey: 'CI',
  flakyMinOccurrences: 3,
  flakyMinBranches: 2,
  flakyWindowDays: 14,
  outbreakRepos: 3,
  outbreakWindowMin: 15,
  rawRetentionDays: 30,
  minConfidenceNotYourFault: 0.75,
};
