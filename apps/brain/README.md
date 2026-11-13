# Déjà-vu CI — Cerveau (Brain), Jira side

The Brain is the memory of the pair (specification § 7). It receives failure
occurrences from the Sensor (Bitbucket) through a signed web trigger, from any
CI through the universal entry, computes signatures, stores the memory in
Forge SQL, diagnoses failures, keeps **one Jira ticket per failure family**,
and answers the PR card, the UI Kit screens, the Rovo agent, and the MCP
server.

All the business logic lives in [`@dejavu/core`](../../packages/core); this
app only wires it to the Forge platform. All pure logic (payload validation,
nonce replay guard, consumer idempotency, SQL query building, row mapping)
lives in `src/pure/` and is tested by `test/*.test.ts` without any `@forge/*`
import.

## Routes (web triggers)

| Route | Purpose | Answer |
|---|---|---|
| `POST /ingest` | Signed occurrence from the Sensor (HMAC bridge, § 15) | `202` as soon as the message is queued |
| `POST /query` | Signed `pr-card` request from the Sensor | `QueryResponse` with the diagnosis of the last known failure |
| `POST /universal` | Log excerpt from any CI, protected by the project key (§ 15, CI-16) | `202` as soon as the message is queued |

A web trigger **never** runs the diagnosis: it verifies, queues, and answers
immediately. The consumer does the heavy work.

## Modules

- `consumer` — extraction → signature → diagnosis → Forge SQL → ticket plan
  (`planTicketActions`) → Jira issue updates → PR-card cache. Idempotent:
  replaying the same message changes nothing.
- `scheduledTrigger` — daily synthesis, suggested closures, raw-excerpt purge
  (`purgeExpired`), outbreak detection.
- `sql` — the memory schema (`SQL_SCHEMA` from `@dejavu/core`), migrated
  idempotently on first use.
- `llm` — fallback normalisation only, when no pattern recognised a block
  (§ 9.5), cached by normalised text hash.
- `jira:projectPage`, `jira:issuePanel`, `jira:projectSettingsPage` — UI Kit 2
  screens. All three render the same hosted resource (`resources: main` →
  `src/frontend.tsx`), which routes on the module key and reads its data
  through one resolver (`uiResolverHandler`).
- `jira:issueContext` — kept in its **text** variant: what a Rovo agent reads
  about a ticket (diagnostic, ticket, CI cost), built by
  `src/pure/issueContextText.ts`.
- `rovo:agent`, `action`, `rovo:mcp` — the six actions of § 13 (lot G),
  exposed identically to Rovo and to MCP clients.

## UI Kit wiring (§ 14)

| Piece | File | Role |
|---|---|---|
| Entry point | `src/frontend.tsx` | `ForgeReconciler.render(<App/>)`; routes `moduleKey` → screen |
| Routing table | `src/pure/screens.ts` | Pure and unit-tested: no React needed to check it |
| Screens | `src/ui/{projectPage,issueContext,settingsPage}.tsx` | The three screens of § 14 (lot G) |
| Resolvers | `src/resolvers.ts` | Dispatches `invoke('memory-page' \| 'issue-context' \| 'settings' \| 'save-settings')` |
| Shared words | `packages/present` | Labels, formatters and screen routing shared with the Sensor |
| Icon | `static/icon.svg` | 32×32, referenced as `resource:icon;icon.svg` |

A module declares `resource: main` + `render: native` + a `resolver.function`;
the schema requires `icon` on `jira:issuePanel`. `tools/manifests.test.mjs`
checks the wiring against the disk: every UI module resolves to a resource
whose file exists, and every resolver is a declared function.

## Forge platform limits (design constraints)

| Limit | Value | Consequence here |
|---|---|---|
| Web trigger timeout | 55 s | verify + queue + answer only |
| Async function (consumer, scheduled) | 900 s | one message per invocation, batched purge |
| Payload size | 5 MB | the bridge already refuses bigger bodies |
| Forge SQL | 1 GiB per installation, 5 s per SELECT | indexes on `signature.family_id` and `occurrence(signature_id, occurred_at)`; every screen query is indexed |
| LLM | 100 requests/min | template cache: the same raw error is never submitted twice |

## Security

- The bridge secret is read from the Forge secret storage, never from code or
  logs (§ 15).
- Every payload is masked before storage or logging (`maskSecrets`).
- Every handler catches: the answer is `{ ok: false, error }`, never a
  thrown exception.

## Pairing (jumelage)

The Sensor stores the Brain's base URL and a secret id; the Brain stores the
matching `pairing` row (workspace → secret id) in Forge SQL and the secret
itself in the Forge secret storage. `verifyRequest` of `@dejavu/bridge`
checks the HMAC-SHA256 signature, the timestamp window (±300 s), and the
nonce (replay guard kept in `src/pure/nonce.ts`).

## Development

```bash
npm install --no-audit --no-fund   # installs the real Forge SDK packages
npm run typecheck                  # strict tsc against the real SDK
npx vitest run apps/brain/test --reporter=dot   # from the repository root
```

`apps/brain` is intentionally **not** part of the root npm workspace: it
installs its own `node_modules` (the real `@forge/*` SDK, versions pinned in
`package.json`) so `npm run typecheck` compiles the adapters against the
platform APIs — `Queue` of `@forge/events`, the `prepare`/`executeDDL` client
of `@forge/sql`, `chat` of `@forge/llm`, the UI Kit of `@forge/react`. The
Forge bundler still provides those packages at deploy time.

The root test run stays free of any `@forge/*` runtime import: tests only
cover `src/pure/`, `src/actions/`, `src/rovo/`, `src/resolvers.ts`, `src/seed.ts`
and the UI helpers, which import types from `@dejavu/core` (erased at runtime)
and never a runtime value of a platform package. `@dejavu/present` — the labels,
formatters and screen routing shared with the Sensor — and `@dejavu/core` are
resolved from their **source** by `vitest.config.ts`, so no build is needed to
run the tests; the seeding of `src/seed.ts` is the one place where an app imports
runtime values of the engine (the real replay, the real diagnostics). A deployed
bundle resolves the built packages, so `npm run build` at the root comes before
`forge deploy`.

## Sample replay (§ 22, CI-11)

A judge installs the Brain, opens the project page **Déjà-vu CI** and clicks
**Replay the sample set**: the 40 failures of `data/sample/occurrences.json`
(14 days, one fictional payments monorepo) are replayed through the real engine
into the real Forge SQL memory, and the tickets they imply are created on the
real Jira — one ticket per problem family, at most one synthesis comment per
day (§ 11).

- `src/seed.ts` — the seeding itself: no `@forge/*` import, the memory and the
  Jira side are injected, so it is unit-tested with `MemoryStore` and a fake
  applier. **Idempotent**: on a memory that already holds signatures nothing is
  injected, and the screen says so.
- `src/ui/sampleReplay.tsx` + `src/ui/sampleSummary.ts` — the button, its
  "running" state and the summary it renders (both languages, `src/ui/i18n.ts`).
- The dataset is embedded in the bundle: `apps/brain/src/data/sample-dataset.json`
  is a **copy** made by `tools/copy-sample.mjs` (`npm run build:seed` in this
  directory). Never edit the copy by hand — `tools/copy-sample.test.mjs`
  compares it with the tracked dataset and fails on any drift.
- The Forge bundler builds from this directory, hence the copy: the placeholder
  issue keys the replay writes (`CI-1`, `CI-2`…) are replaced by the keys Jira
  really answered with before the memory is read again.

## One React in the UI bundle

The UI Kit 2 bundle must contain **one** copy of React.

On 2026-11-13 the Brain deployed in production rendered a blank page:
`TypeError: Cannot read properties of null (reading 'useState')`. The bundle
held **two** copies of React — the app's own code on one side, the renderer
`react-reconciler` (which installs the dispatcher the hooks read) on the other.
The renderer wrote into one copy, the app read the other, and every screen
crashed on its first hook.

The duplicate came from a stray `node_modules/node_modules/` tree in the
working copy: the Forge bundler builds with the local tree. Three guards keep
it out:

- React and React DOM are pinned to an exact version and repeated in
  `overrides`, so no transitive dependency can pull a second one in.
- `node tools/forge-tree.mjs` (or `npm run check:forge-tree`) inspects the
  installed tree and fails when a package is in double — run it before
  `forge deploy` (see `docs/DEPLOY.md`).
- `tools/forge-tree.test.mjs` tests that check against a fixture built from
  the tree that broke production.

When the check fails, the tree is polluted: redo the install in the app
directory with `npm ci`. An `npm install` on an already polluted tree keeps
the duplicate.
