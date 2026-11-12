/**
 * The pure analysis behind the « Your error » panel — no DOM, no network.
 *
 * Input: the pasted log text, the shared memory (`Store`) and the frozen demo
 * clock. Output: the four real steps of the pipeline, as plain data that
 * `erreur.ts` only has to place on the page:
 *
 *  1. masking      — `maskSecrets` (`@dejavu/core`);
 *  2. extraction   — `extractErrorBlocks` + the ecosystem parsers that
 *                    recognised the log (`REPORT_PARSERS`);
 *  3. signature    — `signatureKeys` + `signatureShort`, and whether the
 *                    signature already lives in the shared replay memory;
 *  4. diagnosis    — `diagnose` with a real context: a synthetic occurrence
 *                    built from the text, the history read from the memory,
 *                    the stored resolution/outbreak if any, default settings.
 *
 * Nothing is invented: when no block is recognised, `extract.blocks` is empty
 * and the panel says so instead of fabricating a diagnosis.
 */

import {
  REPORT_PARSERS,
  diagnose,
  extractErrorBlocks,
  hintsFromBlock,
  maskSecrets,
  signatureKeys,
  signatureShort,
  type Diagnostic,
  type ErrorBlock,
  type ExtractSource,
  type MaskResult,
  type Occurrence,
  type Outbreak,
  type Resolution,
  type Settings,
  type Signature,
  type Store,
} from '@dejavu/core';

/** Step 1 — what masking did to the pasted text. */
export type MaskStep = MaskResult;

/** Step 2 — what extraction recognised, and from where. */
export interface ExtractStep {
  source: ExtractSource;
  dropped: number;
  /** Ecosystems whose report parser recognised the (masked) text. */
  ecosystems: string[];
  blocks: ErrorBlock[];
}

/** Step 3 — the fingerprints of one block, and its memory record if known. */
export interface SignatureStep {
  block: ErrorBlock;
  signature: string;
  family: string;
  short: string;
  /** The signature record from the shared memory, when it already exists. */
  known?: Signature;
}

/** Step 4 — one diagnosis, with the exact context fed to `diagnose`. */
export interface DiagnoseStep {
  occurrence: Occurrence;
  history: Occurrence[];
  familyHistory: Occurrence[];
  resolution?: Resolution;
  outbreak?: Outbreak;
  settings: Settings;
  diagnostic: Diagnostic;
}

/** The whole analysis of one pasted log. */
export interface ErrorAnalysis {
  mask: MaskStep;
  extract: ExtractStep;
  signatures: SignatureStep[];
  diagnoses: DiagnoseStep[];
}

/** Step 1: mask the secrets of the pasted text with the real masker. */
export function maskStep(text: string): MaskStep {
  return maskSecrets(text);
}

/** Step 2: extract the blocks, and list the ecosystems that recognised the log. */
export function extractStep(masked: string): ExtractStep {
  const result = extractErrorBlocks({ stepLog: masked });
  const ecosystems = REPORT_PARSERS.filter((parser) => parser.detect(masked)).map(
    (parser) => parser.ecosystem,
  );
  return { source: result.source, dropped: result.dropped, ecosystems, blocks: result.blocks };
}

/** Step 3: fingerprints of one block, plus its memory record when known. */
export async function signatureStep(block: ErrorBlock, store: Store): Promise<SignatureStep> {
  const keys = signatureKeys(block);
  const known = await store.getSignature(keys.signature);
  return {
    block,
    signature: keys.signature,
    family: keys.family,
    short: signatureShort(keys.signature),
    ...(known ? { known } : {}),
  };
}

/**
 * The synthetic occurrence of the pasted log: `diagnose` needs one, and the
 * panel cannot know the visitor's repository, branch or commit. Every field
 * says so plainly — the panel shows this occurrence as raw JSON, and the note
 * of step 4 states that the context is synthetic.
 */
export function pastedOccurrence(
  step: SignatureStep,
  now: Date,
): Occurrence {
  return {
    id: `pasted-${step.signature}`,
    signatureId: step.signature,
    familyId: step.family,
    workspace: 'site',
    repo: 'pasted-log',
    branch: 'local',
    commit: 'unknown',
    author: 'visitor',
    stepName: step.block.testName ?? 'pasted-log',
    durationS: 0,
    occurredAt: now.toISOString(),
    passedOnRetry: false,
    ...(step.block.testName ? { testName: step.block.testName } : {}),
  };
}

/** Step 4: diagnose one block against everything the shared memory knows. */
export async function diagnoseStep(
  step: SignatureStep,
  store: Store,
  now: Date,
): Promise<DiagnoseStep> {
  const occurrence = pastedOccurrence(step, now);
  const history = await store.listOccurrences(occurrence.signatureId);
  const familyHistory = await store.listFamilyOccurrences(occurrence.familyId);
  const resolution = await store.getResolution(occurrence.signatureId);
  const outbreak = await store.findOutbreak(occurrence.familyId);
  const settings = await store.getSettings();
  const diagnostic = diagnose({
    occurrence,
    history,
    familyHistory,
    ...(resolution ? { resolution } : {}),
    branchContainsResolution: false,
    ...(outbreak ? { outbreak } : {}),
    changedFiles: [],
    settings,
    now,
    ...hintsFromBlock(step.block),
  });
  return { occurrence, history, familyHistory, settings, diagnostic,
    ...(resolution ? { resolution } : {}), ...(outbreak ? { outbreak } : {}) };
}

/**
 * Run the four steps on a pasted log. Pure data in, pure data out — the
 * panel (`erreur.ts`) does nothing but display it.
 */
export async function analyzePastedLog(
  text: string,
  store: Store,
  now: Date,
): Promise<ErrorAnalysis> {
  const mask = maskStep(text);
  const extract = extractStep(mask.text);
  const signatures: SignatureStep[] = [];
  for (const block of extract.blocks) signatures.push(await signatureStep(block, store));
  const diagnoses: DiagnoseStep[] = [];
  for (const step of signatures) diagnoses.push(await diagnoseStep(step, store, now));
  return { mask, extract, signatures, diagnoses };
}
