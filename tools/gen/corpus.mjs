// Génère `data/labeled/100-failures.json` depuis les spécifications de groupes.
//
// Chaque groupe est une signature attendue ; ses membres ne diffèrent que par
// un détail volatil (horodatage, numéro de ligne, UUID, port). Les paires
// déclarées dans `pairs` partagent donc tous les autres détails : c'est ce que
// la mesure de justesse (§ 18) vérifie — la normalisation du § 9.2 doit les
// ramener à une seule signature.
//
// Usage : `node tools/gen/corpus.mjs` (écrit le fichier, ne lit rien d'autre).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './corpus-groups.mjs';
import { buildLog } from '../lib/logs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const OUT = path.join(root, 'data', 'labeled', '100-failures.json');

/** Début de la fenêtre du corpus : les groupes se suivent, sans chevauchement. */
const BASE = Date.parse('2026-11-01T06:00:00Z');
/** Pas entre deux membres d'un même groupe (37 min : pas de motif régulier). */
const STEP_MS = 37 * 60_000;

function iso(ms) {
  return new Date(ms).toISOString();
}

/** La paire dont un membre fait partie, avec son rôle (premier ou second). */
function pairOf(group, index) {
  for (const [a, b, attr] of group.pairs ?? []) {
    if (a === index) return { other: b, attr, first: true };
    if (b === index) return { other: a, attr, first: false };
  }
  return undefined;
}

/** Un UUID voisin : seul le dernier caractère change. */
function variantUuid(uuid) {
  const last = uuid.slice(-1);
  const next = last === 'a' ? 'b' : 'a';
  return uuid.slice(0, -1) + next;
}

/**
 * Détails volatils d'un membre.
 *
 * Les deux membres d'une paire partagent l'horodatage (donc tout le reste),
 * sauf quand l'attribut qui les distingue est justement l'horodatage.
 */
function paramsFor(group, index, slotBase) {
  const pair = pairOf(group, index);
  const slot = pair ? Math.min(index, pair.other) : index;
  const base = {
    ts: iso(slotBase + slot * STEP_MS),
    line: group.line ?? 42,
    uuid: group.uuid ?? `a1b2c3d4-${String(index).padStart(4, '0')}-4a2b-8c3d-0123456789ab`,
    port: group.port ?? 5432,
  };
  if (!pair) return base;
  if (pair.attr === 'ts') return { ...base, ts: iso(slotBase + index * STEP_MS) };
  if (pair.first) return base;
  if (pair.attr === 'line') return { ...base, line: base.line + 7 };
  if (pair.attr === 'uuid') return { ...base, uuid: variantUuid(base.uuid) };
  if (pair.attr === 'port') return { ...base, port: base.port + 1 };
  return base;
}

/** Le corpus complet : 100 échecs étiquetés, un par membre de groupe. */
export function buildCorpus() {
  const failures = [];
  let slotBase = BASE;
  for (const group of GROUPS) {
    for (let index = 0; index < group.count; index += 1) {
      const params = paramsFor(group, index, slotBase);
      const entry = {
        id: `${group.key}-${String(index + 1).padStart(2, '0')}`,
        repo: group.repo,
        branch: group.branches[index % group.branches.length],
        step: group.step,
        log: buildLog(group.render(params)),
        expectedGroup: group.group,
        expectedCategory: group.category,
      };
      if (group.diagnostic) entry.expectedDiagnostic = group.diagnostic;
      if (group.ambiguous) entry.notes = group.ambiguous;
      failures.push(entry);
    }
    slotBase += group.count * STEP_MS + 60 * 60_000;
  }
  return {
    name: 'deja-vu-labeled-100',
    description:
      '100 hand-labeled CI failures in 27 groups: members of a group differ only by a volatile ' +
      'detail (timestamp, line number, UUID, port) and must collapse onto one signature (§ 18).',
    failures,
  };
}

/** Nombre de paires déclarées (contrôle de la recette du corpus). */
export function countPairs() {
  return GROUPS.reduce((total, group) => total + (group.pairs?.length ?? 0), 0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const corpus = buildCorpus();
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
  console.log(
    `${corpus.failures.length} échecs, ${GROUPS.length} groupes, ${countPairs()} paires → ${path.relative(root, OUT)}`,
  );
}
