# BRAIN-VIEWS — the memory becomes operable

This document describes what the `brain-views` lot adds to the Jira app
(`apps/brain`). Everything is reached through the **existing** project page: no
new UI module was declared in the manifest, only new `invoke()` names and the
resolvers behind them.

| Panel / tab | Requirement | Where the logic lives |
|---|---|---|
| Incident in progress | CI-15 | `src/pure/incident.ts` |
| Daily cost trend | CI-14 | `src/pure/costTrend.ts` |
| Export the memory | § 14 | `src/pure/exportMemory.ts` |
| What the app did (journal) | § 14 | `src/pure/auditLog.ts` |
| Raw-excerpt retention policy | § 18, CI-18 | `src/pure/excerptPolicy.ts` |
| Memory health | § 16 | `src/pure/memoryHealth.ts` |

Every module above is **pure** (no `@forge/*`, no network) and unit-tested in
`apps/brain/test/`. The `.tsx` components only place the values they return.

## New `invoke()` names

The UI Kit resolver of the app dispatches on the invoke name
(`src/resolvers.ts`). Three names were added, all far below the 23-character
limit of a function key, and all served by the one existing resolver function
(`projectPageResolver`) — so `manifest.yml` is unchanged:

| Name | Reads |
|---|---|
| `audit-log` | the last 100 journal lines, newest first |
| `memory-export` | the memory as one CSV or JSON document (`{ format }`) |
| `memory-health` | row counts, occupancy, oldest failure, last purge |

`memory-page` (the existing resolver) now also carries `incident` and
`costTrend`, so the project page still reads its memory in one call.

## 1. Incident in progress (CI-15)

The engine already detects infrastructure outbreaks (`detectOutbreak`: the same
family on ≥ `outbreakRepos` repositories within `outbreakWindowMin` minutes).
The panel is assembled by running that same detector over every family of the
memory and keeping the strongest incident (most repositories, then earliest
start). It shows the family and its readable signature id, the repositories hit,
the detection window, the start instant, the number of failures, and the
**single** ticket of the incident — the `incidentKey` the memory recorded, or
the ticket of the family (§ 11: one ticket per problem).

No outbreak means no panel content: the screen renders one explicit line
("No infrastructure incident in progress."), never a block of empty fields.

## 2. Daily cost trend (CI-14)

The Cost tab keeps the engine's cost report and adds the **shape** of the cost:
one point per UTC day of the window, with the red builds and the CI minutes lost
of that day, plus the variation against the previous window of the same length.

`computeCost` is not reimplemented — it is *called*: once for the window, once
for the previous window, and once per day (on that day's occurrences, with a
one-day window ending on the day's last millisecond). The previous window is
scoped from above before the call, because `computeCost` bounds a window from
below only.

The bars are text (`textBar`): block characters scaled on the widest day. No
chart library, no CSS of our own.

## 3. Export of the memory

Two buttons, one per format. The document is produced **by the resolver**, not
by the browser, so the size of the memory never depends on what the UI Kit can
render. The browser only receives a ready file and a timestamped name
(`deja-vu-memory-20261112T100000Z.csv`) and hands it to a download
(`src/ui/download.ts`, the only place of the app touching `document`).

The CSV is one tidy table: a leading `type` column (`signature`, `occurrence`,
`resolution`) and one column set shared by the three kinds, blank where a kind
has nothing to say. Cells follow RFC 4180 (quoted, quotes doubled), lines are
CRLF, and the order is total — two exports of the same memory are byte-identical.
No CSV formatter existed anywhere in the repository, so this lot adds one.

## 4. Journal of what the app did

One line per action the app took, with the instant, the action, the signature it
concerns, the ticket it touched and a short complement:

`ticket-created`, `ticket-updated`, `comment-posted`, `ticket-reopened`,
`closure-suggested`, `quarantine-proposed`, `signature-merged`,
`signature-split`, `excerpts-purged`.

The journal is written where the action happens:

- the ticket actions are recorded by the Jira applier (`src/consumer.ts`), which
  is the single place the app writes to Jira — so the consumer, the daily run and
  the sample replay all feed the same journal;
- a quarantine proposal is recorded by the shared assembly of the action
  (`src/actions/propose-quarantine.ts`), so the Rovo, MCP and UI paths agree;
- the daily purge records its date and how many excerpts it removed
  (`src/scheduled.ts`);
- a merge or a split is recorded by the curation resolvers (`src/index.ts`).

**Honest limit:** curation is still a *preview* in this app — no code path writes
a merge or a split to the memory. The journal therefore records the operator's
curation gesture, and says so in the `detail` column (`… — preview`). Recording
a merge that did not happen would be a lie.

Writing a line never breaks the action it describes: a storage failure is
swallowed (`recordAudit`), and the entry id is derived from the content, so a
platform retry does not duplicate a line.

## 5. Raw-excerpt retention policy (§ 18, CI-18)

`minimizeExcerpt` existed in the engine but was not wired
(`docs/DATA-MINIMIZATION.md`). It now is, on the ingestion path: the consumer
applies the project's policy to `block.rawText` before storing the excerpt.

- `hash-only` — **no text at all** is stored; only the fingerprint survives, so
  a failure can still be correlated. Proven by
  `apps/brain/test/minimization.test.ts`.
- `masked-snippet` — a masked excerpt, bounded to 512 characters.
- `full` — the masked text, i.e. what the app stored before this lot.

`full` is the **default**, so a project that never opened the settings page keeps
the behaviour it had. The policy is a radio group on the settings page (a text
field would let a typo silently widen what the memory keeps).

### Two consequences worth stating

1. **The setting does not live in `Settings`.** That type is frozen, so the
   policy is stored in a new `app_policy` row and read/written by the app
   (`src/settings.ts`). The page payload carries it next to the engine settings.
2. **The engine's function is not reachable from the app.** `minimizeExcerpt` is
   not re-exported by the core barrel, and this lot may not touch
   `packages/core/src/**` — see the next section for why that boundary is harder
   than it looks. The app therefore applies the policy through
   `applyExcerptPolicy` (`src/pure/excerptPolicy.ts`), which mirrors the engine
   rule for rule and delegates the masking to the engine's own `maskSecrets`
   (which *is* exported). `apps/brain/test/minimization.test.ts` imports the
   engine function from source and asserts the two agree **on every policy and
   every input**, including a custom snippet budget and a precomputed
   fingerprint, so the app's copy cannot drift silently. Wiring the engine
   function directly stays a one-line follow-up for whoever owns the barrel
   (`export * from './minimize.js'` — exactly what `docs/DATA-MINIMIZATION.md`
   anticipates), plus a site bundle rebuild.

## 6. Memory health

The platform gives one installation **1 GiB** and exposes no byte accounting, so
the panel reports an **estimate**: one conservative average row size per table
(`TABLE_ROW_BYTES`, documented in `src/pure/memoryHealth.ts`), times the row
count read with `COUNT(*)`. It is a warning light, not an invoice — the average
for `raw_excerpt` (8 KiB) is deliberately above what a masked snippet weighs.

The panel also shows the total row count, the age in days of the oldest
occurrence, and the date of the last purge (written by the daily run).
`apps/brain/test/memoryHealth.test.ts` asserts that the reported table list is
exactly the schema's, so a future table cannot go unreported.

## Storage: two new tables, declared by the app

The journal and the policy are **app** concerns, not engine ones, so their DDL
lives in `apps/brain/src/pure/appSchema.ts` (`APP_SCHEMA`) and the migration runs
it right after the engine's frozen `SQL_SCHEMA` (`ensureSchema` in `src/sql.ts`).
It is additive and idempotent exactly like the engine's: every statement is run
on each cold start and an "already exists" answer is ignored, so an existing
installation gains the two tables on its next start — nothing is migrated,
nothing is rewritten, and the engine's nine tables are untouched.

```sql
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
```

Only Forge SQL types are used, there is no referential constraint, and the
journal is read with a `LIMIT` and an index on `created_at` so the tab stays
inside the platform's 5 s per SELECT.

### Why not `packages/core/src/store.ts`

The brief allowed this lot to add the tables to the engine's `SQL_SCHEMA`. That
turns out to be impossible without breaking the build, and the reason is worth
recording for the next lot that needs to touch the engine:

`site/test/bundle.test.mjs` asserts that the committed public bundle matches its
sources, and `tools/build-site.mjs` computes that fingerprint over
`site/src`, **`packages/core/src`** and `packages/present/src`. So *any* edit to
a core source file — one export line, one DDL statement — makes the site test
fail until `npm run build:site` regenerates `site/public/`, and `site/**` is
excluded from this wave. Changing the engine and not rebuilding the site means a
red CI; rebuilding the site means editing a forbidden directory.

Keeping both tables in `APP_SCHEMA` resolves the dilemma without a compromise:
the engine is untouched, the site bundle stays valid, and the app owns the
storage it added.

## What cannot be verified without a Jira site

The panels are rendered by the UI Kit in a real Jira project, and the journal is
fed by real ticket writes. Without a tenant, this lot proves the logic (pure
modules, resolvers wiring, SQL statements and row mapping) but **not**:

- the actual rendering of the incident panel, the trend bars, the journal tab,
  the export buttons and the health panel in Jira;
- the browser download of the exported file inside the Forge iframe;
- that `COUNT(*)`, `MIN()` and `LIMIT ?` behave identically on Forge SQL
  (the statements are standard MySQL, which is the declared engine);
- that the two new tables are created by a real `forge deploy` migration;
- the journal lines produced by real Jira writes (creation, comment, reopen).
