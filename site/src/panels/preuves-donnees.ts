/**
 * Données du panneau « Preuves » — extraction pure, sans DOM.
 *
 * Chaque chiffre affiché par le panneau vient d'un fichier **suivi par git**
 * (`data/golden/*.json`, `docs/SBOM.json`), importé au build par esbuild. Les
 * fonctions ci-dessous valident la forme de ces fichiers : si un fichier
 * manque ou change de forme, elles rendent `null` et le panneau affiche
 * « non disponible » au lieu de mentir.
 *
 * Les fichiers Markdown du dépôt (`docs/NIGHTLY-REPORT.md`, `docs/BENCHMARK.md`,
 * `CHANGELOG.md`, `docs/DECISIONS.md`) ne peuvent **pas** être embarqués :
 * `tools/build-site.mjs` ne configure aucun loader de texte et l'outil est
 * gelé. Le panneau les lie donc vers le dépôt, sans recopier leurs chiffres.
 *
 * Module pur : testable en mémoire, sans fichier ni navigateur.
 */

import { DIAGNOSTIC_KINDS } from '@dejavu/present';
import type { DiagnosticKind } from '@dejavu/core';

/** Un objet simple (ni tableau, ni null). */
function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Un champ numérique fini et positif, ou `null`. */
function numOf(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Un champ texte non vide, ou `null`. */
function strOf(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Métadonnées de l'instantané de référence (`data/golden/meta.json`). */
export interface GoldenMeta {
  goldenVersion: number;
  generator: string;
  dataset: string;
  datasetSha256: string;
  referenceNow: string;
  failures: number;
  signatures: number;
  diagnostics: number;
  tickets: number;
}

/** Les quatre compteurs de coût (`data/golden/cost.json`). */
export interface CostSnapshot {
  windowDays: number;
  redBuilds: number;
  ciMinutesLost: number;
  peopleAffected: number;
  retries: number;
}

/** Le plan de tickets, compté par type d'action (`data/golden/tickets.json`). */
export interface TicketPlanCounts {
  create: number;
  update: number;
  comment: number;
  total: number;
}

/** Résumé du SBOM CycloneDX (`docs/SBOM.json`). */
export interface SbomSummary {
  specVersion: string;
  firstParty: string[];
  thirdParty: Array<{ name: string; version: string }>;
}

/**
 * Les onze contrôles enchaînés par `tools/doctor.mjs` — la liste exacte du
 * catalogue `CHECKS` du fichier, lue pour ce panneau, jamais inventée.
 */
export const DOCTOR_CHECKS = [
  'types',
  'tests',
  'manifests',
  'dataset',
  'sbom',
  'site-bundle',
  'docs',
  'licences',
  'conflicts',
  'sizes',
  'couche0',
] as const;

/** Extrait `meta.json` ; `null` si la forme n'est pas celle attendue. */
export function readGoldenMeta(raw: unknown): GoldenMeta | null {
  if (!isRecord(raw)) return null;
  const meta: GoldenMeta = {
    goldenVersion: numOf(raw, 'goldenVersion') ?? -1,
    generator: strOf(raw, 'generator') ?? '',
    dataset: strOf(raw, 'dataset') ?? '',
    datasetSha256: strOf(raw, 'datasetSha256') ?? '',
    referenceNow: strOf(raw, 'referenceNow') ?? '',
    failures: numOf(raw, 'failures') ?? -1,
    signatures: numOf(raw, 'signatures') ?? -1,
    diagnostics: numOf(raw, 'diagnostics') ?? -1,
    tickets: numOf(raw, 'tickets') ?? -1,
  };
  const valid =
    meta.goldenVersion >= 0 &&
    meta.generator !== '' &&
    meta.dataset !== '' &&
    /^[0-9a-f]{64}$/.test(meta.datasetSha256) &&
    !Number.isNaN(Date.parse(meta.referenceNow)) &&
    meta.failures >= 0 &&
    meta.signatures >= 0 &&
    meta.diagnostics >= 0 &&
    meta.tickets >= 0;
  return valid ? meta : null;
}

/** Extrait `cost.json` ; `null` si un compteur manque ou n'est pas numérique. */
export function readCostSnapshot(raw: unknown): CostSnapshot | null {
  if (!isRecord(raw)) return null;
  const cost: CostSnapshot = {
    windowDays: numOf(raw, 'windowDays') ?? -1,
    redBuilds: numOf(raw, 'redBuilds') ?? -1,
    ciMinutesLost: numOf(raw, 'ciMinutesLost') ?? -1,
    peopleAffected: numOf(raw, 'peopleAffected') ?? -1,
    retries: numOf(raw, 'retries') ?? -1,
  };
  const valid = Object.values(cost).every((value) => value >= 0);
  return valid ? cost : null;
}

/**
 * Extrait la répartition des diagnostics (`diagnostics.json` → `byKind`) :
 * une entrée par diagnostic connu, dans l'ordre du produit. `null` si une
 * clé est inconnue ou si une valeur n'est pas un entier.
 */
export function readDiagnosticSpread(raw: unknown): Array<[DiagnosticKind, number]> | null {
  if (!isRecord(raw) || !isRecord(raw.byKind)) return null;
  const byKind = raw.byKind;
  const spread: Array<[DiagnosticKind, number]> = [];
  for (const kind of DIAGNOSTIC_KINDS) {
    const count = numOf(byKind, kind);
    if (count === null || !Number.isInteger(count)) return null;
    spread.push([kind, count]);
  }
  const known = Object.keys(byKind).every((key) =>
    (DIAGNOSTIC_KINDS as readonly string[]).includes(key),
  );
  return known ? spread : null;
}

/** Compte les actions du plan de tickets (`tickets.json`) ; `null` si invalide. */
export function readTicketPlan(raw: unknown): TicketPlanCounts | null {
  if (!Array.isArray(raw)) return null;
  const counts: TicketPlanCounts = { create: 0, update: 0, comment: 0, total: 0 };
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const kind = entry.kind;
    if (kind !== 'create' && kind !== 'update' && kind !== 'comment') return null;
    counts[kind] += 1;
    counts.total += 1;
  }
  return counts;
}

/** Un composant du SBOM est-il maison ? (propriété `dejavu:first-party`) */
function isFirstParty(component: Record<string, unknown>): boolean {
  const properties = component.properties;
  if (!Array.isArray(properties)) return false;
  return properties.some(
    (property) =>
      isRecord(property) &&
      property.name === 'dejavu:first-party' &&
      property.value === 'true',
  );
}

/**
 * Résume `docs/SBOM.json` (CycloneDX) : paquets maison d'un côté, dépendances
 * tierces d'exécution de l'autre. `null` si la forme n'est pas celle attendue.
 */
export function readSbom(raw: unknown): SbomSummary | null {
  if (!isRecord(raw) || !Array.isArray(raw.components)) return null;
  const specVersion = strOf(raw, 'specVersion');
  if (specVersion === null) return null;
  const summary: SbomSummary = { specVersion, firstParty: [], thirdParty: [] };
  for (const component of raw.components) {
    if (!isRecord(component)) return null;
    const name = strOf(component, 'name');
    const version = strOf(component, 'version');
    if (name === null || version === null) return null;
    if (isFirstParty(component)) summary.firstParty.push(name);
    else summary.thirdParty.push({ name, version });
  }
  return summary;
}
