/**
 * Screen routing of the Brain — pure, no `@forge/react` import.
 *
 * The manifest points three UI modules at **one** resource
 * (`resources: main`); the entry point picks the screen from the module key
 * the platform hands over. The table lives here, out of the `.tsx` file, so
 * it is unit-tested without a browser.
 */

import { resolveScreen as matchScreen, type ScreenRule } from '@dejavu/present';

/** The three UI Kit screens of the Brain (§ 14, screens 3, 4 and 5). */
export type BrainScreen = 'projectPage' | 'issuePanel' | 'settingsPage';

/**
 * Module key → screen.
 *
 * Order matters: the first matching rule wins, so the more specific key
 * (`deja-vu-project-settings`) is tested before the shorter one
 * (`deja-vu-project-page`) — both start with `deja-vu-project`.
 */
export const SCREEN_RULES: ScreenRule<BrainScreen>[] = [
  { match: 'deja-vu-project-settings', screen: 'settingsPage' },
  { match: 'deja-vu-project-page', screen: 'projectPage' },
  { match: 'deja-vu-issue-panel', screen: 'issuePanel' },
];

/** Default screen when the module key is missing or unknown. */
export const FALLBACK_SCREEN: BrainScreen = 'projectPage';

/** Screen to render for a Forge module key. */
export function resolveScreen(moduleKey: string | undefined): BrainScreen {
  return matchScreen(moduleKey, SCREEN_RULES, FALLBACK_SCREEN);
}
