# Changelog

All notable changes to **Déjà-vu CI** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Versioning status.** The repository is pre-release: the root `package.json`
declares `0.1.0` with `private: true`, and no git tag has been cut. Everything
that has landed on `main` is therefore recorded under `[Unreleased]`. The two
Forge applications carry their own platform-side versions — see
[Deployed Forge versions](#deployed-forge-versions).

Every entry cites the pull request that introduced it, or, for the six commits
pushed directly to `main` before the pull-request flow existed, the commit hash.
Nothing here is invented: this file is a reading of `git log --reverse` on
`main` as of commit `37389bf` (2026-11-12), cross-checked against the tree.
Dates are merge dates (Europe/Paris).

## [Unreleased]

### Added

**Repository foundation** — direct commits, before the pull-request flow:

- The CI skeleton of the repository: the `couche0` guard (declared scope and
  forbidden patterns), the `ci` job, the merge sweeper, the triage of red tests
  and the merge queue (`8bfc86e`).
- The frozen contract (`docs/CONTRACTS.md`), the TypeScript engine and the
  signed bridge, under a five-minute budget per CI job (`8148fc6`).
- `node_modules` kept on the runner between runs, reinstalled only when the
  `package-lock.json` fingerprint changes (`8948e23`).
- Removal of the patterns the `couche0` guard refuses from the tracked files
  (`0c04d6f`).
- The memory layer of the engine: deduced-then-confirmed resolutions, one
  ticket per failure family, and the build-cost report (`e5ede30`).
- The merge queue configured with squash and merge-update, after GitHub refused
  to rebase pull requests that had already merged `main` (`20f22aa`).

**Engine (`packages/core`)**:

- Flakiness detection, infrastructure outbreaks, and the four verdicts with
  their confidence and facts (#5).
- The memory store, the deterministic replay, the LLM fallback and the
  universal entry (#6).
- Error extraction, secret masking, normalisation, categorisation and
  signatures (#14).
- The § 20 acceptance recipe replayed end to end, with the signature statuses
  and the ticket ledger visible in the replay (#15).
- The public barrel `@dejavu/core` and a single `CandidateCommit` definition
  (#18).
- Manual curation of signatures — merge, split, and the normalisation rule that
  would keep the same error from splitting again (CI-17) (#52).
- The quarantine proposal for an expensive flaky test (CI-19) (#54).
- Signature versioning: the optional `algorithmVersion` field on `Signature`,
  the golden lock of 14 real error blocks, the pure and idempotent migration
  planner, and the threshold calibration (#69).

**Forge applications**:

- The Sensor, the Bitbucket app: build-status triggers, the pull-request card,
  the workspace settings page, the masked payload and the signed forwarding
  (#13).
- The Brain, the Jira app: the three web triggers (`/ingest`, `/query`,
  `/universal`), the idempotent consumer, the Forge SQL store, the scheduled
  trigger and the settings (#23).
- The Brain UI, the Rovo agent and the six MCP actions of § 13 (#12).
- The UI Kit screens of both applications, the shared resolvers and the shared
  presentation package `@dejavu/present` (#53).
- Deployment-ready applications: the real app ids, the KVS storage, the
  bundler-resolvable imports and the lint-clean manifests (#56).
- The Custom UI of the Bitbucket modules: one static folder, a committed esbuild
  bundle, `forge lint` clean (#57).
- The project-page button "Replay the sample set": the 40 failures of the
  sample dataset fill the real Forge SQL memory and create the tickets they
  imply, through the real engine (§ 22, CI-11) (#58).
- Curation and quarantine wired into the Brain: the merge/split screens, the
  quarantine proposal screen and the `propose-quarantine` action (CI-17,
  CI-19) (#65).

**Data, tools and reproducibility**:

- The sample dataset (40 failures and 8 successes over 14 days), the
  100-failure hand-labelled corpus (27 groups), the replay tool and the
  accuracy evaluation (#16).
- Both Forge manifests validated against the official `@forge/manifest` schema
  in CI (#48).
- The deployment runbook: the real application identifiers, the Forge CLI
  chain, and the six lessons learned while deploying (#50).

**Public site and universal entry**:

- The public GitHub Pages site — the real engine and the real sample dataset
  running in the browser, with no account and no network call (#60).
- The universal entry shipped as copy-paste integrations: a GitHub Action, a
  GitLab CI snippet, a Jenkins snippet, an npm CLI (`deja-vu`) and a
  standard-library Python SDK, with the machine-readable contract in
  `docs/openapi.yaml` (#63).

**Security**:

- The security policy (`SECURITY.md`), the threat model
  (`docs/THREAT-MODEL.md`), the SBOM (`docs/SBOM.json`) and the tooling that
  generates and checks them (#62).
- The hardened bridge: retro-compatible key rotation (`SecretSet`,
  `rotateSecret`), the extensible masking table, the pure excerpt minimisation
  and the isolation tests (#66).

**Repository pipeline and agents**:

- The triage of red tests: the verdict that says whether a failing test is
  inside the scope of the pull request, and whether it passes when replayed
  alone (#25).
- The `hermes` agent as the fallback of the conflict resolver (#29), with the
  fixes that make it loadable from `origin/main` when the sweeper extracts the
  agent alone (#34) and startable without a file (#41).
- The conflict agent on an OpenAI-compatible provider, with provider-agnostic
  settings and the text and provider modules split out (#38).
- CI temporaries on the disk instead of the saturable `/tmp` tmpfs of the
  runners (#35).
- End-to-end probes of the conflict agent, run as documentation-only pull
  requests (#27, #32, #33, #39, #40), and the cleanup of the sections they
  left behind (#37). Two residual probe sections remain in `docs/ROADMAP.md`
  today — see `docs/ETAT-LIVRAISON.md` § 7.

**Documentation**:

- The judges' guide, the architecture page and its diagram, the demo script,
  the roadmap, the three ADRs and the original specification (#3).
- The status of every requirement, command and screen updated to what `main`
  really ships (#20).
- The pipeline of the repository: merge queue, guards, agents and their
  guardrails (#43).

### Changed

- Every function brought under fifty lines; the UI screens, the tools and the
  acceptance recipe were split accordingly (#22).
- The frozen dataset types split out of the domain types, to keep every file
  under the size limit (#11).
- The emitted `tsc` outputs next to the sources are ignored by the build
  hygiene (#49).

### Fixed

- Category accuracy brought to 100 % on the labelled corpus (pytest collection,
  Go compile, Gradle task, per-test timeout) (#17).
- The real Forge SDK versions declared, so the Sensor installs and type-checks
  (#45).
- A schema-compliant manifest, the real Forge SDK and a clean type-check for
  the Brain (#46).
- The lazily-loaded masking module published next to the site bundle (#61).

### Deployed Forge versions

Verified on 2026-11-12 with the Forge CLI (`forge version list`,
`forge install list`), against the two applications created on 2026-11-11
(`docs/DEPLOY.md`).

| Application | Platform identifier | Deployed build | Installation |
|---|---|---|---|
| **Brain** (Jira) | `ari:cloud:ecosystem::app/2abacda7-8c4f-4b29-9c97-7209dd240894` | major version **3**, `development` environment, deployed 2026-11-11T18:53:10Z | one installation on `one-atlas-cndz.atlassian.net` (Jira), status *Up-to-date* |
| **Sensor** (Bitbucket) | `ari:cloud:ecosystem::app/f4c98609-1c94-4e98-9e26-89cec008d6d7` | major version **1**, `development` environment, deployed 2026-11-11T15:53:13Z, **no module** | **not installed anywhere** |

Three facts worth stating plainly:

- The deployed Brain build exposes **16 functions and 6 actions**; the manifest
  on `main` declares **17 functions and 7 actions** (`propose-quarantine`,
  added in #65). The repository is ahead of the deployed build: the quarantine
  action is not on the demo site yet.
- The full version string of the Jira application is reported as **3.1.0** in
  the brief of this wave. The Forge CLI summary exposes major versions only, so
  that exact string is **not verified** — neither from the repository nor from
  the platform.
- The Sensor's only deployed version carries no module: the triggers, the
  pull-request card, the settings page and the Custom UI (#13, #57) have not
  been redeployed since the application was created, and the demo site has no
  Bitbucket to install it on (`docs/DEPLOY.md`, § 6).
