/**
 * Panneau « Incident » — la logique pure, testée avec le vrai moteur (CI-15).
 *
 * Trois contrats du brief :
 *  1. la panne du jeu d'exemple est bien détectée avec les seuils par défaut ;
 *  2. un seuil absurde ne détecte rien (état vide explicite côté rendu) ;
 *  3. la comparaison avant/après regroupement est cohérente avec les
 *     occurrences réelles lues dans la mémoire.
 *
 * Aucun DOM ici : `incident-donnees.ts` est pur, le rendu est vérifié dans un
 * vrai navigateur (panel-check).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@dejavu/core';
import { incidentOccurrences } from '../../apps/brain/src/pure/incident';
import { createWorkspace, type Workspace } from '../src/state/workspace';
import {
  computeIncident,
  defaultThresholds,
  memoryOccurrences,
  sanitizeThreshold,
  type IncidentData,
} from '../src/panels/incident-donnees';
import { panel } from '../src/panels/incident';

let ws: Workspace;
let defaut: IncidentData;

beforeAll(async () => {
  ws = await createWorkspace();
  defaut = await computeIncident(ws, defaultThresholds());
}, 60_000);

describe('seuils du panneau incident', () => {
  it('prend ses valeurs par défaut dans les constantes du moteur', () => {
    expect(defaultThresholds()).toEqual({
      windowMin: DEFAULT_SETTINGS.outbreakWindowMin,
      repos: DEFAULT_SETTINGS.outbreakRepos,
    });
  });

  it('assainit une saisie de visiteur : entier ≥ 1, sinon la valeur courante', () => {
    expect(sanitizeThreshold(15, 7)).toBe(15);
    expect(sanitizeThreshold(2.7, 7)).toBe(2);
    expect(sanitizeThreshold(0, 7)).toBe(1);
    expect(sanitizeThreshold(-3, 7)).toBe(1);
    expect(sanitizeThreshold(Number.NaN, 7)).toBe(7);
  });
});

describe('détection de la panne du jeu d’exemple', () => {
  it('détecte l’épidémie avec les seuils par défaut', () => {
    expect(defaut.outbreak).toBeDefined();
    expect(defaut.panel).toBeDefined();
    expect(defaut.outbreak?.repos.length).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.outbreakRepos);
    expect(defaut.panel?.familyId).toBe(defaut.outbreak?.familyId);
    expect(new Set(defaut.inWindow.map((occurrence) => occurrence.repo)).size)
      .toBeGreaterThanOrEqual(DEFAULT_SETTINGS.outbreakRepos);
  });

  it('lit dans la mémoire partagée les échecs du rejeu', async () => {
    const occurrences = await memoryOccurrences(ws.store);
    expect(occurrences).toHaveLength(ws.view.failures);
    expect(defaut.occurrenceCount).toBe(ws.view.failures);
  });

  it('ne détecte rien avec un seuil de dépôts absurde', async () => {
    const absurde = await computeIncident(ws, { windowMin: DEFAULT_SETTINGS.outbreakWindowMin, repos: 99 });
    expect(absurde.outbreak).toBeUndefined();
    expect(absurde.panel).toBeUndefined();
    expect(absurde.inWindow).toHaveLength(0);
    expect(absurde.comparison).toEqual({ alertsWithout: 0, ticketsWith: 0 });
  });

  it('ne détecte rien avec une fenêtre d’une minute', async () => {
    const minuscule = await computeIncident(ws, { windowMin: 1, repos: DEFAULT_SETTINGS.outbreakRepos });
    expect(minuscule.outbreak).toBeUndefined();
    expect(minuscule.panel).toBeUndefined();
  });

  it('détecte toujours la panne avec des seuils élargis (recalcul en direct)', async () => {
    const large = await computeIncident(ws, { windowMin: 60, repos: 2 });
    expect(large.outbreak).toBeDefined();
    expect(large.outbreak?.familyId).toBe(defaut.outbreak?.familyId);
  });
});

describe('comparaison honnête, calculée depuis la mémoire', () => {
  it('compte les occurrences réelles de la fenêtre, et un seul ticket avec', () => {
    expect(defaut.comparison.alertsWithout).toBe(defaut.inWindow.length);
    expect(defaut.comparison.alertsWithout).toBe(defaut.panel?.occurrences);
    expect(defaut.comparison.ticketsWith).toBe(1);
    expect(defaut.comparison.alertsWithout).toBeGreaterThan(defaut.comparison.ticketsWith);
  });

  it('retombe sur les mêmes occurrences en recomptant depuis la mémoire', async () => {
    const occurrences = await memoryOccurrences(ws.store);
    const outbreak = defaut.outbreak;
    expect(outbreak).toBeDefined();
    const famille = occurrences.filter((occurrence) => occurrence.familyId === outbreak?.familyId);
    const recompte = incidentOccurrences(famille, outbreak!.startedAt, defaut.thresholds.windowMin);
    expect(recompte.map((occurrence) => occurrence.id).sort())
      .toEqual(defaut.inWindow.map((occurrence) => occurrence.id).sort());
  });

  it('tombe à zéro des deux côtés quand rien n’est détecté', async () => {
    const absurde = await computeIncident(ws, { windowMin: 1, repos: 99 });
    expect(absurde.comparison).toEqual({ alertsWithout: 0, ticketsWith: 0 });
  });
});

describe('diagnostics infrastructure du rejeu', () => {
  it('montre exactement ceux que le moteur a posés, avec leurs faits', () => {
    expect(defaut.infra).toHaveLength(ws.view.byKind.infrastructure);
    expect(defaut.infra.length).toBeGreaterThan(0);
    for (const entry of defaut.infra) {
      expect(entry.kind).toBe('infrastructure');
      expect(entry.facts.length).toBeGreaterThan(0);
    }
  });
});

describe('contrat du panneau', () => {
  it('garde l’identifiant, le titre et le résumé du registre', () => {
    expect(panel.id).toBe('incident');
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(0);
      expect(panel.summary(lang).length).toBeGreaterThan(10);
    }
  });
});
