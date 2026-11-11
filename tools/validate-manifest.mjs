#!/usr/bin/env node
// Valide les manifestes Forge contre le schéma JSON officiel d'Atlassian.
//
// Le schéma vient du paquet `@forge/manifest` (celui qu'utilise `forge lint` /
// `forge deploy`) : c'est la même source de vérité que la plateforme, pas une
// copie recodée ici. Un manifeste invalide ne se déploie pas — autant le savoir
// dans la CI plutôt qu'au moment de soumettre l'app.
//
// Usage :
//   node tools/validate-manifest.mjs                 # les deux apps du dépôt
//   node tools/validate-manifest.mjs apps/brain/manifest.yml
//
// Codes de sortie : 0 conforme, 1 non conforme, 2 outillage manquant.

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);

/** Chemin du schéma officiel, tel que publié par `@forge/manifest`. */
function schemaPath() {
  try {
    const pkg = require.resolve('@forge/manifest/package.json');
    return path.join(path.dirname(pkg), 'out', 'schema', 'manifest-schema.json');
  } catch {
    const direct = path.join(repoRoot, 'node_modules', '@forge/manifest', 'out', 'schema', 'manifest-schema.json');
    return existsSync(direct) ? direct : '';
  }
}

/** Les deux manifestes du produit jumelé (§ 7). */
export const MANIFESTS = [
  path.join(repoRoot, 'apps', 'sensor', 'manifest.yml'),
  path.join(repoRoot, 'apps', 'brain', 'manifest.yml'),
];

/** Compile le validateur une fois (le schéma fait plusieurs milliers de lignes). */
let validateCache = null;

export function loadValidator() {
  if (validateCache) return validateCache;
  const file = schemaPath();
  if (!file || !existsSync(file)) {
    throw new Error('schéma @forge/manifest introuvable — npm install à la racine du dépôt');
  }
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  validateCache = ajv.compile(schema);
  return validateCache;
}

/** Résultat de validation d'un manifeste. */
export function validateManifest(file) {
  const validate = loadValidator();
  let doc;
  try {
    doc = yaml.load(readFileSync(file, 'utf8'));
  } catch (error) {
    return { file, ok: false, errors: [`YAML illisible : ${error.message}`], modules: 0 };
  }
  const ok = validate(doc) === true;
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params ?? {})}`,
  );
  const modules = Object.keys(doc?.modules ?? {}).length;
  return { file, ok, errors, modules };
}

/** Regroupe les erreurs par module pour un rapport lisible. */
export function summarize(result) {
  const lines = [
    `${path.relative(repoRoot, result.file)} : ${result.ok ? 'CONFORME' : 'NON CONFORME'} ` +
      `(${result.modules} module(s) déclaré(s))`,
  ];
  const seen = new Map();
  for (const error of result.errors) {
    const key = error.split(' ')[0];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [where, count] of seen) lines.push(`  - ${where} : ${count} erreur(s)`);
  for (const error of result.errors.slice(0, 10)) lines.push(`      ${error}`);
  if (result.errors.length > 10) lines.push(`      … ${result.errors.length - 10} autres`);
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const targets = process.argv.slice(2).map((arg) => path.resolve(arg));
  const files = targets.length > 0 ? targets : MANIFESTS;
  let failures = 0;
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`manifeste introuvable : ${file}`);
      failures += 1;
      continue;
    }
    let result;
    try {
      result = validateManifest(file);
    } catch (error) {
      console.error(`outillage indisponible : ${error.message}`);
      process.exit(2);
    }
    console.log(summarize(result));
    if (!result.ok) failures += 1;
  }
  console.log(
    failures === 0
      ? `\n${files.length} manifeste(s) conforme(s) au schéma @forge/manifest.`
      : `\n${failures} manifeste(s) non conforme(s).`,
  );
  process.exit(failures === 0 ? 0 : 1);
}
