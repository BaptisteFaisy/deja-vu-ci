/**
 * Contexte de diagnostic partagé par les actions et par les écrans.
 *
 * Point important : le diagnostic rendu par `explain-build-failure` et celui
 * rendu par la carte de PR doivent être **le même**. Les deux passent donc par
 * `diagnoseFor`, qui construit le `DiagnoseContext` à partir de la mémoire
 * (magasin) et appelle `engine.diagnose` — la fonction unique du moteur. Aucun
 * calcul parallèle n'existe dans le Cerveau.
 */

import type { DiagnoseContext, Occurrence, Outbreak, Resolution, Signature } from '@dejavu/core';
import type { BrainEngine } from './engine';

/** Occurrences antérieures (exclusion de l'occurrence courante). */
export function previousOccurrences(all: Occurrence[], current: Occurrence): Occurrence[] {
  return all.filter((o) => o.id !== current.id);
}

/**
 * La branche courante contient-elle le commit de résolution ?
 *
 * Le Capteur compare les ancêtres et envoie le verdict au moment de
 * l'ingestion ; le Cerveau n'a pas cette information dans la mémoire. On la
 * déduit de la chronologie : une résolution confirmée après l'échec signifie
 * que la branche ne portait pas encore le correctif. Une résolution encore
 * candidate est traitée comme absente de la branche : c'est le cas le plus
 * prudent, l'hypothèse « déjà corrigé » est signalée par le moteur avec une
 * confiance faible tant qu'aucun humain n'a confirmé.
 */
export function branchContainsResolution(occurrence: Occurrence, resolution?: Resolution): boolean {
  if (!resolution) return true;
  if (!resolution.confirmedAt) return false;
  return occurrence.occurredAt >= resolution.confirmedAt;
}

/** Construit le contexte du moteur pour une occurrence. */
export async function buildDiagnoseContext(
  engine: BrainEngine,
  occurrence: Occurrence,
): Promise<DiagnoseContext> {
  const store = engine.store;
  const [history, familyHistory, resolution, settings, outbreak] = await Promise.all([
    store.listOccurrences(occurrence.signatureId),
    store.listFamilyOccurrences(occurrence.familyId),
    store.getResolution(occurrence.signatureId),
    store.getSettings(),
    store.findOutbreak(occurrence.familyId),
  ]);
  return {
    occurrence,
    history: previousOccurrences(history, occurrence),
    familyHistory: previousOccurrences(familyHistory, occurrence),
    resolution,
    branchContainsResolution: branchContainsResolution(occurrence, resolution),
    outbreak: outbreak ?? undefined,
    changedFiles: occurrence.changedFiles,
    settings,
  };
}

/** Diagnostic du moteur pour une occurrence — source unique de vérité. */
export async function diagnoseFor(
  engine: BrainEngine,
  occurrence: Occurrence,
): Promise<ReturnType<BrainEngine['diagnose']>> {
  const ctx = await buildDiagnoseContext(engine, occurrence);
  return engine.diagnose(ctx);
}

/** Dernière occurrence (la plus récente) d'un ensemble. */
export function latestOccurrence(occurrences: Occurrence[]): Occurrence | undefined {
  let latest: Occurrence | undefined;
  for (const occurrence of occurrences) {
    if (!latest || occurrence.occurredAt > latest.occurredAt) latest = occurrence;
  }
  return latest;
}

/** Toutes les occurrences connues, signature par signature. */
export async function allOccurrences(engine: BrainEngine): Promise<Occurrence[]> {
  const signatures = await engine.store.listSignatures();
  const groups = await Promise.all(signatures.map((s) => engine.store.listOccurrences(s.id)));
  return groups.flat();
}

/** Épidémie connue pour une famille, si le magasin en connaît une. */
export type OutbreakLookup = (familyId: string) => Promise<Outbreak | undefined>;

/** Signature d'un ticket : la première signature liée à cette clé de ticket. */
export async function signatureForIssue(
  engine: BrainEngine,
  issueKey: string,
): Promise<Signature | undefined> {
  const signatures = await engine.store.listSignatures();
  return signatures.find((s) => s.issueKey === issueKey);
}
