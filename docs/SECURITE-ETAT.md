# Security status

One page on the real state of security testing for Déjà-vu CI. What is covered by
a test, what is not, and the three next moves. The analysis backing this lives
in [`docs/THREAT-MODEL.md`](THREAT-MODEL.md).

## What is tested

Security-relevant behaviour is pinned by these test files:

| File | What it verifies |
|---|---|
| `packages/bridge/test/bridge.test.ts` | HMAC signature (forgery/tampering refused), nonce replay, timestamp window, oversized body, case-insensitive headers, envelope ↔ header consistency |
| `packages/core/test/mask.test.ts` | secret masking of tokens/AWS/JWT/private keys, idempotency, `containsSecret` |
| `packages/core/test/universal.test.ts` | universal entry: strict validation, 50 KiB bounding, masking before conversion |
| `packages/core/test/store.test.ts` | `purgeExpired` retention of raw excerpts |
| `packages/core/test/llm.test.ts` | LLM fallback only on `unknown`, cache dedup, deterministic fallback on malformed answer |
| `apps/brain/test/nonce.test.ts` | nonce cache: replay detection, TTL expiry, bounded eviction |
| `apps/brain/test/validate.test.ts` | ingest/query payload shape validation (rejects malformed input) |
| `apps/brain/test/sqlQueries.test.ts` / `sqlRows.test.ts` | parameterised SQL (no interpolation), row mapping |
| `apps/brain/test/consume.test.ts` / `consume-integration.test.ts` | excerpt stored with retention, replay skip (idempotent consumer) |
| `apps/brain/test/actions.test.ts` / `rovo.test.ts` | the six actions: read-only vs write boundaries, no invented fact |
| `apps/brain/test/issueContextText.test.ts` | ticket context never invents a commit/author/ticket |
| `apps/sensor/test/buildPayload.test.ts` / `payload.test.ts` | masking fail-closed on the write side, payload assembly |
| `tools/manifests.test.mjs` | manifest schema: webtrigger routes, scopes, no real `app.id` secret |
| `tools/sbom.test.mjs` | SBOM determinism, presence of expected components, absence of phantom deps |

The full suite (`npx vitest run`) must stay green before a PR is accepted.

## What is not tested (yet)

Be honest: these properties are enforced by design but have **no dedicated test**,
or are known gaps.

- **No integration test of the signing round-trip through the real Forge secret
  storage.** `readBridgeSecret` (per-workspace pairing secret vs fallback) is
  exercised only through mocks, not against the Forge runtime.
- **No test that the universal key is required before the route accepts
  anything at the HTTP level** — `convertUniversal`'s `404` branch is unit-tested
  (`apps/brain/test/...`), but the full `createUniversalHandler` with an unset
  key is not pinned end to end.
- **No test for the "no secret on the wire" property of metadata fields**
  (repository/branch/author/stepName stored in clear — see the threat model § 3).
- **No rate-limit or abuse test** for the public web triggers; we rely on the
  platform limits.
- **First-party manifest licences** are inherited (MIT at the root); the
  `@dejavu/*` manifests carry no `license` field of their own.

## The next three moves

1. **Persist the nonce across cold starts.** Move the replay guard from the
   warm-instance cache into Forge SQL so a replay cannot survive a cold start
   within the residual timestamp window (threat model § 1).
2. **Harden the universal entry.** Replace the cleartext `projectKey` bearer
   with a per-project random secret held in Forge secret storage (not the
   `settings` row), and enforce a stronger minimum length (threat model § 2, § 4).
3. **Add an archive/rollup policy for `signature`/`occurrence`/`test_stats`.**
   They grow without bound toward the 1 GiB install limit; define and test a
   retention path beyond the excerpt purge (threat model § 4).

Each move is a small, testable change and is deliberately scoped to a single
surface so it can ship independently.