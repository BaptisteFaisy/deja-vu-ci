/**
 * The UI Kit resolvers of the Brain (§ 14).
 *
 * A UI Kit 2 module declares **one** Forge function as its resolver
 * (`resolver.function` in `manifest.yml`); every `invoke('<name>')` of the
 * frontend reaches that function with the name in `call.functionKey`, and the
 * resolver dispatches on it. This module registers the four names the screens
 * use (`src/ui/data.ts`), and nothing else: reading the memory stays in
 * `query.ts` and `settings.ts`.
 *
 * No `@forge/*` import here — the resolver is injected (`ResolverLike`) and
 * the data is injected (`UiDataPorts`), so the wiring is unit-tested without
 * a tenant, exactly like the rest of `src/pure/`.
 */

/** What `@forge/resolver` hands to a definition: the payload and the context. */
export interface ResolverRequest {
  payload: unknown;
  context: unknown;
}

/** What `@forge/resolver` exposes: one definition per invoke name. */
export interface ResolverLike {
  define(name: string, fn: (request: ResolverRequest) => unknown): unknown;
}

/** The data the screens ask for, injected by `index.ts`. */
export interface UiDataPorts {
  /** Project page "CI Memory" (§ 14, screen 3). */
  memoryPage(): Promise<unknown>;
  /** Issue panel (§ 14, screen 4). */
  issuePanel(payload: unknown, context: unknown): Promise<unknown>;
  /** Settings page (§ 14, screen 5). */
  settings(): Promise<unknown>;
  /** Settings page, save button. */
  saveSettings(payload: unknown): Promise<unknown>;
}

/** The `invoke()` names the frontend uses, in the order they are registered. */
export const UI_CALL_NAMES = ['memory-page', 'issue-context', 'settings', 'save-settings'] as const;

/** Registers the four screen resolvers on an injected `@forge/resolver`. */
export function registerUiResolvers(resolver: ResolverLike, ports: UiDataPorts): void {
  resolver.define('memory-page', () => ports.memoryPage());
  resolver.define('issue-context', ({ payload, context }) => ports.issuePanel(payload, context));
  resolver.define('settings', () => ports.settings());
  resolver.define('save-settings', ({ payload }) => ports.saveSettings(payload));
}
