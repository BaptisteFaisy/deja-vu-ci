/**
 * Screen routing of the Sensor — pure, no `@forge/react` import.
 *
 * Both Bitbucket modules point at the same resource (`resources: main`); the
 * entry picks the screen from the module key the platform hands over. The
 * table lives here, out of the `.tsx` file, so it is unit-tested.
 */

import { resolveScreen as matchScreen, type ScreenRule } from '@dejavu/present';

/** The two UI Kit screens of the Sensor (§ 14, screens 1 and 2). */
export type SensorScreen = 'prCard' | 'settings';

/**
 * Module key → screen.
 *
 * Order matters: the first matching rule wins, and the settings key is the
 * longer of the two.
 */
export const SCREEN_RULES: ScreenRule<SensorScreen>[] = [
  { match: 'deja-vu-workspace-settings', screen: 'settings' },
  { match: 'deja-vu-pr-card', screen: 'prCard' },
];

/** Default screen when the module key is missing or unknown. */
export const FALLBACK_SCREEN: SensorScreen = 'prCard';

/** Screen to render for a Forge module key. */
export function resolveScreen(moduleKey: string | undefined): SensorScreen {
  return matchScreen(moduleKey, SCREEN_RULES, FALLBACK_SCREEN);
}
