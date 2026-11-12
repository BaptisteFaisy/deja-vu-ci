/**
 * Tests du panneau « Votre erreur » — sans DOM.
 *
 * Le contrat testé ici est celui du module pur `erreur-analyse.ts` (les quatre
 * étapes en données) et des exemples de `erreur-samples.ts` : chaque exemple
 * est reconnu par le vrai moteur, les jetons fictifs sont masqués, aucune
 * garde du dépôt n'est violée (dates, origines externes, secrets littéraux),
 * et le panneau ne produit jamais de diagnostic inventé (texte vide, mémoire
 * vide, signature connue, historique instable).
 */

import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  signatureOf,
  signatureShort,
  type ErrorBlock,
  type Occurrence,
  type Signature,
} from '@dejavu/core';
import { t } from '../src/lib/i18n';
import { panel } from '../src/panels/erreur';
import { analyzePastedLog } from '../src/panels/erreur-analyse';
import { FAKE_TOKENS, SAMPLES } from '../src/panels/erreur-samples';

/** Horloge fixe des tests : jamais de résultat qui dépende du jour courant. */
const NOW = new Date('2026-11-09T12:00:00Z');

/** Le texte d'un exemple, par identifiant. */
function sample(id: string): string {
  const found = SAMPLES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown sample: ${id}`);
  return found.text;
}

/** Analyse un exemple dans une mémoire neuve. */
function analyze(id: string, store: MemoryStore = new MemoryStore()) {
  return analyzePastedLog(sample(id), store, NOW);
}

/** Une occurrence d'historique, à n jours avant NOW. */
function historyOccurrence(signatureId: string, familyId: string, branch: string, daysAgo: number, passed: boolean): Occurrence {
  return {
    id: `hist-${branch}-${daysAgo}`,
    signatureId,
    familyId,
    workspace: 'PAY',
    repo: 'payments-monorepo',
    branch,
    commit: `c${daysAgo}${branch}`,
    author: 'dev@example.test',
    stepName: 'test',
    durationS: 60,
    occurredAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    passedOnRetry: passed,
  };
}

describe('exemples de journaux (8 écosystèmes)', () => {
  it('fournit huit exemples aux identifiants uniques et non vides', () => {
    expect(SAMPLES).toHaveLength(8);
    expect(new Set(SAMPLES.map((item) => item.id)).size).toBe(8);
    for (const item of SAMPLES) expect(item.text.length, item.id).toBeGreaterThan(80);
  });

  it('sont reconnus par le parseur de leur écosystème (pytest, jest, go, rust, dotnet)', async () => {
    const expected: Record<string, string> = {
      pytest: 'pytest',
      jest: 'jest',
      go: 'go',
      rust: 'rust',
      dotnet: 'dotnet',
    };
    for (const [id, ecosystem] of Object.entries(expected)) {
      const analysis = await analyze(id);
      expect(analysis.extract.source, id).toBe('report');
      expect(analysis.extract.ecosystems, id).toContain(ecosystem);
      expect(analysis.extract.blocks[0]?.testName, id).toBeTruthy();
      expect(analysis.extract.blocks[0]?.category, id).toBe('test');
    }
  });

  it('passent par les motifs de journal quand aucun parseur ne s’applique (maven, docker, npm)', async () => {
    for (const id of ['maven', 'docker', 'npm']) {
      const analysis = await analyze(id);
      expect(analysis.extract.source, id).toBe('log');
      expect(analysis.extract.ecosystems, id).toEqual([]);
      expect(analysis.extract.blocks.length, id).toBeGreaterThan(0);
    }
    const maven = await analyze('maven');
    expect(maven.extract.blocks[0]?.category).toBe('test');
    const docker = await analyze('docker');
    expect(docker.extract.blocks[0]?.category).toBe('infrastructure');
    const npm = await analyze('npm');
    expect(npm.extract.blocks[0]?.category).toBe('dependency');
  });

  it('ne contiennent aucun secret littéral : les jetons fictifs sont masqués', async () => {
    const npmAnalysis = await analyze('npm');
    expect(npmAnalysis.mask.masked).toBeGreaterThan(0);
    expect(npmAnalysis.mask.kinds).toContain('token');
    expect(npmAnalysis.mask.text).not.toContain(FAKE_TOKENS.npm);
    const dockerAnalysis = await analyze('docker');
    expect(dockerAnalysis.mask.text).not.toContain(FAKE_TOKENS.bearer);
  });

  it('respectent les gardes du dépôt : aucune date refusée, aucune origine externe nouvelle', () => {
    for (const item of SAMPLES) {
      expect(item.text, item.id).not.toMatch(/2026-10-2[0-5]/);
      expect(item.text, item.id).not.toMatch(/\b2[0-5]\/10\b/);
      expect(item.text, item.id).not.toMatch(/sk-[A-Za-z0-9]{24}/);
      expect(item.text, item.id).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
      const origins = [...item.text.matchAll(/https?:\/\/[^/"'`)\s]+/g)].map((m) => m[0]);
      for (const origin of origins) {
        expect(origin.startsWith('https://registry.npmjs.org') || origin.startsWith('https://docs.docker.com'), origin).toBe(true);
      }
    }
  });
});

describe('analyse du texte collé (module pur, quatre étapes)', () => {
  it('texte vide : aucun bloc, aucun diagnostic — jamais d’invention', async () => {
    const analysis = await analyzePastedLog('   \n ', new MemoryStore(), NOW);
    expect(analysis.extract.blocks).toEqual([]);
    expect(analysis.signatures).toEqual([]);
    expect(analysis.diagnoses).toEqual([]);
  });

  it('étape 3 : signature identique au moteur, courte, inconnue en mémoire vide', async () => {
    const analysis = await analyze('pytest');
    const step = analysis.signatures[0];
    const block = analysis.extract.blocks[0] as ErrorBlock;
    expect(step).toBeDefined();
    expect(step?.signature).toBe(signatureOf(block));
    expect(step?.short).toBe(signatureShort(step?.signature ?? ''));
    expect(step?.short).toMatch(/^S-\d{3}$/);
    expect(step?.known).toBeUndefined();
  });

  it('étape 4 : première apparition en mémoire vide → diagnostic « new », action « fix »', async () => {
    const analysis = await analyze('pytest');
    const diagnosis = analysis.diagnoses[0];
    expect(diagnosis?.diagnostic.kind).toBe('new');
    expect(diagnosis?.diagnostic.action).toBe('fix');
    expect(diagnosis?.history).toEqual([]);
    expect(diagnosis?.occurrence.repo).toBe('pasted-log');
  });

  it('étapes 3+4 : signature enregistrée en mémoire → connue, historique lu', async () => {
    const store = new MemoryStore();
    const first = await analyze('pytest', store);
    const step = first.signatures[0];
    expect(step).toBeDefined();
    const recorded: Signature = {
      id: step?.signature ?? '',
      familyId: step?.family ?? '',
      category: 'test',
      errorType: 'AssertionError',
      template: step?.block.message ?? '',
      frames: [],
      status: 'known',
      firstSeen: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
      lastSeen: new Date(NOW.getTime() - 86_400_000).toISOString(),
      occurrences: 2,
      issueKey: 'CI-42',
    };
    await store.saveSignature(recorded);
    const second = await analyze('pytest', store);
    expect(second.signatures[0]?.known?.id).toBe(recorded.id);
    expect(second.signatures[0]?.known?.issueKey).toBe('CI-42');
  });

  it('étape 4 : historique instable en mémoire → diagnostic « flaky », action « retry »', async () => {
    const store = new MemoryStore();
    const first = await analyze('pytest', store);
    const step = first.signatures[0];
    const signatureId = step?.signature ?? '';
    const familyId = step?.family ?? '';
    for (const [branch, daysAgo, passed] of [
      ['main', 3, true],
      ['feature/a', 2, false],
      ['feature/b', 1, false],
    ] as Array<[string, number, boolean]>) {
      await store.saveOccurrence(historyOccurrence(signatureId, familyId, branch, daysAgo, passed));
    }
    const second = await analyze('pytest', store);
    const diagnosis = second.diagnoses[0];
    expect(diagnosis?.history).toHaveLength(3);
    expect(diagnosis?.diagnostic.kind).toBe('flaky');
    expect(diagnosis?.diagnostic.action).toBe('retry');
    expect(diagnosis?.diagnostic.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('étape 4 : panne d’infrastructure → diagnostic « infrastructure », action « wait »', async () => {
    const analysis = await analyze('docker');
    expect(analysis.diagnoses[0]?.diagnostic.kind).toBe('infrastructure');
    expect(analysis.diagnoses[0]?.diagnostic.action).toBe('wait');
  });
});

describe('contrat du panneau et de ses textes', () => {
  it('garde l’identifiant et des titres traduits dans les deux langues', () => {
    expect(panel.id).toBe('erreur');
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(0);
      expect(panel.summary(lang).length).toBeGreaterThan(10);
      expect(panel.title(lang)).not.toContain('panel.');
    }
  });

  it('traduit chaque libellé d’exemple et chaque source d’extraction', () => {
    for (const item of SAMPLES) {
      for (const lang of ['en', 'fr'] as const) {
        expect(t(`erreur.sample.${item.id}`, lang), item.id).not.toBe(`erreur.sample.${item.id}`);
      }
    }
    for (const source of ['report', 'log', 'tail']) {
      for (const lang of ['en', 'fr'] as const) {
        expect(t(`erreur.source.${source}`, lang), source).not.toBe(`erreur.source.${source}`);
      }
    }
  });
});
