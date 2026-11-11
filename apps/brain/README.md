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
- `jira:projectPage`, `jira:issueContext`, `jira:projectSettingsPage` — UI Kit
  screens (lot G) rendered through resolvers.
- `rovo:agent`, `action`, `rovo:mcp` — the six actions of § 13 (lot G),
  exposed identically to Rovo and to MCP clients.

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
cover `src/pure/`, `src/actions/`, `src/rovo/` and the UI helpers, which
import types from `@dejavu/core` (erased at runtime) and never a runtime
value of a platform package.

