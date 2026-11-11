/**
 * Tests de la mise en forme du résumé d'un rejeu (`src/ui/sampleSummary.ts`).
 *
 * Le module est **pur** : aucune dépendance à `@forge/react`, donc testable
 * sans navigateur. Ce qu'il verrouille : les compteurs affichés, les
 * diagnostics retenus, et les trois états du bouton dans les deux langues.
 */

import { describe, expect, it } from 'vitest';
import {
  kindCounts,
  statusText,
  summaryCounters,
  summaryLine,
  type ReplaySummaryView,
} from '../src/ui/sampleSummary';

const RESUME: ReplaySummaryView = {
  ok: true,
  seeded: true,
  signatures: 7,
  occurrences: 40,
  ticketsCreated: 1,
  comments: 3,
  byKind: { flaky: 2, new: 5, infrastructure: 1, uncertain: 0 },
};

describe('résumé du rejeu', () => {
  it('affiche les quatre compteurs', () => {
    const compteurs = summaryCounters(RESUME, 'en');
    expect(compteurs.map((c) => c.value)).toEqual([7, 40, 1, 3]);
    expect(compteurs[0].label).toBe('Signatures');
  });

  it('ne garde que les diagnostics qui comptent', () => {
    expect(kindCounts(RESUME)).toEqual([
      { kind: 'flaky', count: 2 },
      { kind: 'infrastructure', count: 1 },
      { kind: 'new', count: 5 },
    ]);
  });

  it('écrit une ligne de compteurs lisible', () => {
    const ligne = summaryLine(RESUME, 'fr');
    expect(ligne).toContain('Signatures: 7');
    expect(ligne).toContain('Échecs rejoués: 40');
    expect(ligne).toContain('Diagnostics:');
  });

  it('décrit les trois états du bouton', () => {
    expect(statusText('running', undefined, undefined, 'en')).toContain('Replaying');
    expect(statusText('failed', undefined, 'forge a dit non', 'fr')).toContain('forge a dit non');
    expect(statusText('done', RESUME, undefined, 'en')).toContain('Sample set replayed');
    expect(statusText('done', { ...RESUME, seeded: false }, undefined, 'fr')).toContain(
      'contient déjà des échecs',
    );
    expect(statusText('idle', undefined, undefined, 'en')).toBe('');
  });
});
