/**
 * Action `search-failures` (§ 13) — GET, `text`, `repository` (facultatif).
 *
 * L'action accepte un **texte libre** : un agent ou un humain colle une erreur
 * vue ailleurs que dans Bitbucket Pipelines. L'extrait est signé par le moteur
 * (même fonction que le Capteur), puis rapproché des signatures connues :
 * recherche par signature **et** par famille, complétée par un score de
 * proximité lexicale pour les messages voisins.
 */

import type { Signature } from '@dejavu/core';
import { fail, ok, type ActionResult, type BrainEngine } from './engine';
import { defineAction, type RawInput } from './descriptor';
import { messageSimilarity, scoreMatch, type MatchKind } from './similarity';
import { optionalText, requireText } from './validate';

/** Un candidat trouvé. */
export interface FailureMatch {
  signatureId: string;
  signatureShort: string;
  status: Signature['status'];
  category: Signature['category'];
  errorType: string;
  template: string;
  occurrences: number;
  lastSeen: string;
  issueKey?: string;
  /** Nature du rapprochement. */
  match: MatchKind;
  /** Score de proximité (1 = même signature). */
  score: number;
}

/** Réponse de l'action. */
export interface SearchFailuresData {
  /** Signatures proches de l'extrait, triées par score décroissant. */
  matches: FailureMatch[];
  /** Nombre de signatures examinées. */
  examined: number;
  /** Message court : « 3 signatures proches de cet extrait ». */
  summary: string;
}

/** Entrées de l'action. */
export interface SearchFailuresInput {
  text: string;
  repository?: string;
}

/** Nature du rapprochement entre une signature et l'extrait. */
function classify(signature: Signature, signatureId: string, familyId: string): MatchKind | undefined {
  if (signature.id === signatureId) return 'exact';
  if (signature.familyId === familyId) return 'family';
  return undefined;
}

/** Proximité lexicale d'une signature par rapport à l'extrait. */
function nearestByMessage(
  engine: BrainEngine,
  signatures: Signature[],
  message: string,
  repository: string | undefined,
  occurrencesBySignature: Map<string, string[]>,
): FailureMatch[] {
  return signatures
    .filter((s) => matchesRepository(s.id, occurrencesBySignature, repository))
    .map((s) => {
      const similarity = messageSimilarity(message, s.template);
      return { signature: s, similarity };
    })
    .filter((entry) => entry.similarity >= 0.2)
    .map((entry) => toMatch(engine, entry.signature, 'near', entry.similarity));
}

/** Une signature a-t-elle des occurrences dans le dépôt demandé ? */
function matchesRepository(
  signatureId: string,
  occurrencesBySignature: Map<string, string[]>,
  repository: string | undefined,
): boolean {
  if (!repository) return true;
  const repos = occurrencesBySignature.get(signatureId) ?? [];
  return repos.includes(repository);
}

/** Convertit une signature en candidat affichable. */
function toMatch(
  engine: BrainEngine,
  signature: Signature,
  match: MatchKind,
  similarity: number,
): FailureMatch {
  return {
    signatureId: signature.id,
    signatureShort: engine.signatureShort(signature.id),
    status: signature.status,
    category: signature.category,
    errorType: signature.errorType,
    template: signature.template,
    occurrences: signature.occurrences,
    lastSeen: signature.lastSeen,
    issueKey: signature.issueKey,
    match,
    score: scoreMatch(match, similarity),
  };
}

/** Exécute l'action. */
export async function runSearchFailures(
  engine: BrainEngine,
  raw: RawInput,
): Promise<ActionResult<SearchFailuresData>> {
  const text = requireText(raw.text, 'text');
  if (!text.ok) return fail(text.error);
  const repository = optionalText(raw.repository, 'repository');
  if (!repository.ok) return fail(repository.error);

  const extraction = engine.extractErrorBlocks({ stepLog: text.value });
  const block = extraction.blocks[0];
  if (!block) return fail('no error block could be extracted from this text');
  const keys = engine.signatureKeys(block);

  const signatures = await engine.store.listSignatures();
  const groups = await Promise.all(signatures.map((s) => engine.store.listOccurrences(s.id)));
  const occurrencesBySignature = new Map<string, string[]>();
  signatures.forEach((s, index) => {
    occurrencesBySignature.set(s.id, (groups[index] ?? []).map((o) => o.repo));
  });

  const matches: FailureMatch[] = [];
  for (const signature of signatures) {
    if (!matchesRepository(signature.id, occurrencesBySignature, repository.value)) continue;
    const kind = classify(signature, keys.signature, keys.family);
    if (!kind) continue;
    matches.push(toMatch(engine, signature, kind, 0));
  }
  const near = nearestByMessage(
    engine,
    signatures,
    block.message,
    repository.value,
    occurrencesBySignature,
  );
  const seen = new Set(matches.map((m) => m.signatureId));
  for (const candidate of near) {
    if (!seen.has(candidate.signatureId)) matches.push(candidate);
  }
  matches.sort((a, b) => (b.score - a.score) || (b.occurrences - a.occurrences));

  return ok({
    matches,
    examined: signatures.length,
    summary: `${matches.length} signature(s) close to this excerpt`,
  });
}

/** Descripteur de l'action (§ 13). */
export const searchFailures = defineAction<SearchFailuresData>({
  key: 'search-failures',
  verb: 'GET',
  description:
    'Find the known failure signatures closest to a free-text error excerpt (same signature, same family, or close message).',
  inputs: {
    text: { type: 'string', description: 'Free-text excerpt of the error.', required: true },
    repository: { type: 'string', description: 'Optional repository filter.' },
  },
  run: runSearchFailures,
});
