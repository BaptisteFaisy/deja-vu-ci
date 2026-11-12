/**
 * Manual curation of signatures (CI-17) — the half that calls the engine.
 *
 * Split out of `curation.ts`: these functions import **runtime values** of
 * `@dejavu/core` (`mergeSignatures`, `splitSignature`), which the Forge UI Kit
 * bundle (a web target, Node built-ins disabled) must never reach. The screens
 * import the shapes from `curation.ts`; only the backend (`src/index.ts`) and
 * the tests import this file. `test/ui-bundle.test.ts` guards the boundary.
 */

import {
  mergeSignatures,
  splitSignature,
  type MergeResult,
  type Occurrence,
  type Signature,
  type SplitCriterion,
  type SplitResult,
} from '@dejavu/core';
import type {
  MergePreviewAnswer,
  MergePreviewData,
  SplitCriterionKey,
  SplitPreviewAnswer,
} from './curation';

/**
 * Maps a UI criterion to the engine's `SplitCriterion`.
 *
 * `test-name`, `branch` and `repository` are the engine's own string
 * discriminators. The `function` criterion has no dedicated field on an
 * occurrence, so it discriminates on the pipeline step that ran
 * (`occurrence.stepName`) — the closest execution-level "function" the
 * occurrence model carries.
 */
export function criterionOf(key: SplitCriterionKey): SplitCriterion {
  if (key === 'test-name') return 'test-name';
  if (key === 'branch') return 'branch';
  if (key === 'repository') return 'repository';
  return (occurrence: Occurrence) => occurrence.stepName || '(none)';
}

/** Copies occurrences so a preview never mutates the caller's memory. */
function copyOccurrences(occurrences: Occurrence[]): Occurrence[] {
  return occurrences.map((occurrence) => ({ ...occurrence }));
}

/**
 * Previews a merge: the engine result, computed on a **copy** of the
 * occurrences. Nothing is written back to the store before the operator
 * confirms — the copy keeps the memory untouched during the preview.
 */
export function previewMerge(
  kept: Signature,
  dropped: Signature,
  occurrences: Occurrence[],
): MergeResult {
  return mergeSignatures(kept, dropped, copyOccurrences(occurrences));
}

/** Preview of a split, on a copy of the occurrences. */
export function previewSplit(
  signature: Signature,
  occurrences: Occurrence[],
  key: SplitCriterionKey,
): SplitResult {
  return splitSignature(signature, copyOccurrences(occurrences), criterionOf(key));
}

/** The minimal read side of the store the curation assembly needs. */
export interface CurationReadStore {
  getSignature(id: string): Promise<Signature | undefined>;
  listOccurrences(signatureId: string): Promise<Occurrence[]>;
}

/**
 * Assembles the merge preview the page shows, from two signature ids.
 *
 * The kept signature provides identity; the dropped signature is the one
 * folded into it. The two ids must differ and both must be known. Only the
 * dropped signature's occurrences are read: they are the ones the engine
 * reattaches to the kept signature.
 */
export async function assembleMergePreview(
  store: CurationReadStore,
  keepId: string,
  dropId: string,
): Promise<MergePreviewAnswer> {
  if (keepId === dropId) return { ok: false, error: 'the two signatures must be different' };
  const [kept, dropped] = await Promise.all([
    store.getSignature(keepId),
    store.getSignature(dropId),
  ]);
  if (!kept) return { ok: false, error: `unknown signature: ${keepId}` };
  if (!dropped) return { ok: false, error: `unknown signature: ${dropId}` };
  const occurrences = await store.listOccurrences(dropId);
  const { merged, retired, movedOccurrences, rule } = previewMerge(kept, dropped, occurrences);
  const data: MergePreviewData = { merged, retired, movedOccurrences };
  if (rule) data.rule = rule;
  return { ok: true, data };
}

/** Assembles the split preview the page shows. */
export async function assembleSplitPreview(
  store: CurationReadStore,
  signatureId: string,
  key: SplitCriterionKey,
): Promise<SplitPreviewAnswer> {
  const signature = await store.getSignature(signatureId);
  if (!signature) return { ok: false, error: `unknown signature: ${signatureId}` };
  const occurrences = await store.listOccurrences(signatureId);
  return { ok: true, data: previewSplit(signature, occurrences, key) };
}
