/**
 * Les manifestes Forge doivent passer le schéma officiel d'Atlassian.
 *
 * Un manifeste invalide ne se déploie pas : autant le savoir ici plutôt que
 * devant le juge. La validation utilise le schéma JSON publié par le paquet
 * `@forge/manifest` — la même source que `forge lint` — et non une copie.
 */

import { existsSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
    // `forge lint --fix` réécrit les entrées d'egress en objets `{ address }` :
    // les deux formes sont acceptées.
    const backends = (manifest.permissions.external.fetch.backend ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.address,
    );
    expect(backends).toContain('*.webtrigger.atlassian.app');
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

// ---------------------------------------------------------------------------
// Le câblage UI Kit : un écran que rien ne rend n'est pas livré (CI-08).
//
// Un manifeste peut être conforme au schéma et ne rien afficher : il suffit
// qu'un module UI oublie sa `resource`, qu'une ressource pointe vers un
// fichier absent, ou qu'un résolveur ne soit pas déclaré comme fonction. Les
// contrôles ci-dessous lisent le manifeste **et** le disque.
// ---------------------------------------------------------------------------

/** Les modules qui rendent un écran : ils doivent pointer vers une ressource. */
const UI_MODULES = [
  'jira:projectPage',
  'jira:projectSettingsPage',
  'jira:issuePanel',
  'bitbucket:repoPullRequestCard',
  'bitbucket:workspaceSettingsMenuPage',
];

/** Les deux apps du produit jumelé, avec leur dossier et leur manifeste chargé. */
function apps() {
  return MANIFESTS.map((file) => ({
    name: path.basename(path.dirname(file)),
    dir: path.dirname(file),
    manifest: load(file),
  }));
}

/** Les ressources hébergées, par clé. */
function resourcesOf(manifest) {
  return new Map((manifest.resources ?? []).map((resource) => [resource.key, resource]));
}

/** Les clés déclarées dans `modules.function`. */
function declaredFunctions(manifest) {
  return new Set((manifest.modules.function ?? []).map((fn) => fn.key));
}

/** `resource:<clé>;<fichier>` → sa clé et son fichier, ou `null`. */
function resourceRef(value) {
  if (typeof value !== 'string' || !value.startsWith('resource:')) return null;
  const [key, file] = value.slice('resource:'.length).split(';');
  return { key, file };
}

/** Problèmes de ressources des modules UI (écran non rendu, fichier absent). */
function uiResourceProblems(manifest, dir) {
  const resources = resourcesOf(manifest);
  const problems = [];
  for (const moduleName of UI_MODULES) {
    for (const module of manifest.modules[moduleName] ?? []) {
      const where = `${moduleName}#${module.key}`;
      if (!module.resource) {
        problems.push(`${where} : aucune ressource, l'écran ne s'affiche pas`);
        continue;
      }
      const resource = resources.get(module.resource);
      if (!resource) {
        problems.push(`${where} : ressource « ${module.resource} » non déclarée`);
        continue;
      }
      if (!existsSync(path.join(dir, resource.path))) {
        problems.push(`${where} : ${resource.path} absent du disque`);
      }
    }
  }
  return problems;
}

/** Problèmes de résolveurs : un module UI sans résolveur, ou non déclaré. */
function resolverProblems(manifest) {
  const declared = declaredFunctions(manifest);
  const problems = [];
  for (const moduleName of UI_MODULES) {
    for (const module of manifest.modules[moduleName] ?? []) {
      const where = `${moduleName}#${module.key}`;
      const fn = module.resolver?.function;
      if (!fn) problems.push(`${where} : aucun resolver.function, invoke() n'aboutit pas`);
      else if (!declared.has(fn)) problems.push(`${where} : résolveur « ${fn} » non déclaré`);
    }
  }
  return problems;
}

/** Toute fonction référencée par un module doit exister dans `modules.function`. */
function functionProblems(manifest) {
  const declared = declaredFunctions(manifest);
  const problems = [];
  for (const [moduleName, entries] of Object.entries(manifest.modules)) {
    if (moduleName === 'function') continue;
    for (const module of entries) {
      for (const fn of [module.function, module.resolver?.function]) {
        if (typeof fn === 'string' && !declared.has(fn)) {
          problems.push(`${moduleName}#${module.key} : fonction « ${fn} » non déclarée`);
        }
      }
    }
  }
  return problems;
}

/** Toute icône `resource:<clé>;<fichier>` doit pointer vers un fichier présent. */
function iconProblems(manifest, dir) {
  const resources = resourcesOf(manifest);
  const problems = [];
  for (const [moduleName, entries] of Object.entries(manifest.modules)) {
    for (const module of entries) {
      const ref = resourceRef(module.icon);
      if (!ref) continue;
      const where = `${moduleName}#${module.key}`;
      const resource = resources.get(ref.key);
      if (!resource) {
        problems.push(`${where} : icône « ${ref.key} » sans ressource déclarée`);
        continue;
      }
      // Une ressource peut être un dossier (`resource:cle;fichier` désigne alors
      // le fichier dans ce dossier) ou un fichier直接. Les deux sont acceptés.
      const base = path.join(dir, resource.path);
      const file = ref.file
        ? statSync(base, { throwIfNoEntry: false })?.isDirectory()
          ? path.join(resource.path, ref.file)
          : path.join(path.dirname(resource.path), ref.file)
        : resource.path;
      if (!existsSync(path.join(dir, file))) problems.push(`${where} : icône ${file} absente du disque`);
    }
  }
  return problems;
}

describe('câblage UI Kit des deux apps', () => {
  it('chaque module UI rend une ressource déclarée, dont le fichier existe', () => {
    for (const app of apps()) {
      expect(uiResourceProblems(app.manifest, app.dir), app.name).toEqual([]);
    }
  });

  it('chaque module UI a un résolveur déclaré dans modules.function', () => {
    for (const app of apps()) {
      expect(resolverProblems(app.manifest), app.name).toEqual([]);
    }
  });

  it('toute fonction référencée par un module est déclarée', () => {
    for (const app of apps()) {
      expect(functionProblems(app.manifest), app.name).toEqual([]);
      expect(app.manifest.modules.function?.length, `${app.name} : aucune fonction`).toBeGreaterThan(0);
    }
  });

  it('toute icône pointe vers une ressource déclarée dont le fichier existe', () => {
    for (const app of apps()) {
      expect(iconProblems(app.manifest, app.dir), app.name).toEqual([]);
    }
  });

  it('le Cerveau déclare l’encart du ticket, qui rend la ressource principale (CI-08)', () => {
    const brain = apps().find((app) => app.name === 'brain');
    const panels = brain.manifest.modules['jira:issuePanel'] ?? [];
    expect(panels, 'aucun jira:issuePanel').toHaveLength(1);
    expect(panels[0].resource).toBe('main');
    expect(panels[0].title.length).toBeGreaterThan(0);
    expect(panels[0].icon).toBe('resource:icon;icon.svg');
    expect(panels[0].viewportSize).toBe('medium');
    // Le contexte texte pour Rovo reste déclaré, avec sa propre fonction.
    const contexts = brain.manifest.modules['jira:issueContext'] ?? [];
    expect(contexts).toHaveLength(1);
    expect(contexts[0].function).toBeTruthy();
    expect(contexts[0].label).toBeTruthy();
  });

  it('le Capteur déclare la carte de PR et la page de réglages (CI-08)', () => {
    const sensor = apps().find((app) => app.name === 'sensor');
    const cards = sensor.manifest.modules['bitbucket:repoPullRequestCard'] ?? [];
    const pages = sensor.manifest.modules['bitbucket:workspaceSettingsMenuPage'] ?? [];
    expect(cards).toHaveLength(1);
    expect(pages).toHaveLength(1);
    for (const module of [...cards, ...pages]) {
      expect(module.resource).toBe('main');
      expect(module.resolver?.function).toBeTruthy();
    }
  });

  it('les deux apps pointent leurs ressources vers un point d’entrée UI Kit', () => {
    for (const app of apps()) {
      const main = resourcesOf(app.manifest).get('main');
      expect(main, `${app.name} : pas de ressource « main »`).toBeTruthy();
      expect(main.path.endsWith('.tsx'), `${app.name} : ${main.path} n'est pas un .tsx`).toBe(true);
      const source = readFileSync(path.join(app.dir, main.path), 'utf8');
      // Le point d'entrée UI Kit 2 rend quelque chose : sans cet appel, le
      // module s'installe et n'affiche rien.
      expect(source, `${app.name} : ${main.path} ne rend rien`).toContain('ForgeReconciler.render');
    }
  });

  it('refuse un écran dont la ressource ou l’icône est absente (le garde n’est pas décoratif)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cabling-'));
    try {
      const file = path.join(dir, 'manifest.yml');
      writeFileSync(
        file,
        yaml.dump({
          modules: {
            'jira:issuePanel': [
              {
                key: 'panel',
                title: 'Panel',
                resource: 'main',
                resolver: { function: 'missingResolver' },
                icon: 'resource:icon;icon.svg',
              },
            ],
            function: [{ key: 'other', handler: 'index.other' }],
          },
          resources: [{ key: 'main', path: 'src/absent.tsx' }],
          permissions: { scopes: [] },
          app: { id: 'ari:cloud:ecosystem::app/x', runtime: { name: 'nodejs22.x' } },
        }),
        'utf8',
      );
      const manifest = load(file);
      expect(uiResourceProblems(manifest, dir).join('\n')).toContain('absent du disque');
      expect(resolverProblems(manifest).join('\n')).toContain('non déclaré');
      expect(functionProblems(manifest).join('\n')).toContain('missingResolver');
      expect(iconProblems(manifest, dir).join('\n')).toContain('sans ressource déclarée');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
