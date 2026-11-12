/**
 * Les données du panneau « Entrée universelle » — pures, sans DOM.
 *
 * La charge utile est construite **une seule fois** : le formulaire, la
 * validation, le masquage et les commandes affichées lisent tous ces
 * fonctions — aucune copie à la main, aucun chiffre inventé.
 *
 * La validation est celle du produit (`parseUniversalPayload`, dans
 * `packages/core/src/universal.ts`) : elle est stricte et nomme le champ
 * fautif. Le masquage est celui du produit aussi (`maskSecrets`), et la
 * troncature vient du module universel (`truncateBytes`, 50 KiB).
 *
 * Module pur : aucun import du DOM, donc testable dans `site/test/`.
 */

import { MAX_LOG_BYTES, maskSecrets, parseUniversalPayload, truncateBytes } from '@dejavu/core';
import type { UniversalPayload } from '@dejavu/core';

/** Ce que le visiteur saisit dans le formulaire. */
export interface FormValues {
  /** Clé de projet : jamais affichée, jamais envoyée depuis cette page. */
  projectKey: string;
  /** Dépôt (`owner/name`). */
  repository: string;
  /** Branche du build en échec. */
  branch: string;
  /** Commit SHA, quand il est connu. */
  commit: string;
  /** Nom de l'étape ou du job. */
  step: string;
  /** Durée en secondes, telle que la CI la rapporte. */
  durationS: string;
  /** Résultat du build : `failure` ou `success`. */
  outcome: string;
  /** Le journal lui-même. */
  log: string;
}

/** La clé de projet n'est jamais réaffichée : ce marqueur la remplace. */
export const KEY_PLACEHOLDER = '<PROJECT_KEY>';

/** Un exemple de journal, par écosystème. */
export interface Exemple {
  /** Identifiant technique de l'exemple. */
  id: string;
  /** Clé de traduction de son libellé. */
  labelKey: string;
  /** Les valeurs du formulaire pour cet exemple. */
  values: FormValues;
}

/** Les exemples proposés : un par écosystème supporté. */
export const EXEMPLES: Exemple[] = [
  {
    id: 'github',
    labelKey: 'universel.example.github',
    values: {
      projectKey: 'placeholder-project-key',
      repository: 'octo/payments',
      branch: 'main',
      commit: '9f3c1ab',
      step: 'make test',
      durationS: '4',
      outcome: 'failure',
      log: [
        '##[group]Run make test',
        'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
        'FAILED tests/test_checkout.py::TestCheckout::test_refund - assert 42 == 43',
        'Error: Process completed with exit code 1.',
        'Duration: 4.20 seconds',
        '##[endgroup]',
        'contact: dev@example.org',
      ].join('\n'),
    },
  },
  {
    id: 'gitlab',
    labelKey: 'universel.example.gitlab',
    values: {
      projectKey: 'placeholder-project-key',
      repository: 'octo/payments',
      branch: 'feature/checkout',
      commit: '4d81f02',
      step: 'pytest',
      durationS: '12',
      outcome: 'failure',
      log: [
        'section_start:1710000000:test',
        '$ make test',
        'export DEPLOY_TOKEN=glpat-abcdefghijklmnopqrstuvwx',
        'ERROR: Job failed: exit code 1',
        'Duration: 12.34 seconds',
      ].join('\n'),
    },
  },
  {
    id: 'jenkins',
    labelKey: 'universel.example.jenkins',
    values: {
      projectKey: 'placeholder-project-key',
      repository: 'octo/payments',
      branch: 'release/2.4',
      commit: 'c07be51',
      step: 'Build and test',
      durationS: '185',
      outcome: 'failure',
      log: [
        '[Pipeline] { (Build)',
        "sh 'make build && make test'",
        'ERROR: script returned exit code 3',
        'Total duration: 3 min 5 sec',
      ].join('\n'),
    },
  },
  {
    id: 'autre',
    labelKey: 'universel.example.autre',
    values: {
      projectKey: 'placeholder-project-key',
      repository: 'mon-service/paie',
      branch: 'main',
      commit: 'b1a2c3d',
      step: 'npm test',
      durationS: '9',
      outcome: 'failure',
      log: [
        '$ npm test',
        'FAIL tests/checkout.test.js',
        '  AssertionError: expected 42 to be 43',
        'exit status 1',
      ].join('\n'),
    },
  },
];

/** Les valeurs de départ du formulaire (aucune clé réelle). */
export function defaultValues(): FormValues {
  const premier = EXEMPLES[0].values;
  return { ...premier };
}

/**
 * La charge utile telle qu'elle est envoyée : les champs du contrat, plus les
 * deux extras que le contrat tolère (`additionalProperties: true`).
 */
export function bodyOf(values: FormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    projectKey: values.projectKey,
    repository: values.repository,
    branch: values.branch,
    step: values.step,
    log: values.log,
  };
  if (values.commit.trim()) body.commit = values.commit.trim();
  const duration = Number(values.durationS);
  if (Number.isFinite(duration) && duration > 0) body.durationS = duration;
  if (values.outcome) body.outcome = values.outcome;
  return body;
}

/** Le résultat de la validation réelle. */
export type Validation =
  | { ok: true; payload: UniversalPayload; body: Record<string, unknown> }
  | { ok: false; error: string; body: Record<string, unknown> };

/**
 * Valide la charge utile avec le validateur du produit.
 *
 * En cas de refus, la raison exacte est renvoyée : elle nomme le champ
 * fautif, comme le fait l'app.
 */
export function validate(values: FormValues): Validation {
  const body = bodyOf(values);
  const resultat = parseUniversalPayload(body);
  if (!resultat.ok) return { ok: false, error: resultat.error, body };
  return { ok: true, payload: resultat.payload, body };
}

/** La charge utile telle qu'elle quitterait la machine. */
export interface MaskedPayload {
  /** La charge masquée et tronquée, clé remplacée (prête pour `JSON.stringify`). */
  payload: Record<string, unknown>;
  /** Le même objet, en JSON indenté. */
  text: string;
  /** Combien de secrets ont été masqués. */
  masked: number;
  /** Les familles de secrets trouvées. */
  kinds: string[];
  /** Vrai quand le journal a été tronqué à 50 KiB. */
  truncated: boolean;
}

/** La charge utile masquée, tronquée, sans la clé de projet. */
export function maskPayload(payload: UniversalPayload): MaskedPayload {
  const log = truncateBytes(payload.log, MAX_LOG_BYTES);
  const masque = maskSecrets(log);
  const cases = (payload.testCases ?? []).map((cas) => ({
    ...cas,
    message: maskSecrets(cas.message).text,
    stack: cas.stack === undefined ? undefined : maskSecrets(cas.stack).text,
  }));
  const nettoye: Record<string, unknown> = {
    ...payload,
    projectKey: KEY_PLACEHOLDER,
    log: masque.text,
  };
  if (cases.length > 0) nettoye.testCases = cases;
  return {
    payload: nettoye,
    text: JSON.stringify(nettoye, null, 2),
    masked: masque.masked,
    kinds: masque.kinds,
    truncated: log.length !== payload.log.length,
  };
}

