/**
 * Moteur de test (doublure locale).
 *
 * Les modules du moteur (`@dejavu/core`) arrivent en parallèle : le lot G
 * écrit **contre le contrat**, jamais contre une copie de la logique. Cette
 * doublure fournit donc des fonctions déterministes qui respectent les
 * signatures du contrat, et les tests vérifient ce qui appartient au lot G :
 * la validation des entrées, le choix de la fonction du moteur, l'ordre des
 * résultats et le format des erreurs.
 *
 * Quand le moteur réel est disponible, il suffit de remplacer cette
 * doublure par `createBrainEngine(core, store)` : les tests ne changent pas.
 */

import { createHash } from 'node:crypto';
import type {
  CostReport,
  Diagnostic,
  DiagnoseContext,
  ErrorBlock,
  ExtractResult,
  FlakyVerdict,
  Occurrence,
  Settings,
  Signature,
} from '@dejavu/core';
import { createBrainEngine } from '../../src/actions/engine.js';
import type { BrainEngine, CoreFunctions, StoreLike } from '../../src/actions/engine.js';
import { FakeStore, type StoreSeed } from './store.js';

/** Empreinte courte, comme le contrat l'attend (16 hex). */
export function fakeSignatureOf(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** Bloc d'erreur minimal, tiré d'un extrait de journal. */
export function fakeBlock(rawText: string): ErrorBlock {
  const message = rawText.split('\n')[0] ?? rawText;
  return {
    category: 'test',
    errorType: 'AssertionError',
    message,
    rawMessage: message,
    frames: [],
    source: 'log',
    rawText,
  };
}

/** Diagnostic déterministe : la doublure ne connaît que le contrat. */
export function fakeDiagnose(ctx: DiagnoseContext): Diagnostic {
  const history = ctx.history.length;
  const kind = ctx.outbreak
    ? 'infrastructure'
    : ctx.resolution && !ctx.branchContainsResolution
      ? 'already-fixed'
      : history === 0
        ? 'new'
        : 'flaky';
  return {
    kind,
    confidence: 0.9,
    title: `Fake diagnostic for ${ctx.occurrence.signatureId}`,
    summary: `${history} previous occurrence(s) of ${ctx.occurrence.signatureId}`,
    action: kind === 'flaky' ? 'retry' : kind === 'already-fixed' ? 'rebase' : 'fix',
    facts: [{ label: 'occurrences', value: String(history) }],
    signatureId: ctx.occurrence.signatureId,
    signatureShort: `S-${ctx.occurrence.signatureId.slice(-3)}`,
    issueKey: ctx.occurrence.prId ? undefined : undefined,
    evidence: [`branch ${ctx.occurrence.branch}`],
  };
}

/** Verdict d'instabilité déterministe. */
export function fakeAssessFlakiness(occurrences: Occurrence[]): FlakyVerdict {
  const branches = new Set(occurrences.map((o) => o.branch));
  const sameCommitPass = occurrences.some((o) => o.passedOnRetry);
  const flaky = occurrences.length >= 3 && branches.size >= 2 && sameCommitPass;
  return {
    flaky,
    reasons: [`${occurrences.length} occurrence(s) on ${branches.size} branch(es)`],
    occurrences: occurrences.length,
    branches: branches.size,
    sameCommitPass,
    flakyIndex: flaky ? 0.5 : 0,
  };
}

/** Coût déterministe : une minute par minute de build. */
export function fakeComputeCost(
  occurrences: Occurrence[],
  opts?: { windowDays?: number; signatures?: Signature[] },
): CostReport {
  const signatures = opts?.signatures ?? [];
  const perSignature = signatures.map((signature) => {
    const own = occurrences.filter((o) => o.signatureId === signature.id);
    return {
      signatureId: signature.id,
      signatureShort: `S-${signature.id.slice(-3)}`,
      title: signature.template,
      occurrences: own.length,
      ciMinutesLost: Math.round(own.reduce((sum, o) => sum + o.durationS, 0) / 60),
      peopleAffected: new Set(own.map((o) => o.author)).size,
      retries: own.filter((o) => o.passedOnRetry).length,
    };
  });
  return {
    redBuilds: occurrences.length,
    ciMinutesLost: Math.round(occurrences.reduce((sum, o) => sum + o.durationS, 0) / 60),
    peopleAffected: new Set(occurrences.map((o) => o.author)).size,
    retries: occurrences.filter((o) => o.passedOnRetry).length,
    windowDays: opts?.windowDays ?? 14,
    perSignature,
  };
}

/** Extraction déterministe : la première ligne non vide devient le bloc. */
export function fakeExtract(input: { stepLog?: string }): ExtractResult {
  const text = input.stepLog ?? '';
  if (text.trim().length === 0) return { blocks: [], source: 'log', dropped: 0 };
  return { blocks: [fakeBlock(text)], source: 'log', dropped: 0 };
}

/**
 * Signatures déterministes, calées sur le contrat : la signature tient compte
 * de la pile, la famille non (§ 9.3).
 */
export function fakeSignatureKeys(block: ErrorBlock): { signature: string; family: string } {
  const stack = block.frames.length
    ? block.frames.map((frame) => `${frame.file}:${frame.fn ?? ''}`).join('|')
    : '<none>';
  return {
    signature: fakeSignatureOf([block.category, block.errorType, block.message, stack]),
    family: fakeSignatureOf([block.category, block.errorType, block.message]),
  };
}

/** Moteur de test complet. */
export interface FakeEngine extends BrainEngine {
  /** Appels de `diagnose`, pour vérifier que l'action passe par le moteur. */
  readonly diagnoseCalls: DiagnoseContext[];
}

/** Assemble un moteur de test sur un magasin mémoire. */
export function makeFakeEngine(
  seed: StoreSeed = {},
  options?: { now?: () => Date; settings?: Partial<Settings> },
): FakeEngine {
  const store: StoreLike = new FakeStore({ ...seed, settings: { ...seed.settings, ...options?.settings } });
  const diagnoseCalls: DiagnoseContext[] = [];
  const core: CoreFunctions = {
    diagnose: (ctx) => {
      diagnoseCalls.push(ctx);
      return fakeDiagnose(ctx);
    },
    extractErrorBlocks: fakeExtract,
    signatureKeys: fakeSignatureKeys,
    assessFlakiness: fakeAssessFlakiness,
    computeCost: fakeComputeCost,
    signatureShort: (id: string) => `S-${id.slice(-3)}`,
  };
  const engine = createBrainEngine(core, store, {
    now: options?.now ?? (() => new Date('2026-11-11T09:00:00Z')),
  });
  return Object.assign(engine, { diagnoseCalls });
}
