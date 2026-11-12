# Delivery status — Déjà-vu CI

The factual state of the project: what is delivered, what is deployed where,
what cannot be demonstrated without a real tenant, and what remains open.

- **Base:** `main` at commit `37389bf`, 2026-11-12.
- **Method:** `git log`, the tree at that commit, the test suite, the accuracy
  evaluation, the replay tool, and the Forge CLI (`forge version list`,
  `forge install list`) run on 2026-11-12. Nothing is estimated: what could not
  be checked is written **not verified**.

---

## 1. What was measured, on this base

| Measurement | Result | How |
|---|---|---|
| Test suite | **75 files, 733 tests, all green** (run duration ≈ 3 s) | `npx vitest run`, 2026-11-12 |
| Grouping accuracy | **100.0 %** (threshold 90 %) | `npm run eval` on the 100-failure labelled corpus (27 groups), 2026-11-12 |
| False "flaky" rate | **0.0 %** (threshold < 5 %) — 0 signature declared flaky out of 26 | `npm run eval`, 2026-11-12 |
| Category accuracy | **100.0 %** (threshold 90 %) | `npm run eval`, 2026-11-12 |
| § 20 acceptance recipe | **held**: the four diagnostics (flaky 15, already-fixed 2, new 12, infrastructure 9, plus 2 uncertain), one flaky signature, one regression, **one** ticket (1 create, 14 updates, 11 comments) | `npm run replay`, 2026-11-12 — the tool exits non-zero if an expectation is missed |
| Manifests | both validate against the official `@forge/manifest` schema | `tools/manifests.test.mjs`, inside the suite above |
| Site bundle | the committed bundle matches its sources (fingerprint) and the page is self-contained | `site/test/bundle.test.mjs`, inside the suite above |

## 2. Requirements CI-01 … CI-19

`shipped` means: present in the tree on this base, and covered by at least one
test in the suite of § 1.

| # | Requirement | Status | Where it lives | Proven by |
|---|---|---|---|---|
| CI-01 | Capture every failed build status | shipped | `apps/sensor/manifest.yml` (triggers `avi:bitbucket:{created,updated}:build-status`), `apps/sensor/src/index.ts` | `apps/sensor/test/event.test.ts`, `payload.test.ts` |
| CI-02 | Read the failed step log and failed test cases | shipped | `apps/sensor/src/pipelines.ts` (partial requests), `src/pure/blocks.ts` | `apps/sensor/test/pipelines.test.ts`, `blocks.test.ts` |
| CI-03 | Mask secrets before anything leaves Bitbucket | shipped | `packages/core/src/mask.ts`, `apps/sensor/src/masking.ts` (fail-closed) | `packages/core/test/mask.test.ts`, `mask-extended.test.ts`, `apps/sensor/test/buildPayload.test.ts` |
| CI-04 | Signature, family and category (§ 9) | shipped | `packages/core/src/sign.ts`, `categorize.ts`, `normalize.ts`, `extract.ts` | `sign.test.ts`, `categorize.test.ts`, `normalize.test.ts`, `extract.test.ts`, `signature-golden.test.ts` |
| CI-05 | One of four diagnostics, with confidence and justification | shipped | `packages/core/src/diagnose.ts`, `apps/brain/src/ingest.ts` + `consumer.ts` | `diagnose.test.ts`, `apps/brain/test/consume.test.ts`, `consume-integration.test.ts` |
| CI-06 | Flaky detection (§ 10.1) | shipped | `packages/core/src/flaky.ts` | `flaky.test.ts` |
| CI-07 | One ticket per problem (§ 11) | shipped | `packages/core/src/tickets.ts` | `tickets.test.ts` |
| CI-08 | Diagnostic on the pull request and on the Jira ticket | shipped | Sensor: `src/pure/prCardView.ts` + `src/ui/customPrCard.tsx`; Brain: `jira:issuePanel` → `src/ui/issueContext.tsx` | `apps/sensor/test/prCardView.test.ts`, `apps/brain/test/issueContextText.test.ts` |
| CI-09 | "CI Memory" project page | shipped | `apps/brain/src/ui/projectPage.tsx`, `projectPageParts.tsx` (tabs: flaky, resolutions, cost) | `apps/brain/test/screens.test.ts`, `resolvers.test.ts` |
| CI-10 | Rovo agent and MCP tools (§ 13) | shipped | `apps/brain/src/rovo/`, `apps/brain/src/actions/` — **7 actions**: the six of § 13 plus `propose-quarantine` | `apps/brain/test/rovo.test.ts`, `actions.test.ts` |
| CI-11 | Replayable sample set without Bitbucket | shipped | `packages/core/src/replay.ts` + `engine.ts`, `data/sample/`, `tools/replay.mjs`, `apps/brain/src/seed.ts` (the button), `site/` (in the browser) | `replay.test.ts`, `recipe.test.ts`, `apps/brain/test/seed.test.ts`, `site/test/demo.test.ts` |
| CI-12 | Deduce then confirm resolutions | shipped | `packages/core/src/resolutions.ts`, `apps/brain/src/actions/{report-resolution,confirm-resolution}.ts` | `resolutions.test.ts`, `actions.test.ts` |
| CI-13 | Detect regressions, reopen the ticket, mention the fix author | shipped | `resolutions.ts` (`detectRegression`), `tickets.ts` (`reopen`) | `resolutions.test.ts`, `tickets.test.ts`, `recipe.test.ts` |
| CI-14 | Cost: red builds, CI minutes lost, people affected | shipped | `packages/core/src/cost.ts`, cost tab in `apps/brain/src/ui/projectPageParts.tsx` | `cost.test.ts`, `apps/brain/test/screens.test.ts` |
| CI-15 | Detect infrastructure outbreaks, open one incident | shipped | `packages/core/src/outbreak.ts`, daily sweep in `apps/brain/src/scheduled.ts` | `outbreak.test.ts` |
| CI-16 | Universal entry for any CI | shipped | `packages/core/src/universal.ts`, `apps/brain/src/universal.ts`, `tools/universal-entry.sh`, `integrations/` (GitHub Action, GitLab, Jenkins, npm CLI, Python SDK, adapters) | `universal.test.ts`, `tools/universal-cli.test.mjs`, `tools/universal-adapters.test.mjs`, `tools/openapi.test.mjs` |
| CI-17 | Manually merge or split signatures | shipped | `packages/core/src/curate.ts`, `apps/brain/src/pure/curation.ts`, `src/ui/curation.tsx`, resolver calls `curate-merge` / `curate-split` (#52, #65) | `curate.test.ts`, `apps/brain/test/curate-ui.test.ts` |
| CI-18 | Adjustable retention of raw excerpts | shipped | `packages/core/src/store.ts` (`purgeExpired`), `rawRetentionDays` setting (default 30), daily purge in `apps/brain/src/scheduled.ts` | `store.test.ts`, `apps/brain/test/consume.test.ts` |
| CI-19 | Propose quarantining a test | shipped | `packages/core/src/quarantine.ts`, `apps/brain/src/pure/quarantineUi.ts`, `src/ui/quarantine.tsx`, action `propose-quarantine` (#54, #65) | `quarantine.test.ts`, `apps/brain/test/quarantine-ui.test.ts` |

> **Note.** The traceability table in `README.md` still lists CI-17 and CI-19
> as *planned*; both are in the tree and tested — see § 7.

## 3. What is deployed, where

Verified with the Forge CLI on **2026-11-12** (CLI 14.2.0, Developer Space
`laddition`).

| Surface | State |
|---|---|
| **Brain** (Jira app `ari:cloud:ecosystem::app/2abacda7-8c4f-4b29-9c97-7209dd240894`) | Major version **3** deployed on 2026-11-11T18:53:10Z, `development` environment. One installation on the demo site `one-atlas-cndz.atlassian.net` (Jira), status *Up-to-date*. The deployed build exposes **16 functions and 6 actions** |
| **Sensor** (Bitbucket app `ari:cloud:ecosystem::app/f4c98609-1c94-4e98-9e26-89cec008d6d7`) | Major version **1** deployed on 2026-11-11T15:53:13Z, **no module**. **Not installed anywhere** — the demo site has no Bitbucket (`docs/DEPLOY.md` § 6) |
| **Public site** | Published on GitHub Pages: `https://baptistefaisy.github.io/deja-vu-ci/`, from the committed `site/public/` (`.github/workflows/site.yml`, on push to `main`) |
| **Full version string of the Jira app** | Reported as **3.1.0** in the wave brief; the CLI exposes major versions only — **not verified** |

**The repository is ahead of the deployed Brain.** `main` declares 7 actions
and 17 functions (`propose-quarantine` and the curation/quarantine resolver
calls, #65); the installed build predates them. A `forge deploy` +
`forge install --upgrade` would align the demo site with the tree
(`docs/DEPLOY.md` § 3).

## 4. What is demonstrable without any tenant

All of it runs offline, from a clone:

- `npm run replay` — the 40-failure sample set through the real chain, the four
  diagnostics, the ticket ledger (§ 20 recipe);
- `npm run eval` — accuracy on the 100-failure labelled corpus;
- the **public site** — the real engine in the browser, one click, no account;
- the **733 tests** — every rule of the engine, the bridge, the apps' pure
  layers, the integrations and the guards;
- `deja-vu report --dry-run` (npm CLI) and the Python SDK's payload builder —
  the universal-entry payloads without sending them.

## 5. What needs a real Bitbucket workspace

The Sensor's live capture chain cannot be demonstrated on the demo site
(Jira + Confluence only):

- the build-status triggers firing on a real pipeline, the partial log reads,
  the test reports;
- the pull-request card answering on a real pull request;
- the pairing (Brain settings → Sensor settings → shared secret);
- the six points of § 17 that a first-week prototype must validate (find the
  pipeline from a build status; read a step log from Forge; test-report
  availability; the retry event on the same commit; the extra test scope; the
  web trigger called from the Bitbucket app). None of them has been validated
  against a real workspace yet — each has a documented fallback
  (`README.md`, "The six points still to validate").

The demo repository `examples/flaky-repo/` (a deliberately random test, a real
regression, a dependency on a cut-off registry) exists for that path but has
not been pushed to a real Bitbucket workspace as part of this repository's
verification — **not verified**.

## 6. What remains open

**Deployment**

- Redeploy the Brain so the demo site carries the 7th action and the curation /
  quarantine screens (§ 3).
- Deploy the current Sensor manifest and install it on a real Bitbucket
  workspace (§ 5).

**Security — the three documented next moves** (`docs/SECURITE-ETAT.md`):

1. persist the nonce across cold starts (today the replay guard is a
   warm-instance cache);
2. harden the universal entry (replace the cleartext `projectKey` bearer with
   a per-project random secret in the Forge secret storage);
3. define an archive/rollup policy for `signature` / `occurrence` /
   `test_stats`, which grow toward the 1 GiB installation limit.

**Wiring deliberately left open**

- `minimizeExcerpt` is pure and tested but **not wired** — the retention policy
  is a product decision (`docs/DATA-MINIMIZATION.md`).
- Server-side deduplication on `idempotencyKey` — the field is accepted, not
  used yet; the wire format will not change when it lands
  (`docs/API-UNIVERSELLE.md`).

**Product**

- Marketplace publication, learned normalisers per ecosystem, predictions
  before the build ends, cross-organisation memory — in that order
  (`docs/ROADMAP.md` § 6).

## 7. Documentation drift observed on this base

Listed for the coherence pass; this document does not modify any of the files
below. "Tree" means the code at commit `37389bf`.

| Document | What it says | What the tree shows | Introduced by |
|---|---|---|---|
| `README.md` (traceability) | CI-17 and CI-19 *planned*, "Where it lives: —" | both shipped and tested (§ 2) | #52, #54, #65 |
| `README.md` (status box) | "336 automated tests green" | **733** tests in 75 files (measured, § 1) | every lot since |
| `README.md`, `docs/JUDGES.md`, `docs/ARCHITECTURE.md` § 6, `apps/brain/src/rovo/README.md` | "six actions" (Rovo / MCP) | the manifest declares **7** actions and 7 MCP tools (`propose-quarantine`) | #54, #65 |
| `docs/ROADMAP.md` § 2 | "Deliberately still missing: manual merge or split of signatures (CI-17) … the honest status is *planned*" | shipped | #52, #65 |
| `docs/ROADMAP.md` § 6 | item 1 of "After the hackathon": manual merge and split | done | #52, #65 |
| `docs/ROADMAP.md` (tail) | two residual sections "Sonde InferHub A / B" in French, appended after § 6 | leftovers of the end-to-end agent probes; the same family of leftovers was cleaned in #37 | #39, #40 |
| `docs/ARCHITECTURE.md` § 6, § 8 | code layout without `packages/present`, `site/`, `integrations/`, `examples/`; engine module list without `curate`, `quarantine`, `minimize`, `engine`, `signature-version`, `cascade`, `calibrate` | all present in the tree | #52–#69 |
| `docs/JUDGES.md` § 0 | "The project is built by eight parallel lots" and a status table without the site's curation/quarantine surfaces | historical statement; the tree has grown two waves beyond it | #60–#69 |
| `docs/DEPLOY.md` | deployment runbook executed on 2026-11-11 | still accurate, but the Brain has not been redeployed since (#65 is newer than the deployed build) | #65 |
| `README.md` and `docs/JUDGES.md` (universal entry examples) | `tools/universal-entry.sh --project-key CI --repository my-repo --branch main --log-file step.log` | the script parses `--file`, `--repo`, `--branch`, `--key` (the key normally comes from `DEJAVU_PROJECT_KEY`); the flags `--project-key`, `--repository` and `--log-file` are not recognised — `docs/API-UNIVERSELLE.md` shows the correct form (`--file build.log`) | #63 (the script); the examples predate it |

Frozen documents (`docs/CONTRACTS.md`, `packages/core/src/types.ts`) are **not**
drift: they are deliberately unchanged — `algorithmVersion` was added as an
optional field without touching the frozen contract
(`docs/SIGNATURE-VERSIONING.md`).
