/**
 * The Brain's own tables (§ 16 complement, lot brain-views).
 *
 * The engine's `SQL_SCHEMA` is a frozen contract: it declares the nine tables of
 * the data model and nothing else. The two tables this lot needs — the journal of
 * what the app did, and the retention policy the frozen `Settings` type cannot
 * carry — belong to the **app**, not to the engine. They are declared here, and
 * the migration runs them right after the engine's schema.
 *
 * The migration stays additive and idempotent: every statement is run on each
 * cold start and an "already exists" answer is ignored, exactly like the engine's
 * own DDL (`ensureSchema` in `src/sql.ts`). An existing installation gains the two
 * tables on its next start; nothing is migrated, nothing is rewritten.
 *
 * Only Forge SQL types are used (VARCHAR, INT, BIGINT, TEXT, TIMESTAMP), there is
 * no referential constraint, and the journal is read with a `LIMIT` on an indexed
 * column so the tab stays inside the platform's 5 s per SELECT.
 */

/** The DDL of the app's own tables. */
export const APP_SCHEMA: string = `-- Déjà-vu CI — the Brain's own tables (lot brain-views).
-- The journal of what the app did, and the policy the frozen Settings type
-- cannot carry. Platform limits: 1 GiB per installation, 5 s per SELECT.
-- No foreign key; only VARCHAR, INT, BIGINT, TEXT and TIMESTAMP.

CREATE TABLE audit_log (
  id VARCHAR(64) PRIMARY KEY,
  action_kind VARCHAR(64) NOT NULL,
  signature_id VARCHAR(64),
  issue_key VARCHAR(64),
  detail TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX audit_log_created_at ON audit_log (created_at);

CREATE TABLE app_policy (
  project_key VARCHAR(128) PRIMARY KEY,
  excerpt_policy VARCHAR(32) NOT NULL,
  last_purge_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL
);
`;

/** The tables the app adds to the engine's data model. */
export const APP_TABLES = ['audit_log', 'app_policy'] as const;
