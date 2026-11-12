# BENCHMARK — measuring the CI-05 promise

CI-05 promises **one of the four diagnostics, with confidence and
justification, in less than 30 seconds** after a build failure. This document
describes how that promise is measured offline, the numbers actually observed,
and how to read them honestly.

Everything here runs **offline**: no network, no Atlassian tenant, no LLM. The
engine is the real one (`packages/core`), loaded from its compiled output.

## Run it

```bash
npm run build --silent && node tools/bench.mjs           # full bench (~4 min quiet, ~5-8 min loaded)
npm run build --silent && node tools/bench.mjs --quick   # reduced corpora, ~1-2 s (what CI runs)
node tools/bench.mjs --json                              # JSON report on stdout
node tools/bench.mjs --json-out /tmp/bench.json          # also write the JSON report to a file
```

Requires Node ≥ 22.18 (the bench imports the app's TypeScript similarity
module directly, via Node type stripping) and a built engine
(`packages/core/dist`); without it the tool exits 2 with a clear message.
The vitest suite (`tools/bench.test.mjs`) runs the bench from the TypeScript
sources and does **not** need the build.

## Method

- **Corpora.** `sample-40`: the tracked sample dataset (`data/sample/`,
  40 failures over 14 days). `synth-1000` / `synth-10000`: synthetic corpora
  generated with a **fixed seed (42)** — the same on every run — mixing 11 log
  kinds (JUnit, pytest, Jest, Go, Gradle, npm, pip-style DB, ESLint, tsc,
  Docker, unknown) over 7 repositories and 23 branches, plus ~10 % same-commit
  successes so a replay also walks its refine path.
- **Repetitions.** 5 per measurement, the **first discarded** as warm-up;
  p50/p95/max are nearest-rank percentiles over the 4 kept runs. With 4 kept
  samples, p95 coincides with max — read it as "worst of 4", not a smooth tail.
- **`ingest-failure`** times extraction + signature + diagnosis of one failure
  (the CI-05 path). Store calls are **excluded** from the time and **counted**
  instead (column `queries/op`).
- **`replay-full`** times a whole `replayWithEngine` pass (extraction,
  signature, diagnosis, flakiness, ticket plan, resolutions).
- **`search-failures`** replays the exact sequence of the Jira action
  (`apps/brain/src/actions/search-failures.ts`): extract + sign the free text,
  list every signature and its occurrences, score exact/family/near matches
  with the action's own similarity module. 5 fixed queries per run.
- **`cost-report`** times `computeCost` (CI-14) over every occurrence of the
  corpus; it is pure computation (0 store queries).
- **Memory** (`heap MB`) is the `heapUsed` delta across a phase — approximate:
  the GC is not forced (unless node runs with `--expose-gc`), so a delta can
  even be negative when a collection happens mid-phase.

## Environment — read this before quoting any number

Measured on a **loaded workstation, not on Forge infrastructure**:

- 12-thread Intel Core i5-11600K @ 3.90 GHz, Linux x64;
- Node v26.9.0 (the CI worker runs Node v22.23.4 — same major behaviour);
- two full runs: one **quiet** (load average 2.6) and one **loaded** (load
  average 23, produced with 12 CPU burners — the machine this wave of work
  runs on was observed at load ~20 on 12 threads);
- the engine talks to `MemoryStore`; in production it talks to Forge SQL over
  the network. These numbers therefore bound the **engine's own work**, not
  the end-to-end latency of a Forge resolver.

Compare **orders of magnitude**, never exact milliseconds.

## Numbers

Quiet run (load 2.6/2.9/2.2), full bench:

| metric | corpus | p50 ms | p95 ms | max ms | queries/op | heap MB |
|---|---|---:|---:|---:|---:|---:|
| ingest-failure | sample-40 | 0.076 | 0.108 | 0.540 | 7 | 0.7 |
| replay-full | sample-40 | 4.4 | 5.6 | 5.6 | 394 | 4.4 |
| search-failures | sample-40 | 0.132 | 0.168 | 0.176 | 16 | 2.1 |
| cost-report | sample-40 | 0.033 | 0.066 | 0.066 | 0 | 0.1 |
| ingest-failure | synth-1000 | 0.062 | 0.106 | 0.573 | 7 | 5.2 |
| replay-full | synth-1000 | 208 | 246 | 246 | 9 863 | 37.7 |
| search-failures | synth-1000 | 0.950 | 1.733 | 1.784 | 135 | 6.1 |
| cost-report | synth-1000 | 0.331 | 0.366 | 0.366 | 0 | 1.2 |
| ingest-failure | synth-10000 | 0.173 | 0.714 | 10.3 | 7 | 45.8 |
| replay-full | synth-10000 | 12 810 | 14 797 | 14 797 | 98 110 | 589.1 |
| search-failures | synth-10000 | 11.3 | 11.8 | 11.9 | 196 | 14.7 |
| cost-report | synth-10000 | 2.35 | 2.89 | 2.89 | 0 | 4.4 |

Loaded run (load 23/16.3/8.2), same bench, same seed:

| metric | corpus | p50 ms | p95 ms | max ms | queries/op | heap MB |
|---|---|---:|---:|---:|---:|---:|
| ingest-failure | sample-40 | 0.124 | 0.455 | 1.23 | 7 | 0.8 |
| replay-full | sample-40 | 10.4 | 17.7 | 17.7 | 394 | 4.5 |
| search-failures | sample-40 | 0.253 | 0.683 | 0.692 | 16 | 2.1 |
| cost-report | sample-40 | 0.073 | 0.174 | 0.174 | 0 | 0.2 |
| ingest-failure | synth-1000 | 0.098 | 0.197 | 5.88 | 7 | 4.4 |
| replay-full | synth-1000 | 370 | 681 | 681 | 9 863 | 36.8 |
| search-failures | synth-1000 | 1.72 | 4.38 | 4.61 | 135 | 5.9 |
| cost-report | synth-1000 | 0.696 | 1.24 | 1.24 | 0 | 1.0 |
| ingest-failure | synth-10000 | 0.329 | 1.554 | 38.5 | 7 | 18.8 |
| replay-full | synth-10000 | 37 108 | 70 894 | 70 894 | 98 110 | 576.8 |
| search-failures | synth-10000 | 74.8 | 101.2 | 113.9 | 196 | 14.0 |
| cost-report | synth-10000 | 11.1 | 12.6 | 12.6 | 0 | 4.4 |

End of full bench: ~660–670 MiB heap, ~780–800 MiB RSS (both 10 000-failure
corpora and their stores are resident at that point).

## Interpretation (honest)

- **CI-05 is met with ~4 orders of magnitude of margin by the engine itself.**
  A unit diagnosis costs 0.06–0.33 ms (p50) and stayed under 39 ms even for
  the worst single failure of the loaded run. The 30 s budget is dominated by
  everything the bench deliberately excludes: fetching the log over the
  Bitbucket API, the signed bridge call, Forge SQL round-trips.
- **The "Rejouer le jeu d'exemple" button is instantaneous**: a full replay of
  the 40-failure dataset costs ~5 ms quiet, ~18 ms worst-case loaded.
- **Bulk replay of 10 000 failures is an offline operation, not a UI one**:
  12.8 s quiet, 37–71 s loaded. `MemoryStore` listings scan their whole table,
  so the pass is quadratic; Forge SQL carries the two indexes the screens rely
  on (`signature.family_id`, `occurrence(signature_id, occurred_at)`), which
  keeps each **single-failure** query indexed. CI-05 promises a diagnosis per
  failure, and that path stays milliseconds either way.
- **`search-failures` against 195 signatures / 10 000 occurrences costs
  11–114 ms in memory, with ~196 store queries per search.** On Forge SQL
  that is ~196 SELECTs; even at 10–50 ms of round-trip each, the action lands
  in the 2–10 s range — each individual SELECT far below the platform limit
  of **5 s per SELECT**, thanks to the indexes above. If a tenant ever grew
  past that, the fix is batching the occurrence listing, not a redesign.
- **Memory stays far below the Forge SQL budget of 1 GiB per installation.**
  10 000 occurrences add ~19–46 MiB of heap; stored rows (without logs) are a
  few hundred bytes each. The only bulky table is `raw_excerpt` (50 Ko max per
  excerpt), which CI-18 expires after `rawRetentionDays` (30 by default) via
  `purgeExpired` — retention, not growth, bounds it.

## Guards in the test suite

- `packages/core/test/budget.test.ts` — the CI-05 promise as a test: a unit
  diagnosis on a 200-occurrence history must render in **< 1 s** (observed:
  well under 1 ms; the margin is the point — the test compares orders of
  magnitude, never exact milliseconds), and a full replay of the sample
  dataset in **< 30 s** (observed: ~5–20 ms).
- `tools/bench.test.mjs` — the bench itself runs in reduced mode inside CI
  (~0.9 s added to the suite, hard-asserted < 20 s), validates its JSON
  report shape, corpus determinism and percentile math, and checks the CLI
  end-to-end when the engine is built (or its graceful failure when it is
  not).

## Reproducibility

Fixed seed, fixed repetitions, deterministic corpora, no clock-dependent
input: two runs produce the same corpora, the same signature counts and the
same store-query counts. Only the timings vary — with the machine load, which
the report records (`environment.loadavg`) so no number can be quoted
without its context.
