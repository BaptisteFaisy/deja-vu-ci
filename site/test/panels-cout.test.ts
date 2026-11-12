/**
 * Les données du panneau « Coût » : les chiffres du moteur, pas une copie.
 *
 * Ce test porte sur `site/src/panels/cout-donnees.ts` (module pur, aucune DOM).
 * Il vérifie les quatre invariants du brief — les compteurs sont ceux du rejeu,
 * le classement est trié, la tendance couvre la fenêtre du jeu, la conversion en
 * euros est linéaire — plus la facture de l'instabilité, le tarif saisi et le
 * contrat du panneau (identifiant, titres, chaînes traduites).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assessFlakiness } from '@dejavu/core';
import { createWorkspace, type Workspace } from '../src/state/workspace';
import {
  DEFAULT_EUR_PER_MINUTE,
  costView,
  eurosText,
  groupsOf,
  minutesToEuros,
  percentText,
  rateOf,
  type CostInput,
} from '../src/panels/cout-donnees';
import { panel } from '../src/panels/cout';
import { t } from '../src/lib/i18n';

/** L'entrée du panneau, lue dans l'atelier partagé. */
async function inputOf(workspace: Workspace): Promise<CostInput> {
  const [signatures, settings] = await Promise.all([
    workspace.store.listSignatures(),
    workspace.store.getSettings(),
  ]);
  return {
    occurrences: workspace.result.diagnostics.map((entry) => entry.occurrence),
    signatures,
    settings,
    now: workspace.now,
    windowDays: workspace.view.cost.windowDays,
  };
}

/** Les jours distincts couverts par les échecs du rejeu. */
function daysOf(input: CostInput): string[] {
  return [...new Set(input.occurrences.map((occurrence) => occurrence.occurredAt.slice(0, 10)))].sort();
}

describe('panneau coût — compteurs', () => {
  it('rend les quatre compteurs du rejeu, sur la même fenêtre', async () => {
    const workspace = await createWorkspace();
    const view = costView(await inputOf(workspace));
    const attendu = workspace.view.cost;
    expect(view.report.redBuilds).toBe(attendu.redBuilds);
    expect(view.report.ciMinutesLost).toBe(attendu.ciMinutesLost);
    expect(view.report.peopleAffected).toBe(attendu.peopleAffected);
    expect(view.report.retries).toBe(attendu.retries);
    expect(view.report.windowDays).toBe(attendu.windowDays);
  });

  it('compte chaque échec du jeu, et pas un de plus', async () => {
    const workspace = await createWorkspace();
    const input = await inputOf(workspace);
    const view = costView(input);
    expect(view.report.redBuilds).toBe(input.occurrences.length);
    expect(view.report.redBuilds).toBe(workspace.view.failures);
    expect(view.report.ciMinutesLost).toBeGreaterThan(0);
  });
});

describe('panneau coût — classement', () => {
  it('est trié par minutes perdues, puis par occurrences', async () => {
    const workspace = await createWorkspace();
    const { ranking } = costView(await inputOf(workspace));
    expect(ranking.length).toBeGreaterThan(1);
    for (let index = 1; index < ranking.length; index += 1) {
      const avant = ranking[index - 1];
      const apres = ranking[index];
      const ordonne =
        avant.ciMinutesLost > apres.ciMinutesLost ||
        (avant.ciMinutesLost === apres.ciMinutesLost && avant.occurrences >= apres.occurrences);
      expect(ordonne, `${avant.signatureShort} avant ${apres.signatureShort}`).toBe(true);
    }
  });

  it('commence par la signature la plus coûteuse de la vue du rejeu', async () => {
    const workspace = await createWorkspace();
    const { ranking } = costView(await inputOf(workspace));
    const premier = workspace.view.cost.top[0];
    expect(ranking[0].signatureShort).toBe(premier.signature);
    expect(ranking[0].title).toBe(premier.title);
    expect(ranking[0].occurrences).toBe(premier.occurrences);
    expect(ranking[0].ciMinutesLost).toBe(premier.ciMinutesLost);
  });

  it('répartit exactement les minutes de la fenêtre entre les signatures', async () => {
    const workspace = await createWorkspace();
    const view = costView(await inputOf(workspace));
    const somme = view.ranking.reduce((total, row) => total + row.ciMinutesLost, 0);
    expect(Math.round(somme * 10) / 10).toBe(view.report.ciMinutesLost);
    const parts = view.ranking.reduce((total, row) => total + row.share, 0);
    expect(parts).toBeCloseTo(1, 1);
    for (const row of view.ranking) {
      expect(row.share).toBeGreaterThanOrEqual(0);
      expect(row.share).toBeLessThanOrEqual(1);
    }
  });

  it('suit la mémoire partagée : une signature retitrée est retitrée ici', async () => {
    const workspace = await createWorkspace();
    const input = await inputOf(workspace);
    const cible = input.signatures[0];
    await workspace.store.saveSignature({ ...cible, testName: 'RenamedByAnotherPanel' });
    const apres = costView(await inputOf(workspace));
    const ligne = apres.ranking.find((row) => row.signatureId === cible.id);
    expect(ligne?.title).toBe('RenamedByAnotherPanel');
  });
});

describe('panneau coût — tendance', () => {
  it('couvre toute la fenêtre du jeu, jour par jour', async () => {
    const workspace = await createWorkspace();
    const input = await inputOf(workspace);
    const view = costView(input);
    expect(view.trend.points).toHaveLength(input.windowDays);
    expect(view.trendRows).toHaveLength(input.windowDays);
    const jours = view.trend.points.map((point) => point.day);
    for (const day of daysOf(input)) expect(jours, day).toContain(day);
  });

  it('ne peut pas contredire les compteurs : mêmes totaux', async () => {
    const workspace = await createWorkspace();
    const view = costView(await inputOf(workspace));
    expect(view.trend.current.ciMinutesLost).toBe(view.report.ciMinutesLost);
    expect(view.trend.current.redBuilds).toBe(view.report.redBuilds);
    expect(view.trend.windowDays).toBe(view.report.windowDays);
  });

  it('dessine une barre par jour, à l’échelle de la fenêtre', async () => {
    const workspace = await createWorkspace();
    const view = costView(await inputOf(workspace));
    for (const row of view.trendRows) {
      expect(row.bar).toHaveLength(12);
      expect(row.share).toBeGreaterThanOrEqual(0);
      expect(row.share).toBeLessThanOrEqual(1);
      if (row.ciMinutesLost === 0) expect(row.redBuilds).toBe(0);
    }
    const plein = view.trendRows.filter((row) => row.ciMinutesLost > 0);
    expect(plein.length).toBeGreaterThan(0);
    expect(plein.every((row) => row.bar.includes('█'))).toBe(true);
  });

  it('dit honnêtement que la fenêtre précédente du jeu est vide', async () => {
    const workspace = await createWorkspace();
    const view = costView(await inputOf(workspace));
    // Le jeu couvre moins de jours que la fenêtre : aucun échec avant.
    expect(view.trend.previous.redBuilds).toBe(0);
    expect(view.trend.minutesDeltaPct).toBeNull();
    expect(view.trend.minutesDelta).toBe(view.report.ciMinutesLost);
    expect(view.trend.redBuildsDelta).toBe(view.report.redBuilds);
  });
});

describe('panneau coût — instabilité', () => {
  it('ne facture que les signatures que le moteur déclare instables', async () => {
    const workspace = await createWorkspace();
    const input = await inputOf(workspace);
    const view = costView(input);
    const groupes = groupsOf(input.occurrences);
    expect(view.flaky.rows.length).toBeGreaterThan(0);
    for (const row of view.flaky.rows) {
      const verdict = assessFlakiness(groupes.get(row.signatureId) ?? [], {
        settings: input.settings,
        now: input.now,
      });
      expect(verdict.flaky, row.shortId).toBe(true);
      expect(row.branches).toBe(verdict.branches);
      expect(row.flakyIndex).toBe(verdict.flakyIndex);
      expect(row.sameCommitPass).toBe(verdict.sameCommitPass);
      expect(row.reasons.length).toBeGreaterThan(0);
    }
  });

  it('reste sous le total de la fenêtre, et trie le plus coûteux d’abord', async () => {
    const workspace = await createWorkspace();
    const view = costView(await inputOf(workspace));
    const { flaky, report } = view;
    expect(flaky.ciMinutesLost).toBeLessThanOrEqual(report.ciMinutesLost);
    expect(flaky.retries).toBeLessThanOrEqual(report.retries);
    expect(flaky.occurrences).toBeLessThanOrEqual(report.redBuilds);
    expect(flaky.share).toBeGreaterThan(0);
    expect(flaky.share).toBeLessThanOrEqual(1);
    for (let index = 1; index < flaky.rows.length; index += 1) {
      expect(flaky.rows[index - 1].ciMinutesLost).toBeGreaterThanOrEqual(flaky.rows[index].ciMinutesLost);
    }
    const somme = flaky.rows.reduce((total, row) => total + row.ciMinutesLost, 0);
    expect(Math.round(somme * 10) / 10).toBe(flaky.ciMinutesLost);
  });
});

describe('panneau coût — euros saisis par le visiteur', () => {
  it('convertit linéairement, et ne facture rien à tarif nul', () => {
    const tarif = 0.37;
    expect(minutesToEuros(0, tarif)).toBe(0);
    expect(minutesToEuros(52.4, 0)).toBe(0);
    expect(minutesToEuros(52.4, -1)).toBe(0);
    expect(minutesToEuros(-5, tarif)).toBe(0);
    expect(minutesToEuros(Number.NaN, tarif)).toBe(0);
    expect(minutesToEuros(52.4, Number.NaN)).toBe(0);
    // Linéaire : doubler les minutes double les euros, à l’arrondi près.
    expect(minutesToEuros(20, tarif)).toBeCloseTo(2 * minutesToEuros(10, tarif), 2);
    expect(minutesToEuros(30, tarif)).toBeCloseTo(minutesToEuros(10, tarif) + minutesToEuros(20, tarif), 2);
    expect(minutesToEuros(10, 2 * tarif)).toBeCloseTo(2 * minutesToEuros(10, tarif), 2);
    expect(minutesToEuros(1, tarif)).toBe(0.37);
  });

  it('lit le tarif tapé, virgule comprise, et retombe sur zéro sinon', () => {
    expect(rateOf('0.25')).toBe(0.25);
    expect(rateOf('0,25')).toBe(0.25);
    expect(rateOf('12')).toBe(12);
    expect(rateOf('')).toBe(0);
    expect(rateOf('abc')).toBe(0);
    expect(rateOf('-3')).toBe(0);
    expect(rateOf('0')).toBe(0);
    expect(DEFAULT_EUR_PER_MINUTE).toBeGreaterThan(0);
  });

  it('affiche le montant dans la langue du visiteur', () => {
    const montant = minutesToEuros(52.4, DEFAULT_EUR_PER_MINUTE);
    expect(montant).toBe(5.24);
    expect(eurosText(montant, 'fr')).toContain('€');
    expect(eurosText(montant, 'en')).toContain('€');
    expect(eurosText(0, 'fr')).toContain('0');
    expect(percentText(0.612)).toBe('61%');
    expect(percentText(0)).toBe('0%');
  });
});

describe('panneau coût — contrat', () => {
  it('garde l’identifiant, le titre et le résumé du registre', () => {
    expect(panel.id).toBe('cout');
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(0);
      expect(panel.summary(lang).length).toBeGreaterThan(20);
    }
  });

  it('traduit chaque clé utilisée par ses deux modules', () => {
    const dossier = fileURLToPath(new URL('../src/panels', import.meta.url));
    const cles = new Set<string>();
    for (const fichier of ['cout.ts', 'cout-rendu.ts']) {
      const code = readFileSync(`${dossier}/${fichier}`, 'utf8');
      for (const groupe of code.matchAll(/[^.\w]t\(\s*'([^']+)'/g)) cles.add(groupe[1]);
    }
    expect(cles.size).toBeGreaterThan(20);
    for (const cle of cles) {
      expect(t(cle, 'en'), cle).not.toBe(cle);
      expect(t(cle, 'fr'), cle).not.toBe(cle);
    }
  });
});
