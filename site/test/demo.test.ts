/**
 * Tests de la démo publique : le vrai moteur, le vrai jeu d'exemple.
 *
 * Ce que la page promet au visiteur est vérifié ici, sans navigateur :
 *  - les 40 échecs du jeu suivi par git sont bien rejoués ;
 *  - les quatre diagnostics du § 5 apparaissent (plus le repli « incertain ») ;
 *  - un seul ticket est planifié par famille (§ 11) ;
 *  - le coût voit tout le corpus (l'horloge de la démo est fixe) ;
 *  - deux rejeux donnent exactement la même chose (déterminisme).
 */

import { describe, expect, it } from 'vitest';
import { demoNow, repositoriesOf, runDemo, SAMPLE } from '../src/lib/demo';

describe('démo publique', () => {
  it('rejoue le jeu suivi par git, en entier', async () => {
    const run = await runDemo();
    const failures = SAMPLE.occurrences.filter((o) => o.outcome === 'failure').length;
    expect(run.failures).toBe(failures);
    expect(run.diagnostics).toHaveLength(failures);
    expect(run.datasetName).toBe(SAMPLE.name);
    expect(run.days).toBe(SAMPLE.days);
  });

  it('produit les quatre diagnostics, et jamais plus de cinq', async () => {
    const run = await runDemo();
    expect(run.byKind.flaky).toBeGreaterThan(0);
    expect(run.byKind['already-fixed']).toBeGreaterThan(0);
    expect(run.byKind.new).toBeGreaterThan(0);
    expect(run.byKind.infrastructure).toBeGreaterThan(0);
    const total = Object.values(run.byKind).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(run.failures);
  });

  it('chaque diagnostic montre ses faits et son action', async () => {
    const run = await runDemo();
    for (const entry of run.diagnostics) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.facts.length).toBeGreaterThan(0);
      expect(entry.confidence).toBeGreaterThan(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
      expect(entry.signature).toMatch(/^S-/);
      expect(entry.repo.length).toBeGreaterThan(0);
    }
  });

  it('planifie un seul ticket par famille', async () => {
    const run = await runDemo();
    const families = new Set(run.tickets.filter((a) => a.kind === 'create').map((a) => a.familyId));
    const creations = run.tickets.filter((a) => a.kind === 'create');
    expect(creations.length).toBe(families.size);
    expect(creations.length).toBeGreaterThan(0);
    expect(creations.length).toBeLessThan(run.signatures.length + 1);
  });

  it('calcule un coût qui voit tout le corpus', async () => {
    const run = await runDemo();
    expect(run.cost.windowDays).toBeGreaterThanOrEqual(SAMPLE.days);
    expect(run.cost.redBuilds).toBeGreaterThan(0);
    expect(run.cost.ciMinutesLost).toBeGreaterThan(0);
    expect(run.cost.peopleAffected).toBeGreaterThan(0);
    expect(run.repositories.length).toBe(repositoriesOf().length);
  });

  it('ne dépend pas de l’heure réelle', async () => {
    const now = demoNow();
    const last = SAMPLE.occurrences.map((o) => o.at).sort().at(-1) as string;
    expect(now.getTime()).toBeGreaterThan(Date.parse(last));
    expect(demoNow().toISOString()).toBe(now.toISOString());
  });

  it('est déterministe : deux rejeux, mêmes chiffres', async () => {
    const first = await runDemo();
    const second = await runDemo();
    const sansDuree = (run: typeof first) => ({ ...run, elapsedMs: 0 });
    expect(sansDuree(second)).toEqual(sansDuree(first));
  });
});
