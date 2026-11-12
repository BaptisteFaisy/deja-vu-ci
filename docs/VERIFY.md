# VERIFY — one command to check everything, offline

`node tools/doctor.mjs` runs **every verification this repository owns** and
prints one verdict per check. It never touches the network, it never installs
anything, and it finishes in about a minute on a loaded machine (each check
carries its own timeout). The exit code is non-zero as soon as one check
fails, so the doctor can gate a script or a hook.

```bash
node tools/doctor.mjs                     # everything
node tools/doctor.mjs --list              # the catalogue of checks
node tools/doctor.mjs --only types,tests  # a subset (comma-separated)
node tools/doctor.mjs --json              # machine-readable report
```

Verdicts: **`OK`** (the check passed), **`KO`** (the check failed — the exit
code is 1 and the details are printed below the table), **`PASSÉ`** (the
check does not apply in this workspace, for example no `origin/main` to diff
against, or the public site was never built here).

## The checks

| Check | What it proves | Runs (also standalone) |
|---|---|---|
| `types` | `packages/core`, `packages/bridge` and `packages/present` typecheck under `tsc --noEmit` (the engine declarations are built first when missing: `present` imports the emitted types of `core`). | `npx tsc -p packages/core --noEmit` (idem `bridge`, `present`) |
| `tests` | the whole vitest suite is green — engine, bridge, apps, tools, site. | `npx vitest run --reporter=dot` |
| `manifests` | both Forge manifests validate against the **official** `@forge/manifest` JSON schema — the same source of truth as `forge lint`, not a recopied subset. | `node tools/validate-manifest.mjs` |
| `dataset` | the sample dataset (40 failures / 14 days / four expected diagnostics) and the labeled corpus (100 failures / 20+ groups) are conformant. The doctor **calls** `tools/check-dataset.mjs`; it never recopies its rules. | `node tools/check-dataset.mjs` |
| `sbom` | `docs/SBOM.json` matches a fresh deterministic generation — the bill of materials cannot drift from the manifests. | `node tools/sbom.mjs` (regenerates) |
| `site-bundle` | the committed `site/public/` bundle carries the fingerprint of the current sources (site + engine + sample dataset): what GitHub Pages serves is what the repository says. | `npm run build:site` (rebuilds) |
| `docs` | every relative link of every tracked Markdown file points at something that exists, every cited anchor exists in its target (when the target is readable), no document is empty, no document carries a merge conflict marker. | `node tools/check-docs.mjs` |
| `licences` | every **runtime** component of the SBOM has a licence, and none is copyleft — nothing incompatible with the MIT licence of this repository ships inside an app bundle. | `node tools/check-licences.mjs` |
| `conflicts` | no line of any tracked file starts with a merge conflict marker. | `git grep -nE '^(<<<<<<<\|>>>>>>>)'` |
| `sizes` | the repository code rules: a file stays under 500 lines, a function under 50 lines (see *Scope of the size rules* below). | `node tools/doctor.mjs --only sizes` |
| `couche0` | the CI guard, replayed locally: the forbidden patterns of `.github/couche0/check_couche0.py` (forced side-taking, history rewrite without lease, privileged trigger, plaintext keys, hardcoded `sdk.dir`, ante-rule dates) are matched against the added lines of the branch — committed diff **and** untracked files. The patterns are imported from the guard itself at runtime, never recopied. | `node tools/doctor.mjs --only couche0` |

## The standalone tools behind the doctor

- `tools/check-docs.mjs` — documentation links, anchors, empty files,
  conflict markers. Tested by `tools/check-docs.test.mjs` (fixtures in the
  temporary directory + the real tracked documentation).
- `tools/check-licences.mjs` — runtime licences of `docs/SBOM.json`, read
  from each dependency's own `package.json` when installed, from the
  documented table of `docs/THIRD-PARTY.md` otherwise. Tested by
  `tools/check-licences.test.mjs`.
- `tools/openapi-conformance.test.mjs` — binds `docs/openapi.yaml` to the
  code: the schemas compile under `ajv` (an existing root dev dependency),
  the `required` list is exactly the one `packages/core/src/universal.ts`
  checks, every documented property is a field the engine reads (plus
  `idempotencyKey`, documented as accepted-and-ignored), `ajv` and the
  engine give the same verdict on valid and invalid payloads, and every
  documented response code is returned by `apps/brain/src/universal.ts`.
- `tools/lib/verify.mjs` and `tools/lib/limits.mjs` — the shared primitives
  (tracked files, subprocess with timeout, conflict markers, verdict table)
  and the TypeScript size scanner. They exist once; the three tools import
  them instead of copying rules.

## Scope of the size rules

The file limit (< 500 lines) is enforced on **every tracked TypeScript
file**. The function limit (< 50 lines) is enforced on `packages/**` and
`tools/**` — the shared engine and the repository tooling, where the rule
protects reviewability. In `apps/**` and `site/**` the oversized functions
are **reported as observations**, not failures: the long bodies there are
declarative Forge screens (`apps/brain/src/ui/`) and the public demo page,
which are markup rather than logic. The scanner is a conservative heuristic
(comments and strings blanked out, brace matching), so every report carries
the file and the line for a human to confirm.

## Licence buckets

`check-licences` classifies each runtime component: **permissive**
(MIT-compatible SPDX), **platform** (`SEE LICENSE IN …`, `UNLICENSED` — the
Forge SDK under the Atlassian Developer Terms, expected for a Forge
product), **copyleft** (GPL family, AGPL, SSPL… — the only blocking
bucket), **undeclared** and **unknown** (reported, never blocking: the tool
names the missing declarations precisely instead of failing on them).

## What cannot be verified offline

The doctor proves everything that can be proven **inside this repository**.
The following genuinely require the platform and are verified by hand (see
`docs/DEPLOY.md` and `docs/DEMO.md`):

- the real rendering of the Forge apps (Custom UI of the Sensor, UI Kit
  pages of the Brain, Rovo agent and MCP exposure);
- `forge lint` and `forge deploy`, which need the Atlassian CLI and
  credentials — the manifest *schema* is checked locally, the platform-side
  validation is not;
- Bitbucket itself: webhooks, build-status triggers, pull-request cards;
- the live `/universal` web trigger behind `*.webtrigger.atlassian.app`,
  including the platform-enforced body limit (the documented `413`);
- GitHub Pages actually serving `site/public/`, and the CI workflows
  themselves (the `couche0` **scope** control reads the PR body through the
  GitHub API — locally, only the forbidden-pattern half is replayed).

## Budget

Every check has its own timeout and the whole run stays far below the
5-minute CI budget rule. On a loaded machine, run a subset with `--only`
(the checks are independent) instead of raising a timeout — a timeout is
never extended, a check is split.
