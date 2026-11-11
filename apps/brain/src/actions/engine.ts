/**
 * Contrat d'injection du Cerveau (lot G).
 *
 * Les actions du § 13 ne calculent rien d'elles-mêmes : elles câblent le moteur
 * de `@dejavu/core` (diagnostic, extraction, signature, instabilité, coût) et le
 * magasin qui porte la mémoire. Le moteur arrive par injection pour que les
 * tests puissent brancher un magasin mémoire et un double local
 * (`apps/brain/test/fakes/`) sans jamais dupliquer la logique du moteur.
 */

import type {
  CostReport,
  Diagnostic,
  DiagnoseContext,
  ErrorBlock,
  ExtractResult,
  FailedTestCase,
  FlakyVerdict,
  Occurrence,
  Outbreak,
  Resolution,
  Settings,
  Signature,
  SignatureKey,
} from '@dejavu/core';

/**
 * Sous-ensemble du `Store` de `@dejavu/core` réellement utilisé par les
 * actions. Le `Store` complet satisfait ce contrat par compatibilité
 * structurelle : aucune implémentation n'est réécrite ici.
 */
export interface StoreLike {
  listSignatures(): Promise<Signature[]>;
  getSignature(id: string): Promise<Signature | undefined>;
  findSignaturesByFamily(familyId: string): Promise<Signature[]>;
  listOccurrences(signatureId: string): Promise<Occurrence[]>;
  listFamilyOccurrences(familyId: string): Promise<Occurrence[]>;
  getResolution(signatureId: string): Promise<Resolution | undefined>;
  saveResolution(resolution: Resolution): Promise<void>;
  saveSignature(signature: Signature): Promise<void>;
  getSettings(): Promise<Settings>;
  findOutbreak(familyId: string): Promise<Outbreak | undefined>;
}

/** Entrées d'extraction acceptées par le moteur (§ 9.1). */
export interface ExtractInput {
  stepLog?: string;
  testCases?: FailedTestCase[];
  maxTotalBytes?: number;
}

/** Fonctions du moteur `@dejavu/core` utilisées par les actions. */
export interface CoreFunctions {
  diagnose(ctx: DiagnoseContext): Diagnostic;
  extractErrorBlocks(input: ExtractInput): ExtractResult;
  signatureKeys(block: ErrorBlock): SignatureKey;
  assessFlakiness(
    occurrences: Occurrence[],
    opts?: { settings?: Partial<Settings>; now?: Date },
  ): FlakyVerdict;
  computeCost(
    occurrences: Occurrence[],
    opts?: { windowDays?: number; signatures?: Signature[]; now?: Date },
  ): CostReport;
  /** Identifiant court affichable (`S-204`). */
  signatureShort(id: string): string;
}

/** Le moteur, injecté dans chaque action. */
export interface BrainEngine {
  store: StoreLike;
  /** Horloge du moteur : une seule source de « maintenant » (tests déterministes). */
  now(): Date;
  diagnose(ctx: DiagnoseContext): Diagnostic;
  extractErrorBlocks(input: ExtractInput): ExtractResult;
  signatureKeys(block: ErrorBlock): SignatureKey;
  signatureShort(id: string): string;
  assessFlakiness(
    occurrences: Occurrence[],
    opts?: { settings?: Partial<Settings>; now?: Date },
  ): FlakyVerdict;
  computeCost(
    occurrences: Occurrence[],
    opts?: { windowDays?: number; signatures?: Signature[]; now?: Date },
  ): CostReport;
}

/**
 * Assemble un moteur à partir des fonctions de `@dejavu/core` et du magasin
 * de mémoire. Le serveur du Cerveau appelle cette fonction une fois, au
 * démarrage ; les actions et les écrans partagent alors le même moteur.
 */
export function createBrainEngine(
  core: CoreFunctions,
  store: StoreLike,
  options?: { now?: () => Date },
): BrainEngine {
  return {
    store,
    now: options?.now ?? (() => new Date()),
    diagnose: core.diagnose,
    extractErrorBlocks: core.extractErrorBlocks,
    signatureKeys: core.signatureKeys,
    assessFlakiness: core.assessFlakiness,
    computeCost: core.computeCost,
    signatureShort: core.signatureShort,
  };
}

/** Sortie stable des actions : succès ou erreur explicite, jamais d'exception. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Succès. */
export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Échec explicite. */
export function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}

/**
 * Moteur par défaut du Cerveau.
 *
 * Le serveur (web triggers, consommateur) installe le moteur réel — celui de
 * `@dejavu/core` branché sur la mémoire Forge SQL — avec `setDefaultEngine`.
 * Les actions l'utilisent quand on les appelle sans moteur explicite, comme le
 * fait Forge pour un gestionnaire d'action.
 */
let defaultEngine: BrainEngine | undefined;

/** Installe le moteur par défaut du Cerveau. */
export function setDefaultEngine(engine: BrainEngine | undefined): void {
  defaultEngine = engine;
}

/** Moteur par défaut du Cerveau, s'il est installé. */
export function getDefaultEngine(): BrainEngine | undefined {
  return defaultEngine;
}

/** Horodatage ISO de l'horloge du moteur. */
export function nowIso(engine: BrainEngine): string {
  return engine.now().toISOString();
}

/** Exécute une action sans jamais laisser remonter d'exception (§ F). */
export async function guard<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`internal error: ${message}`);
  }
}
