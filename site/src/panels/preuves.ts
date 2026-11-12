/**
 * Panneau « Preuves » — ce qui est vérifié, où, et comment le rejouer.
 *
 * Le panneau de la crédibilité : pas de marketing, des artefacts du dépôt.
 * Les chiffres affichés viennent des fichiers JSON suivis par git
 * (`data/golden/*.json`, `docs/SBOM.json`), importés au build et validés par
 * `preuves-donnees.ts`. Les artefacts Markdown (rapport nocturne, bancs de
 * mesure, changelog, journal des décisions) ne peuvent pas être embarqués —
 * `tools/build-site.mjs` n'a pas de loader de texte — ils sont donc **liés**
 * vers le dépôt, et le panneau le dit explicitement.
 */

import { diagnosticLabel, diagnosticTone, formatDate } from '@dejavu/present';
import { badge, el, mount, table } from '../render/dom';
import { renderHonesty } from '../render/content';
import { REPO_URL } from '../render/sections';
import { fill, registerStrings, t, type Lang } from '../lib/i18n';
import {
  DOCTOR_CHECKS,
  readCostSnapshot,
  readDiagnosticSpread,
  readGoldenMeta,
  readSbom,
  readTicketPlan,
} from './preuves-donnees';
import goldenCost from '../../../data/golden/cost.json';
import goldenDiagnostics from '../../../data/golden/diagnostics.json';
import goldenMeta from '../../../data/golden/meta.json';
import goldenTickets from '../../../data/golden/tickets.json';
import sbom from '../../../docs/SBOM.json';
import type { Panel } from './types';

registerStrings({
  'panel.preuves.title': ['Proofs', 'Preuves'],
  'panel.preuves.summary': [
    'The golden snapshot, the SBOM, the verification command and the nightly report — every figure comes from a tracked file.',
    'L’instantané de référence, le SBOM, la commande de vérification et le rapport nocturne — chaque chiffre vient d’un fichier suivi par git.',
  ],

  'preuves.intro': [
    'No marketing here: repository artefacts. Every number below is extracted from a JSON file tracked by git; ' +
      'Markdown artefacts (nightly report, benchmarks, changelog, decision log) cannot be bundled by the site ' +
      'build, so they are linked — their figures live in the repository, never copied here.',
    'Pas de marketing ici : des artefacts du dépôt. Chaque chiffre ci-dessous est extrait d’un fichier JSON suivi ' +
      'par git ; les artefacts Markdown (rapport nocturne, bancs de mesure, changelog, journal des décisions) ne ' +
      'peuvent pas être embarqués par le build du site : ils sont donc liés — leurs chiffres vivent dans le dépôt, ' +
      'jamais recopiés ici.',
  ],
  'preuves.unavailable': ['Not available', 'Non disponible'],
  'preuves.links': ['See in the repository:', 'Voir dans le dépôt :'],

  'preuves.col.measure': ['Measure', 'Mesure'],
  'preuves.col.value': ['Value', 'Valeur'],
  'preuves.col.check': ['Check', 'Contrôle'],
  'preuves.col.what': ['What it verifies', 'Ce qu’il vérifie'],
  'preuves.col.package': ['Package', 'Paquet'],

  'preuves.nightly.title': ['The nightly proof', 'La vérification nocturne'],
  'preuves.nightly.text': [
    'Every night, a workflow replays on `main` the full verification: the whole test suite, the sample replay, ' +
      'the accuracy measurement (correct grouping, false “flaky”, correct category, each against its threshold) ' +
      'and the repository integrity checks. It rewrites `docs/NIGHTLY-REPORT.md` with the verdict and the figures — ' +
      'the report is generated, never hand-edited.',
    'Chaque nuit, un workflow rejoue sur `main` toute la vérification : la suite de tests complète, le rejeu du ' +
      'jeu d’exemple, la mesure de justesse (regroupement correct, faux « instables », catégorie correcte, chacun ' +
      'contre son seuil) et les contrôles d’intégrité du dépôt. Il réécrit `docs/NIGHTLY-REPORT.md` avec le verdict ' +
      'et les chiffres — le rapport est généré, jamais écrit à la main.',
  ],

  'preuves.golden.title': ['The reference snapshot — data/golden', 'L’instantané de référence — data/golden'],
  'preuves.golden.note': [
    'What the real engine produces end to end on the sample set, frozen in five generated JSON files. ' +
      '`packages/core/test/golden-memory.test.ts` replays the sample and compares every field: any drift of the ' +
      'memory turns the CI red and names the field that moved. Regenerate on an intended change:',
    'Ce que le vrai moteur produit de bout en bout sur le jeu d’exemple, figé dans cinq fichiers JSON générés. ' +
      '`packages/core/test/golden-memory.test.ts` rejoue le jeu et compare chaque champ : toute dérive de la ' +
      'mémoire met la CI au rouge et nomme le champ qui a bougé. Régénérer lors d’un changement voulu :',
  ],
  'preuves.golden.spread': ['Diagnostics of the snapshot', 'Diagnostics de l’instantané'],
  'preuves.golden.plan': ['Ticket plan of the snapshot', 'Plan de tickets de l’instantané'],
  'preuves.golden.cost': ['Cost of the window', 'Coût sur la fenêtre'],
  'preuves.meta.version': ['Snapshot version', 'Version de l’instantané'],
  'preuves.meta.generator': ['Generator', 'Générateur'],
  'preuves.meta.dataset': ['Dataset', 'Jeu de données'],
  'preuves.meta.sha': ['Dataset SHA-256', 'SHA-256 du jeu'],
  'preuves.meta.reference': ['Reference instant', 'Instant de référence'],
  'preuves.meta.failures': ['Failures replayed', 'Échecs rejoués'],
  'preuves.meta.signatures': ['Signatures memorised', 'Signatures mémorisées'],
  'preuves.meta.diagnostics': ['Diagnostics produced', 'Diagnostics produits'],
  'preuves.meta.tickets': ['Ticket actions planned', 'Actions de tickets planifiées'],
  'preuves.plan.create': ['Tickets to create', 'Tickets à créer'],
  'preuves.plan.update': ['Updates', 'Mises à jour'],
  'preuves.plan.comment': ['Synthesis comments', 'Commentaires de synthèse'],

  'preuves.bench.title': ['Benchmarks', 'Bancs de mesure'],
  'preuves.bench.text': [
    'The CI-05 promise — a diagnostic in under 30 seconds — is measured offline by `tools/bench.mjs` on the real ' +
      'engine: p50/p95/max per operation over synthetic corpora with a fixed seed. The figures live in ' +
      '`docs/BENCHMARK.md`; reproduce them with:',
    'La promesse CI-05 — un diagnostic en moins de 30 secondes — est mesurée hors ligne par `tools/bench.mjs` sur ' +
      'le vrai moteur : p50/p95/max par opération sur des corpus synthétiques à graine fixe. Les chiffres vivent ' +
      'dans `docs/BENCHMARK.md` ; reproduisez-les avec :',
  ],

  'preuves.doctor.title': ['One command verifies everything', 'Une commande vérifie tout'],
  'preuves.doctor.text': [
    '`node tools/doctor.mjs` runs every check the repository owns, offline, one verdict per check ' +
      '(`--list` prints the catalogue, `--only types,tests` a subset, `--json` a machine-readable report):',
    '`node tools/doctor.mjs` enchaîne tous les contrôles du dépôt, hors ligne, un verdict par contrôle ' +
      '(`--list` affiche le catalogue, `--only types,tests` un sous-ensemble, `--json` un rapport lisible par machine) :',
  ],
  'preuves.check.types': ['TypeScript types (core, bridge, present)', 'Types TypeScript (core, bridge, present)'],
  'preuves.check.tests': ['the whole vitest suite', 'toute la suite vitest'],
  'preuves.check.manifests': ['Forge manifests vs the official schema', 'manifestes Forge contre le schéma officiel'],
  'preuves.check.dataset': ['sample dataset + labeled corpus', 'jeu d’exemple + corpus étiqueté'],
  'preuves.check.sbom': ['docs/SBOM.json is fresh', 'docs/SBOM.json est à jour'],
  'preuves.check.site-bundle': ['the public site bundle fingerprint', 'l’empreinte du bundle du site public'],
  'preuves.check.docs': ['documentation links and anchors', 'liens et ancres de la documentation'],
  'preuves.check.licences': ['runtime licences vs MIT', 'licences d’exécution contre MIT'],
  'preuves.check.conflicts': ['no merge conflict marker', 'aucun marqueur de conflit de fusion'],
  'preuves.check.sizes': ['files < 500 lines, functions < 50 lines', 'fichiers < 500 lignes, fonctions < 50 lignes'],
  'preuves.check.couche0': ['the CI guard, replayed locally', 'la garde CI, rejouée localement'],

  'preuves.sbom.title': ['Bill of materials', 'Inventaire des composants'],
  'preuves.sbom.text': [
    '`docs/SBOM.json` (CycloneDX, generated by `tools/sbom.mjs`, freshness checked by the doctor and the nightly ' +
      'run): {first} first-party packages and {third} third-party runtime packages, all Forge platform libraries.',
    '`docs/SBOM.json` (CycloneDX, généré par `tools/sbom.mjs`, fraîcheur vérifiée par le doctor et la nuit) : ' +
      '{first} paquets maison et {third} paquets tiers d’exécution, tous des bibliothèques de la plateforme Forge.',
  ],

  'preuves.history.title': ['The history', 'L’histoire'],
  'preuves.history.text': [
    'Every change is recorded in `CHANGELOG.md` with the pull request that introduced it, and every smaller ' +
      'design choice in `docs/DECISIONS.md` (context, decision, rejected alternative, source). The three major ' +
      'decisions have their own ADRs in `docs/ADRs/`.',
    'Chaque changement est consigné dans `CHANGELOG.md` avec la pull request qui l’a introduit, et chaque petit ' +
      'choix de conception dans `docs/DECISIONS.md` (contexte, décision, alternative rejetée, source). Les trois ' +
      'décisions majeures ont leur ADR dans `docs/ADRs/`.',
  ],
});

/** Un lien vers un fichier (ou dossier) du dépôt public. */
function repoLink(kind: 'blob' | 'tree', path: string): HTMLElement {
  return el('a', { href: `${REPO_URL}/${kind}/main/${path}`, rel: 'noopener' }, path);
}

/** La ligne de liens d'une section. */
function linkLine(links: HTMLElement[], lang: Lang): HTMLElement {
  return el(
    'p',
    { class: 'facts' },
    el('span', {}, t('preuves.links', lang)),
    ...links.flatMap((link, index) => (index === 0 ? [link] : [', ', link])),
  );
}

/** Un bloc de commande(s) à reproduire, en chasse fixe. */
function commands(...lines: string[]): HTMLElement {
  return el('div', { class: 'mono' }, ...lines.flatMap((line) => [el('div', {}, line)]));
}

/** Le tableau des métadonnées de l'instantané de référence. */
function goldenMetaTable(lang: Lang): HTMLElement {
  const meta = readGoldenMeta(goldenMeta);
  if (!meta) return el('p', { class: 'empty' }, t('preuves.unavailable', lang));
  const mono = (value: string) => el('span', { class: 'mono' }, value);
  return table(
    [t('preuves.col.measure', lang), t('preuves.col.value', lang)],
    [
      [t('preuves.meta.version', lang), String(meta.goldenVersion)],
      [t('preuves.meta.generator', lang), mono(meta.generator)],
      [t('preuves.meta.dataset', lang), mono(meta.dataset)],
      [t('preuves.meta.sha', lang), mono(meta.datasetSha256.slice(0, 16) + '…')],
      [t('preuves.meta.reference', lang), formatDate(meta.referenceNow, lang)],
      [t('preuves.meta.failures', lang), String(meta.failures)],
      [t('preuves.meta.signatures', lang), String(meta.signatures)],
      [t('preuves.meta.diagnostics', lang), String(meta.diagnostics)],
      [t('preuves.meta.tickets', lang), String(meta.tickets)],
    ],
    t('preuves.unavailable', lang),
  );
}

/** La répartition des diagnostics, avec les libellés et tons du produit. */
function spreadBlock(lang: Lang): HTMLElement {
  const spread = readDiagnosticSpread(goldenDiagnostics);
  if (!spread) return el('p', { class: 'empty' }, t('preuves.unavailable', lang));
  return el(
    'ul',
    { class: 'facts' },
    ...spread.map(([kind, count]) =>
      el('li', {}, badge(diagnosticLabel(kind, lang), diagnosticTone(kind)), ' ', el('span', { class: 'mono' }, String(count))),
    ),
  );
}

/** Les compteurs du plan de tickets et du coût. */
function countersBlock(entries: Array<[string, string | number]>): HTMLElement {
  return el(
    'ul',
    { class: 'counters' },
    ...entries.map(([label, value]) =>
      el('li', {}, el('span', { class: 'value' }, String(value)), el('span', { class: 'label' }, label)),
    ),
  );
}

/** Les compteurs de coût, libellés par la table partagée du produit. */
function costBlock(lang: Lang): HTMLElement {
  const cost = readCostSnapshot(goldenCost);
  if (!cost) return el('p', { class: 'empty' }, t('preuves.unavailable', lang));
  return countersBlock([
    [t('cost.redBuilds', lang), cost.redBuilds],
    [t('cost.minutesLost', lang), cost.ciMinutesLost],
    [t('cost.peopleAffected', lang), cost.peopleAffected],
    [t('cost.retries', lang), cost.retries],
    [t('cost.window', lang), cost.windowDays],
  ]);
}

/** Le plan de tickets compté depuis `tickets.json`. */
function planBlock(lang: Lang): HTMLElement {
  const plan = readTicketPlan(goldenTickets);
  if (!plan) return el('p', { class: 'empty' }, t('preuves.unavailable', lang));
  return countersBlock([
    [t('preuves.plan.create', lang), plan.create],
    [t('preuves.plan.update', lang), plan.update],
    [t('preuves.plan.comment', lang), plan.comment],
  ]);
}

/** Section 1 — la vérification nocturne (rapport Markdown lié, non embarqué). */
function nightlyBlock(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, t('preuves.nightly.title', lang)),
    el('p', { class: 'section-note' }, t('preuves.nightly.text', lang)),
    linkLine(
      [
        repoLink('blob', 'docs/NIGHTLY-REPORT.md'),
        repoLink('blob', '.github/workflows/nightly.yml'),
        repoLink('blob', 'docs/NIGHTLY.md'),
      ],
      lang,
    ),
  );
}

/** Section 2 — l'instantané de référence (les seuls chiffres embarqués). */
function goldenBlock(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, t('preuves.golden.title', lang)),
    el('p', { class: 'section-note' }, t('preuves.golden.note', lang)),
    commands('npm run build && node tools/gen/golden.mjs', 'node tools/gen/golden.mjs --check'),
    goldenMetaTable(lang),
    el('h3', {}, t('preuves.golden.spread', lang)),
    spreadBlock(lang),
    el('h3', {}, t('preuves.golden.plan', lang)),
    planBlock(lang),
    el('h3', {}, t('preuves.golden.cost', lang)),
    costBlock(lang),
    linkLine([repoLink('tree', 'data/golden'), repoLink('blob', 'docs/GOLDEN.md')], lang),
  );
}

/** Section 3 — les bancs de mesure (chiffres dans le Markdown lié). */
function benchBlock(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, t('preuves.bench.title', lang)),
    el('p', { class: 'section-note' }, t('preuves.bench.text', lang)),
    commands('npm run build --silent && node tools/bench.mjs --quick', 'node tools/bench.mjs --json'),
    linkLine([repoLink('blob', 'docs/BENCHMARK.md'), repoLink('blob', 'tools/bench.mjs')], lang),
  );
}

/** Section 4 — la commande unique, ses onze contrôles énumérés. */
function doctorBlock(lang: Lang): HTMLElement {
  const rows = DOCTOR_CHECKS.map((name) => [
    el('span', { class: 'mono' }, name),
    t(`preuves.check.${name}`, lang),
  ]);
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, t('preuves.doctor.title', lang)),
    el('p', { class: 'section-note' }, t('preuves.doctor.text', lang)),
    table(
      [t('preuves.col.check', lang), t('preuves.col.what', lang)],
      rows,
      t('preuves.unavailable', lang),
    ),
    commands('node tools/doctor.mjs', 'node tools/doctor.mjs --list'),
    linkLine([repoLink('blob', 'tools/doctor.mjs'), repoLink('blob', 'docs/VERIFY.md')], lang),
  );
}

/** Section 5 — le SBOM : maison contre tiers, extrait de docs/SBOM.json. */
function sbomBlock(lang: Lang): HTMLElement {
  const summary = readSbom(sbom);
  const note = summary
    ? fill(t('preuves.sbom.text', lang), {
        first: summary.firstParty.length,
        third: summary.thirdParty.length,
      })
    : t('preuves.unavailable', lang);
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, t('preuves.sbom.title', lang)),
    el('p', { class: 'section-note' }, note),
    summary
      ? table(
          [t('preuves.col.package', lang), t('preuves.meta.version', lang)],
          summary.thirdParty.map((entry) => [
            el('span', { class: 'mono' }, entry.name),
            el('span', { class: 'mono' }, entry.version),
          ]),
          t('preuves.unavailable', lang),
        )
      : el('p', { class: 'empty' }, t('preuves.unavailable', lang)),
    linkLine([repoLink('blob', 'docs/SBOM.json'), repoLink('blob', 'tools/sbom.mjs')], lang),
  );
}

/** Section 6 — l'histoire (Markdown lié, non embarqué). */
function historyBlock(lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'block' },
    el('h2', {}, t('preuves.history.title', lang)),
    el('p', { class: 'section-note' }, t('preuves.history.text', lang)),
    linkLine(
      [
        repoLink('blob', 'CHANGELOG.md'),
        repoLink('blob', 'docs/DECISIONS.md'),
        repoLink('tree', 'docs/ADRs'),
      ],
      lang,
    ),
  );
}

export const panel: Panel = {
  id: 'preuves',
  title: (lang) => t('panel.preuves.title', lang),
  summary: (lang) => t('panel.preuves.summary', lang),
  render(host, ctx) {
    const { lang, workspace } = ctx;
    mount(
      host,
      el('div', { class: 'block' }, el('p', { class: 'section-note' }, t('preuves.intro', lang))),
      nightlyBlock(lang),
      goldenBlock(lang),
      benchBlock(lang),
      doctorBlock(lang),
      sbomBlock(lang),
      historyBlock(lang),
      el('div', { class: 'block' }, renderHonesty({ lang, running: false, run: workspace.view })),
    );
  },
};
