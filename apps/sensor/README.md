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
| `bitbucket:repoPullRequestCard` | `prCardResolver` → `getPrCard` | The card in the pull request asks the Brain for the diagnostic (§ 14, screen 1). |
| `bitbucket:workspaceSettingsMenuPage` | `settingsResolver` → `getSettings`, `saveSettings` | Pairing, watched repositories, maximum excerpt size (§ 14, screen 2). |

The Bitbucket modules of the manifest schema declare **no `render`
property**: UI Kit does not exist for Bitbucket, and `forge lint` refuses a
UI resource that is not a directory. Both UI modules therefore render the
same **Custom UI** — the static folder `resources: main` → `static/`
(`index.html`, `styles.css`, and the committed bundle `index.js`), served in
an iframe. The entry point (`src/ui/custom.tsx`, React DOM) routes on the
module key (`src/pure/screens.ts`) and reads its data through `invoke()` of
`@forge/bridge`. The card (`src/ui/customPrCard.tsx`) and the settings page
(`src/ui/customSettings.tsx`) place exactly what the pure view models produce
(`src/pure/prCardView.ts`, `src/pure/settingsView.ts`); their words come from
`packages/present`, the same table the Brain uses.

Scopes: `read:repository:bitbucket`, `read:pipeline:bitbucket`,
`read:pullrequest:bitbucket`, `storage:app`.
`permissions.external.fetch.backend` allows `*.webtrigger.atlassian.app`
only — the address of the Brain. Nothing else can be called from here.

Runtime: `nodejs22.x`.

### `@forge/api` stays on 7.x — on purpose

`@forge/api` **8.0.0 removed the `storage` export**, which this app uses for
the pairing and the workspace preferences (`src/settings.ts`,
`src/bitbucketApi.ts`). The Brain moved to Forge SQL and could take 8.x; the
Sensor keeps `@forge/api ^7.2.2` because migrating it to SQL would mean a
`sql` module and a schema for two settings rows — more moving parts for the
same behaviour. Check it any time with:

```bash
cd apps/sensor && node -e "console.log(typeof require('@forge/api').storage)"   # → object
```

The frontend packages (`react`, `react-dom`, `esbuild`) are independent of
that choice: the Custom UI only talks to `@forge/bridge`, and its bundle is
built once, then committed.

### Uncertainties (to confirm with `forge lint` and a prototype)

The specification (§ 17) lists these as points to check; they are recorded
here so that the next reader knows what is assumed:

1. **Module keys.** The brief named `bitbucket:pullRequestCard` and
   `bitbucket:workspaceSettingsPage`. Those keys do not exist in the Forge
   manifest schema shipped with `@forge/manifest` 12.9.0; the closest real
   keys are used here: `bitbucket:repoPullRequestCard` and
   `bitbucket:workspaceSettingsMenuPage`.
2. **Two entries for the settings page.** ~~The save action is declared as a
   second `bitbucket:workspaceSettingsMenuPage` entry.~~ **Resolved**: with a
   resolver, one page module answers both `invoke('getSettings')` and
   `invoke('saveSettings')`, so the manifest declares a single page and
   `saveSettings` is a resolver key (`src/index.ts` → `settingsResolver`).
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
| `src/index.ts` | The Forge functions and the module resolvers (`prCardResolver`, `settingsResolver`, `handler`). Wiring only; never throws. |
| `src/ui/custom.tsx` | Custom UI entry point (React DOM): reads the platform context (`view.getContext()`), routes the module key to the card or the settings page. Bundled by esbuild into `static/index.js`. |
| `src/ui/customPrCard.tsx` | The pull-request card (§ 14, screen 1). |
| `src/ui/customSettings.tsx` | The workspace settings page (§ 14, screen 2). The secret field is write-only. |
| `src/ui/parts.tsx` | Pieces shared by the two screens (the language button). |
| `src/ui/data.ts` | The `invoke()` loader, built on `@dejavu/present` (one unwrapping for both apps). |
| `static/index.html`, `static/styles.css` | The Custom UI page and its styling — self-hosted only, the Forge iframe has a strict CSP. |
| `static/index.js` | The **committed** esbuild bundle of `src/ui/custom.tsx` — `npm run build:ui`. |
| `static/icon.svg` | The 32×32 icon the card declares (`resource:icon;icon.svg`). |
| `src/pipelines.ts` | Reads the Pipelines API through an injected reader: pipeline of a commit, steps, log tail, test reports, commits, diffstat. |
| `src/bitbucketApi.ts` | The only file that talks to `@forge/api`: the Bitbucket reader used in production. |
| `src/buildPayload.ts` | Collects one failing build and builds the `IngestPayload`. |
| `src/masking.ts` | Adapter to `maskSecrets` from `@dejavu/core`. Fails closed. |
| `src/send.ts` | Signs with `@dejavu/bridge` and posts to the Brain. |
| `src/settings.ts` | Pairing and settings in `storage:app`; the secret lives in the Forge secret storage. |
| `src/ancestry.ts` | Pure ancestor comparison (§ 10.2) with an injected commit reader. |
| `src/pure/*.ts` | Everything testable without Forge: payload construction, block selection and truncation, `Range` computation, event and API parsing, settings, the card's view model (`prCardView.ts`), the page's form (`settingsView.ts`), the resolver dispatch (`dispatch.ts`) and the screen routing (`screens.ts`). |
| `test/*.test.ts` | Unit tests of the pure modules; no network, no `@forge/api`, no React. |

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
npm run typecheck           # tsc -p . --noEmit (checks the .tsx screens too)
cd ../.. && npx vitest run apps/sensor/test --reporter=dot
```

The root CI typechecks `packages/core`, `packages/bridge` and `packages/present`
and runs every test of `packages/**` and `apps/**/test/**`; the Sensor tests are
part of it and need no network, no Forge runtime, no React and no built engine.
The screens import `@dejavu/present` (labels, formatters, routing) through the
`paths` of `tsconfig.json`; a deployed bundle resolves the built package, so
`npm run build` at the root comes before `forge deploy`.

### The Custom UI bundle is committed

`forge deploy` ships the `static/` folder as it is, so a judge can deploy with
**no build tooling**: `static/index.js` is the esbuild bundle of
`src/ui/custom.tsx`, and it is versioned. After any change to the screens, to
the pure view models or to `packages/present`, regenerate it:

```bash
npm run build               # at the root: the bundle resolves packages/present/dist
cd apps/sensor
npm install                 # once: pulls react-dom and esbuild
npm run build:ui            # esbuild → static/index.js (minified, production)
```

The guard `tools/manifests.test.mjs` checks the wiring at the root: the `main`
resource is a directory, `index.html` loads `./index.js` and `./styles.css`
(and nothing external — the iframe CSP forbids CDNs), and the committed bundle
has a sane minimum size plus the markers of the current sources (module keys,
resolver names). A stale or missing bundle fails the tests.
