/**
 * Panneau « Incident » — la logique pure (CI-15).
 *
 * Rien n'est recalculé ici : la détection vient du moteur
 * (`detectOutbreak`, `packages/core`), le panneau d'incident vient du Cerveau
 * (`assembleIncident`, `apps/brain/src/pure/incident.ts` — le module que
 * l'écran Jira appelle), et les occurrences viennent de la **mémoire
 * partagée** du site. Les seuils par défaut sont les constantes du moteur
 * (`DEFAULT_SETTINGS`), jamais des valeurs inventées.
 *
 * Module pur : aucun DOM, donc testable hors navigateur.
 */

import {
  DEFAULT_SETTINGS,
  detectOutbreak,
  signatureShort,
  type Occurrence,
  type Outbreak,
  type Settings,
  type Store,
} from '@dejavu/core';
import {
  assembleIncident,
  incidentOccurrences,
  type IncidentPanel,
} from '../../../apps/brain/src/pure/incident';
import type { DemoDiagnostic, DemoRun } from '../lib/demo';

/** Les seuils de détection que le visiteur règle (fenêtre, dépôts). */
export interface IncidentThresholds {
  /** Largeur de la fenêtre glissante, en minutes. */
  windowMin: number;
  /** Nombre minimal de dépôts distincts touchés. */
  repos: number;
}

/** Ce dont le calcul a besoin : la mémoire, la vue dérivée, l'horloge. */
export interface IncidentSource {
  store: Store;
  view: DemoRun;
  now: Date;
}

/** Tout ce que le panneau affiche, calculé depuis la mémoire. */
export interface IncidentData {
  /** Les seuils utilisés pour ce calcul. */
  thresholds: IncidentThresholds;
  /** Les seuils par défaut du moteur (pour le bouton « réinitialiser »). */
  defaults: IncidentThresholds;
  /** Le nombre d'occurrences d'échec lues dans la mémoire. */
  occurrenceCount: number;
  /** La détection du moteur, si une famille atteint les seuils. */
  outbreak?: Outbreak;
  /** Le panneau d'incident du Cerveau (le modèle de vue de l'app Jira). */
  panel?: IncidentPanel;
  /** Les occurrences réelles tombées dans la fenêtre de l'incident. */
  inWindow: Occurrence[];
  /** La comparaison honnête : alertes sans regroupement, tickets avec. */
  comparison: { alertsWithout: number; ticketsWith: number };
  /** Les diagnostics `infrastructure` du rejeu, avec leurs faits. */
  infra: DemoDiagnostic[];
}

/** Les seuils par défaut : les constantes du moteur, pas des valeurs écrites à la main. */
export function defaultThresholds(): IncidentThresholds {
  return {
    windowMin: DEFAULT_SETTINGS.outbreakWindowMin,
    repos: DEFAULT_SETTINGS.outbreakRepos,
  };
}

/** Un seuil saisi par le visiteur : entier ≥ 1, ou la valeur courante si invalide. */
export function sanitizeThreshold(raw: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.floor(raw));
}

/** Toutes les occurrences d'échec de la mémoire, dédoublonnées et triées par date. */
export async function memoryOccurrences(store: Store): Promise<Occurrence[]> {
  const signatures = await store.listSignatures();
  const byId = new Map<string, Occurrence>();
  for (const signature of signatures) {
    for (const occurrence of await store.listOccurrences(signature.id)) {
      byId.set(occurrence.id, occurrence);
    }
  }
  return [...byId.values()].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
}

/** Les réglages réels : ceux de la mémoire, avec les seuils du visiteur par-dessus. */
async function settingsFor(store: Store, thresholds: IncidentThresholds): Promise<Settings> {
  const base = await store.getSettings();
  return {
    ...base,
    outbreakWindowMin: thresholds.windowMin,
    outbreakRepos: thresholds.repos,
  };
}

/**
 * Calcule l'incident visible : détection du moteur, panneau du Cerveau,
 * occurrences dans la fenêtre, comparaison avant/après regroupement et
 * diagnostics `infrastructure` — le tout depuis la mémoire partagée.
 */
export async function computeIncident(
  source: IncidentSource,
  thresholds: IncidentThresholds,
): Promise<IncidentData> {
  const occurrences = await memoryOccurrences(source.store);
  const settings = await settingsFor(source.store, thresholds);
  const outbreak = detectOutbreak(occurrences, { settings, now: source.now });
  const panel = await assembleIncident(
    source.store,
    occurrences,
    settings,
    source.now,
    signatureShort,
  );
  const family = occurrences.filter((o) => o.familyId === outbreak?.familyId);
  const inWindow = outbreak
    ? incidentOccurrences(family, outbreak.startedAt, settings.outbreakWindowMin)
    : [];
  return {
    thresholds,
    defaults: defaultThresholds(),
    occurrenceCount: occurrences.length,
    ...(outbreak ? { outbreak } : {}),
    ...(panel ? { panel } : {}),
    inWindow,
    comparison: { alertsWithout: inWindow.length, ticketsWith: panel ? 1 : 0 },
    infra: source.view.diagnostics.filter((entry) => entry.kind === 'infrastructure'),
  };
}
