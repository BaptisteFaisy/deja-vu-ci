/**
 * Panneau « Production » — les faits constatés, figés dans le module.
 *
 * Rien n'est mesuré ici : ce sont des **relevés** faits le 12/11/2026 sur le
 * site Jira réel, écrits une fois et affichés tels quels. Le panneau les met en
 * regard de ce que **cette page** calcule en direct — cette séparation est le
 * sujet du panneau, pas un détail de mise en forme.
 *
 * Module pur : aucun DOM, aucun réseau, aucune horloge. Les liens sont des
 * adresses réelles (`https://…`), jamais une URL de web trigger (elles
 * contiennent une clé). Testable sans navigateur.
 */

import type { DiagnosticKind } from '@dejavu/core';
import { REPO_URL } from '../render/sections';

/** Le jour du relevé (l'affichage passe par `formatDate` de `@dejavu/present`). */
export const OBSERVED_AT = '2026-11-12';

/** Le site Jira réel où l'app est installée. */
export const SITE_URL = 'https://one-atlas-cndz.atlassian.net';

/** Le projet Jira qui porte la page de l'app. */
export const PROJECT_KEY = 'PAY';

/** La page du projet : l'app s'ouvre depuis le menu du projet. */
export const PROJECT_URL = `${SITE_URL}/jira/software/projects/${PROJECT_KEY}`;

/** La page de l'app elle-même, dans le projet (c'est là qu'est le bouton). */
export const APP_PAGE_URL = `${PROJECT_URL}/apps/`;

/** Le chemin réel de la page de l'app, tel que le navigateur l'affiche. */
export const APP_PAGE_PATH = `/jira/software/projects/${PROJECT_KEY}/apps/…`;

/** L'app réelle (le Cerveau), telle que la CLI Forge la nomme. */
export const APP_ID = 'ari:cloud:ecosystem::app/2abacda7-8c4f-4b29-9c97-7209dd240894';

/** La version déployée, l'environnement et l'état de l'installation. */
export const DEPLOYED_VERSION = 'v2.12.0';
export const DEPLOY_ENV = 'production';
export const INSTALL_STATUS = 'Up-to-date';

/** La console Forge : les apps du compte, leurs environnements, leurs installations. */
export const CONSOLE_URL = 'https://developer.atlassian.com/console/myapps/';

/**
 * Ce site, publié par GitHub Pages depuis `site/public/` commité.
 *
 * L'adresse servie est celle du dépôt **transféré** (`Tradoooo/deja-vu-ci`) :
 * c'est elle qui répond, vérifié par un `curl` sur l'adresse publique.
 */
export const PAGES_URL = 'https://tradoooo.github.io/deja-vu-ci/';

/** Les vérifications nocturnes : le workflow réel, pas une intention. */
export const NIGHTLY_URL = `${REPO_URL}/actions/workflows/nightly.yml`;

/** La mémoire, en Forge SQL : ce que le magasin accepte et ce qu'il refuse. */
export const SQL_URL = `${REPO_URL}/blob/main/docs/FORGE-SQL-LIMITS.md`;

/** Les compteurs du rejeu déclenché **en production** par le bouton de l'app. */
export const REPLAY = { signatures: 15, failures: 40, comments: 11 } as const;

/**
 * Les diagnostics du rejeu de production, dans l'ordre où l'app les a rendus.
 *
 * `15 + 4 + 9 + 2 + 10 = 40` : la somme doit valoir `REPLAY.failures`, et le
 * test le vérifie — un relevé qui ne se recompte pas n'est pas un relevé.
 */
export const PROD_BY_KIND: ReadonlyArray<{ kind: DiagnosticKind; count: number }> = [
  { kind: 'flaky', count: 15 },
  { kind: 'new', count: 4 },
  { kind: 'infrastructure', count: 9 },
  { kind: 'already-fixed', count: 2 },
  { kind: 'uncertain', count: 10 },
];

/** L'incident d'infrastructure détecté en production (CI-15), et son ticket. */
export const INCIDENT = {
  /** L'identifiant court de la signature, tel que l'app l'affiche. */
  signature: 'S-168',
  /** La famille, en clair (8 premiers caractères du hachage). */
  familyHash: '414b5b36',
  repos: ['billing-service', 'payments-api', 'payments-web'],
  windowMinutes: 15,
  failures: 8,
} as const;

/** Le refus réel de Jira quand l'app a voulu écrire un ticket. */
export const REFUSAL_STATUS = 400;

/** La phrase que l'app a affichée en français au lieu de la cacher. */
export const REFUSAL_QUOTE = '« Jira a refusé l’écriture (HTTP 400) : … »';

/** Une ligne du tableau des compteurs : une clé de traduction et une valeur figée. */
export interface ObservationRow {
  labelKey: string;
  value: number;
}

/**
 * Les compteurs du relevé, dans l'ordre d'affichage.
 *
 * Le rendu itère **cette** liste : un chiffre du panneau ne peut donc pas
 * exister ailleurs que dans ce module, et le test vérifie qu'il y est.
 */
export function observationRows(): ObservationRow[] {
  return [
    { labelKey: 'counter.signatures', value: REPLAY.signatures },
    { labelKey: 'counter.failures', value: REPLAY.failures },
    { labelKey: 'counter.comments', value: REPLAY.comments },
  ];
}

/** Les diagnostics du relevé, tels que le rendu les parcourt. */
export function kindRows(): Array<{ kind: DiagnosticKind; count: number }> {
  return PROD_BY_KIND.map((row) => ({ ...row }));
}

/** Le compte d'un diagnostic dans le relevé (0 s'il n'apparaît pas). */
export function prodCount(kind: DiagnosticKind): number {
  return PROD_BY_KIND.find((row) => row.kind === kind)?.count ?? 0;
}

/** La somme des diagnostics : elle doit valoir le nombre d'échecs rejoués. */
export function prodTotal(): number {
  return PROD_BY_KIND.reduce((total, row) => total + row.count, 0);
}

/** Un des quatre environnements réels : ce qui y tourne, et son adresse. */
export interface EnvironmentFact {
  id: 'jira' | 'sql' | 'actions' | 'pages';
  href: string;
}

/** Les quatre environnements, dans l'ordre de lecture. */
export function environments(): EnvironmentFact[] {
  return [
    { id: 'jira', href: APP_PAGE_URL },
    { id: 'sql', href: SQL_URL },
    { id: 'actions', href: NIGHTLY_URL },
    { id: 'pages', href: PAGES_URL },
  ];
}

/** Une étape de reproduction : un titre et son texte, tous deux traduits. */
export interface ReproStep {
  titleKey: string;
  textKey: string;
}

/** Les étapes réelles, celles qui ont produit le relevé. */
export function reproSteps(): ReproStep[] {
  return [
    { titleKey: 'prod.repro.s1.title', textKey: 'prod.repro.s1.text' },
    { titleKey: 'prod.repro.s2.title', textKey: 'prod.repro.s2.text' },
    { titleKey: 'prod.repro.s3.title', textKey: 'prod.repro.s3.text' },
    { titleKey: 'prod.repro.s4.title', textKey: 'prod.repro.s4.text' },
  ];
}

/** Un lien de la section « reproduire » : un libellé traduit et une adresse réelle. */
export interface FactLink {
  labelKey: string;
  href: string;
}

/** Les documents du dépôt et la console, jamais recopiés : liés. */
export function reproLinks(): FactLink[] {
  return [
    { labelKey: 'prod.link.app', href: APP_PAGE_URL },
    { labelKey: 'prod.link.deploy', href: `${REPO_URL}/blob/main/docs/DEPLOY.md` },
    { labelKey: 'prod.link.judges', href: `${REPO_URL}/blob/main/docs/JUDGES.md` },
    { labelKey: 'prod.link.console', href: CONSOLE_URL },
    { labelKey: 'prod.link.repo', href: REPO_URL },
  ];
}
