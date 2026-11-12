/**
 * The UI Kit resolvers of the Brain (§ 14).
 *
 * A UI Kit 2 module declares **one** Forge function as its resolver
 * (`resolver.function` in `manifest.yml`); every `invoke('<name>')` of the
 * frontend reaches that function with the name in `call.functionKey`, and the
 * resolver dispatches on it. This module registers the eleven names the screens
 * use (`src/ui/data.ts`), and nothing else: reading the memory stays in
 * `query.ts`, `settings.ts` and `memoryViews.ts`, and the curation, quarantine
 * and incident previews are assembled in `src/pure/`.
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
  /** Project page, "replay the sample set" button (§ 22, CI-11). */
  replaySample(): Promise<unknown>;
  /** Project page, curation: merge two signatures (CI-17). */
  curateMerge(payload: unknown): Promise<unknown>;
  /** Project page, curation: split one signature (CI-17). */
  curateSplit(payload: unknown): Promise<unknown>;
  /** Project page, propose the quarantine of a signature (CI-19). */
  quarantineProposal(payload: unknown): Promise<unknown>;
  /** Project page, the journal of what the app did. */
  auditLog(): Promise<unknown>;
  /** Project page, the export of the memory (CSV or JSON). */
  memoryExport(payload: unknown): Promise<unknown>;
  /** Project page, the health of the memory. */
  memoryHealth(): Promise<unknown>;
}

/** The `invoke()` names the frontend uses, in the order they are registered. */
export const UI_CALL_NAMES = [
  'memory-page',
  'issue-context',
  'settings',
  'save-settings',
  'replay-sample',
  'curate-merge',
  'curate-split',
  'quarantine-proposal',
  'audit-log',
  'memory-export',
  'memory-health',
] as const;

/** Registers the screen resolvers on an injected `@forge/resolver`. */
export function registerUiResolvers(resolver: ResolverLike, ports: UiDataPorts): void {
  resolver.define('memory-page', () => ports.memoryPage());
  resolver.define('issue-context', ({ payload, context }) => ports.issuePanel(payload, context));
  resolver.define('settings', () => ports.settings());
  resolver.define('save-settings', ({ payload }) => ports.saveSettings(payload));
  resolver.define('replay-sample', () => ports.replaySample());
  resolver.define('curate-merge', ({ payload }) => ports.curateMerge(payload));
  resolver.define('curate-split', ({ payload }) => ports.curateSplit(payload));
  resolver.define('quarantine-proposal', ({ payload }) => ports.quarantineProposal(payload));
  resolver.define('audit-log', () => ports.auditLog());
  resolver.define('memory-export', ({ payload }) => ports.memoryExport(payload));
  resolver.define('memory-health', () => ports.memoryHealth());
}
