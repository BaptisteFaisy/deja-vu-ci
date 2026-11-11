#!/usr/bin/env node
// Mesure la justesse du moteur sur le corpus étiqueté (§ 18, NFR « Justesse »).
//
// Sur 100 échecs étiquetés à la main, l'objectif est :
//   - au moins 90 % de regroupements corrects (deux échecs du même groupe
//     doivent tomber sur la même signature) ;
//   - moins de 5 % de faux « instable » ;
//   - la catégorie reconnue dans la grande majorité des cas.
//
// Usage : `npm run eval` (construit le moteur puis lance cet outil).
// Code de sortie : 0 si les seuils sont tenus, 1 sinon, 2 si le moteur manque.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEngine, missingEntryPoints, repoRoot } from './lib/engine.mjs';

const CORPUS = path.join(repoRoot, 'data', 'labeled', '100-failures.json');
const THRESHOLDS = { grouping: 0.9, falseFlaky: 0.05, category: 0.9 };

function readCorpus() {
  try {
    return JSON.parse(readFileSync(CORPUS, 'utf8'));
  } catch (error) {
    console.error(`corpus illisible (${CORPUS}) : ${error.message}`);
    console.error('régénérez-le : node tools/gen/corpus.mjs');
    process.exit(2);
  }
}

/** Signature, famille et catégorie d'un échec étiqueté. */
function signOne(engine, failure) {
  const extracted = engine.extractErrorBlocks({
    stepLog: failure.log,
    testCases: failure.testCases,
  });
  const block = extracted.blocks[0];
  if (!block) return { signature: undefined, family: undefined, category: 'unknown' };
  return {
    signature: engine.signatureOf(block),
    family: engine.familyOf(block),
    category: block.category,
  };
}

/** Signature majoritaire d'un groupe, et le nombre de membres qui la suivent. */
function dominant(signatureOfMembers) {
  const counts = new Map();
  for (const signature of signatureOfMembers) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  let best;
  let bestCount = -1;
  for (const [signature, count] of counts) {
    if (count > bestCount) {
      best = signature;
      bestCount = count;
    }
  }
  return { signature: best, count: bestCount, distinct: counts.size };
}

/** Regroupement : part des échecs qui tombent sur la signature de leur groupe. */
function groupingAccuracy(rows) {
  const byGroup = new Map();
  for (const row of rows) {
    if (!byGroup.has(row.expectedGroup)) byGroup.set(row.expectedGroup, []);
    byGroup.get(row.expectedGroup).push(row);
  }
  let matched = 0;
  const scattered = [];
  for (const [group, members] of byGroup) {
    const { signature, count, distinct } = dominant(members.map((m) => m.signature));
    matched += count;
    if (distinct > 1) scattered.push({ group, distinct, members: members.length });
  }
  return { accuracy: matched / rows.length, scattered, groups: byGroup.size };
}

/**
 * Faux « instable » : signatures que le détecteur déclare instables alors que
 * leur groupe n'est pas étiqueté comme tel.
 *
 * Le corpus ne contient aucun succès au même commit : un détecteur correct ne
 * déclare donc rien d'instable ici. Toute déclaration est un faux positif.
 */
function falseFlakyRate(engine, rows) {
  const bySignature = new Map();
  for (const row of rows) {
    if (!bySignature.has(row.signature)) bySignature.set(row.signature, []);
    bySignature.get(row.signature).push(row);
  }
  let flagged = 0;
  let wrong = 0;
  for (const [, members] of bySignature) {
    const occurrences = members.map((m) => ({
      branch: m.branch,
      commit: m.commit ?? m.id,
      occurredAt: m.occurredAt,
      passedOnRetry: Boolean(m.passedOnRetry),
    }));
    const verdict = engine.assessFlakiness(occurrences, { now: new Date(members[0].occurredAt) });
    if (!verdict.flaky) continue;
    flagged += 1;
    const labeledFlaky = members.some((m) => m.expectedDiagnostic === 'flaky');
    if (!labeledFlaky) wrong += 1;
  }
  return { rate: flagged === 0 ? 0 : wrong / flagged, flagged, wrong, signatures: bySignature.size };
}

function percent(value) {
  return `${(value * 100).toFixed(1)} %`;
}

const engine = await loadEngine();
const missing = missingEntryPoints(engine);
if (missing.length > 0) {
  console.error(`moteur incomplet : ${missing.join(', ')} — lancez « npm run build »`);
  process.exit(2);
}

const corpus = readCorpus();
const rows = corpus.failures.map((failure) => ({
  ...failure,
  occurredAt: failure.occurredAt ?? new Date(Date.parse(failure.log.slice(0, 24)) || Date.now()).toISOString(),
  ...signOne(engine, failure),
}));

const grouping = groupingAccuracy(rows);
const flaky = falseFlakyRate(engine, rows);
const categoryMatches = rows.filter((row) => row.category === row.expectedCategory).length;
const categoryAccuracy = categoryMatches / rows.length;

console.log(`Corpus : ${corpus.name} — ${rows.length} échecs, ${grouping.groups} groupes`);
console.log(`  regroupement correct  ${percent(grouping.accuracy)}  (seuil ${percent(THRESHOLDS.grouping)})`);
console.log(`  faux « instable »     ${percent(flaky.rate)}  (seuil < ${percent(THRESHOLDS.falseFlaky)}) ; ${flaky.flagged} signature(s) déclarée(s) instable(s) sur ${flaky.signatures}`);
console.log(`  catégorie correcte    ${percent(categoryAccuracy)}  (seuil ${percent(THRESHOLDS.category)})`);

if (grouping.scattered.length > 0) {
  console.log('\nGroupes éclatés (plusieurs signatures pour un même groupe) :');
  for (const item of grouping.scattered) {
    console.log(`  - ${item.group} : ${item.distinct} signatures pour ${item.members} membres`);
  }
}

const categoryMisses = rows.filter((row) => row.category !== row.expectedCategory);
if (categoryMisses.length > 0) {
  console.log('\nCatégories divergentes :');
  for (const row of categoryMisses.slice(0, 12)) {
    console.log(`  - ${row.id} : attendu ${row.expectedCategory}, obtenu ${row.category}`);
  }
}

const failures = [];
if (grouping.accuracy < THRESHOLDS.grouping) failures.push('regroupement sous le seuil');
if (flaky.rate >= THRESHOLDS.falseFlaky) failures.push('trop de faux « instable »');
if (categoryAccuracy < THRESHOLDS.category) failures.push('catégories sous le seuil');

if (failures.length > 0) {
  console.error(`\nJUSTESSE INSUFFISANTE : ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nJustesse conforme au § 18.');
