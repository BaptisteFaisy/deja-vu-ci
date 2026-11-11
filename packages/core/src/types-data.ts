/**
 * Types des jeux de données Déjà-vu CI — CONTRAT GELÉ.
 *
 * Le jeu d'exemple rejouable (CI-11) et le corpus étiqueté de justesse (§ 18).
 * Réexportés par `./types.js` : les modules importent tout depuis `types.js`.
 */

import type { Category, Diagnostic, DiagnosticKind, FailedTestCase, Occurrence, Signature, TicketAction } from './types.js';

// ---------------------------------------------------------------------------
// Jeu d'exemple rejouable (CI-11) et corpus étiqueté (§ 18)
// ---------------------------------------------------------------------------

/** Une ligne du jeu d'exemple : un build, réussi ou échoué. */
export interface SampleOccurrence {
  /** ISO-8601, UTC. */
  at: string;
  repo: string;
  branch: string;
  commit: string;
  author: string;
  step: string;
  durationS: number;
  buildUrl?: string;
  prId?: number;
  outcome: 'failure' | 'success';
  /** Extrait de journal brut (les échecs seulement). */
  log?: string;
  testCases?: FailedTestCase[];
  changedFiles?: string[];
  /**
   * Commits que la branche contient déjà (comparaison d'ancêtres faite par le
   * Capteur en production). Sert à distinguer « déjà corrigé » (la branche
   * précède le correctif) d'une « régression » (le correctif est là et le
   * problème revient). Absent = la branche est supposée ne pas le contenir.
   */
  containsCommits?: string[];
  /** Vérité terrain, quand elle est connue — sert à la recette § 20. */
  expected?: {
    signature?: string;
    category?: Category;
    diagnostic?: DiagnosticKind;
    testName?: string;
  };
}

/** Une résolution prévue par le jeu d'exemple. */
export interface SampleResolution {
  /** Nom de test ou gabarit qui identifie la signature visée. */
  match: { testName?: string; contains?: string };
  commit: string;
  author: string;
  note: string;
  files: string[];
  confirmed: boolean;
}

/** Le jeu d'exemple complet, rejouable sans Bitbucket (§ 22). */
export interface SampleDataset {
  name: string;
  description: string;
  /** Dépôt principal du jeu d'exemple. */
  repository: string;
  /** Fenêtre couverte, pour l'affichage. */
  days: number;
  occurrences: SampleOccurrence[];
  resolutions?: SampleResolution[];
}

/** Un échec étiqueté à la main, pour la mesure de justesse (§ 18). */
export interface LabeledFailure {
  id: string;
  repo: string;
  branch: string;
  step: string;
  log: string;
  testCases?: FailedTestCase[];
  /** Groupe attendu : deux échecs de même groupe doivent tomber sur la même signature. */
  expectedGroup: string;
  expectedCategory: Category;
  expectedDiagnostic?: DiagnosticKind;
  notes?: string;
}

/** Le corpus étiqueté : 100 échecs, mesure de regroupement et de faux « instable ». */
export interface LabeledCorpus {
  name: string;
  description: string;
  failures: LabeledFailure[];
}

/** Résultat d'un rejeu. */
export interface ReplayResult {
  datasetName: string;
  occurrences: number;
  signatures: Signature[];
  diagnostics: Array<{ occurrence: Occurrence; diagnostic: Diagnostic }>;
  tickets: TicketAction[];
  byKind: Record<DiagnosticKind, number>;
  /** Durée du rejeu, en millisecondes. */
  elapsedMs: number;
}

/** Mesure de justesse sur le corpus étiqueté (§ 18). */
export interface AccuracyReport {
  failures: number;
  /** Part des échecs regroupés correctement (cible ≥ 0,90). */
  groupingAccuracy: number;
  /** Part des signatures déclarées instables à tort (cible < 0,05). */
  falseFlakyRate: number;
  /** Part des catégories correctes. */
  categoryAccuracy: number;
  mismatches: Array<{ id: string; expectedGroup: string; gotSignature: string; expectedCategory: Category; gotCategory: Category }>;
}
