# NIGHTLY — the proof that regenerates itself

Every night a workflow replays the whole demonstration of Déjà-vu CI on a
self-hosted runner and writes the numbers it obtained into
[`NIGHTLY-REPORT.md`](NIGHTLY-REPORT.md), committed on the default branch. The
point is honesty: the report is not written by a human, it is produced by the
same code as the gates it describes, and it is published only when it changed.

- Workflow: [`../.github/workflows/nightly.yml`](../.github/workflows/nightly.yml)
- Generator: [`../tools/nightly-report.mjs`](../tools/nightly-report.mjs) (tests: `../tools/nightly-report.test.mjs`)
- Published proof: [`NIGHTLY-REPORT.md`](NIGHTLY-REPORT.md)

## What runs, in order

The workflow contains orchestration only; every number comes from a tool of
this repository. Four gates run before anything is published — a red gate
stops the run and nothing is pushed.

| # | Gate | Command | What it proves |
|---|---|---|---|
| 1 | Sample replay | `npm run replay` | the 40 failures of the sample dataset still produce the four diagnostics, one flaky signature, one regression and exactly one created ticket |
| 2 | Accuracy measurement | `npm run eval` | on the 100 labelled failures: grouping ≥ 90 %, false "flaky" < 5 %, correct category ≥ 90 % |
| 3 | Test suite | `npx vitest run` | the whole suite is green; its JSON report gives the counts published in the report |
| 4 | Repository integrity | `node tools/nightly-report.mjs checks` | the Forge manifests conform to the official schema, the committed SBOM matches the workspace manifests, the published site bundle matches its sources |

The run needs no secret: it talks neither to Atlassian nor to an LLM. It reads
`data/sample/occurrences.json` and `data/labeled/100-failures.json`, and it
uses the engine built from `packages/core`.

## Where to read the result

- **Green night** — [`NIGHTLY-REPORT.md`](NIGHTLY-REPORT.md) on the default
  branch: verdict, test counts, replay time, diagnostics and categories,
  the three accuracy measures against their thresholds, and the integrity
  checks. The header names the date, the commit and the run.
- **Red night** — nothing is published (a report describing a broken run
  would be misleading). The trace is the failed run itself, plus the artifact
  `nightly-numbers-<run id>`, which keeps the collected JSON of every step
  that did run.

## What a failure means

| Red gate | Meaning | First reflex |
|---|---|---|
| Sample replay | an expectation of the sample dataset moved (a diagnostic, a signature count, the single ticket) | read the `RECETTE ÉCHOUÉE` list printed by the tool; it names the occurrence and the expected diagnostic |
| Accuracy measurement | a measure fell under its threshold | the tool prints which one, plus the scattered groups and the diverging categories |
| Test suite | a unit test broke | the Vitest output names the file and the assertion |
| Repository integrity | manifests, SBOM or site bundle out of sync with the repository | `npm run lint:manifests`, `node tools/sbom.mjs`, then rebuild the site |
| Publication refused | the default branch moved twice during the run, or its protection refuses the bot | the report is still in the artifact; re-run the workflow |

## How to run it by hand

On GitHub:

```bash
gh workflow run nightly.yml
```

Locally, the same chain (no network, no secret):

```bash
npm run replay && npm run eval
npx vitest run --reporter=dot --reporter=json --outputFile=/tmp/nightly/vitest-raw.json
node tools/nightly-report.mjs tests --vitest /tmp/nightly/vitest-raw.json --out /tmp/nightly/tests.json
node tools/nightly-report.mjs collect --out-dir /tmp/nightly
node tools/nightly-report.mjs checks --out /tmp/nightly/checks.json
node tools/nightly-report.mjs render --inputs /tmp/nightly --out /tmp/NIGHTLY-REPORT.md
```

`collect` needs the built engine (`npm run build`); the other modes do not.

## How the publication works

1. The report is rendered from the collected JSON.
2. `git diff` decides: if the rendered file is identical to the committed one,
   the run stops here and publishes nothing.
3. Otherwise the workflow bot commits it (signed off) and pushes to the
   default branch. If the branch moved during the run, the commit is rebased
   on top of the new head and pushed again — a human commit is never
   rewritten, and no branch protection is bypassed.

The report embeds the measured replay time, so most nights differ from the
previous one and produce a commit: that is the intent, the proof is
regenerated. A night whose every number is identical publishes nothing.

## What this report does not prove

- **The real rendering of the Forge apps.** Neither the Capteur nor the
  Cerveau runs here: there is no Forge runtime, no Custom UI, no Rovo agent.
  What is exercised is the engine they call, not what the platform draws.
- **Bitbucket.** No webhook is received and no real build log is read: the
  occurrences come from a committed fixture.
- **Jira.** No ticket is created, updated or commented in a real site; the
  ticket plan is computed against an in-memory store.
- **The LLM.** No model is called. The diagnosis published here is the
  deterministic one; the assisted path is stubbed in the tests.
- **Performance on Atlassian infrastructure.** The timings are those of a
  self-hosted runner that other jobs share. They are orders of magnitude, not
  a service-level measurement — see the Forge SQL limits described in
  [`ARCHITECTURE.md`](ARCHITECTURE.md).

In short: the nightly run proves that the repository, its data and its engine
still agree with each other, and it says so with numbers. It does not prove
that the two apps behave the same way once deployed on a real tenant.
