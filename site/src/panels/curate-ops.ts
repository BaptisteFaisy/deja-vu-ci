/**
 * Panneau « Curation » — logique pure, sans DOM ni textes.
 *
 * Ce module est la colle entre la mémoire de la page (`Store`) et les vraies
 * fonctions de curation du moteur (CI-17, CI-19) : `mergeSignatures`,
 * `splitSignature`, `suggestNormalizationRule`, `assessFlakiness` et
 * `proposeQuarantine`. Aucune logique n'est réinventée ici — chaque fonction
 * appelle le moteur et rend son résultat brut ; le panneau (`curate.ts`) ne
 * fait que le mettre en forme et le traduire.
 *
 * Les aperçus passent par `apps/brain/src/pure/curation` (le même module que
 * les résolveurs `curate-merge` / `curate-split` de l'app Jira) : ils
 * travaillent sur des **copies**, donc la mémoire reste intacte tant que le
 * visiteur n'a pas confirmé. L'application, elle, donne au moteur les objets
 * réels du magasin : les occurrences sont réaffectées en place (effet documenté
 * de `mergeSignatures` / `splitSignature`), puis tout est ré-enregistré.
 *
 * Module pur : testable sous Node (`site/test/panels-curate.test.ts`).
 */

import {
  assessFlakiness,
  mergeSignatures,
  proposeQuarantine,
  signatureShort,
  splitSignature,
  suggestNormalizationRule,
  type FlakyVerdict,
  type NormalizationRuleSuggestion,
  type Occurrence,
  type QuarantineProposal,
  type Signature,
  type SignatureStatus,
  type Store,
} from '@dejavu/core';
import { SIGNATURE_STATUSES } from '@dejavu/present';
import { SPLIT_CRITERION_KEYS, type SplitCriterionKey } from '../../../apps/brain/src/pure/curation';
import {
  assembleMergePreview,
  assembleSplitPreview,
  criterionOf,
} from '../../../apps/brain/src/pure/curationCompute';

// Les aperçus viennent du module pur du Cerveau : aucune copie de sa logique.
export {
  SPLIT_CRITERION_KEYS as SPLIT_KEYS,
  assembleMergePreview as mergePreview,
  assembleSplitPreview as splitPreview,
};
export type { MergePreviewData, SplitCriterionKey } from '../../../apps/brain/src/pure/curation';
export type { SplitResult } from '@dejavu/core';

/** Réponse d'une opération : donnée réelle, ou erreur explicite. */
export type OpsAnswer<T> = { ok: true; data: T } | { ok: false; error: string };

/** Ce que contient la mémoire : les trois compteurs « avant / après ». */
export interface MemorySnapshot {
  signatures: number;
  occurrences: number;
  tickets: number;
}

/** Compte la mémoire telle qu'elle est : signatures, occurrences, tickets distincts. */
export async function snapshotOf(store: Store): Promise<MemorySnapshot> {
  const signatures = await store.listSignatures();
  const tickets = new Set(
    signatures.flatMap((signature) => (signature.issueKey ? [signature.issueKey] : [])),
  );
  return {
    signatures: signatures.length,
    occurrences: signatures.reduce((total, s) => total + s.occurrences, 0),
    tickets: tickets.size,
  };
}

/** Un magasin qui sait retirer une signature (le contrat `Store` gelé ne le sait pas). */
interface RemovableStore {
  removeSignature?(id: string): void | Promise<void>;
}

/**
 * Retire une signature du magasin.
 *
 * Le contrat `Store` (§ 16) n'a pas de suppression : dans l'app réelle, la
 * fusion est aujourd'hui une prévisualisation (`curate-merge`), et Fusion SQL
 * demanderait un `DELETE`. Ici la page tourne sur une `MemoryStore` : on
 * utilise sa méthode si elle existe un jour, sinon sa carte interne — repli
 * assumé, propre à la démo, sans effet hors de la page.
 */
export async function removeSignature(store: Store, id: string): Promise<boolean> {
  const removable = store as RemovableStore;
  if (typeof removable.removeSignature === 'function') {
    await removable.removeSignature(id);
    return true;
  }
  const internals = store as unknown as { signatures?: Map<string, Signature> };
  if (internals.signatures instanceof Map) return internals.signatures.delete(id);
  return false;
}

/** Une fusion appliquée : le résultat du moteur et les compteurs avant / après. */
export interface MergeApplied {
  merged: Signature;
  retiredId: string;
  movedOccurrences: number;
  rule?: NormalizationRuleSuggestion;
  before: MemorySnapshot;
  after: MemorySnapshot;
}

/** La résolution de la signature absorbée suit la fusion (jamais de doublon). */
async function moveResolution(store: Store, kept: Signature, droppedId: string): Promise<void> {
  const [own, inherited] = await Promise.all([
    store.getResolution(kept.id),
    store.getResolution(droppedId),
  ]);
  if (own || !inherited) return;
  await store.saveResolution({ ...inherited, signatureId: kept.id });
}

/**
 * Applique la fusion pour de vrai : le moteur réaffecte les occurrences de la
 * signature absorbée en place, la signature fusionnée est enregistrée, la
 * résolution éventuelle suit, puis l'absorbée est retirée du magasin.
 */
export async function applyMerge(
  store: Store,
  keepId: string,
  dropId: string,
): Promise<OpsAnswer<MergeApplied>> {
  if (keepId === dropId) return { ok: false, error: 'the two signatures must be different' };
  const [before, kept, dropped] = await Promise.all([
    snapshotOf(store),
    store.getSignature(keepId),
    store.getSignature(dropId),
  ]);
  if (!kept) return { ok: false, error: `unknown signature: ${signatureShort(keepId)}` };
  if (!dropped) return { ok: false, error: `unknown signature: ${signatureShort(dropId)}` };
  const occurrences = await store.listOccurrences(dropped.id);
  const result = mergeSignatures(kept, dropped, occurrences);
  await store.saveSignature(result.merged);
  for (const occurrence of occurrences) await store.saveOccurrence(occurrence);
  await moveResolution(store, kept, dropped.id);
  if (!(await removeSignature(store, dropped.id))) {
    return { ok: false, error: `the store refused to retire ${signatureShort(dropped.id)}` };
  }
  const data: MergeApplied = {
    merged: result.merged,
    retiredId: dropped.id,
    movedOccurrences: result.movedOccurrences,
    before,
    after: await snapshotOf(store),
  };
  if (result.rule) data.rule = result.rule;
  return { ok: true, data };
}

/** Un groupe produit par une scission appliquée. */
export interface SplitGroup {
  value: string;
  kept: boolean;
  signature: Signature;
  occurrences: number;
}

/** Une scission appliquée : les groupes et les compteurs avant / après. */
export interface SplitApplied {
  criterion: SplitCriterionKey;
  groups: SplitGroup[];
  before: MemorySnapshot;
  after: MemorySnapshot;
}

/** Valeur du discriminateur d'un groupe, lue sur ses occurrences réelles. */
function groupValue(signature: Signature, first: Occurrence | undefined, key: SplitCriterionKey): string {
  if (key === 'branch') return first?.branch ?? '—';
  if (key === 'repository') return first?.repo ?? '—';
  if (key === 'function') return first?.stepName || '—';
  return signature.testName ?? first?.testName ?? '—';
}

/**
 * Applique la scission pour de vrai : le moteur répartit les occurrences en
 * place (le groupe majoritaire garde l'empreinte et le ticket d'origine), puis
 * chaque signature de groupe est enregistrée.
 */
export async function applySplit(
  store: Store,
  signatureId: string,
  key: SplitCriterionKey,
): Promise<OpsAnswer<SplitApplied>> {
  const before = await snapshotOf(store);
  const signature = await store.getSignature(signatureId);
  if (!signature) return { ok: false, error: `unknown signature: ${signatureShort(signatureId)}` };
  const occurrences = await store.listOccurrences(signatureId);
  const result = splitSignature(signature, occurrences, criterionOf(key));
  const groups: SplitGroup[] = [];
  for (const [index, group] of result.groups.entries()) {
    await store.saveSignature(group.signature);
    for (const occurrence of group.occurrences) await store.saveOccurrence(occurrence);
    groups.push({
      value: groupValue(group.signature, group.occurrences[0], key),
      kept: index === 0,
      signature: group.signature,
      occurrences: group.occurrences.length,
    });
  }
  return { ok: true, data: { criterion: key, groups, before, after: await snapshotOf(store) } };
}

/** Ce que dit le moteur d'une signature candidate à la quarantaine. */
export interface QuarantineView {
  verdict: FlakyVerdict;
  proposal?: QuarantineProposal;
}

/**
 * Le verdict d'instabilité (seule autorité : `assessFlakiness`) et, quand le
 * test est réellement instable, la proposition complète de quarantaine (CI-19).
 */
export async function quarantineOf(
  store: Store,
  signatureId: string,
  now: Date,
): Promise<OpsAnswer<QuarantineView>> {
  const signature = await store.getSignature(signatureId);
  if (!signature) return { ok: false, error: `unknown signature: ${signatureShort(signatureId)}` };
  const occurrences = await store.listOccurrences(signatureId);
  const verdict = assessFlakiness(occurrences, { now });
  const proposal = proposeQuarantine({ signature, occurrences, now });
  return { ok: true, data: proposal ? { verdict, proposal } : { verdict } };
}

/** Deux gabarits comparés et la règle de normalisation proposée. */
export interface RuleView {
  templateA: string;
  templateB: string;
  rule?: NormalizationRuleSuggestion;
}

/** La règle qui aurait gardé deux signatures ensemble (ou rien à suggérer). */
export async function ruleBetween(store: Store, idA: string, idB: string): Promise<OpsAnswer<RuleView>> {
  const [a, b] = await Promise.all([store.getSignature(idA), store.getSignature(idB)]);
  if (!a) return { ok: false, error: `unknown signature: ${signatureShort(idA)}` };
  if (!b) return { ok: false, error: `unknown signature: ${signatureShort(idB)}` };
  const rule = suggestNormalizationRule(a.template, b.template);
  return { ok: true, data: rule ? { templateA: a.template, templateB: b.template, rule } : { templateA: a.template, templateB: b.template } };
}

/** Date neutre des signatures sonde (après la borne de la garde de dépôt). */
const PROBE_DATE = '2026-11-01T00:00:00.000Z';

/** Signature minimale pour sonder le moteur (mêmes gabarit et empreintes). */
function statusProbe(status: SignatureStatus, id: string): Signature {
  return {
    id,
    familyId: id,
    category: 'unknown',
    errorType: 'ProbeError',
    template: 'probe template',
    frames: [],
    status,
    firstSeen: PROBE_DATE,
    lastSeen: PROBE_DATE,
    occurrences: 0,
  };
}

/**
 * La précédence des statuts, **déduite du moteur** : chaque paire de statuts
 * est fusionnée via `mergeSignatures` et le gagnant marque un point — aucun
 * ordre recopié à la main. Rend l'ordre du plus fort au plus faible.
 */
export function statusPrecedence(): SignatureStatus[] {
  const wins = new Map<SignatureStatus, number>(SIGNATURE_STATUSES.map((s) => [s, 0]));
  for (const a of SIGNATURE_STATUSES) {
    for (const b of SIGNATURE_STATUSES) {
      if (a === b) continue;
      const { merged } = mergeSignatures(statusProbe(a, 'kept'), statusProbe(b, 'dropped'), []);
      const winner = merged.status === a ? a : b;
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
  }
  return [...SIGNATURE_STATUSES].sort((x, y) => (wins.get(y) ?? 0) - (wins.get(x) ?? 0));
}

/** Gabarit tronqué pour les listes déroulantes (affichage seulement). */
export function shortTemplate(template: string, max = 56): string {
  const flat = template.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
