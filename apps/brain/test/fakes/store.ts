/**
 * Magasin mémoire de test (doublure locale).
 *
 * Le magasin réel vient de `@dejavu/core` (lot D) et le Cerveau le branche sur
 * Forge SQL. Pour les tests du lot G, une doublure minimale suffit : elle
 * implémente le contrat `StoreLike` utilisé par les actions, sans jamais
 * dupliquer la logique du moteur.
 *
 * Elle est volontairement déterministe : les listes sont triées, rien ne
 * dépend de l'horloge du système.
 */

import type { Occurrence, Resolution, Settings, Signature } from '@dejavu/core';
import type { StoreLike } from '../../src/actions/engine.js';

/**
 * Valeurs par défaut des réglages, alignées sur `DEFAULT_SETTINGS` du moteur.
 *
 * Le magasin de test est une doublure locale : il ne doit pas importer le
 * moteur à l'exécution (le paquet `@dejavu/core` n'est pas construit au
 * moment des tests du lot G). Les valeurs sont donc reprises ici ; quand le
 * magasin réel (`MemoryStore`) sera branché, ce sera la même table.
 */
const DEFAULT_SETTINGS: Settings = {
  issueProjectKey: 'CI',
  flakyMinOccurrences: 3,
  flakyMinBranches: 2,
  flakyWindowDays: 14,
  outbreakRepos: 3,
  outbreakWindowMin: 15,
  rawRetentionDays: 30,
  minConfidenceNotYourFault: 0.75,
};

/** Graine d'un magasin mémoire de test. */
export interface StoreSeed {
  signatures?: Signature[];
  occurrences?: Occurrence[];
  resolutions?: Resolution[];
  settings?: Partial<Settings>;
}

/** Magasin mémoire de test. */
export class FakeStore implements StoreLike {
  private readonly signatures = new Map<string, Signature>();
  private readonly occurrences = new Map<string, Occurrence[]>();
  private readonly resolutions = new Map<string, Resolution>();
  private settings: Settings;

  constructor(seed: StoreSeed = {}) {
    for (const signature of seed.signatures ?? []) {
      this.signatures.set(signature.id, signature);
    }
    for (const occurrence of seed.occurrences ?? []) {
      const group = this.occurrences.get(occurrence.signatureId) ?? [];
      group.push(occurrence);
      this.occurrences.set(occurrence.signatureId, group);
    }
    for (const resolution of seed.resolutions ?? []) {
      this.resolutions.set(resolution.signatureId, resolution);
    }
    this.settings = { ...DEFAULT_SETTINGS, ...seed.settings };
  }

  async listSignatures(): Promise<Signature[]> {
    return [...this.signatures.values()].sort((a, b) =>
      a.lastSeen === b.lastSeen ? a.id.localeCompare(b.id) : a.lastSeen < b.lastSeen ? 1 : -1,
    );
  }

  async getSignature(id: string): Promise<Signature | undefined> {
    return this.signatures.get(id);
  }

  async findSignaturesByFamily(familyId: string): Promise<Signature[]> {
    return (await this.listSignatures()).filter((s) => s.familyId === familyId);
  }

  async listOccurrences(signatureId: string): Promise<Occurrence[]> {
    return [...(this.occurrences.get(signatureId) ?? [])].sort((a, b) =>
      a.occurredAt < b.occurredAt ? -1 : 1,
    );
  }

  async listFamilyOccurrences(familyId: string): Promise<Occurrence[]> {
    const family = await this.findSignaturesByFamily(familyId);
    const groups = await Promise.all(family.map((s) => this.listOccurrences(s.id)));
    return groups.flat().sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  }

  async getResolution(signatureId: string): Promise<Resolution | undefined> {
    return this.resolutions.get(signatureId);
  }

  async saveResolution(resolution: Resolution): Promise<void> {
    this.resolutions.set(resolution.signatureId, resolution);
  }

  async saveSignature(signature: Signature): Promise<void> {
    this.signatures.set(signature.id, signature);
  }

  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.settings = { ...settings };
  }

  async findOutbreak(): Promise<undefined> {
    return undefined;
  }
}
