/**
 * La démo, rejouée **avec le substitut navigateur** de `node:crypto`.
 *
 * Le bundle public remplace `node:crypto` par `site/src/lib/nodeCrypto.ts`
 * (alias esbuild). Ce test refait exactement ce remplacement sous vitest et
 * compare le résultat aux valeurs relevées avec le vrai module Node : mêmes
 * identifiants de signature, mêmes diagnostics, même coût. Si le hachage du
 * site dérivait d'un octet, ce test cassait — et le site aurait affiché une
 * autre mémoire que l'app Jira.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async () => await import('../src/lib/nodeCrypto'));

const { runDemo } = await import('../src/lib/demo');

/**
 * Identifiants de signatures relevés avec `node:crypto` (15 signatures).
 *
 * Valeurs **relevées**, pas choisies : cinq d'entre elles ont été re-relevées
 * quand l'extraction a reconnu les rapports de tests structurés (pytest, jest,
 * Go…) dans le journal brut — ces six échecs du jeu d'exemple portent désormais
 * un `testName` et leur message vient du rapport plutôt que de la première
 * ligne du bloc de journal. La répartition des diagnostics, le nombre de
 * signatures, le plan de tickets et le coût sont inchangés.
 */
const IDS_DORES = [
  'b2737785dd7e524d', '2ad03492867ad617', '8b94841020ff38ad', '510a30497d352937',
  'e2c2ae39a0041eed', 'f82b080d2a316f11', '0da29ed003d6d8a8', '32b7832785996ed4',
  '4689afc61c5a42e0', 'd13f6506916959fd', 'fe84e787c2201959', 'fb6c03b1c83342fc',
  '67a63eac27b0d23d', '951307af952eebb1', '4b6b8782b5558e1e',
];

/** Répartition relevée avec `node:crypto` (40 échecs). */
const DIAGNOSTICS_DORES = {
  flaky: 15,
  'already-fixed': 2,
  new: 12,
  infrastructure: 9,
  uncertain: 2,
};

describe('démo avec le substitut navigateur', () => {
  it('signe exactement comme node:crypto', async () => {
    const run = await runDemo();
    expect(run.signatures.map((s) => s.id)).toEqual(IDS_DORES);
    expect(run.byKind).toEqual(DIAGNOSTICS_DORES);
  });

  it('garde le même plan de tickets et le même coût', async () => {
    const run = await runDemo();
    expect(run.failures).toBe(40);
    expect(run.tickets.filter((a) => a.kind === 'create')).toHaveLength(1);
    expect(run.cost.redBuilds).toBe(40);
    expect(run.cost.peopleAffected).toBe(26);
    expect(Math.round(run.cost.ciMinutesLost)).toBe(52);
    expect(run.cost.windowDays).toBe(21);
  });
});
