/**
 * Les adaptateurs de journaux CI — **le vrai code** de `integrations/adapters`.
 *
 * Le panneau montre un journal brut de GitHub Actions et la charge utile que
 * l'adaptateur en tire : l'adaptateur du dépôt est appelé dans le navigateur
 * (aucune réécriture, aucun résultat recopié). Les modules sont publiés en
 * JavaScript, sans déclarations de types : c'est la seule ligne non typée du
 * site, et elle est assumée.
 */

// @ts-expect-error — les adaptateurs sont publiés en JavaScript, sans types.
import { fromGitHub, toUniversalPayload } from '../../../integrations/adapters/index.js';

import { KEY_PLACEHOLDER } from './universel-donnees';
import type { UniversalPayload } from '@dejavu/core';

/** Ce que l'adaptateur tire d'un journal brut. */
export interface AdapterReport {
  /** Le format reconnu (`github-actions`). */
  format: string;
  /** Le dépôt, tel que passé en entrée. */
  repository: string;
  /** La branche, telle que passée en entrée. */
  branch: string;
  /** Le commit, tel que passé en entrée. */
  commit: string;
  /** L'auteur, tel que passé en entrée. */
  author: string;
  /** L'étape : lue dans le journal quand elle y est. */
  step: string;
  /** Le journal, borné à 50 KiB. */
  log: string;
  /** La durée en secondes, lue dans le journal. */
  durationS?: number;
  /** Le code de sortie, lu dans le journal. */
  exitCode?: number;
  /** Les tests en échec, lus dans le journal. */
  testCases: Array<{ name: string; message: string }>;
}

/** L'entrée de l'adaptateur : un journal brut et le contexte du dépôt. */
export interface AdapterInput {
  log: string;
  repository: string;
  branch: string;
  commit: string;
}

/** Un journal brut de GitHub Actions, avec de quoi montrer le masquage. */
export const GITHUB_LOG = [
  '##[group]Run make test',
  'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  'FAILED tests/test_checkout.py::TestCheckout::test_refund - assert 42 == 43',
  'FAILED tests/test_refund.py::TestRefund::test_total - assert 7 == 9',
  'Error: Process completed with exit code 1.',
  'Duration: 4.20 seconds',
  '##[endgroup]',
].join('\n');

/** Le rapport que l'adaptateur tire du journal brut. */
export function adaptGitHub(input: AdapterInput): AdapterReport {
  return fromGitHub(input) as AdapterReport;
}

/** La charge utile que l'adaptateur produit, clé de projet remplacée. */
export function adapterPayload(report: AdapterReport): UniversalPayload {
  return toUniversalPayload(report, KEY_PLACEHOLDER) as UniversalPayload;
}
