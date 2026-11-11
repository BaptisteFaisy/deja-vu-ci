# Déjà-vu CI — Capteur (Sensor)

The Bitbucket half of the pair. The Sensor watches the build statuses of a
paired workspace, reads what failed, masks the secrets, and sends a signed
payload to the **Brain** (the Jira app), which owns all the memory: the
signature, the diagnostic and the tickets.

```
Bitbucket build status ─▶ Sensor (this app) ──signed bridge──▶ Brain (Jira app)
                            │                                     │
                            ├─ pipeline + failed step             ├─ signature, family
                            ├─ log tail (partial request)         ├─ diagnostic
                            ├─ test reports / failed cases        └─ one ticket per problem
                            └─ ancestors, changed files
```

The Sensor keeps **no build data** (§ 7). Its only durable state is the
pairing with a Brain and the preferences of the workspace.

## Modules (`manifest.yml`)

| Module | Function | Role |
|---|---|---|
| `trigger` (`avi:bitbucket:created:build-status`, `avi:bitbucket:updated:build-status`) | `onBuildStatus` | A build turned red: read it, mask it, sign it, forward it. |
| `bitbucket:repoPullRequestCard` | `getPrCard` | The card in the pull request asks the Brain for the diagnostic (§ 14, screen 1). |
| `bitbucket:workspaceSettingsMenuPage` | `getSettings` | Pairing, watched repositories, maximum excerpt size (§ 14, screen 2). |
| `bitbucket:workspaceSettingsMenuPage` | `saveSettings` | Saves the same page, and writes the shared secret to the Forge secret storage. |

Scopes: `read:repository:bitbucket`, `read:pipeline:bitbucket`,
`read:pullrequest:bitbucket`, `storage:app`.
`permissions.external.fetch.backend` allows `*.webtrigger.atlassian.app`
only — the address of the Brain. Nothing else can be called from here.

Runtime: `nodejs20.x`.

### Uncertainties (to confirm with `forge lint` and a prototype)

The specification (§ 17) lists these as points to check; they are recorded
here so that the next reader knows what is assumed:

1. **Module keys.** The brief named `bitbucket:pullRequestCard` and
   `bitbucket:workspaceSettingsPage`. Those keys do not exist in the Forge
   manifest schema shipped with `@forge/manifest` 12.9.0; the closest real
   keys are used here: `bitbucket:repoPullRequestCard` and
   `bitbucket:workspaceSettingsMenuPage`.
2. **Two entries for the settings page.** A page module declares one
   function, so the save action is declared as a second
   `bitbucket:workspaceSettingsMenuPage` entry with its own key. If Forge
   prefers a single page with a resolver, the two entries collapse into one
   and `saveSettings` becomes a resolver key.
3. **Event names.** `avi:bitbucket:created:build-status` and
   `avi:bitbucket:updated:build-status` are the names given by the
   specification; they are absent from the product-event mapping of
   `@forge/manifest` 12.9.0 (which lists repository, pull-request and
   deployment events only). The schema accepts free-form event strings, so
   the manifest is valid; the delivery of the event has to be confirmed on a
   real workspace.
4. **`app.id`.** A placeholder is committed. `forge create` / `forge install`
   replaces it with the real ari; never commit a real app id next to a
   secret.
5. **Pipelines endpoints.** The step log, the test reports and the test cases
   are read from `/2.0/repositories/{ws}/{repo}/pipelines/...`. The exact
   segment names of the test-report endpoints (`/testReports`,
   `/test-cases`) are isolated in `testReportPath` and `testCasePath`
   (`src/pipelines.ts`) so that a single edit fixes them all.
6. **Partial requests on the log.** The log is asked with
   `Range: bytes=-<n>`. When the endpoint ignores the header and answers
   `200`, the tail is cut locally (`keepTail`). Both paths are tested.
7. **`@dejavu/core` barrel.** The Sensor imports the domain types and
   `maskSecrets` from the engine package. `packages/core/package.json`
   exposes a single entry point (`./dist/index.js`), so the engine needs a
   barrel (`packages/core/src/index.ts`) that re-exports `types.ts` and
   `mask.ts`. That file is not listed in `docs/CONTRACTS.md` ownership table;
   until it exists, `apps/sensor` resolves its types through
   `packages/core/src/types.ts` (see `tsconfig.json`) and the masking
   adapter (`src/masking.ts`) fails **closed** at runtime.

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | The Forge functions and the `handler` entry point. Wiring only; never throws. |
| `src/pipelines.ts` | Reads the Pipelines API through an injected reader: pipeline of a commit, steps, log tail, test reports, commits, diffstat. |
| `src/bitbucketApi.ts` | The only file that talks to `@forge/api`: the Bitbucket reader used in production. |
| `src/buildPayload.ts` | Collects one failing build and builds the `IngestPayload`. |
| `src/masking.ts` | Adapter to `maskSecrets` from `@dejavu/core`. Fails closed. |
| `src/send.ts` | Signs with `@dejavu/bridge` and posts to the Brain. |
| `src/settings.ts` | Pairing and settings in `storage:app`; the secret lives in the Forge secret storage. |
| `src/ancestry.ts` | Pure ancestor comparison (§ 10.2) with an injected commit reader. |
| `src/pure/*.ts` | Everything testable without Forge: payload construction, block selection and truncation, `Range` computation, event and API parsing, settings. |
| `test/*.test.ts` | Unit tests of the pure modules; no network, no `@forge/api`. |

## Reading a failure, and what happens when it cannot be read

A missing log is **not** an error (§ 17). The order is:

1. **Test reports** (`/testReports`, then `/test-cases?status=FAILED`) — the
   richest source: the failing test name, its message and its stack.
2. **The tail of the step log**, read with a partial request.
3. **Nothing.** The step is still reported, with `source: 'none'` and the
   reasons kept in `notes`, so the Brain records the occurrence and answers
   "uncertain" instead of losing the build (§ 19: "a build of another CI
   without an accessible log").

What is collected is then masked and bounded before it leaves Bitbucket:

- every error block and every test-case message and stack goes through
  `maskSecrets` (the engine, never a copy of it);
- at most **3 blocks** and **50 KiB** in total (§ 19);
- at most **100 commit hashes** in `branchHistory`;
- if the masking engine is unavailable, nothing is sent at all.

### The ancestor verdict (§ 10.2)

The Brain owns the memory, the Sensor owns Bitbucket, so "already seen,
already fixed" needs both:

1. before sending an occurrence, the Sensor asks the Brain (`/query`) for the
   diagnostic of the branch;
2. if that diagnostic cites the commit of a fix, the Sensor walks the
   ancestors of the built commit and answers "does this branch contain it?";
3. the verdict is added to the payload as `containsResolution`.

The walk is bounded (`MAX_ANCESTOR_DEPTH`) and an inconclusive comparison
leaves the field out: a missing verdict is never read as a negative verdict.

### Entry point

`manifest.yml` points every module at a function key; `index.handler`
dispatches on it. Each resolver answers `{ ok: false, error }` instead of
raising — a Forge function that throws is retried by the platform and the
build event is lost anyway.

## Pairing

1. Install the Brain (Jira) and copy its web-trigger base URL.
2. In Bitbucket → workspace settings → *Déjà-vu CI*, paste the URL and a
   shared secret of at least 16 characters, and save.
3. The secret is written to the Forge **secret** storage; the application
   storage keeps only its identifier (`pairing.secretId`, § 16). No resolver
   ever returns it and no log ever prints it.
4. Every call to the Brain is signed: HMAC-SHA256 over
   `"<timestamp>.<nonce>.<body>"`, with a 300 s window and a nonce that the
   Brain refuses to see twice (`@dejavu/bridge`).

## Working on this app

```bash
cd apps/sensor
npm install                 # the app is not part of the root npm workspace
npm run typecheck           # tsc -p . --noEmit
cd ../.. && npx vitest run apps/sensor/test --reporter=dot
```

The root CI typechecks `packages/core` and `packages/bridge` and runs every
test of `packages/**` and `apps/**/test/**`; the Sensor tests are part of it
and need no network, no Forge runtime and no built engine.
