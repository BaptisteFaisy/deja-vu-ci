# Forge SQL limits, measured

The Cerveau keeps the whole CI memory of an installation in **Forge SQL**
(§ 16). The platform gives no unlimited budget: it publishes two hard limits,
**5 s per `SELECT`** and **1 GiB per installation**, and it offers no foreign
key, no join and only the indexes you declare yourself.

This document reports what those limits mean for Déjà-vu CI, measured rather
than estimated. Every number below comes from `tools/loadtest-sql.mjs`, a
deterministic bench that replays a realistic volume against a **fake SQL
client**: the client counts the statements, keeps their shape, records the
columns each one filters on, and checks that column against the indexes
declared in the engine's own DDL (`SQL_SCHEMA`). No network, no platform, no
guesswork — and two runs give the same report.

```bash
node tools/loadtest-sql.mjs          # the report below, on stdout
npx vitest run tools/loadtest-sql.test.mjs
```

## The replayed volume

A busy Jira site, several months of red builds:

| Quantity | Value |
|---|---|
| signatures | 500 |
| families | 50 |
| occurrences | 10 000 |
| occurrences per signature | 20 |
| repositories / branches / authors | 10 / 8 / 20 |

That is roughly **700 red builds a day for two weeks**, well above what a
single team produces: the bench is deliberately sized to be pessimistic.

## Queries per screen operation

One call of each screen, measured on the volume above. "Rows touched" is what
the store has to walk: one probe plus the matching rows when the read uses an
index, the **whole table** when it does not.

| Screen operation | Reads | Writes | Rows touched | Full scans |
|---|---|---|---|---|
| `pr-card` (`/query`, the Bitbucket card) | 7 | 0 | 30 153 | 5 |
| `issue-context` (the Jira panel) | 7 | 0 | 10 674 | 4 |
| `project-page` (the "CI Memory" page) | 503 | 0 | 11 625 | 3 |
| `flaky-tests-tab` | 2 | 0 | 161 | 1 |
| `template-cache` (warm-instance hydration) | 1 | 0 | 28 | 1 |
| `purge-expired` (scheduled retention) | 1 | 1 | 10 000 | 1 |
| `settings-page` | 1 | 0 | 2 | 0 |
| `pairing-lookup` | 1 | 0 | 2 | 0 |

The ingest path is the write side: **10 501 statements** to store the volume
(500 signature upserts, 10 000 occurrence upserts, one settings upsert), plus
11 DDL statements for the idempotent migration (nine tables, two indexes).

Two structural findings fall out of the table:

- **The project page issues 503 reads for 500 signatures.** `allOccurrences`
  lists the signatures, then asks for the occurrences of each one — an N+1.
  Every one of those reads is indexed, so each is cheap, but the *count* grows
  with the number of signatures. It is the first thing to batch if the memory
  page ever feels slow.
- **The PR card is the most expensive read path**, and it is the hottest one:
  it runs on every build status the Sensor sees. Five of its seven reads walk
  a whole table (see below).

## Which reads use an index

The schema declares two indexes on top of the primary keys:
`signature(family_id)` and `occurrence(signature_id, occurred_at)`.

**Reads that go through an index** (cost bounded by the rows they return):

| Statement | Index used |
|---|---|
| `SELECT * FROM occurrence WHERE signature_id = ?` | `occurrence(signature_id, occurred_at)`, leftmost prefix |
| `SELECT * FROM test_stats WHERE repo = ?` | primary key `(repo, test_name)`, leftmost prefix |
| `SELECT * FROM settings WHERE project_key = ?` | primary key |
| `SELECT * FROM pairing WHERE workspace = ?` | primary key |

**Reads that walk a whole table.** Three of them are *bounded by design* — the
table cannot grow past a small multiple of the number of distinct errors, and
they carry no `WHERE` at all:

| Statement | Table size at the replayed volume |
|---|---|
| `SELECT * FROM signature` | 500 rows |
| `SELECT * FROM test_stats` | 80 rows |
| `SELECT * FROM llm_template_cache` | 28 rows |

The remaining ones **grow with the memory**, and they are the real subject of
this document:

| Statement | Walks | Called by |
|---|---|---|
| `SELECT * FROM occurrence WHERE repo = ? AND branch = ? ORDER BY occurred_at DESC` | every occurrence | `pr-card` (latest failure of a branch) |
| `SELECT * FROM occurrence WHERE repo = ? AND branch = ? AND commit_sha = ? ORDER BY occurred_at DESC` | every occurrence | `pr-card` (exact commit) |
| `SELECT * FROM occurrence WHERE family_id = ?` | every occurrence | `diagnose` (family history) |
| `SELECT * FROM resolution WHERE signature_id = ?` | every resolution | `diagnose` (already-fixed?) |
| `SELECT * FROM resolution WHERE confirmed_at IS NULL` | every resolution | `project-page` (pending tab) |
| `SELECT * FROM outbreak WHERE family_id = ?` | every outbreak | `diagnose` (infrastructure?) |
| `SELECT occurrence_id FROM raw_excerpt WHERE expires_at <= ?` | every excerpt | `purge-expired` (scheduled) |

## Stored volume

Measured from the values the bench actually stores, plus a 48-byte row
overhead:

| Table | Rows | Bytes per row | Bytes |
|---|---|---|---|
| `raw_excerpt` | 10 000 | 1 200 | 12 000 000 |
| `occurrence` | 10 000 | 272 | 2 720 000 |
| `signature` | 500 | 264 | 132 000 |
| `resolution` | 125 | 220 | 27 500 |
| `test_stats` | 80 | 140 | 11 200 |
| `llm_template_cache` | 28 | 260 | 7 280 |
| `outbreak` | 5 | 180 | 900 |
| `settings` | 1 | 160 | 160 |
| `pairing` | 1 | 120 | 120 |
| **Total** | | | **14.9 MB (14.2 MiB)** |

That is **1.4 % of the 1 GiB installation limit**. The raw excerpts — the
masked log text kept for the retention window — are 80 % of it, which is
exactly why `rawRetentionDays` exists and why `purge-expired` runs on a
schedule.

## The breaking point

**Storage.** One occurrence stores 272 bytes, so the 1 GiB limit is reached at
about **3 947 580 stored occurrences**. The raw excerpts reach it sooner: at
1 200 bytes each, roughly **895 000 excerpts**, i.e. about 90 occurrences per
day for 27 years, or 2 400 a day for a year if the retention window is never
enforced. Retention is the binding constraint, not the occurrences.

**Query time.** The `pr-card` touches **30 153 rows per call** at 10 000 stored
occurrences — **3.02 rows touched per stored occurrence**, because five of its
reads scale with the whole memory instead of with one signature. The growth is
linear:

| Stored occurrences | Rows touched by one `pr-card` |
|---|---|
| 10 000 | 30 153 |
| 100 000 | ~302 000 |
| 1 000 000 | ~3 020 000 |

Forge does not publish a rows-per-second figure for its SQL store, so this
document does not invent one: the bench reports the deterministic quantity
that drives the limit — rows touched — and states the growth. What is certain
is the shape of the curve: **the PR card is O(memory), not O(signature)**. At
the replayed volume it is milliseconds; it is the first thing to break if an
installation grows two orders of magnitude, and the fix is known: index
`occurrence(repo, branch, occurred_at)` and `occurrence(family_id)`.

Both limits are therefore far away at hackathon scale, and the one that would
be hit first — the unindexed branch lookup on the PR card — is a single
`CREATE INDEX` away.

## What the bench does not measure

- Real platform latency: the client is fake, so no network, no MySQL, no
  Forge runtime. Row counts are exact; wall-clock times are not claimed.
- Write throughput under concurrency: the ingest path is replayed
  sequentially, one statement at a time.
- Anything above the replayed volume: the growth table extrapolates a
  measured linear coefficient, it does not replay a million occurrences.
