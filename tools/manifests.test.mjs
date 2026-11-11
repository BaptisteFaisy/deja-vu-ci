/**
 * Les manifestes Forge doivent passer le schéma officiel d'Atlassian.
 *
 * Un manifeste invalide ne se déploie pas : autant le savoir ici plutôt que
 * devant le juge. La validation utilise le schéma JSON publié par le paquet
 * `@forge/manifest` — la même source que `forge lint` — et non une copie.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { MANIFESTS, repoRoot, summarize, validateManifest } from './validate-manifest.mjs';

/** Charge un manifeste du dépôt en objet JavaScript. */
function load(file) {
  return yaml.load(readFileSync(file, 'utf8'));
}

describe('manifestes Forge vs schéma @forge/manifest', () => {
  it('valide les deux apps du produit jumelé', () => {
    expect(MANIFESTS).toHaveLength(2);
    for (const file of MANIFESTS) {
      const result = validateManifest(file);
      // Le rapport complet est affiché en cas d'échec : c'est lui qui dit quoi corriger.
      expect(result.ok, summarize(result)).toBe(true);
      expect(result.modules).toBeGreaterThan(0);
    }
  });

  it('le Capteur déclare les modules Bitbucket du § 15', () => {
    const manifest = load(path.join(repoRoot, 'apps', 'sensor', 'manifest.yml'));
    const modules = Object.keys(manifest.modules);
    expect(modules).toContain('trigger');
    expect(modules.some((m) => m.startsWith('bitbucket:'))).toBe(true);
    const scopes = manifest.permissions.scopes;
    for (const expected of ['read:repository:bitbucket', 'read:pipeline:bitbucket', 'storage:app']) {
      expect(scopes, `scope manquant : ${expected}`).toContain(expected);
    }
    // Le pont signé (§ 15) : seul le web trigger du Cerveau est appelable.
    expect(manifest.permissions.external.fetch.backend).toContain('*.webtrigger.atlassian.app');
  });

  it('le Cerveau déclare les modules Jira du § 15', () => {
    const manifest = load(path.join(repoRoot, 'apps', 'brain', 'manifest.yml'));
    const modules = Object.keys(manifest.modules);
    for (const expected of [
      'webtrigger',
      'consumer',
      'scheduledTrigger',
      'sql',
      'llm',
      'jira:projectPage',
      'jira:issueContext',
      'jira:projectSettingsPage',
      'rovo:agent',
      'rovo:mcp',
      'action',
      'function',
    ]) {
      expect(modules, `module manquant : ${expected}`).toContain(expected);
    }
  });

  it('les six actions du § 13 sont déclarées, exposées à Rovo et au serveur MCP', () => {
    const manifest = load(path.join(repoRoot, 'apps', 'brain', 'manifest.yml'));
    const expected = [
      'explain-build-failure',
      'search-failures',
      'get-signature',
      'list-flaky-tests',
      'report-resolution',
      'confirm-resolution',
    ];
    const actions = manifest.modules.action.map((a) => a.key);
    expect(actions.sort()).toEqual([...expected].sort());

    const agent = manifest.modules['rovo:agent'][0];
    expect([...agent.actions].sort()).toEqual([...expected].sort());

    const mcp = manifest.modules['rovo:mcp'][0];
    expect([...mcp.tools].sort()).toEqual([...expected].sort());

    // Chaque action décrit son verbe (§ 13) et ce à quoi elle sert (lu par Rovo).
    for (const action of manifest.modules.action) {
      expect(action.description?.length, `${action.key} sans description`).toBeGreaterThan(10);
      expect(action.actionVerb ?? action.actionType, `${action.key} sans verbe`).toBeTruthy();
    }
  });

  it('les trois routes du web trigger du Cerveau existent (§ 15)', () => {
    const manifest = load(path.join(repoRoot, 'apps', 'brain', 'manifest.yml'));
    const routes = manifest.modules.webtrigger.map((w) => w.key);
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const fn of ['ingest', 'query', 'universal']) {
      expect(
        manifest.modules.webtrigger.some((w) => w.function === fn),
        `route manquante pour ${fn}`,
      ).toBe(true);
    }
    // Toute fonction déclarée dans un module a son entrée dans `function`.
    const declared = new Set(manifest.modules.function.map((f) => f.key));
    for (const module of manifest.modules.webtrigger) {
      expect(declared.has(module.function), `fonction inconnue : ${module.function}`).toBe(true);
    }
  });

  it('le SQL déclare son moteur et le LLM sa famille (§ 16, § 9.5)', () => {
    const manifest = load(path.join(repoRoot, 'apps', 'brain', 'manifest.yml'));
    expect(manifest.modules.sql[0].engine).toBe('mysql');
    expect(manifest.modules.llm[0].model).toContain('claude');
  });

  it('refuse un manifeste cassé (le garde n’est pas décoratif)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'manifeste-casse-'));
    const file = path.join(dir, 'manifest.yml');
    try {
      writeFileSync(
        file,
        yaml.dump({
          modules: {
            // `retry` n'existe pas dans le schéma du consommateur, et `sql`
            // sans `engine` est refusé : deux fautes volontaires.
            consumer: [{ key: 'k', queue: 'q', function: 'f', retry: { maxAttempts: 3 } }],
            sql: [{ key: 's' }],
            function: [{ key: 'f', handler: 'index.f' }],
          },
          permissions: { scopes: [] },
          app: { id: 'ari:cloud:ecosystem::app/x', runtime: { name: 'nodejs20.x' } },
        }),
        'utf8',
      );
      const result = validateManifest(file);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(summarize(result)).toContain('NON CONFORME');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
