/**
 * Panneau « Coût » — ce que ça coûte, la tendance, et la facture de l'instabilité.
 *
 * Les cinq blocs montrent les chiffres du produit, calculés dans le navigateur :
 * les quatre compteurs de `computeCost` (`packages/core`, CI-14), le classement
 * par signature que le moteur trie lui-même, la tendance par jour de
 * `computeCostTrend` (`apps/brain/src/pure/costTrend`, le modèle de vue de
 * l'onglet Coût du Cerveau), la conversion en euros au tarif **saisi par le
 * visiteur**, et le coût des signatures que `assessFlakiness` déclare instables.
 *
 * La fenêtre et l'horloge viennent de l'atelier partagé (`workspace.now`,
 * `workspace.view.cost.windowDays`) : ce panneau compte exactement ce que le
 * rejeu a compté, sur la mémoire que les autres panneaux peuvent modifier.
 */

import { el, mount } from '../render/dom';
import { fill, registerStrings, t, type Lang } from '../lib/i18n';
import { DEFAULT_EUR_PER_MINUTE, costView, rateOf } from './cout-donnees';
import {
  countersSection,
  euroSection,
  euroSinks,
  flakySection,
  rankingSection,
  refreshEuros,
  trendSection,
  type EuroSinks,
} from './cout-rendu';
import type { Panel, PanelContext } from './types';

registerStrings({
  'panel.cout.title': ['Cost', 'Coût'],
  'panel.cout.summary': [
    'What the failures cost: the engine’s four counters, the ranking by signature, the daily trend of the Brain’s Cost tab, the price of flakiness — and the same minutes converted at a rate you type.',
    'Ce que coûtent les échecs : les quatre compteurs du moteur, le classement par signature, la tendance par jour de l’onglet Coût du Cerveau, le prix de l’instabilité — et ces mêmes minutes converties au tarif que vous saisissez.',
  ],

  'cout.source': [
    'Computed in your browser by the product’s own code: `computeCost` and `assessFlakiness` (packages/core) over the shared memory, and `computeCostTrend` (apps/brain/src/pure/costTrend), the view model of the Brain’s Cost tab. Measured here: {failures} red builds over a {days}-day window.',
    'Calculé dans votre navigateur par le code du produit : `computeCost` et `assessFlakiness` (packages/core) sur la mémoire partagée, et `computeCostTrend` (apps/brain/src/pure/costTrend), le modèle de vue de l’onglet Coût du Cerveau. Mesuré ici : {failures} builds rouges sur une fenêtre de {days} jours.',
  ],

  'cout.col.share': ['Share of the window', 'Part de la fenêtre'],
  'cout.col.euros': ['Euros, at your rate', 'Euros, à votre tarif'],

  'cout.ranking.title': ['Ranking by signature', 'Classement par signature'],
  'cout.ranking.note': [
    'One row per signature of the window, in the order the engine returns it (`computeCost` sorts by minutes lost, then by occurrences). The share is that signature’s part of the window’s CI minutes.',
    'Une ligne par signature de la fenêtre, dans l’ordre rendu par le moteur (`computeCost` trie par minutes perdues, puis par occurrences). La part est la portion de cette signature dans les minutes de CI de la fenêtre.',
  ],

  'cout.trend.title': ['Daily trend', 'Tendance par jour'],
  'cout.trend.note': [
    'One row per day of the window: each day is counted by the engine itself (`computeCost` on that day’s failures), and the bars are the text bars of the Brain’s Cost tab. Days without failures belong to the window and are shown as they are.',
    'Une ligne par jour de la fenêtre : chaque jour est compté par le moteur lui-même (`computeCost` sur les échecs du jour), et les barres sont les barres textuelles de l’onglet Coût du Cerveau. Les jours sans échec font partie de la fenêtre et sont montrés tels quels.',
  ],
  'cout.trend.day': ['Day', 'Jour'],
  'cout.trend.bar': ['Minutes, as a bar', 'Minutes, en barre'],
  'cout.trend.current': [
    'Window: {minutes} CI minutes lost over {builds} red builds, spread on {days} days.',
    'Fenêtre : {minutes} minutes de CI perdues sur {builds} builds rouges, réparties sur {days} jours.',
  ],
  'cout.trend.summary': ['{direction} of {minutes} min ({percent}%) {vs}.', '{direction} de {minutes} min ({percent} %) {vs}.'],
  'cout.trend.noPrevious': [
    'The previous window holds no failure of this sample set, so its {minutes} min and {builds} red builds are all new — no percentage can be computed.',
    'La fenêtre précédente ne contient aucun échec de ce jeu d’exemple : ses {minutes} min et {builds} builds rouges sont donc entièrement nouveaux — aucun pourcentage ne peut être calculé.',
  ],
  'cout.trend.vsPrevious': ['vs the previous window', 'vs la fenêtre précédente'],
  'cout.trend.up': ['up', 'en hausse'],
  'cout.trend.down': ['down', 'en baisse'],
  'cout.trend.flat': ['unchanged', 'inchangé'],

  'cout.euro.title': ['In euros, at your rate', 'En euros, à votre tarif'],
  'cout.euro.note': [
    'Type your own price for one CI minute: every euro figure on this page is that rate applied to the minutes the engine really counted, live, as you type.',
    'Saisissez votre propre prix pour une minute de CI : chaque montant de cette page est ce tarif appliqué aux minutes réellement comptées par le moteur, en direct pendant que vous tapez.',
  ],
  'cout.euro.rate': ['Cost of one CI minute (€)', 'Coût d’une minute de CI (€)'],
  'cout.euro.total': ['Whole window', 'Fenêtre entière'],
  'cout.euro.perDay': ['Per day with failures', 'Par jour avec échec'],
  'cout.euro.flaky': ['Flakiness', 'Instabilité'],
  'cout.euro.honesty': [
    'Honesty: the rate is typed by you, the visitor. Déjà-vu CI itself never reasons in money — it counts CI minutes, retries and interrupted people, exactly as shown above. No price is stored, estimated or fetched by the product.',
    'Honnêteté : le tarif est saisi par vous, le visiteur. Déjà-vu CI ne raisonne jamais en argent — il compte des minutes de CI, des relances et des personnes interrompues, exactement comme ci-dessus. Aucun prix n’est stocké, estimé ou récupéré par le produit.',
  ],

  'cout.flaky.title': ['The cost of flakiness', 'Le coût de l’instabilité'],
  'cout.flaky.note': [
    'The verdicts come from `assessFlakiness` with the settings of the shared memory (thresholds and window), the minutes from `computeCost`. The bullet points are the engine’s own reasons, word for word; `test_stats` is filled by the engine’s per-test statistics when a test name is known.',
    'Les verdicts viennent de `assessFlakiness` avec les réglages de la mémoire partagée (seuils et fenêtre), les minutes de `computeCost`. Les puces sont les raisons du moteur, mot pour mot ; `test_stats` est rempli par les statistiques par test du moteur quand un nom de test est connu.',
  ],
  'cout.flaky.diagnosed': [
    'The engine diagnosed {count} of the {failures} replayed failures as flaky.',
    'Le moteur a diagnostiqué {count} des {failures} échecs rejoués comme instables.',
  ],
  'cout.flaky.bill': [
    'Flaky signatures cost {minutes} min ({share} of the window), {retries} retries over {occurrences} failures.',
    'Les signatures instables coûtent {minutes} min ({share} de la fenêtre), {retries} relances sur {occurrences} échecs.',
  ],
  'cout.flaky.branches': ['Branches', 'Branches'],
  'cout.flaky.index': ['flakyIndex', 'flakyIndex'],
  'cout.flaky.sameCommit': ['Passed at the same commit', 'Passé au même commit'],
  'cout.flaky.yes': ['yes', 'oui'],
  'cout.flaky.no': ['no', 'non'],
  'cout.flaky.none': ['No signature meets the flakiness thresholds in this window.', 'Aucune signature n’atteint les seuils d’instabilité sur cette fenêtre.'],
  'cout.flaky.stats': [
    'test_stats: {repo} — {test}, {failed} failed runs, {passed} passed at the same commit',
    'test_stats : {repo} — {test}, {failed} échecs, {passed} réussites au même commit',
  ],
});

/** Le tarif saisi par le visiteur : il survit aux re-rendus du panneau. */
let rate = DEFAULT_EUR_PER_MINUTE;

/** Garde anti-course : seul le dernier `render` appelé a le droit de monter. */
let generation = 0;

/** La note qui dit quel code a produit ces chiffres, avec les vrais totaux. */
function sourceNote(view: ReturnType<typeof costView>, lang: Lang): HTMLElement {
  return el('p', { class: 'section-note' }, fill(t('cout.source', lang), {
    failures: view.report.redBuilds,
    days: view.report.windowDays,
  }));
}

/** Le tarif change : les euros sont recalculés, le champ garde le focus. */
function onRate(raw: string, sinks: EuroSinks, lang: Lang): void {
  rate = rateOf(raw);
  refreshEuros(sinks, rate, lang);
}

/**
 * Lit la mémoire partagée, calcule avec le moteur, puis monte les cinq blocs.
 *
 * La lecture du magasin est asyncture (c'est le contrat de `Store`, le même que
 * l'adaptateur SQL du Cerveau) : la garde `run !== generation` évite qu'une
 * lecture lente écrase un rendu plus récent.
 */
async function draw(host: HTMLElement, ctx: PanelContext, run: number): Promise<void> {
  const { workspace, lang } = ctx;
  const [signatures, settings] = await Promise.all([
    workspace.store.listSignatures(),
    workspace.store.getSettings(),
  ]);
  if (run !== generation) return;
  const view = costView({
    occurrences: workspace.result.diagnostics.map((entry) => entry.occurrence),
    signatures,
    settings,
    now: workspace.now,
    windowDays: workspace.view.cost.windowDays,
  });
  const sinks = euroSinks();
  mount(
    host,
    el(
      'div',
      {},
      sourceNote(view, lang),
      countersSection(view.report, lang),
      rankingSection(view, sinks, rate, lang),
      trendSection(view, sinks, rate, lang),
      euroSection(view, sinks, rate, lang, (raw) => onRate(raw, sinks, lang)),
      flakySection(view, workspace.view.byKind.flaky, workspace.view.failures, sinks, rate, lang),
    ),
  );
}

export const panel: Panel = {
  id: 'cout',
  title: (lang) => t('panel.cout.title', lang),
  summary: (lang) => t('panel.cout.summary', lang),
  render(host, ctx) {
    generation += 1;
    void draw(host, ctx, generation);
  },
};
