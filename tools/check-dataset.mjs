#!/usr/bin/env node
// Contrôle de conformité des jeux de données (§ 20, § 22).
//
// Vérifie, sans le moteur :
//   - le jeu d'exemple : schéma, 40 échecs, 14 jours, ordre chronologique,
//     attentes renseignées, quatre diagnostics couverts, résolutions cohérentes
//     avec les occurrences, au moins une occurrence qui contient le correctif
//     (sans quoi la régression du § 8.4 est impossible) ;
//   - le corpus étiqueté : schéma, 100 échecs, au moins 20 groupes, au moins
//     8 paires ne différant que d'une ligne, cas ambigus documentés.
//
// Usage : `npm run check:data` — exit 0 si tout est conforme, 1 sinon.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib/engine.mjs';

const SAMPLE = path.join(repoRoot, 'data', 'sample', 'occurrences.json');
const CORPUS = path.join(repoRoot, 'data', 'labeled', '100-failures.json');

/** Champs obligatoires d'une occurrence du jeu d'exemple. */
const SAMPLE_FIELDS = ['at', 'repo', 'branch', 'commit', 'author', 'step', 'durationS', 'outcome'];
/** Champs obligatoires d'un échec étiqueté. */
const CORPUS_FIELDS = ['id', 'repo', 'branch', 'step', 'log', 'expectedGroup', 'expectedCategory'];

const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function readJson(file, regenerate) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    problems.push(`${path.relative(repoRoot, file)} illisible : ${error.message} — régénérez : ${regenerate}`);
    return undefined;
  }
}

/** Un journal d'échec est présent, lisible et borné. */
function checkLogs(dataset) {
  dataset.occurrences.forEach((occurrence, index) => {
    for (const field of SAMPLE_FIELDS) {
      check(occurrence[field] !== undefined, `jeu : occurrence ${index} sans « ${field} »`);
    }
    check(
      occurrence.outcome === 'failure' || occurrence.outcome === 'success',
      `jeu : occurrence ${index} — outcome inconnu (${occurrence.outcome})`,
    );
    if (occurrence.outcome !== 'failure') return;
    check(
      typeof occurrence.log === 'string' && occurrence.log.length > 0,
      `jeu : échec ${occurrence.commit} sans journal`,
    );
    check(
      (occurrence.log ?? '').length <= 8192,
      `jeu : journal de ${occurrence.commit} trop long (${(occurrence.log ?? '').length} octets)`,
    );
  });
}

/** Fenêtre de 14 jours, ordre chronologique, horodatages lisibles. */
function checkTimeline(dataset) {
  const dates = dataset.occurrences.map((o) => Date.parse(o.at));
  check(dates.every((d) => Number.isFinite(d)), 'jeu : un horodatage est illisible');
  if (dates.some((d) => !Number.isFinite(d))) return;
  const sorted = [...dates].sort((a, b) => a - b);
  check(
    JSON.stringify(dates) === JSON.stringify(sorted),
    'jeu : les occurrences ne sont pas en ordre chronologique',
  );
  const spanDays = (sorted[sorted.length - 1] - sorted[0]) / 86_400_000;
  check(spanDays <= 14, `jeu : fenêtre de ${spanDays.toFixed(1)} jours (> 14)`);
  check(spanDays >= 13, `jeu : fenêtre de ${spanDays.toFixed(1)} jours (< 13, jeu trop court)`);
}

/** Les attentes du jeu : les quatre diagnostics et les mouvements de statut. */
function checkExpectations(dataset, failures) {
  const kinds = new Set(failures.map((f) => f.expected?.diagnostic).filter(Boolean));
  for (const expected of ['flaky', 'already-fixed', 'new', 'infrastructure']) {
    check(kinds.has(expected), `jeu : aucun échec n'attend le diagnostic « ${expected} »`);
  }
  const flakyRuns = failures.filter((f) => f.expected?.diagnostic === 'flaky');
  const branches = new Set(flakyRuns.map((f) => f.branch));
  check(flakyRuns.length >= 10, `jeu : ${flakyRuns.length} échecs instables attendus (< 10)`);
  check(branches.size >= 3, `jeu : le test instable ne couvre que ${branches.size} branche(s)`);
  const regression = failures.filter((f) => (f.containsCommits ?? []).length > 0);
  check(
    regression.length >= 1,
    'jeu : aucune occurrence ne déclare contenir le correctif (régression impossible)',
  );
}

/** Chaque résolution déclarée correspond à un succès du jeu. */
function checkResolutions(dataset) {
  for (const resolution of dataset.resolutions ?? []) {
    check(typeof resolution.commit === 'string', 'jeu : résolution sans commit');
    check(typeof resolution.author === 'string', 'jeu : résolution sans auteur');
    const fixing = dataset.occurrences.find((o) => o.commit === resolution.commit);
    check(fixing !== undefined, `jeu : le commit de résolution ${resolution.commit} est absent du jeu`);
    check(
      fixing === undefined || fixing.outcome === 'success',
      `jeu : le commit de résolution ${resolution.commit} n'est pas un succès`,
    );
  }
}

function checkSample(dataset) {
  check(typeof dataset.name === 'string' && dataset.name.length > 0, 'jeu : nom absent');
  check(Array.isArray(dataset.occurrences), 'jeu : occurrences absentes');
  if (!Array.isArray(dataset.occurrences)) return;

  const failures = dataset.occurrences.filter((o) => o.outcome === 'failure');
  const successes = dataset.occurrences.filter((o) => o.outcome === 'success');
  check(failures.length === 40, `jeu : attendu 40 échecs, obtenu ${failures.length}`);
  check(successes.length > 0, 'jeu : aucun succès — la détection d’instabilité est impossible');
  check(dataset.days === 14, `jeu : attendu 14 jours, déclaré ${dataset.days}`);

  checkLogs(dataset);
  checkTimeline(dataset);
  checkExpectations(dataset, failures);
  checkResolutions(dataset);
}

/** Vrai si deux journaux ne diffèrent que par une seule ligne. */
function differByOneLine(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  if (left.length !== right.length) return false;
  let differences = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) differences += 1;
    if (differences > 1) return false;
  }
  return differences === 1;
}

/** Au moins 8 paires de membres ne différant que d'une ligne (détail volatil). */
function checkPairs(groups) {
  let pairs = 0;
  for (const members of groups.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        if (differByOneLine(members[i].log, members[j].log)) pairs += 1;
      }
    }
  }
  check(pairs >= 8, `corpus : ${pairs} paires ne différant que d'une ligne (< 8)`);
}

function checkCorpus(corpus) {
  check(Array.isArray(corpus.failures), 'corpus : échecs absents');
  if (!Array.isArray(corpus.failures)) return;
  check(corpus.failures.length === 100, `corpus : attendu 100 échecs, obtenu ${corpus.failures.length}`);

  const groups = new Map();
  const ids = new Set();
  for (const failure of corpus.failures) {
    for (const field of CORPUS_FIELDS) {
      check(failure[field] !== undefined, `corpus : ${failure.id ?? '?'} sans « ${field} »`);
    }
    check(!ids.has(failure.id), `corpus : identifiant dupliqué ${failure.id}`);
    ids.add(failure.id);
    if (!groups.has(failure.expectedGroup)) groups.set(failure.expectedGroup, []);
    groups.get(failure.expectedGroup).push(failure);
  }
  check(groups.size >= 20, `corpus : ${groups.size} groupes (< 20)`);
  checkPairs(groups);
  check(
    corpus.failures.filter((f) => f.notes).length >= 3,
    `corpus : ${corpus.failures.filter((f) => f.notes).length} cas ambigus documentés (< 3)`,
  );
}

const sample = readJson(SAMPLE, 'node tools/gen/sample.mjs');
const corpus = readJson(CORPUS, 'node tools/gen/corpus.mjs');
if (sample) checkSample(sample);
if (corpus) checkCorpus(corpus);

if (sample && corpus) {
  const failures = sample.occurrences.filter((o) => o.outcome === 'failure').length;
  console.log(
    `jeu d'exemple : ${failures} échecs, ${sample.occurrences.length - failures} succès, ` +
      `${(sample.resolutions ?? []).length} résolution(s)`,
  );
  console.log(
    `corpus étiqueté : ${corpus.failures.length} échecs, ` +
      `${new Set(corpus.failures.map((f) => f.expectedGroup)).size} groupes`,
  );
}

if (problems.length > 0) {
  console.error(`\nCONFORMITÉ EN ÉCHEC (${problems.length}) :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nConformité des jeux de données : OK');
