/**
 * Manual curation of signatures (CI-17) — decision logic for the CI Memory
 * page, kept **pure** so it is tested without React and without the UI Kit.
 *
 * **Split in two on purpose.** This file holds what the screens may import:
 * the four criteria and the shapes of the previews. It has no runtime import of
 * the engine, because the Forge bundler compiles the UI Kit entry for a web
 * target where Node built-ins are disabled — and the engine barrel pulls in
 * `crypto`. The functions that call the engine live in `curationCompute.ts`,
 * imported by the backend only (`src/index.ts`). `test/ui-bundle.test.ts`
 * enforces the boundary.
 *
 * The engine already knows how to merge and split signatures
 * (`@dejavu/core` `curate.ts`). `curationCompute.ts` only:
 *   - maps the four UI criteria to the engine's `SplitCriterion`;
 *   - previews a merge or a split **without mutating** the memory: the engine
 *     functions reassign the occurrences they receive in place, so a preview
 *     hands them a copy and the store is only written after confirmation;
 *   - assembles the preview from two signature ids, reading through a minimal
 *     store contract so the whole flow is unit-tested on an in-memory store.
 *
 * Nothing here touches Forge, React or the network.
 */

import type { NormalizationRuleSuggestion, Signature, SplitResult } from '@dejavu/core';

/** The four criteria the "Split" action offers (§ 19). */
export type SplitCriterionKey = 'test-name' | 'branch' | 'repository' | 'function';

/** The four criteria, in the order the screen lists them. */
export const SPLIT_CRITERION_KEYS: readonly SplitCriterionKey[] = [
  'test-name',
  'branch',
  'repository',
  'function',
];

/** Type guard for the four UI criteria (the payload of `invoke` is unknown). */
export function isSplitCriterionKey(value: unknown): value is SplitCriterionKey {
  return (
    value === 'test-name' ||
    value === 'branch' ||
    value === 'repository' ||
    value === 'function'
  );
}

/** The kept part of a merge preview, as the screen shows it. */
export interface MergePreviewData {
  merged: Signature;
  retired: Signature;
  movedOccurrences: number;
  rule?: NormalizationRuleSuggestion;
}

/** Answer of a merge preview. */
export type MergePreviewAnswer =
  | { ok: true; data: MergePreviewData }
  | { ok: false; error: string };

/** Answer of a split preview. */
export type SplitPreviewAnswer =
  | { ok: true; data: SplitResult }
  | { ok: false; error: string };
