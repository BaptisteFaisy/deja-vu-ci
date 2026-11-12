/**
 * Types du domaine Déjà-vu CI — CONTRAT GELÉ.
 *
 * Ce fichier est la référence unique : le Capteur (Bitbucket), le Cerveau
 * (Jira), les outils et le jeu d'exemple parlent tous ce vocabulaire.
 * Ne pas le modifier sans mettre à jour `docs/CONTRACTS.md` dans le même PR.
 *
 * Vocabulaire (cahier des charges § 4) :
 *  - Occurrence : un échec d'une étape de pipeline, à un commit donné.
 *  - Signature  : l'empreinte d'une erreur une fois retirés les détails variables.
 *  - Famille    : une signature plus lâche (sans la pile d'appels).
 *  - Diagnostic : la réponse donnée au développeur pour une occurrence.
 */

// ---------------------------------------------------------------------------
// Vocabulaire de base
// ---------------------------------------------------------------------------

/** Catégories d'erreur (§ 9.4). */
export type Category =
  | 'test'
  | 'compile'
  | 'style'
  | 'dependency'
  | 'infrastructure'
  | 'timeout'
  | 'config'
  | 'unknown';

/** Statut d'une signature (§ 4). */
export type SignatureStatus = 'new' | 'known' | 'flaky' | 'resolved' | 'regression';

/** Les quatre diagnostics, plus le repli prudent « incertain » (§ 5, § 18). */
export type DiagnosticKind =
  | 'flaky'
  | 'already-fixed'
  | 'new'
  | 'infrastructure'
  | 'uncertain';

/** Action proposée au développeur (§ 5). */
export type DiagnosticAction = 'retry' | 'rebase' | 'fix' | 'wait' | 'none';

/** Origine d'un bloc d'erreur : rapport de tests, journal, ou fin de journal. */
export type ExtractSource = 'report' | 'log' | 'tail';

// ---------------------------------------------------------------------------
// Extraction et normalisation (§ 9.1, § 9.2)
// ---------------------------------------------------------------------------

/** Une ligne de pile d'appels. */
export interface Frame {
  /** Fichier tel qu'il apparaît dans la pile (chemin relatif au dépôt si reconnu). */
  file: string;
  /** Fonction ou méthode, si connue. */
  fn?: string;
  /** Numéro de ligne d'origine (retiré de l'empreinte, gardé pour l'affichage). */
  line?: number;
  /** Vrai si le fichier appartient au dépôt (pas une dépendance, pas le runtime). */
  isProject: boolean;
}

/** Un cas de test échoué, issu d'un rapport de tests. */
export interface FailedTestCase {
  /** Nom complet du test (classe + méthode, ou chemin pytest). */
  name: string;
  message: string;
  stack?: string;
  classname?: string;
  durationMs?: number;
}

/** Un bloc d'erreur extrait, prêt à être normalisé puis signé. */
export interface ErrorBlock {
  category: Category;
  /** Type d'erreur reconnu : `AssertionError`, `ENOENT`, `ETIMEDOUT`, `OutOfMemory`… */
  errorType: string;
  /** Message normalisé (variable retirée). */
  message: string;
  /** Message d'origine, secrets masqués. */
  rawMessage: string;
  /** Pile réduite aux cinq premières lignes appartenant au projet. */
  frames: Frame[];
  /** Nom du test quand le bloc vient d'un rapport de tests. */
  testName?: string;
  source: ExtractSource;
  /** Texte brut du bloc (secrets masqués), borné à 50 Ko au total. */
  rawText: string;
}

/** Empreintes calculées pour un bloc (§ 9.3). */
export interface SignatureKey {
  /** Signature = catégorie + type + message normalisé + pile réduite. */
  signature: string;
  /** Famille = catégorie + type + message normalisé. */
  family: string;
}

// ---------------------------------------------------------------------------
// Mémoire (§ 16)
// ---------------------------------------------------------------------------

/** Une occurrence : un échec d'étape, à un commit. */
export interface Occurrence {
  id: string;
  signatureId: string;
  familyId: string;
  workspace: string;
  repo: string;
  branch: string;
  commit: string;
  author: string;
  prId?: number;
  stepName: string;
  durationS: number;
  buildUrl?: string;
  /** ISO-8601, UTC. */
  occurredAt: string;
  /** Vrai si la même étape a réussi au même commit après cet échec. */
  passedOnRetry: boolean;
  testName?: string;
  /** Fichiers modifiés par la PR, quand le Capteur les connaît. */
  changedFiles?: string[];
}

/** Une signature mémorisée. */
export interface Signature {
  /** Identifiant stable (hex court) — sert d'URL et de clé de ticket. */
  id: string;
  familyId: string;
  category: Category;
  errorType: string;
  /** Gabarit normalisé (message + pile réduite), pour l'affichage. */
  template: string;
  frames: Frame[];
  status: SignatureStatus;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  issueKey?: string;
  /** Nom du test quand la signature est de catégorie `test`. */
  testName?: string;
  /**
   * Version de l'algorithme de signature qui a produit `id` (§ 9.3).
   * Absent = version courante (`deja-vu-normalized-v1`). Voir
   * `docs/SIGNATURE-VERSIONING.md`.
   */
  algorithmVersion?: number;
}

/** Statistiques d'un test instable (§ 16 `test_stats`). */
export interface TestStats {
  repo: string;
  testName: string;
  runsFailed: number;
  runsPassedSameCommit: number;
  branches: number;
  /** Indice 0..1 : part des échecs sans modification pertinente (§ 10.1). */
  flakyIndex: number;
  updatedAt: string;
}

/** Une résolution : le commit qui a fait disparaître une signature (§ 10.5). */
export interface Resolution {
  id: string;
  signatureId: string;
  commit: string;
  author: string;
  files: string[];
  note?: string;
  /** 0..1 — faible tant qu'un humain n'a pas confirmé. */
  confidence: number;
  confirmedBy?: string;
  confirmedAt?: string;
}

/** Extrait brut conservé pour une durée réglable (§ 16 `raw_excerpt`, CI-18). */
export interface RawExcerpt {
  occurrenceId: string;
  text: string;
  expiresAt: string;
}

/** Épidémie d'infrastructure : même signature sur plusieurs dépôts (§ 10.3, CI-15). */
export interface Outbreak {
  id: string;
  familyId: string;
  startedAt: string;
  repos: string[];
  incidentKey?: string;
}

/** Ligne du cache de gabarits produits par le modèle de langage (§ 9.5). */
export interface LlmTemplateCacheEntry {
  normalizedHash: string;
  template: string;
  category: Category;
}

/** Liaison Capteur ↔ Cerveau (§ 16 `pairing`). */
export interface Pairing {
  workspace: string;
  /** Secret partagé du pont signé, rangé dans le stockage de secrets Forge. */
  secretId: string;
  pairedAt: string;
  pairedBy: string;
}

/** Réglages du projet Cerveau (§ 14 écran 5). */
export interface Settings {
  /** Projet Jira où créer les tickets de problème. */
  issueProjectKey: string;
  flakyMinOccurrences: number;
  flakyMinBranches: number;
  flakyWindowDays: number;
  outbreakRepos: number;
  outbreakWindowMin: number;
  rawRetentionDays: number;
  /** Seuil de confiance sous lequel on ne dit jamais « sans rapport avec ta PR ». */
  minConfidenceNotYourFault: number;
  /** Clé de l'entrée universelle (§ 15, CI-16). */
  universalKey?: string;
}

/** Réglages par défaut, alignés sur le cahier des charges. */
export const DEFAULT_SETTINGS: Settings = {
  issueProjectKey: 'CI',
  flakyMinOccurrences: 3,
  flakyMinBranches: 2,
  flakyWindowDays: 14,
  outbreakRepos: 3,
  outbreakWindowMin: 15,
  rawRetentionDays: 30,
  minConfidenceNotYourFault: 0.75,
};

// ---------------------------------------------------------------------------
// Diagnostic (§ 5, § 10)
// ---------------------------------------------------------------------------

/** Un fait affiché au développeur : « vu 17 fois sur 9 branches ». */
export interface DiagnosticFact {
  label: string;
  value: string;
}

/** La résolution citée par un diagnostic « déjà vu, déjà corrigé ». */
export interface ResolutionFact {
  commit: string;
  author: string;
  note?: string;
  files: string[];
  confirmed: boolean;
}

/** Le diagnostic rendu pour une occurrence. */
export interface Diagnostic {
  kind: DiagnosticKind;
  /** 0..1 — sous `minConfidenceNotYourFault`, l'app dit « incertain ». */
  confidence: number;
  /** Phrase courte pour la carte de PR. */
  title: string;
  /** Phrase complète, avec les faits. */
  summary: string;
  action: DiagnosticAction;
  facts: DiagnosticFact[];
  signatureId: string;
  /** Identifiant court affichable (`S-204`). */
  signatureShort: string;
  issueKey?: string;
  resolution?: ResolutionFact;
  /** Fichiers modifiés par la PR présents dans la pile (diagnostic « nouveau »). */
  suspects?: string[];
  stats?: DiagnosticStats;
  /** Faits bruts qui justifient le diagnostic (§ 18 « les faits toujours montrés »). */
  evidence?: string[];
}

export interface DiagnosticStats {
  occurrences: number;
  branches: number;
  repos: number;
  firstSeen: string;
  lastSeen: string;
  sameCommitPass?: boolean;
}

/** Contexte fourni au moteur de diagnostic. */
export interface DiagnoseContext {
  occurrence: Occurrence;
  /** Occurrences antérieures de la même signature (toutes branches). */
  history: Occurrence[];
  /** Occurrences de la même famille (variantes). */
  familyHistory: Occurrence[];
  resolution?: Resolution;
  /** Vrai si la branche courante contient déjà le commit de résolution. */
  branchContainsResolution: boolean;
  outbreak?: Outbreak;
  /** Fichiers modifiés par la PR. */
  changedFiles?: string[];
  settings?: Partial<Settings>;
}

// ---------------------------------------------------------------------------
// Verdicts intermédiaires
// ---------------------------------------------------------------------------

/** Verdict d'instabilité d'une signature de catégorie `test` (§ 10.1). */
export interface FlakyVerdict {
  flaky: boolean;
  /** Raisons lisibles, dans l'ordre des règles évaluées. */
  reasons: string[];
  occurrences: number;
  branches: number;
  /** Au moins un succès au même commit après un échec. */
  sameCommitPass: boolean;
  flakyIndex: number;
}

/** Résultat de l'extraction d'une étape (§ 9.1). */
export interface ExtractResult {
  blocks: ErrorBlock[];
  source: ExtractSource;
  /** Nombre de blocs distincts écartés (au-delà des trois premiers, § 19). */
  dropped: number;
}

// ---------------------------------------------------------------------------
// Entrées : Capteur → Cerveau, entrée universelle, carte de PR
// ---------------------------------------------------------------------------

/** Charge utile du Capteur (§ 8.1, § 15). */
export interface IngestPayload {
  version: 1;
  workspace: string;
  repository: string;
  branch: string;
  commit: string;
  author: string;
  prId?: number;
  stepName: string;
  stepUuid?: string;
  buildUrl?: string;
  buildNumber?: number;
  durationS: number;
  /** ISO-8601, UTC. */
  failedAt: string;
  /** Blocs d'erreur bruts, secrets masqués, 50 Ko au plus au total. */
  errorBlocks: string[];
  /** Cas de test échoués, quand le pipeline produit des rapports. */
  testCases?: FailedTestCase[];
  /** SHAs des commits de la branche, du plus récent au plus ancien (≤ 100). */
  branchHistory?: string[];
  /** Verdict d'ancêtre calculé par le Capteur quand il a pu le faire (§ 10.2). */
  containsResolution?: { commit: string; contains: boolean };
  /** Fichiers modifiés par la PR, quand connus. */
  changedFiles?: string[];
  /** Ticket Jira lié à la branche, quand il existe (§ 8.1 étape 5). */
  linkedIssueKey?: string;
}

/** Charge utile de l'entrée universelle (§ 15, CI-16). */
export interface UniversalPayload {
  /** Clé propre au projet, comparée au réglage `universalKey`. */
  projectKey: string;
  repository: string;
  branch: string;
  commit?: string;
  author?: string;
  step?: string;
  /** Extrait de journal (ou bloc d'erreur) envoyé par la CI de l'utilisateur. */
  log: string;
  testCases?: FailedTestCase[];
  failedAt?: string;
}

/** Demande de diagnostic pour la carte de PR (§ 14 écran 1). */
export interface QueryRequest {
  kind: 'pr-card';
  repository: string;
  branch: string;
  commit?: string;
}

/** Réponse du Cerveau à une demande de carte de PR. */
export interface QueryResponse {
  ok: boolean;
  diagnostic?: Diagnostic;
  /** Dernière occurrence connue de la branche, si elle existe. */
  lastFailureAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tickets (§ 11)
// ---------------------------------------------------------------------------

export type TicketActionKind = 'create' | 'update' | 'comment' | 'reopen' | 'close-suggested';

/** Une action à appliquer au ticket unique d'une famille (§ 11). */
export interface TicketAction {
  kind: TicketActionKind;
  familyId: string;
  signatureId: string;
  issueKey?: string;
  summary: string;
  description?: string;
  labels?: string[];
  /** Commentaire de synthèse — au plus un par jour et par ticket. */
  comment?: string;
  /** Propriétaire suggéré (auteur du correctif ou auteur de la PR). */
  assignee?: string;
  /** Vrai si un commentaire a déjà été publié aujourd'hui (frein de discrétion). */
  commentAlreadyToday?: boolean;
}

// ---------------------------------------------------------------------------
// Coût (§ 14 onglet Coût, CI-14)
// ---------------------------------------------------------------------------

export interface SignatureCost {
  signatureId: string;
  signatureShort: string;
  title: string;
  occurrences: number;
  ciMinutesLost: number;
  peopleAffected: number;
  retries: number;
}

export interface CostReport {
  redBuilds: number;
  ciMinutesLost: number;
  peopleAffected: number;
  retries: number;
  windowDays: number;
  perSignature: SignatureCost[];
}

// ---------------------------------------------------------------------------
// Jeu d'exemple rejouable (CI-11) et corpus étiqueté (§ 18)
// ---------------------------------------------------------------------------

export * from './types-data.js';
