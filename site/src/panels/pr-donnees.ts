/**
 * Le sélecteur du panneau « Carte de pull request » — module pur, aucun DOM.
 *
 * Ce module construit la réponse du Cerveau (`QueryResponse`) que la carte de
 * pull request reçoit, avec la **même forme** que la route réelle `/query`
 * (`buildQueryResponse` dans `apps/brain/src/query.ts`) :
 * `{ ok: true, diagnostic, lastFailureAt }`.
 *
 * Le diagnostic est celui que le vrai moteur (`packages/core`) a produit
 * pendant le rejeu du jeu d'exemple, lu dans la mémoire partagée de l'atelier
 * (`workspace.result.diagnostics`) — jamais un texte écrit à la main. C'est le
 * diagnostic à horloge figée que tous les autres panneaux affichent ; en
 * production, `/query` le recalcule au moment de la demande (`diagnoseFor`),
 * ce qui exige l'heure réelle du serveur et n'aurait pas sa place sur un site
 * de démonstration déterministe.
 *
 * Les trois autres états de la carte (`loading`, `empty`, `error`) sont les
 * états réels du produit, pas des simulations fantaisistes (voir `responseFor`).
 *
 * Testé sans DOM dans `site/test/panels-pr.test.ts`.
 */

import type { Diagnostic, Occurrence, QueryResponse, ReplayResult } from '@dejavu/core';

/** Les quatre entrées du sélecteur : un échec réel, ou un état du produit. */
export type ChoiceKind = 'failure' | 'loading' | 'empty' | 'error';

/** Une entrée du sélecteur de la carte. */
export interface PrChoice {
  /** Valeur stable du `<select>` (`failure:12`, `state:empty`…). */
  id: string;
  kind: ChoiceKind;
  /** L'occurrence mémorisée et le diagnostic du moteur, pour un échec du jeu. */
  occurrence?: Occurrence;
  diagnostic?: Diagnostic;
}

/** Identifiants des trois états produit (aucun échec du jeu ne les porte). */
export const LOADING_ID = 'state:loading';
export const EMPTY_ID = 'state:empty';
export const ERROR_ID = 'state:error';

/**
 * Le message d'erreur réel de la carte non appairée.
 *
 * C'est la chaîne exacte que `getPrCard` renvoie quand l'espace de travail n'a
 * pas de Cerveau appairé (`apps/sensor/src/index.ts`). Ce module importe
 * `@forge/resolver` et ne peut donc pas tourner dans le navigateur : la chaîne
 * est reprise ici telle quelle — c'est la donnée produit que la carte affiche,
 * pas un texte inventé.
 */
export const UNPAIRED_ERROR = 'this workspace is not paired with a Brain yet';

/** Les 40 échecs du rejeu, dans l'ordre du jeu, puis les trois états produit. */
export function allChoices(result: ReplayResult): PrChoice[] {
  const failures: PrChoice[] = result.diagnostics.map((entry, index) => ({
    id: `failure:${index}`,
    kind: 'failure',
    occurrence: entry.occurrence,
    diagnostic: entry.diagnostic,
  }));
  return [
    ...failures,
    { id: LOADING_ID, kind: 'loading' },
    { id: EMPTY_ID, kind: 'empty' },
    { id: ERROR_ID, kind: 'error' },
  ];
}

/**
 * L'entrée affichée à l'ouverture : le premier échec dont la carte est la plus
 * complète (une résolution connue, sinon un ticket, sinon le premier échec).
 * Déterministe, déduit du rejeu — jamais un choix écrit à la main.
 */
export function defaultChoice(choices: PrChoice[]): PrChoice | undefined {
  const failures = choices.filter((choice) => choice.kind === 'failure');
  return (
    failures.find((choice) => choice.diagnostic?.resolution !== undefined) ??
    failures.find((choice) => choice.diagnostic?.issueKey !== undefined) ??
    failures[0]
  );
}

/**
 * La réponse du Cerveau pour l'entrée choisie — chaque cas est le corps réel
 * d'un chemin du produit :
 *
 *  - `failure` : `buildQueryResponse(engine, occurrence)` — le diagnostic du
 *    moteur pour cette occurrence, et `lastFailureAt` = son horodatage ;
 *  - `empty` : `buildQueryResponse(engine, undefined)` → `{ ok: true }`, la
 *    réponse exacte de `/query` quand la mémoire ne connaît aucun échec de la
 *    branche ; `prCardView` en fait l'état « aucun échec connu » ;
 *  - `error` : la réponse exacte de `getPrCard` (Capteur) quand l'espace n'est
 *    pas appairé — le produit affiche alors cette raison, rien d'autre ;
 *  - `loading` : `undefined` — la valeur que la carte reçoit **avant** la
 *    réponse du Cerveau ; `prCardView(undefined)` rend l'état chargement.
 */
export function responseFor(choice: PrChoice): QueryResponse | undefined {
  if (choice.kind === 'loading') return undefined;
  if (choice.kind === 'error') return { ok: false, error: UNPAIRED_ERROR };
  if (choice.kind === 'empty' || !choice.occurrence || !choice.diagnostic) return { ok: true };
  return { ok: true, diagnostic: choice.diagnostic, lastFailureAt: choice.occurrence.occurredAt };
}
