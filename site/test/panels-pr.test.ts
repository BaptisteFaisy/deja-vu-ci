/**
 * Le panneau « Carte de pull request », testé sans DOM.
 *
 * Deux niveaux, comme le produit :
 *  1. `pr-donnees.ts` — le `QueryResponse` construit depuis la mémoire partagée
 *     a exactement la forme que la route réelle `/query` renvoie
 *     (`buildQueryResponse`), pour les 40 échecs du jeu et les trois états du
 *     produit (chargement, vide, erreur) ;
 *  2. le **vrai** modèle de vue du Capteur (`prCardView`) transforme chaque
 *     réponse en l'un des quatre états de la carte (`PrCardState`), avec les
 *     libellés partagés de `@dejavu/present`.
 *
 * Le rejeu complet est fait une seule fois (beforeAll) : la suite reste rapide.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { formatDate, shortCommit } from '@dejavu/present';
import { prCardView } from '../../apps/sensor/src/pure/prCardView';
import { panel } from '../src/panels/pr';
import {
  allChoices,
  defaultChoice,
  responseFor,
  EMPTY_ID,
  ERROR_ID,
  LOADING_ID,
  UNPAIRED_ERROR,
  type PrChoice,
} from '../src/panels/pr-donnees';
import { createWorkspace, type Workspace } from '../src/state/workspace';

let workspace: Workspace;
let choices: PrChoice[];
let failures: PrChoice[];

beforeAll(async () => {
  workspace = await createWorkspace();
  choices = allChoices(workspace.result);
  failures = choices.filter((choice) => choice.kind === 'failure');
}, 60_000);

describe('pr-donnees : le sélecteur', () => {
  it('expose les 40 échecs du rejeu plus les trois états du produit', () => {
    expect(failures).toHaveLength(40);
    expect(choices).toHaveLength(43);
    expect(choices.map((choice) => choice.id)).toContain(LOADING_ID);
    expect(choices.map((choice) => choice.id)).toContain(EMPTY_ID);
    expect(choices.map((choice) => choice.id)).toContain(ERROR_ID);
    expect(new Set(choices.map((choice) => choice.id)).size).toBe(choices.length);
  });

  it('attache à chaque échec l’occurrence mémorisée et le diagnostic du moteur', () => {
    for (const choice of failures) {
      expect(choice.occurrence?.signatureId, choice.id).toBeTruthy();
      expect(choice.diagnostic?.signatureId, choice.id).toBe(choice.occurrence?.signatureId);
    }
  });

  it('couvre les cinq natures de diagnostic du produit', () => {
    const kinds = new Set(failures.map((choice) => choice.diagnostic?.kind));
    expect(kinds).toEqual(new Set(['flaky', 'already-fixed', 'new', 'infrastructure', 'uncertain']));
  });

  it('choisit par défaut une carte complète (résolution connue), jamais à la main', () => {
    const choice = defaultChoice(choices);
    expect(choice?.kind).toBe('failure');
    expect(choice?.diagnostic?.resolution).toBeDefined();
  });
});

describe('pr-donnees : la réponse du Cerveau (forme réelle de /query)', () => {
  it('répond { ok, diagnostic, lastFailureAt } pour chaque échec du jeu', () => {
    for (const choice of failures) {
      const response = responseFor(choice);
      expect(response?.ok, choice.id).toBe(true);
      expect(response?.diagnostic, choice.id).toBe(choice.diagnostic);
      expect(response?.lastFailureAt, choice.id).toBe(choice.occurrence?.occurredAt);
    }
  });

  it('répond { ok: true } sans diagnostic pour une branche sans échec connu', () => {
    const empty = choices.find((choice) => choice.id === EMPTY_ID);
    expect(responseFor(empty!)).toEqual({ ok: true });
  });

  it('répond l’erreur exacte du Capteur quand l’espace n’est pas appairé', () => {
    const error = choices.find((choice) => choice.id === ERROR_ID);
    expect(responseFor(error!)).toEqual({ ok: false, error: UNPAIRED_ERROR });
  });

  it('n’a pas encore de réponse pendant le chargement', () => {
    const loading = choices.find((choice) => choice.id === LOADING_ID);
    expect(responseFor(loading!)).toBeUndefined();
  });
});

describe('prCardView : le vrai modèle de vue du Capteur, sur les réponses réelles', () => {
  it('rend l’état « diagnostic » pour les 40 échecs, dans les deux langues', () => {
    for (const choice of failures) {
      for (const lang of ['en', 'fr'] as const) {
        const view = prCardView(responseFor(choice), lang);
        expect(view.state, `${choice.id}/${lang}`).toBe('diagnostic');
        expect(view.headline?.length, choice.id).toBeGreaterThan(0);
        expect(view.tone, choice.id).toBeTruthy();
        expect(view.confidence, choice.id).toMatch(/^\d+%$/);
        expect(view.title?.length, choice.id).toBeGreaterThan(0);
        expect(view.summary?.length, choice.id).toBeGreaterThan(0);
        expect(view.facts.length, choice.id).toBeGreaterThan(0);
        expect(view.action?.length, choice.id).toBeGreaterThan(0);
      }
    }
  });

  it('montre la résolution et le dernier échec de la carte par défaut', () => {
    const choice = defaultChoice(choices)!;
    const view = prCardView(responseFor(choice), 'fr');
    const resolution = choice.diagnostic?.resolution;
    expect(view.resolution).toContain(shortCommit(resolution!.commit));
    expect(view.resolution).toContain(resolution!.author);
    expect(view.lastFailure).toBe(formatDate(choice.occurrence!.occurredAt, 'fr'));
  });

  it('rend les trois états du produit : chargement, vide, erreur', () => {
    expect(prCardView(undefined, 'fr').state).toBe('loading');
    expect(prCardView({ ok: true }, 'fr').state).toBe('empty');
    const error = prCardView({ ok: false, error: UNPAIRED_ERROR }, 'en');
    expect(error.state).toBe('error');
    expect(error.error).toBe(UNPAIRED_ERROR);
  });
});

describe('le panneau', () => {
  it('garde l’identifiant du registre et des textes dans les deux langues', () => {
    expect(panel.id).toBe('pr');
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(0);
      expect(panel.summary(lang).length).toBeGreaterThan(10);
      expect(panel.summary(lang)).not.toContain('panel.');
    }
  });
});
