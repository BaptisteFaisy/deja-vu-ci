/**
 * Routing of a Forge UI Kit entry point (§ 14).
 *
 * A UI Kit app declares **one** `resources:` entry and points several modules
 * at it: the entry point has to tell which screen to render. The platform
 * hands the module key through `useProductContext().moduleKey`, and the
 * mapping key → screen is a plain table, so it is testable without a browser
 * and without `@forge/react`.
 */

/** One rule: a fragment of module key, and the screen it opens. */
export interface ScreenRule<Screen extends string> {
  /** Substring looked for in the module key (`deja-vu-pr-card`). */
  readonly match: string;
  /** Screen rendered when the key contains the fragment. */
  readonly screen: Screen;
}

/**
 * Returns the screen of a module key.
 *
 * The first matching rule wins, so the caller lists the most specific keys
 * first. A missing or unknown key falls back on the default screen: a module
 * added to the manifest without a rule renders something readable instead of
 * a blank panel.
 */
export function resolveScreen<Screen extends string>(
  moduleKey: string | undefined,
  rules: readonly ScreenRule<Screen>[],
  fallback: Screen,
): Screen {
  const key = moduleKey ?? '';
  for (const rule of rules) {
    if (key.includes(rule.match)) return rule.screen;
  }
  return fallback;
}
