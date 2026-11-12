/**
 * Les textes du panneau « Justesse » — anglais et français, enregistrés au
 * chargement du module (chaque panneau possède ses clés, `lib/i18n.ts`).
 *
 * Les libellés du domaine (les catégories) ne sont pas ici : ils viennent de
 * `@dejavu/present` (`categoryLabel`), la même table que les apps.
 */

import { registerStrings } from '../lib/i18n';

registerStrings({
  'panel.justesse.title': ['Accuracy', 'Justesse'],
  'panel.justesse.summary': [
    'The labelled corpus measured live in your browser: grouping, categories, false “flaky” — and the divergence list.',
    'Le corpus étiqueté mesuré en direct dans votre navigateur : regroupement, catégories, faux « instable » — et la liste des divergences.',
  ],

  'justesse.corpus': [
    'Corpus {name} — {failures} labelled failures, {groups} groups, {signatures} signatures, measured in {ms} ms.',
    'Corpus {name} — {failures} échecs étiquetés, {groups} groupes, {signatures} signatures, mesurés en {ms} ms.',
  ],
  'justesse.corpus.cached': [
    'Measured once when the page loaded: the corpus is fixed, the engine is fixed, the result cannot change.',
    'Mesuré une fois au chargement de la page : le corpus est fixe, le moteur est fixe, le résultat ne peut pas changer.',
  ],
  'justesse.corpus.link': ['Source file: {file}', 'Fichier source : {file}'],

  'justesse.indicators.title': ['The three measures of § 18', 'Les trois indicateurs du § 18'],
  'justesse.indicators.note': [
    'Computed by the engine itself (packages/core): extraction, signature, family, flakiness verdict. The thresholds are the ones of the release gate.',
    'Calculés par le moteur lui-même (packages/core) : extraction, signature, famille, verdict d’instabilité. Les seuils sont ceux de la porte de livraison.',
  ],
  'justesse.metric.grouping': ['Correct grouping', 'Regroupement correct'],
  'justesse.metric.category': ['Correct category', 'Catégorie correcte'],
  'justesse.metric.falseFlaky': ['False “flaky”', 'Faux « instable »'],
  'justesse.metric.failures': ['Labelled failures', 'Échecs étiquetés'],
  'justesse.metric.groups': ['Groups', 'Groupes'],
  'justesse.metric.signatures': ['Signatures', 'Signatures'],
  'justesse.what.grouping': [
    'Two failures of the same group must land on the same signature: the share of failures that land on the dominant signature of their group.',
    'Deux échecs du même groupe doivent tomber sur la même signature : part des échecs qui tombent sur la signature majoritaire de leur groupe.',
  ],
  'justesse.what.category': [
    'The category read by the engine (test, compile, timeout, dependency…) against the one written by hand on each failure.',
    'La catégorie lue par le moteur (test, compile, timeout, dépendance…) face à celle écrite à la main sur chaque échec.',
  ],
  'justesse.what.falseFlaky': [
    'Signatures the engine declares unstable although no group of the corpus is labelled unstable. Any declaration here is a false positive.',
    'Signatures que le moteur déclare instables alors qu’aucun groupe du corpus n’est étiqueté instable. Toute déclaration ici est un faux positif.',
  ],
  'justesse.target': ['Target: {target}', 'Cible : {target}'],
  'justesse.verdict.ok': ['within target', 'dans la cible'],
  'justesse.verdict.breach': ['outside target', 'hors cible'],

  'justesse.detail.title': ['Every failure, one row', 'Chaque échec, une ligne'],
  'justesse.detail.note': [
    'One row per labelled failure: the group it belongs to, the signature the engine computed, the expected and obtained category. The verdict says whether the failure landed where it should.',
    'Une ligne par échec étiqueté : le groupe auquel il appartient, la signature calculée par le moteur, la catégorie attendue et obtenue. Le verdict dit si l’échec est tombé où il devait.',
  ],
  'justesse.mismatches.title': ['Divergences', 'Divergences'],
  'justesse.mismatches.note': [
    'Failures that landed on another signature than the one of their group, or whose category differs from the hand-written one.',
    'Échecs tombés sur une autre signature que celle de leur groupe, ou dont la catégorie diffère de celle écrite à la main.',
  ],
  'justesse.mismatches.none': [
    'No divergence: every failure landed on the signature of its group with the expected category.',
    'Aucune divergence : chaque échec est tombé sur la signature de son groupe, avec la catégorie attendue.',
  ],
  'justesse.col.id': ['Failure', 'Échec'],
  'justesse.col.group': ['Expected group', 'Groupe attendu'],
  'justesse.col.signature': ['Signature obtained', 'Signature obtenue'],
  'justesse.col.expectedCategory': ['Expected category', 'Catégorie attendue'],
  'justesse.col.gotCategory': ['Obtained category', 'Catégorie obtenue'],
  'justesse.col.verdict': ['Verdict', 'Verdict'],
  'justesse.state.ok': ['as expected', 'conforme'],
  'justesse.state.group': ['group divergence', 'divergence de groupe'],
  'justesse.state.category': ['category divergence', 'divergence de catégorie'],
  'justesse.state.both': ['group + category', 'groupe + catégorie'],
  'justesse.state.noblock': ['no error block', 'aucun bloc d’erreur'],

  'justesse.method.title': ['How this is measured', 'Comment c’est mesuré'],
  'justesse.method.origin.title': ['A synthetic corpus, labelled by hand', 'Un corpus synthétique, étiqueté à la main'],
  'justesse.method.origin.text': [
    'The corpus is generated by tools/gen/corpus.mjs from group specifications: the members of a group differ only by a volatile detail (timestamp, line number, UUID, port), so the normalisation of the engine must bring them back to one signature. The labels (group, category) were written by hand.',
    'Le corpus est généré par tools/gen/corpus.mjs à partir de spécifications de groupes : les membres d’un groupe ne diffèrent que par un détail volatil (horodatage, numéro de ligne, UUID, port), donc la normalisation du moteur doit les ramener à une seule signature. Les étiquettes (groupe, catégorie) ont été écrites à la main.',
  ],
  'justesse.method.measures.title': ['Three questions, three numbers', 'Trois questions, trois chiffres'],
  'justesse.method.measures.text': [
    'Grouping: do two failures of the same group land on the same signature? Category: does the engine read the right kind of failure? False “flaky”: does the engine excuse a real defect as unstable? Each question becomes one number, compared with the threshold of the release gate.',
    'Regroupement : deux échecs du même groupe tombent-ils sur la même signature ? Catégorie : le moteur lit-il le bon type d’échec ? Faux « instable » : le moteur excuse-t-il un vrai défaut comme instable ? Chaque question devient un chiffre, comparé au seuil de la porte de livraison.',
  ],
  'justesse.method.limits.title': ['What it does not prove', 'Ce que cela ne prouve pas'],
  'justesse.method.limits.text': [
    'The corpus is fictional: it proves the engine behaves as specified on these 100 failures, nothing about a real repository, real logs or a real tenant. No Bitbucket call, no Jira call and no model call happen here.',
    'Le corpus est fictif : il prouve que le moteur se comporte comme prévu sur ces 100 échecs, rien sur un dépôt réel, des journaux réels ou un tenant réel. Aucun appel Bitbucket, aucun appel Jira, aucun appel de modèle ici.',
  ],

  'justesse.nightly.title': ['Compared with the nightly proof', 'Comparé à la preuve nocturne'],
  'justesse.nightly.note': [
    'The nightly verification publishes its own measurement in docs/NIGHTLY-REPORT.md (generated on {date}). That file is a trace: the measurement made in your browser is the authority. The table below compares them line by line.',
    'La vérification nocturne publie sa propre mesure dans docs/NIGHTLY-REPORT.md (générée le {date}). Ce fichier est une trace : la mesure faite dans votre navigateur fait foi. Le tableau ci-dessous les compare ligne à ligne.',
  ],
  'justesse.nightly.col.metric': ['Measure', 'Grandeur'],
  'justesse.nightly.col.live': ['Measured here', 'Mesuré ici'],
  'justesse.nightly.col.published': ['Published trace', 'Trace publiée'],
  'justesse.nightly.same': ['identical', 'identique'],
  'justesse.nightly.diff': ['different', 'différent'],
  'justesse.nightly.authority': [
    'The browser measurement is the authority: the nightly report is the trace of a run on a runner, regenerated every night.',
    'La mesure du navigateur fait foi : le rapport nocturne est la trace d’une exécution sur un runner, régénérée chaque nuit.',
  ],
});
