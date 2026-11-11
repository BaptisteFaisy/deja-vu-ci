/**
 * Memory store for Déjà-vu CI.
 *
 * The engine never talks to a database directly: it talks to the `Store`
 * interface. `MemoryStore` is the in-memory implementation used by the
 * replay tool, the tests and the sample dataset. The Cerveau (Jira app)
 * swaps it for the Forge SQL adapter built on `SQL_SCHEMA`.
 *
 * Everything is deterministic: listings are sorted with a total order so that
 * two runs on the same data always produce the same output.
 */

import {
  DEFAULT_SETTINGS,
  type Occurrence,
  type Outbreak,
  type RawExcerpt,
  type Resolution,
  type Settings,
  type Signature,
  type TestStats,
} from './types.js';

/** The persistence contract used by the engine (§ 16). */
export interface Store {
  saveSignature(s: Signature): Promise<void>;
  getSignature(id: string): Promise<Signature | undefined>;
  listSignatures(): Promise<Signature[]>;
  findSignaturesByFamily(familyId: string): Promise<Signature[]>;
  saveOccurrence(o: Occurrence): Promise<void>;
  listOccurrences(signatureId: string): Promise<Occurrence[]>;
  listFamilyOccurrences(familyId: string): Promise<Occurrence[]>;
  saveResolution(r: Resolution): Promise<void>;
  getResolution(signatureId: string): Promise<Resolution | undefined>;
  saveRawExcerpt(e: RawExcerpt): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listTestStats(repo?: string): Promise<TestStats[]>;
  saveTestStats(t: TestStats): Promise<void>;
  saveOutbreak(o: Outbreak): Promise<void>;
  findOutbreak(familyId: string): Promise<Outbreak | undefined>;
}

/** Seed accepted by the `MemoryStore` constructor. */
export interface StoreSeed {
  signatures?: Signature[];
  occurrences?: Occurrence[];
  resolutions?: Resolution[];
}

/** Signatures: most recently seen first, ties broken by id. */
function compareSignatures(a: Signature, b: Signature): number {
  if (a.lastSeen !== b.lastSeen) return a.lastSeen < b.lastSeen ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Occurrences: oldest first, ties broken by id. */
function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Test statistics: flakiest first, ties broken by repository and test name. */
function compareTestStats(a: TestStats, b: TestStats): number {
  if (a.flakyIndex !== b.flakyIndex) return b.flakyIndex - a.flakyIndex;
  if (a.repo !== b.repo) return a.repo < b.repo ? -1 : 1;
  return a.testName < b.testName ? -1 : a.testName > b.testName ? 1 : 0;
}

/** Outbreaks: most recent first, ties broken by id. */
function compareOutbreaks(a: Outbreak, b: Outbreak): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** In-memory implementation of {@link Store}. */
export class MemoryStore implements Store {
  private readonly signatures = new Map<string, Signature>();
  private readonly occurrences = new Map<string, Occurrence>();
  private readonly resolutions = new Map<string, Resolution>();
  private readonly excerpts = new Map<string, RawExcerpt>();
  private readonly testStats = new Map<string, TestStats>();
  private readonly outbreaks = new Map<string, Outbreak>();
  private settings: Settings;

  constructor(seed?: StoreSeed) {
    this.settings = { ...DEFAULT_SETTINGS };
    for (const s of seed?.signatures ?? []) this.signatures.set(s.id, s);
    for (const o of seed?.occurrences ?? []) this.occurrences.set(o.id, o);
    for (const r of seed?.resolutions ?? []) this.resolutions.set(r.signatureId, r);
  }

  async saveSignature(s: Signature): Promise<void> {
    this.signatures.set(s.id, s);
  }

  async getSignature(id: string): Promise<Signature | undefined> {
    return this.signatures.get(id);
  }

  async listSignatures(): Promise<Signature[]> {
    return [...this.signatures.values()].sort(compareSignatures);
  }

  async findSignaturesByFamily(familyId: string): Promise<Signature[]> {
    return (await this.listSignatures()).filter((s) => s.familyId === familyId);
  }

  async saveOccurrence(o: Occurrence): Promise<void> {
    this.occurrences.set(o.id, o);
  }

  async listOccurrences(signatureId: string): Promise<Occurrence[]> {
    return [...this.occurrences.values()]
      .filter((o) => o.signatureId === signatureId)
      .sort(compareOccurrences);
  }

  async listFamilyOccurrences(familyId: string): Promise<Occurrence[]> {
    return [...this.occurrences.values()]
      .filter((o) => o.familyId === familyId)
      .sort(compareOccurrences);
  }

  async saveResolution(r: Resolution): Promise<void> {
    this.resolutions.set(r.signatureId, r);
  }

  async getResolution(signatureId: string): Promise<Resolution | undefined> {
    return this.resolutions.get(signatureId);
  }

  async saveRawExcerpt(e: RawExcerpt): Promise<void> {
    this.excerpts.set(e.occurrenceId, e);
  }

  async purgeExpired(now: Date): Promise<number> {
    const limit = now.getTime();
    let removed = 0;
    for (const [id, excerpt] of this.excerpts) {
      if (new Date(excerpt.expiresAt).getTime() < limit) {
        this.excerpts.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async saveSettings(s: Settings): Promise<void> {
    this.settings = { ...s };
  }

  async listTestStats(repo?: string): Promise<TestStats[]> {
    const all = [...this.testStats.values()];
    const filtered = repo === undefined ? all : all.filter((t) => t.repo === repo);
    return filtered.sort(compareTestStats);
  }

  async saveTestStats(t: TestStats): Promise<void> {
    this.testStats.set(`${t.repo}::${t.testName}`, t);
  }

  async saveOutbreak(o: Outbreak): Promise<void> {
    this.outbreaks.set(o.id, o);
  }

  async findOutbreak(familyId: string): Promise<Outbreak | undefined> {
    const matches = [...this.outbreaks.values()].filter((o) => o.familyId === familyId);
    if (matches.length === 0) return undefined;
    return matches.sort(compareOutbreaks)[0];
  }
}

/**
 * Forge SQL schema of the Cerveau memory (§ 16).
 *
 * Limits of the platform: 1 GiB per installation, 5 s per SELECT, and no
 * foreign keys. The two indexes below are the ones the screens rely on:
 * `signature.family_id` (lookup by family) and
 * `occurrence(signature_id, occurred_at)` (history of one signature).
 */
export const SQL_SCHEMA: string = `-- Déjà-vu CI — memory schema (Forge SQL, Jira side).
-- Platform limits: 1 GiB per installation and 5 s per SELECT.
-- Referential integrity is kept by the engine itself: Forge SQL declares no
-- such constraint, so the code never relies on one.
-- Only Forge SQL types are used: VARCHAR, INT, BIGINT, TEXT and TIMESTAMP.
-- Ratios (flaky index, confidence) are stored as BIGINT per mille.

CREATE TABLE signature (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL,
  category VARCHAR(32) NOT NULL,
  error_type VARCHAR(128) NOT NULL,
  template TEXT,
  frames_json TEXT,
  status VARCHAR(32) NOT NULL,
  first_seen TIMESTAMP NOT NULL,
  last_seen TIMESTAMP NOT NULL,
  occurrences INT NOT NULL DEFAULT 0,
  issue_key VARCHAR(64),
  test_name VARCHAR(256)
);

CREATE INDEX signature_family_id ON signature (family_id);

CREATE TABLE occurrence (
  id VARCHAR(64) PRIMARY KEY,
  signature_id VARCHAR(64) NOT NULL,
  family_id VARCHAR(64) NOT NULL,
  workspace VARCHAR(128) NOT NULL,
  repo VARCHAR(256) NOT NULL,
  branch VARCHAR(256) NOT NULL,
  commit_sha VARCHAR(64) NOT NULL,
  author VARCHAR(256) NOT NULL,
  pr_id INT,
  step_name VARCHAR(256) NOT NULL,
  duration_s INT NOT NULL DEFAULT 0,
  build_url VARCHAR(1024),
  occurred_at TIMESTAMP NOT NULL,
  passed_on_retry INT NOT NULL DEFAULT 0,
  test_name VARCHAR(256),
  changed_files_json TEXT
);

CREATE INDEX occurrence_signature_occurred ON occurrence (signature_id, occurred_at);

CREATE TABLE test_stats (
  repo VARCHAR(256) NOT NULL,
  test_name VARCHAR(256) NOT NULL,
  runs_failed INT NOT NULL DEFAULT 0,
  runs_passed_same_commit INT NOT NULL DEFAULT 0,
  branches INT NOT NULL DEFAULT 0,
  flaky_index BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (repo, test_name)
);

CREATE TABLE resolution (
  id VARCHAR(64) PRIMARY KEY,
  signature_id VARCHAR(64) NOT NULL,
  commit_sha VARCHAR(64) NOT NULL,
  author VARCHAR(256) NOT NULL,
  files_json TEXT,
  note TEXT,
  confidence BIGINT NOT NULL DEFAULT 0,
  confirmed_by VARCHAR(256),
  confirmed_at TIMESTAMP
);

CREATE TABLE raw_excerpt (
  occurrence_id VARCHAR(64) PRIMARY KEY,
  text TEXT,
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE llm_template_cache (
  normalized_hash VARCHAR(64) PRIMARY KEY,
  template TEXT,
  category VARCHAR(32) NOT NULL
);

CREATE TABLE outbreak (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  repos_json TEXT,
  incident_key VARCHAR(64)
);

CREATE TABLE pairing (
  workspace VARCHAR(128) PRIMARY KEY,
  secret_id VARCHAR(256) NOT NULL,
  paired_at TIMESTAMP NOT NULL,
  paired_by VARCHAR(256) NOT NULL
);

CREATE TABLE settings (
  project_key VARCHAR(128) PRIMARY KEY,
  issue_project_key VARCHAR(32) NOT NULL,
  flaky_min_occurrences INT NOT NULL DEFAULT 3,
  flaky_min_branches INT NOT NULL DEFAULT 2,
  flaky_window_days INT NOT NULL DEFAULT 14,
  outbreak_repos INT NOT NULL DEFAULT 3,
  outbreak_window_min INT NOT NULL DEFAULT 15,
  raw_retention_days INT NOT NULL DEFAULT 30,
  min_confidence_not_your_fault BIGINT NOT NULL DEFAULT 750,
  universal_key VARCHAR(256),
  updated_at TIMESTAMP NOT NULL
);
`;
