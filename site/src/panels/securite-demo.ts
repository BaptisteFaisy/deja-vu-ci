/**
 * Logique du panneau « Sécurité » — pure, sans DOM, testée directement.
 *
 * Quatre démonstrations, toutes adossées au vrai code du dépôt :
 *  - le masquage (`maskSecrets` de `packages/core`, motifs par défaut +
 *    `extraPatterns` fournis par le visiteur) ;
 *  - le pont signé (`packages/bridge` : `signPayload`, `verifyRequest`,
 *    `rotateSecret`) — les refus sont les raisons réelles du produit ;
 *  - la minimisation (`packages/core/src/minimize` et la copie applicative
 *    `apps/brain/src/pure/excerptPolicy`, comparées politique par politique) ;
 *  - l'inventaire (`docs/SBOM.json`, le vrai fichier CycloneDX du dépôt).
 *
 * Aucun secret réel : les exemples sensibles sont **construits à l'exécution**
 * (jamais de littéral ressemblant à une clé dans les sources). Le nonce vient
 * de `randomBytes` — le vrai sous Node, le substitut navigateur vérifié sous
 * le bundle ; le formatage hexadécimal est fait ici car le substitut rend des
 * octets bruts (voir le rapport du lot).
 */

import { randomBytes } from 'node:crypto';
import { maskSecrets, type MaskResult } from '@dejavu/core';
import {
  BRIDGE_HEADERS,
  DEFAULT_MAX_SKEW_S,
  MAX_BODY_BYTES,
  rotateSecret,
  signPayload,
  verifyRequest,
  type BridgeSecret,
  type SecretSet,
  type VerifyResult,
} from '../../../packages/bridge/src/index';
import {
  MINIMIZE_POLICIES,
  minimizeExcerpt,
  type MinimizePolicy,
} from '../../../packages/core/src/minimize';
import { applyExcerptPolicy } from '../../../apps/brain/src/pure/excerptPolicy';
import { SAMPLE } from '../lib/demo';
import sbomFile from '../../../docs/SBOM.json';

/** Constantes du pont réexportées pour l'affichage (une seule source). */
export { BRIDGE_HEADERS, DEFAULT_MAX_SKEW_S, MAX_BODY_BYTES };

/* ------------------------------------------------------------------ */
/* Masquage                                                            */
/* ------------------------------------------------------------------ */

/** Un jeton factice : préfixe + `length` caractères alphanumériques. */
function fakeSecret(prefix: string, length: number, seed: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = prefix;
  for (let i = 0; i < length; i += 1) out += alphabet[(i * 31 + seed) % alphabet.length];
  return out;
}

/** Une clé factice en majuscules (le motif AWS n'accepte que `[0-9A-Z]`). */
function fakeUpperKey(prefix: string, length: number, seed: number): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = prefix;
  for (let i = 0; i < length; i += 1) out += alphabet[(i * 17 + seed) % alphabet.length];
  return out;
}

/** Le mot de passe factice des exemples (construit, jamais un littéral). */
const FAKE_PASSWORD = ['S3', 'cr3t', 'Pa55'].join('');

/**
 * L'exemple pré-rempli : un extrait de journal fictif qui contient un jeton
 * GitHub, une clé AWS, un mot de passe d'URL de connexion, une affectation
 * `password=`, un en-tête `Authorization`, une adresse e-mail et un
 * identifiant interne que seuls les motifs **supplémentaires** attrapent.
 */
export function fakeSampleText(): string {
  return [
    '[gradle test] com.payments.RefundLimiterTest > limitsRefundAmount FAILED',
    `export GITHUB_TOKEN=${fakeSecret(['ghp', ''].join('_'), 36, 7)}`,
    `aws configure set aws_access_key_id ${fakeUpperKey('AKIA', 16, 3)}`,
    `psql "postgres://deploy:${FAKE_PASSWORD}@db.internal:5432/payments"`,
    `curl -H "Authorization: Bearer ${fakeSecret('', 20, 11)}" hooks.internal/deploy`,
    `password=${FAKE_PASSWORD} ./scripts/deploy.sh`,
    'notify: alice.dupont@example.com (on-call)',
    'employee EMP-4821 approved the release',
  ].join('\n');
}

/** Le motif supplémentaire proposé au visiteur (identifiants internes). */
export const SUGGESTED_EXTRA = { source: 'EMP-[0-9]{4,}', kind: 'employee-id' };

/** Ce que rend la démonstration de masquage. */
export interface MaskDemo {
  /** Résultat avec les seuls motifs par défaut du produit. */
  base: MaskResult;
  /** Résultat avec le motif supplémentaire ajouté (si compile). */
  withExtra?: MaskResult;
  /** Message d'erreur si l'expression du visiteur est invalide. */
  error?: string;
}

/**
 * Masque `text` avec les motifs par défaut, puis avec le motif supplémentaire
 * du visiteur ajouté (`extraPatterns` s'ajoute **sans jamais retirer** les
 * motifs par défaut — c'est le contrat de `maskSecrets`).
 */
export function runMaskDemo(text: string, extraSource: string, extraKind: string): MaskDemo {
  const base = maskSecrets(text);
  if (!extraSource.trim()) return { base };
  let re: RegExp;
  try {
    re = new RegExp(extraSource, 'g');
  } catch (error) {
    return { base, error: error instanceof Error ? error.message : String(error) };
  }
  const kind = extraKind.trim() || 'custom';
  return { base, withExtra: maskSecrets(text, { extraPatterns: [{ kind, re }] }) };
}

/* ------------------------------------------------------------------ */
/* Pont signé                                                          */
/* ------------------------------------------------------------------ */

/** Le secret partagé de la démonstration — fictif, construit à l'exécution. */
export const DEMO_SECRET = ['deja', 'vu', 'demo', 'bridge'].join('-');

/** Un autre secret fictif, pour la démonstration du mauvais secret. */
export const OTHER_SECRET = ['autre', 'cle', 'fictive', 'demo'].join('-');

/** Le secret qui remplace `DEMO_SECRET` à la rotation. */
export const NEXT_SECRET = ['cle', 'suivante', 'fictive', 'demo'].join('-');

/** Nonce hexadécimal (32 caractères) tiré de `randomBytes` — Node ou substitut. */
export function demoNonce(): string {
  return Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Une requête signée par le produit, prête à vérifier. */
export interface SignedRequest {
  body: string;
  headers: Record<string, string>;
  secret: BridgeSecret;
  now: Date;
}

/** Le premier échec du jeu d'exemple suivi par git. */
function firstFailure() {
  const failure = SAMPLE.occurrences.find((o) => o.outcome === 'failure' && o.log);
  if (!failure) throw new Error('jeu d’exemple : aucun échec avec journal');
  return failure;
}

/** La charge utile signée : l'identité réelle du premier échec du jeu. */
export function demoPayload(): Record<string, string> {
  const o = firstFailure();
  return { kind: 'ingest', repo: o.repo, commit: o.commit, step: o.step, outcome: o.outcome };
}

/** Signe une charge avec `signPayload` (nonce tiré de `randomBytes`). */
export function signDemo(
  secret: BridgeSecret,
  now: Date,
  payload: unknown = demoPayload(),
): SignedRequest {
  const { body, headers } = signPayload(payload, secret, { now, nonce: demoNonce() });
  return { body, headers, secret, now };
}

/** Vérifie une requête signée avec l'horloge de la démonstration. */
export function verifyDemo(request: SignedRequest, secret?: BridgeSecret): VerifyResult {
  return verifyRequest(request.headers, request.body, secret ?? request.secret, { now: request.now });
}

/** Les scénarios de refus réels, un par bouton dans le panneau. */
export interface Scenario {
  id: string;
  labelKey: string;
  /** La raison attendue, telle que le produit la renvoie (test). */
  expectReason: string;
  run(request: SignedRequest): VerifyResult;
}

/** Un corps altéré : la même enveloppe, `outcome` retourné en `success`. */
function tamperedBody(request: SignedRequest): string {
  const body = request.body.replace('"failure"', '"success"');
  return body === request.body ? `${request.body.slice(0, -1)}x}` : body;
}

/** Les refus qui portent sur le corps, le temps ou le nonce. */
function bodyScenarios(): Scenario[] {
  return [
    {
      id: 'tampered',
      labelKey: 'securite.scenario.tampered',
      expectReason: 'signature invalide',
      run: (r) => verifyRequest(r.headers, tamperedBody(r), r.secret, { now: r.now }),
    },
    {
      id: 'stale',
      labelKey: 'securite.scenario.stale',
      expectReason: `horodatage hors fenêtre (±${DEFAULT_MAX_SKEW_S} s)`,
      run: (r) => {
        const old = new Date(r.now.getTime() - (DEFAULT_MAX_SKEW_S + 120) * 1000);
        const signed = signDemo(r.secret, old);
        return verifyRequest(signed.headers, signed.body, signed.secret, { now: r.now });
      },
    },
    {
      id: 'replay',
      labelKey: 'securite.scenario.replay',
      expectReason: 'nonce déjà consommé (rejeu)',
      run: (r) =>
        verifyRequest(r.headers, r.body, r.secret, {
          now: r.now,
          seenNonce: (nonce) => nonce === r.headers[BRIDGE_HEADERS.nonce],
        }),
    },
  ];
}

/** Les refus qui portent sur le secret, la taille ou les en-têtes. */
function keyScenarios(): Scenario[] {
  return [
    {
      id: 'wrong-secret',
      labelKey: 'securite.scenario.wrongSecret',
      expectReason: 'signature invalide',
      run: (r) => verifyRequest(r.headers, r.body, OTHER_SECRET, { now: r.now }),
    },
    {
      id: 'huge',
      labelKey: 'securite.scenario.huge',
      expectReason: 'corps trop gros',
      run: (r) => verifyRequest(r.headers, 'x'.repeat(MAX_BODY_BYTES + 1), r.secret, { now: r.now }),
    },
    {
      id: 'missing-header',
      labelKey: 'securite.scenario.missingHeader',
      expectReason: 'en-tête de signature incomplet',
      run: (r) => {
        const headers = { ...r.headers };
        delete headers[BRIDGE_HEADERS.nonce];
        return verifyRequest(headers, r.body, r.secret, { now: r.now });
      },
    },
  ];
}

/** Les six refus du produit, construits avec son propre code. */
export function refusalScenarios(): Scenario[] {
  return [...bodyScenarios(), ...keyScenarios()];
}

/** La démonstration de rotation de clé, avec le vrai `rotateSecret`. */
export interface RotationDemo {
  /** L'ensemble tourné : `[nouvelle clé, ancienne]` — la première signe. */
  set: SecretSet;
  /** Message signé AVANT la rotation (ancienne clé seule). */
  oldRequest: SignedRequest;
  /** Message signé APRÈS la rotation (nouvelle clé active). */
  newRequest: SignedRequest;
  /** Pendant le chevauchement, l'ancien message reste accepté. */
  oldAccepted: VerifyResult;
  /** Le nouveau message est accepté par l'ensemble tourné. */
  newAccepted: VerifyResult;
  /** Hors chevauchement (nouvelle clé seule), l'ancien message est refusé. */
  oldWithoutOverlap: VerifyResult;
}

/** Construit la rotation : l'ancienne clé reste acceptée pendant le chevauchement. */
export function rotationDemo(now: Date): RotationDemo {
  const oldRequest = signDemo(DEMO_SECRET, now);
  const set = rotateSecret(DEMO_SECRET, NEXT_SECRET);
  const newRequest = signDemo(set, now);
  return {
    set,
    oldRequest,
    newRequest,
    oldAccepted: verifyRequest(oldRequest.headers, oldRequest.body, set, { now }),
    newAccepted: verifyRequest(newRequest.headers, newRequest.body, set, { now }),
    oldWithoutOverlap: verifyRequest(oldRequest.headers, oldRequest.body, NEXT_SECRET, { now }),
  };
}

/* ------------------------------------------------------------------ */
/* Minimisation                                                        */
/* ------------------------------------------------------------------ */

/** Ce qui survit à une politique (forme commune au moteur et au Cerveau). */
export interface Minimized {
  fingerprint: string;
  text?: string;
  masked: boolean;
  truncated: boolean;
  bytes: number;
}

/** Une ligne du tableau de minimisation. */
export interface MinimizationRow {
  policy: MinimizePolicy;
  engine: Minimized;
  brain: Minimized;
  agree: boolean;
}

/** L'extrait minimisé : le journal brut réel du premier échec du jeu. */
export function sampleExcerpt(): string {
  return firstFailure().log ?? '';
}

/** Les trois politiques, appliquées au même extrait par le moteur et le Cerveau. */
export function minimizationRows(): MinimizationRow[] {
  const text = sampleExcerpt();
  return MINIMIZE_POLICIES.map((policy) => {
    const engine: Minimized = minimizeExcerpt({ text }, policy);
    const brain: Minimized = applyExcerptPolicy({ text }, policy);
    return { policy, engine, brain, agree: JSON.stringify(engine) === JSON.stringify(brain) };
  });
}

/* ------------------------------------------------------------------ */
/* Inventaire (SBOM)                                                   */
/* ------------------------------------------------------------------ */

/** Une ligne du tableau d'inventaire. */
export interface SbomRow {
  name: string;
  version: string;
  /** Licences déclarées dans le SBOM (vide = non déclarée). */
  licenses: string;
  firstParty: boolean;
}

interface SbomComponent {
  type?: string;
  name?: string;
  version?: string;
  licenses?: Array<{ license?: { name?: string }; expression?: string }>;
  properties?: Array<{ name?: string; value?: string }>;
}

interface SbomFile {
  components?: SbomComponent[];
  metadata?: { component?: { licenses?: SbomComponent['licenses'] } };
}

/** La licence du dépôt (celle du composant racine du SBOM), sinon ''. */
function repoLicense(file: SbomFile): string {
  const licenses = file.metadata?.component?.licenses ?? [];
  return licenses.map((l) => l.license?.name ?? l.expression ?? '').filter(Boolean).join(', ');
}

/**
 * Les composants du vrai `docs/SBOM.json` : les paquets internes héritent de
 * la licence du dépôt (MIT), les tiers affichent ce que le SBOM déclare — et
 * rien d'autre (une licence absente reste absente, voir `docs/THIRD-PARTY.md`).
 */
export function sbomRows(): SbomRow[] {
  const file = sbomFile as SbomFile;
  const repo = repoLicense(file);
  return (file.components ?? []).map((component) => {
    const declared = (component.licenses ?? [])
      .map((l) => l.license?.name ?? l.expression ?? '')
      .filter(Boolean)
      .join(', ');
    const firstParty = (component.properties ?? []).some(
      (p) => p.name === 'dejavu:first-party' && p.value === 'true',
    );
    return {
      name: component.name ?? '?',
      version: component.version ?? '?',
      licenses: declared || (firstParty ? repo : ''),
      firstParty,
    };
  });
}
