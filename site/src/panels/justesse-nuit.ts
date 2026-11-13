/**
 * La trace publiée par la vérification nocturne, et la comparaison.
 *
 * `docs/NIGHTLY-REPORT.md` est régénéré chaque nuit par
 * `.github/workflows/nightly.yml` : c'est une **trace** de ce que la porte a
 * mesuré sur le runner — pas la mesure elle-même. Le panneau compare donc les
 * deux et dit lequel fait foi : la mesure faite dans le navigateur.
 *
 * Les valeurs ci-dessous sont **citées** du rapport : le Markdown n'a pas de
 * loader esbuild, il ne peut donc pas entrer dans le bundle du site. Elles ne
 * sont donc pas écrites à la main sans filet — `site/test/panels-justesse.test.ts`
 * relit `docs/NIGHTLY-REPORT.md` et échoue si la citation ne correspond plus au
 * rapport publié.
 */

import type { CorpusMeasurement } from './justesse-mesure';

/** La trace publiée par la vérification nocturne. */
export interface PublishedTrace {
  /** Le fichier du dépôt qui publie la trace. */
  source: string;
  /** La date de génération du rapport. */
  date: string;
  /** Regroupement correct, en fraction. */
  grouping: number;
  /** Faux « instable », en fraction. */
  falseFlaky: number;
  /** Catégorie correcte, en fraction. */
  category: number;
  /** Nombre d'échecs étiquetés. */
  failures: number;
  /** Nombre de groupes. */
  groups: number;
  /** Nombre de signatures obtenues. */
  signatures: number;
}

/** La trace publiée, citée de `docs/NIGHTLY-REPORT.md`. */
export const PUBLISHED: PublishedTrace = {
  source: 'docs/NIGHTLY-REPORT.md',
  date: '2026-11-12',
  grouping: 1,
  falseFlaky: 0,
  category: 1,
  failures: 100,
  groups: 27,
  signatures: 26,
};

/** Les grandeurs comparées entre la mesure du navigateur et la trace publiée. */
export type NightlyKey = 'grouping' | 'falseFlaky' | 'category' | 'failures' | 'groups' | 'signatures';

/** Une ligne de comparaison. */
export interface NightlyRow {
  key: NightlyKey;
  /** La valeur mesurée dans le navigateur. */
  live: number;
  /** La valeur publiée par la vérification nocturne. */
  published: number;
  /** Vrai quand les deux valeurs coïncident, à la précision du rapport. */
  same: boolean;
}

/** Deux valeurs coïncident-elles, à la précision du rapport (0,1 %) ? */
function sameValue(live: number, published: number): boolean {
  const arrondi = (value: number) => Math.round(value * 1000) / 1000;
  return arrondi(live) === arrondi(published);
}

/** Compare la mesure du navigateur à la trace publiée, ligne par ligne. */
export function compareWithPublished(measurement: CorpusMeasurement): NightlyRow[] {
  const rows: Array<[NightlyKey, number, number]> = [
    ['grouping', measurement.report.groupingAccuracy, PUBLISHED.grouping],
    ['falseFlaky', measurement.report.falseFlakyRate, PUBLISHED.falseFlaky],
    ['category', measurement.report.categoryAccuracy, PUBLISHED.category],
    ['failures', measurement.report.failures, PUBLISHED.failures],
    ['groups', measurement.grouping.groups, PUBLISHED.groups],
    ['signatures', measurement.flaky.signatures, PUBLISHED.signatures],
  ];
  return rows.map(([key, live, published]) => ({ key, live, published, same: sameValue(live, published) }));
}

/** La comparaison est-elle entièrement conforme à la trace publiée ? */
export function matchesPublished(rows: NightlyRow[]): boolean {
  return rows.every((row) => row.same);
}
