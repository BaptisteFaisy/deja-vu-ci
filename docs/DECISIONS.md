# Decision log — Déjà-vu CI

The three decisions that shaped the product have their own ADRs
([`docs/ADRs/`](ADRs/)): two twin applications, the memory on the Jira side,
and the deterministic signature before the model. This log records the
**smaller** ones — the choices a reader would otherwise find buried in a code
comment, a workflow header or a squashed pull request. Each entry gives the
context, the decision, the alternative that was rejected, and why.

Every entry is sourced: a file in the tree, a pull request, or a commit. Nothing
is invented.

---

## D-01 — The site bundle is committed, not built by the publishing workflow

- **Context.** The public site runs the real engine in the browser. Publishing
  it through GitHub Pages would normally mean building it in CI.
- **Decision.** `site/public/` (bundle, style sheet, page, fingerprint) is
  committed. The `site` workflow only uploads it.
- **Rejected.** Building the bundle in the publishing workflow.
- **Why.** No `npm ci` in that job, so the five-minute CI budget stays wide
  even on loaded runners; and what is published is exactly what the repository
  contains. Freshness is enforced *before* the merge instead:
  `site/test/bundle.test.mjs` recomputes the fingerprint of `site/src`,
  `packages/core`, `packages/present` and the dataset, and fails the CI if the
  committed bundle is older than its sources.
- **Source.** `.github/workflows/site.yml` (header), `tools/build-site.mjs`,
  `site/test/bundle.test.mjs` (#60, #61).

## D-02 — SHA-256 is implemented by hand for the browser

- **Context.** A signature identifier *is* a truncated SHA-256
  (`packages/core/src/sign.ts`). The public site must produce exactly the same
  identifiers as the Jira app, but the browser has no `node:crypto`.
- **Decision.** A pure TypeScript SHA-256 (FIPS 180-4), with no dependency and
  no shortcut.
- **Rejected.** A third-party hashing library (a runtime dependency in the
  published bundle), and the Web Crypto API (asynchronous only, while the
  engine signs synchronously).
- **Why.** The site shows the real memory, not an approximation of it. The
  implementation is verified byte by byte against `node:crypto`
  (`site/test/sha256.test.ts`) and end to end on the real identifiers of the
  sample set (`site/test/shim.test.ts`).
- **Source.** `site/src/lib/sha256.ts`, `site/src/lib/nodeCrypto.ts` (#60).

## D-03 — One shared replay engine, assembled statically

- **Context.** `loadEngine()` proves at runtime that every brick of the engine
  is separable, by importing the six sibling modules dynamically. A dynamic
  specifier cannot be resolved by a bundler — neither the Forge bundler
  (webpack) nor esbuild.
- **Decision.** `staticReplayEngine()` assembles the same `ReplayEngine` from
  the real functions of the package, statically. Two consumers, and no third
  copy: `apps/brain/src/seed.ts` (the "Replay the sample set" button) and
  `site/src/lib/demo.ts` (the in-browser demo).
- **Rejected.** Keeping the dynamic import in Node and duplicating the engine
  inside each bundle.
- **Why.** One implementation, shared. `assertEngine()` (`replay.ts`) validates
  the static assembly against the same contract the dynamic loader enforces.
- **Source.** `packages/core/src/engine.ts` (header comment) (#58, #60).

## D-04 — Squash and merge-update in the merge queue

- **Context.** GitHub refused to rebase pull requests that had already merged
  `main` ("GitHub cannot rebase the pull request").
- **Decision.** `.mergify.yml` uses `merge_method: squash` and
  `update_method: merge`.
- **Rejected.** Rebasing the pull-request branches.
- **Why.** One pull request = one commit on `main` (readable history); a branch
  is never rewritten; and a pull request that already merged `main` never fails
  to update. Mergify is the only merge pilot — neither a guard nor an agent
  merges anything.
- **Source.** `.mergify.yml` (comments), `docs/PIPELINE.md` § 2 (`20f22aa`).

## D-05 — The sample replay runs only on an empty memory

- **Context.** The project page carries a "Replay the sample set" button. A
  judge can click it twice.
- **Decision.** The seeding is idempotent: when signatures already exist,
  nothing is injected and the screen is told so (`seeded: false`). The counters
  of the summary report what *this* call did, not what the memory holds.
- **Rejected.** Always replaying and upserting over the existing rows.
- **Why.** A double click must never duplicate an occurrence or a ticket, and
  the memory must never show a ticket that does not exist: the placeholder
  issue keys written by the replay (`CI-1`, `CI-2`…) are replaced by the keys
  the real Jira answered with.
- **Source.** `apps/brain/src/seed.ts` (header and `alreadySeeded`) (#58).

## D-06 — `@forge/api` stays on 7.x

- **Context.** `@forge/api` 8.0.0 removed the `storage` export, which the
  Sensor uses for the pairing and the workspace preferences.
- **Decision.** The applications pin `@forge/api` to `^7.2.2` and use
  `@forge/sql` / `@forge/kvs` where they can.
- **Rejected.** Upgrading to 8.x and rewriting the storage layer.
- **Why.** The upgrade would touch the pairing secret path for no functional
  gain during the hackathon; the pin is declared in the app READMEs so the next
  reader does not "fix" it by accident.
- **Source.** `apps/sensor/README.md` ("`@forge/api` stays on 7.x — on
  purpose"), `docs/DEPLOY.md` lesson 4 (#45, #46).

## D-07 — The `LIMIT` of a Forge SQL query is inlined, not bound

- **Context.** Forge SQL is TiDB: a bound `LIMIT ?` fails with `ERROR 1210`.
- **Decision.** The limit is coerced to an integer and inlined into the query
  text; every other parameter stays bound.
- **Rejected.** Bound limits (they fail), and removing pagination (the 5 s
  budget per SELECT requires bounded queries).
- **Why.** It works today and keeps the queries parameterised everywhere else.
  Flagged in the runbook as the thing to watch if a new query needs a limit.
- **Source.** `docs/DEPLOY.md` lesson 5, `apps/brain/src/pure/sqlQueries.ts`.

## D-08 — The universal entry authenticates with a project key, not the HMAC bridge

- **Context.** Any CI must be able to report a failure without a Forge
  installation. The signed bridge needs a shared secret established by pairing.
- **Decision.** `/universal` authenticates with a per-project key in the body,
  compared to the Brain's `universalKey` setting, and fails closed: `404` when
  no key is configured, `503` when the masking engine is unavailable.
- **Rejected.** Requiring the HMAC envelope on this route (each CI would need a
  distributed secret and a signing implementation), and leaving the route open.
- **Why.** It is the simplest thing a shell one-liner can do, and the route is
  documented as the weakest surface of the product — gap 1 of the threat model,
  with the hardening path written down (a per-project random secret in the
  Forge secret storage).
- **Source.** `docs/API-UNIVERSELLE.md` ("Trust model"), `docs/THREAT-MODEL.md`
  § 2, `docs/SECURITE-ETAT.md` (#6, #63).

## D-09 — Reporting never fails the caller's build, and nothing is queued locally

- **Context.** A CI must not turn red because the Brain is unreachable.
- **Decision.** Every integration retries transient errors with backoff, logs a
  warning, and continues the build. There is deliberately no client-side
  persistence queue.
- **Rejected.** A local queue that flushes its reports when the network is back.
- **Why.** No accumulation of stale reports to spray at the Brain later; and a
  manual replay is safe, because every payload carries a stable
  `idempotencyKey`.
- **Source.** `docs/API-UNIVERSELLE.md` ("When the Brain is down"),
  `integrations/python/deja_vu_ci.py` (module docstring),
  `integrations/gitlab/gitlab-ci.yml`, `integrations/jenkins/Jenkinsfile` (#63).

## D-10 — The idempotency key is stamped by the client; the Brain does not deduplicate yet

- **Context.** A retried step could report the same failure twice.
- **Decision.** Every reporter stamps the payload with `idempotencyKey`, a
  stable SHA-256 fingerprint of the exact content sent. The Brain accepts the
  field but does not deduplicate on it today.
- **Rejected.** Dropping the field until the server uses it, and changing the
  wire format later.
- **Why.** The wire format is stable now, so server-side deduplication can land
  without breaking any client. The limit is written in the API documentation
  and in `docs/openapi.yaml` rather than hidden.
- **Source.** `docs/API-UNIVERSELLE.md` ("Idempotence"), `docs/openapi.yaml`
  (#63).

## D-11 — Excerpt minimisation is a pure function, not wired yet

- **Context.** Raw excerpts are the only bulky rows in the memory; keeping the
  full raw text is the least-minimising choice.
- **Decision.** `minimizeExcerpt` (three policies: `hash-only`,
  `masked-snippet`, `full`) is pure, tested and exported — but no application
  calls it yet. The two natural branch points (the consumer, the retention
  sweep) are documented.
- **Rejected.** Wiring a default policy immediately.
- **Why.** The retention policy is a product decision; wiring it is a settings
  field plus one call site, deliberately left to a follow-up lot so the choice
  is made with the product owner. Secrets are masked before anything is
  retained under every policy, including `full`.
- **Source.** `packages/core/src/minimize.ts` (header),
  `docs/DATA-MINIMIZATION.md` ("Branch point (not wired yet)") (#66).

## D-12 — Key rotation accepts a set of secrets, and the rotation itself is pure

- **Context.** Replacing the bridge secret everywhere at once drops in-flight
  messages: the HMAC check fails and the request is refused.
- **Decision.** `verifyRequest` accepts a `SecretSet` — the active key signs,
  the retired keys still verify during an overlap the operator closes.
  `rotateSecret(current, next)` is pure: no clock, no storage, no expiry of its
  own. A single string secret is treated as a one-element set, so existing
  callers are unaffected.
- **Rejected.** A hard cut-over, and a key identifier carried on the wire.
- **Why.** No downtime, no new field in the envelope, and a refusal reason
  never reveals a secret, a key identifier or the expected nonce — asserted by
  the attack suite.
- **Source.** `docs/KEY-ROTATION.md`, `packages/bridge/src/index.ts`,
  `packages/bridge/test/rotation.test.ts`, `packages/bridge/test/attacks.test.ts`
  (#66).

## D-13 — The issue context stays a text variant, not a UI panel

- **Context.** The ticket needs two readers: the human, and the Rovo agent.
- **Decision.** `jira:issueContext` is declared in its **function/text**
  variant — the current diagnostic, its ticket and what the failure already
  cost, as text. The human view is the `jira:issuePanel` above it.
- **Rejected.** One UI Kit panel serving both readers.
- **Why.** An agent reads text; a panel renders pixels. Two surfaces built from
  the same pure view model (`src/pure/issueContextText.ts`) cannot drift, and
  the text variant is what the schema requires `label` for.
- **Source.** `apps/brain/manifest.yml` (`jira:issueContext` comment),
  `apps/brain/test/issueContextText.test.ts` (#23, #53).

## D-14 — The Bitbucket modules render the same Custom UI folder

- **Context.** UI Kit does not exist for Bitbucket, and `forge lint` refuses a
  UI resource that is not a directory.
- **Decision.** The pull-request card and the workspace settings page both
  render one static folder (`static/`: `index.html`, `styles.css`, and the
  committed esbuild bundle `index.js`), served in an iframe, routing on the
  module key.
- **Rejected.** Two separate resources, and waiting for a Bitbucket UI Kit.
- **Why.** One application, lint-clean, with the same words as the Jira side —
  the labels come from `packages/present`, the same table the Brain uses.
- **Source.** `apps/sensor/manifest.yml` (comments), `apps/sensor/README.md`,
  `apps/sensor/src/ui/custom.tsx` (#57).

## D-15 — The masking table is extensible, never replaceable

- **Context.** Every stack has its own secret shapes; a fixed table will miss
  some.
- **Decision.** `maskSecrets(text, { extraPatterns })` **appends** caller
  patterns to the defaults. Extra patterns never remove or reorder a default
  rule, and idempotence is preserved as long as they do not match the neutral
  tokens.
- **Rejected.** A fully configurable table (the defaults would stop being a
  floor), and pretending the coverage is complete.
- **Why.** The default rules stay a security floor; the limits (postal
  addresses, free-text names, IP addresses and hostnames are **not** masked)
  are written down rather than over-claimed — "a false sense of coverage is
  worse than a written limit".
- **Source.** `docs/MASKING.md`, `packages/core/src/mask.ts`,
  `packages/core/test/mask-extended.test.ts` (#66).

## D-16 — The sample datasets are generated, not hand-written

- **Context.** The replay dataset must produce the four diagnostics and the
  three status movements; the labelled corpus must be reproducible.
- **Decision.** Both files are generated by `tools/gen/` from realistic log
  builders (`tools/lib/logs.mjs`), and `npm run check:data` verifies their
  conformity.
- **Rejected.** Hand-written JSON.
- **Why.** A generator can be re-run, extended and diffed; a hand-written
  corpus silently rots. The corpus grew to 100 labelled failures in 27 groups
  this way.
- **Source.** `data/README.md`, `tools/gen/sample.mjs`, `tools/gen/corpus.mjs`,
  `tools/check-dataset.mjs` (#16, #17).

## D-17 — Both manifests are validated against the official schema in CI

- **Context.** The Forge manifest schema is strict and the installed CLI can be
  older than the schema; a rejected manifest is discovered at deploy time.
- **Decision.** `tools/validate-manifest.mjs` validates both `manifest.yml`
  files against the official `@forge/manifest` schema, in the `ci` job, with no
  token and no network.
- **Rejected.** Relying on `forge lint` alone (it needs credentials and a
  deployment context).
- **Why.** The check is free, offline and runs on every pull request — it is
  what caught the schema details recorded in the deployment runbook (the
  `consumer` variant that accepts no `retry`, `action` requiring `actionVerb`,
  `rovo:mcp` refusing `description` and `cloud`).
- **Source.** `tools/validate-manifest.mjs`, `tools/manifests.test.mjs`,
  `docs/DEPLOY.md` lesson 3 (#48).

## D-18 — Signature identifiers carry an algorithm version, frozen by a golden lock

- **Context.** A signature identifier *is* a truncated SHA-256 of the
  normalised error. If normalisation changes, every stored identifier becomes
  an orphan: the tickets point at fingerprints that no longer reproduce, and
  the memory — the heart of the product — is lost.
- **Decision.** An optional `algorithmVersion` field on `Signature`
  (absent = current version at write time, so no data migration is needed to
  add it); a golden test that freezes 14 real error blocks through the whole
  pipeline; and a pure, idempotent migration (`planSignatureMigration`,
  `applySignatureMigration`) that moves occurrences, merges duplicates and
  keeps the oldest `firstSeen`, the newest `lastSeen` and the most advanced
  status.
- **Rejected.** Letting the normaliser evolve freely and rehashing silently.
- **Why.** Whoever changes normalisation sees the golden lock break; the
  answer is then to ship a migration, not to copy the new numbers into the
  test.
- **Source.** `docs/SIGNATURE-VERSIONING.md`,
  `packages/core/src/signature-version.ts`,
  `packages/core/test/signature-golden.test.ts` (#69).

## D-19 — CI temporaries live on the disk, and `node_modules` survives the runs

- **Context.** The runners' `/tmp` is a 16 GB tmpfs, shared and seen full at
  100 %: vitest died with `ENOSPC` while the disk had 90 GB free.
- **Decision.** `TMPDIR` points at `$HOME/.cache/ci-tmp`; `git clean -ffdx`
  spares `node_modules`, which is reinstalled only when the fingerprint of
  `package-lock.json` changes.
- **Rejected.** Keeping the platform default temp directory, and a full
  `npm ci` on every run.
- **Why.** Both choices buy minutes against a five-minute budget per job, on
  self-hosted runners that do not even carry Node on the default `PATH`.
- **Source.** `docs/PIPELINE.md` § 1, `.github/workflows/ci.yml` (`8948e23`,
  #35).

## D-20 — Mergify is the only merge pilot; the agents never merge

- **Context.** The repository runs agents that resolve conflicts, fix red
  tests and complete a missing scope. An agent that merges is an agent that can
  merge a red build.
- **Decision.** One pilot: the Mergify queue, gated on three required checks
  (`ci`, `ci-budget`, `couche0`). The agents write to the pull-request branch
  only — never `main`, never `.github/`, never the guards. A resolution that
  does not compile is never pushed; success is judged on the real
  `mergeable_state`, never on the model's narrative; and a circuit breaker
  (`FIREWORKS_AGENT_RESOLVE=0`) disables every escalation.
- **Rejected.** Letting an agent merge, or letting a guard merge.
- **Why.** "Never a red CI because of an agent" — the worst case is a comment
  and the `intervention-humaine` label.
- **Source.** `docs/PIPELINE.md` § 2–4, `.mergify.yml`,
  `.github/fireworks/*.py` (#29, #38, #43).

## D-21 — The conflict agent uses a generic provider, with a local fallback

- **Context.** The conflict resolver calls an OpenAI-compatible API. Keys
  expire, quotas run out, models get retired.
- **Decision.** Generic variables (`MODEL_API_KEY`, `MODEL_API_URL`,
  `MODEL_NAME`) take priority over the historical `FIREWORKS_*` names. If the
  API refuses, the same question goes to the local `hermes` agent of the
  runner's daemon (A2A). If the fallback is unavailable too, the original error
  is kept, a comment is posted, and the label `intervention-humaine` is added.
- **Rejected.** One hard-wired provider, and failing the CI when the agent
  fails.
- **Why.** Resilience without a paid dependency, and the invariant of D-20:
  an agent problem is never a CI problem.
- **Source.** `docs/PIPELINE.md` § 4, `.github/hermes/a2a.py` (#29, #34, #38,
  #41).

## D-22 — The engine is the only source of truth; every surface only wires it

- **Context.** The same diagnostic is shown on a pull-request card, on a Jira
  panel, in a browser, and answered by an agent. Four implementations would be
  four divergences.
- **Decision.** All the logic lives in `packages/core` (no Forge import, no
  React import, `node:*` only at runtime). The applications, the site and the
  tools are adapters: they read an event, call the engine, render its output.
  The shared vocabulary (English and French labels, tones, formatters, screen
  routing) lives once in `packages/present`.
- **Rejected.** Logic in the resolvers, screens or scripts.
- **Why.** The consequence is the product's promise: the same diagnostic from
  every surface, and an engine that is unit-testable without a tenant, without
  a network, and fast enough for the CI budget.
- **Source.** `docs/ARCHITECTURE.md` § 6, `packages/core/src/index.ts`,
  `packages/present/src/index.ts` (#12, #53, #60).
