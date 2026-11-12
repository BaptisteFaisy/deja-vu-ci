/**
 * Les gestes du panneau « Curation », testés contre une vraie mémoire.
 *
 * Chaque test rejoue le jeu d'exemple dans une `MemoryStore` neuve (le même
 * chemin que la page), puis exerce la logique pure de `curate-ops.ts` — donc
 * les vraies fonctions du moteur (`mergeSignatures`, `splitSignature`,
 * `assessFlakiness`, `proposeQuarantine`, `suggestNormalizationRule`).
 *
 * Les quatre exigences du lot : la fusion ne perd aucune occurrence, la
 * scission respecte le critère, la quarantaine refuse un test non instable,
 * et une seconde fusion des mêmes signatures est sans effet.
 */

import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  QUARANTINE_DUE_DAYS,
  assessFlakiness,
  replayWithEngine,
  staticReplayEngine,
  type Signature,
  type Store,
} from '@dejavu/core';
import { SAMPLE, demoNow } from '../src/lib/demo';
import * as ops from '../src/panels/curate-ops';

/** Une mémoire neuve : le jeu d'exemple rejoué par le vrai moteur. */
async function freshMemory(): Promise<{ store: MemoryStore; now: Date }> {
  const now = demoNow();
  const store = new MemoryStore();
  await replayWithEngine(SAMPLE, staticReplayEngine(), { store, now });
  return { store, now };
}

/** Déroule une réponse d'opération, ou échoue le test avec son erreur. */
function unwrap<T>(answer: ops.OpsAnswer<T>): T {
  if (!answer.ok) throw new Error(answer.error);
  return answer.data;
}

/** Le nombre d'échecs du jeu d'exemple (jamais un chiffre écrit à la main). */
function sampleFailures(): number {
  return SAMPLE.occurrences.filter((entry) => entry.outcome === 'failure').length;
}

/** Une signature réellement instable du jeu, selon `assessFlakiness`. */
async function flakySignature(store: Store, now: Date): Promise<Signature> {
  for (const signature of await store.listSignatures()) {
    const verdict = assessFlakiness(await store.listOccurrences(signature.id), { now });
    if (verdict.flaky) return signature;
  }
  throw new Error('the sample set contains no flaky signature');
}

/** Une signature non instable (une seule occurrence, jamais passée au même commit). */
async function stableSignature(store: Store, now: Date): Promise<Signature> {
  for (const signature of await store.listSignatures()) {
    const verdict = assessFlakiness(await store.listOccurrences(signature.id), { now });
    if (!verdict.flaky) return signature;
  }
  throw new Error('the sample set contains only flaky signatures');
}

describe('snapshotOf — les compteurs de la mémoire', () => {
  it('compte les signatures, toutes les occurrences et les tickets distincts', async () => {
    const { store } = await freshMemory();
    const snapshot = await ops.snapshotOf(store);
    expect(snapshot.signatures).toBe((await store.listSignatures()).length);
    expect(snapshot.occurrences).toBe(sampleFailures());
    expect(snapshot.tickets).toBeGreaterThan(0);
  });
});

describe('applyMerge — la fusion ne perd rien', () => {
  it('réaffecte toutes les occurrences, retire l’absorbée et garde le statut le plus fort', async () => {
    const { store } = await freshMemory();
    const [a, b] = (await store.listSignatures()).slice(0, 2);
    const before = await ops.snapshotOf(store);
    const moved = (await store.listOccurrences(b.id)).length;

    const applied = unwrap(await ops.applyMerge(store, a.id, b.id));

    const after = await ops.snapshotOf(store);
    expect(applied.movedOccurrences).toBe(moved);
    expect(applied.merged.occurrences).toBe(a.occurrences + b.occurrences);
    expect(after.signatures).toBe(before.signatures - 1);
    expect(after.occurrences).toBe(before.occurrences); // aucune occurrence perdue
    expect(await store.getSignature(b.id)).toBeUndefined();
    expect((await store.listOccurrences(a.id)).length).toBe(a.occurrences + moved);
    for (const occurrence of await store.listOccurrences(a.id)) {
      expect(occurrence.signatureId).toBe(a.id);
      expect(occurrence.familyId).toBe(applied.merged.familyId);
    }
    const precedence = ops.statusPrecedence();
    const strongest = precedence.indexOf(a.status) <= precedence.indexOf(b.status) ? a.status : b.status;
    expect(applied.merged.status).toBe(strongest);
  });

  it('une seconde fusion des mêmes signatures est sans effet', async () => {
    const { store } = await freshMemory();
    const [a, b] = (await store.listSignatures()).slice(0, 2);
    unwrap(await ops.applyMerge(store, a.id, b.id));
    const afterFirst = await ops.snapshotOf(store);
    const occurrences = (await store.listOccurrences(a.id)).length;

    const second = await ops.applyMerge(store, a.id, b.id);

    expect(second.ok).toBe(false);
    expect(await ops.snapshotOf(store)).toEqual(afterFirst);
    expect((await store.listOccurrences(a.id)).length).toBe(occurrences);
  });

  it('refuse de fusionner une signature avec elle-même', async () => {
    const { store } = await freshMemory();
    const [a] = await store.listSignatures();
    const answer = await ops.applyMerge(store, a.id, a.id);
    expect(answer.ok).toBe(false);
  });
});

describe('mergePreview — l’aperçu ne touche pas la mémoire', () => {
  it('laisse les occurrences et les signatures exactement en place', async () => {
    const { store } = await freshMemory();
    const [a, b] = (await store.listSignatures()).slice(0, 2);
    const before = await ops.snapshotOf(store);

    const preview = unwrap(await ops.mergePreview(store, a.id, b.id));

    expect(preview.merged.occurrences).toBe(a.occurrences + b.occurrences);
    expect(preview.retired.id).toBe(b.id);
    expect(await store.getSignature(b.id)).toBeDefined(); // pas retirée
    expect((await store.listOccurrences(b.id)).length).toBe(b.occurrences); // pas réaffectées
    for (const occurrence of await store.listOccurrences(b.id)) {
      expect(occurrence.signatureId).toBe(b.id);
    }
    expect(await ops.snapshotOf(store)).toEqual(before);
  });
});

describe('applySplit — la scission respecte le critère', () => {
  it('répartit par branche : un groupe = une branche, rien de perdu ni d’inventé', async () => {
    const { store } = await freshMemory();
    const target = await flakySignature(store, demoNow());
    const original = await store.listOccurrences(target.id);
    expect(original.length).toBeGreaterThan(1);

    const applied = unwrap(await ops.applySplit(store, target.id, 'branch'));

    expect(applied.groups.length).toBeGreaterThan(1);
    const total = applied.groups.reduce((sum, group) => sum + group.occurrences, 0);
    expect(total).toBe(original.length);
    expect(applied.groups[0].kept).toBe(true);
    expect(applied.groups[0].signature.id).toBe(target.id); // la majorité garde l’empreinte
    expect(applied.after.signatures).toBe(applied.before.signatures + applied.groups.length - 1);
    expect(applied.after.occurrences).toBe(applied.before.occurrences);
    for (const group of applied.groups) {
      const stored = await store.listOccurrences(group.signature.id);
      expect(stored.length).toBe(group.occurrences);
      expect(new Set(stored.map((occurrence) => occurrence.branch)).size).toBe(1);
      expect(stored[0].branch).toBe(group.value);
      for (const occurrence of stored) expect(occurrence.signatureId).toBe(group.signature.id);
    }
  });
});

describe('quarantineOf — `assessFlakiness` est la seule autorité', () => {
  it('ne propose rien pour un test qui n’est pas instable, et explique pourquoi', async () => {
    const { store, now } = await freshMemory();
    const stable = await stableSignature(store, now);

    const view = unwrap(await ops.quarantineOf(store, stable.id, now));

    expect(view.verdict.flaky).toBe(false);
    expect(view.proposal).toBeUndefined();
    expect(view.verdict.reasons.length).toBeGreaterThan(0); // le panneau explique
  });

  it('propose la quarantaine d’un test réellement instable : snippet, ticket, échéance', async () => {
    const { store, now } = await freshMemory();
    const flaky = await flakySignature(store, now);

    const view = unwrap(await ops.quarantineOf(store, flaky.id, now));
    const proposal = view.proposal;

    expect(view.verdict.flaky).toBe(true);
    expect(proposal).toBeDefined();
    if (!proposal) return;
    expect(proposal.ticket.dueInDays).toBe(QUARANTINE_DUE_DAYS);
    expect(proposal.patch.snippet.length).toBeGreaterThan(0);
    expect(proposal.patch.file.length).toBeGreaterThan(0);
    expect(proposal.cost.occurrences).toBeGreaterThan(0);
    expect(typeof proposal.worthIt).toBe('boolean');
  });
});

describe('ruleBetween — la règle de normalisation', () => {
  it('isole le jeton qui différe deux gabarits distincts', async () => {
    const { store } = await freshMemory();
    const signatures = await store.listSignatures();
    const [a, b] = signatures.slice(0, 2);

    const view = unwrap(await ops.ruleBetween(store, a.id, b.id));

    expect(view.rule).toBeDefined();
    expect(view.rule?.token.length).toBeGreaterThan(0);
    expect(view.rule?.pattern.length).toBeGreaterThan(0);
    expect(typeof view.rule?.alreadyCovered).toBe('boolean');
  });

  it('n’a rien à suggérer quand les deux gabarits sont identiques', async () => {
    const { store } = await freshMemory();
    const [a] = await store.listSignatures();

    const view = unwrap(await ops.ruleBetween(store, a.id, a.id));

    expect(view.rule).toBeUndefined();
    expect(view.templateA).toBe(view.templateB);
  });
});

describe('statusPrecedence — déduite du moteur, jamais recopiée', () => {
  it('rend l’ordre du contrat : regression > flaky > resolved > known > new', () => {
    expect(ops.statusPrecedence()).toEqual(['regression', 'flaky', 'resolved', 'known', 'new']);
  });
});
