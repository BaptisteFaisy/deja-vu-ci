#!/usr/bin/env node
// Rejoue le jeu d'exemple sans Bitbucket (§ 22, CI-11).
//
// `npm run replay` construit le moteur puis lance cet outil : il charge
// `data/sample/occurrences.json`, le fait passer par la vraie chaîne
// (extraction → signature → diagnostic → tickets) sur un magasin mémoire, et
// affiche le résultat. Aucun réseau, aucun tenant Atlassian.
//
// Code de sortie : 0 si les quatre diagnostics sortent et si chaque attente du
// jeu est tenue, 1 sinon, 2 si le moteur n'est pas construit.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { coreDist, loadEngine, missingEntryPoints, repoRoot } from './lib/engine.mjs';

const DATASET = path.join(repoRoot, 'data', 'sample', 'occurrences.json');
const FOUR = ['flaky', 'already-fixed', 'new', 'infrastructure'];

function readDataset() {
  try {
    return JSON.parse(readFileSync(DATASET, 'utf8'));
  } catch (error) {
    console.error(`jeu d'exemple illisible (${DATASET}) : ${error.message}`);
    console.error('régénérez-le : node tools/gen/sample.mjs');
    process.exit(2);
  }
}

/** Ligne de tableau alignée, sans dépendance externe. */
function row(cells, widths) {
  return cells.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ');
}

function printSignatures(signatures) {
  const widths = [10, 10, 14, 11, 6, 34];
  console.log('\n== Signatures ==');
  console.log(row(['signature', 'famille', 'catégorie', 'statut', 'vus', 'gabarit'], widths));
  for (const signature of signatures) {
    console.log(
      row(
        [
          signature.id.slice(0, 8),
          signature.familyId.slice(0, 8),
          signature.category,
          signature.status,
          signature.occurrences,
          signature.template.slice(0, 34),
        ],
        widths,
      ),
    );
  }
}

function printDiagnostics(diagnostics) {
  const widths = [20, 16, 14, 5, 46];
  console.log('\n== Diagnostics (par occurrence) ==');
  console.log(row(['instant', 'dépôt/branche', 'diagnostic', 'conf.', 'titre'], widths));
  for (const { occurrence, diagnostic } of diagnostics) {
    console.log(
      row(
        [
          occurrence.occurredAt.slice(5, 16).replace('T', ' '),
          `${occurrence.repo}/${occurrence.branch}`.slice(0, 16),
          diagnostic.kind,
          diagnostic.confidence.toFixed(2),
          diagnostic.title.slice(0, 46),
        ],
        widths,
      ),
    );
  }
}

function printTickets(tickets) {
  const counts = new Map();
  for (const action of tickets) counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
  console.log('\n== Tickets (un seul par famille) ==');
  for (const [kind, count] of [...counts].sort()) console.log(`  ${kind.padEnd(16)} ${count}`);
  const keys = new Set(tickets.filter((t) => t.issueKey).map((t) => t.issueKey));
  const created = tickets.filter((t) => t.kind === 'create');
  console.log(`  créations        ${created.length} (clés simulées : ${[...keys].join(', ') || '—'})`);
}

/** Vérifie les attentes du jeu : les quatre diagnostics et chaque `expected`. */
function checkExpectations(dataset, result) {
  const problems = [];
  for (const kind of FOUR) {
    if (!(result.byKind[kind] > 0)) problems.push(`diagnostic manquant : ${kind}`);
  }

  const byCommit = new Map(result.diagnostics.map((d) => [d.occurrence.commit, d.diagnostic]));
  for (const sample of dataset.occurrences) {
    if (sample.outcome !== 'failure' || !sample.expected?.diagnostic) continue;
    const got = byCommit.get(sample.commit);
    if (!got) {
      problems.push(`${sample.commit} : aucun diagnostic`);
    } else if (got.kind !== sample.expected.diagnostic) {
      problems.push(
        `${sample.commit} (${sample.branch}) : attendu ${sample.expected.diagnostic}, obtenu ${got.kind}`,
      );
    }
  }

  const flaky = result.signatures.filter((s) => s.status === 'flaky');
  if (flaky.length !== 1) problems.push(`attendu 1 signature instable, obtenu ${flaky.length}`);
  const regression = result.signatures.filter((s) => s.status === 'regression');
  if (regression.length !== 1) problems.push(`attendu 1 régression, obtenu ${regression.length}`);
  const creations = result.tickets.filter((t) => t.kind === 'create');
  if (creations.length !== 1) problems.push(`attendu 1 ticket créé, obtenu ${creations.length}`);
  return problems;
}

const engine = await loadEngine();
const missing = missingEntryPoints(engine);
if (missing.length > 0) {
  console.error(`moteur incomplet : ${missing.join(', ')} manquent dans ${coreDist}`);
  console.error('construisez-le d’abord : npm run build');
  process.exit(2);
}

const dataset = readDataset();
const result = await engine.replay(dataset);

console.log(`Jeu : ${dataset.name} — ${dataset.description}`);
console.log(
  `${result.occurrences} échecs rejoués en ${result.elapsedMs} ms, ` +
    `${result.signatures.length} signatures mémorisées.`,
);
printSignatures(result.signatures);
printDiagnostics(result.diagnostics);
printTickets(result.tickets);

console.log('\n== Les quatre diagnostics ==');
for (const kind of [...FOUR, 'uncertain']) {
  console.log(`  ${kind.padEnd(16)} ${result.byKind[kind]}`);
}

const problems = checkExpectations(dataset, result);
if (problems.length > 0) {
  console.error(`\nRECETTE ÉCHOUÉE (${problems.length}) :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nRecette § 20 tenue : quatre diagnostics, une signature instable, une régression, un seul ticket.');
