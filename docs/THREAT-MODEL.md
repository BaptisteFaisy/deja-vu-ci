# Threat model

This is the **real** threat model of Déjà-vu CI, by surface. For every threat we
state the mitigation that is actually in place, the test that verifies it, and
what is **not** covered yet. A threat model that claims to cover everything is
worthless; the "remaining work" sections are the honest part.

The surfaces are, in order: the signed bridge, the public web triggers, secrets
in build logs, Forge SQL, the LLM path, and Rovo/MCP.

---

## 1. Signed bridge Sensor → Brain (`packages/bridge`)

The Sensor signs each payload before posting it to the Brain; the Brain verifies
it before anything is queued. The wire format is a JSON envelope
`{ v, nonce, ts, payload }` plus three headers:

- `x-dejavu-signature` — `HMAC-SHA256(secret, "<ts>.<nonce>.<body>")` in hex,
- `x-dejavu-timestamp` — UNIX seconds,
- `x-dejavu-nonce` — 16 random bytes, hex (32 chars).

The secret is a shared key established at pairing and held in Forge secret
storage, never in code and never logged. Verification refuses: a missing or
malformed header, a signature mismatch, a timestamp outside `±300 s`, a nonce
already seen, a body larger than 5 MiB, and an envelope that does not match the
headers. The HMAC comparison is constant-time (`timingSafeEqual`).

| Threat | Mitigation in place | Verified by |
|---|---|---|
| Replay (resend a captured request) | nonce memory + `±300 s` timestamp window | `packages/bridge/test/bridge.test.ts` ("refuse un nonce déjà consommé") |
| Signature forgery / tampered body | HMAC over `ts.nonce.body`; any edit breaks it | same file ("refuse une signature falsifiée", "refuse un corps modifié") |
| Payload substitution | envelope nonce/ts must equal the headers | same file ("nonce diffère de l'en-tête") |
| Clock skew / stale timestamp | explicit `±300 s` window, injectable clock | same file ("horodatage illisible", window tests) |
| Secret theft from code or logs | secret read from Forge secret storage; per-workspace pairing secret | `apps/brain/src/ingest.ts` (`readBridgeSecret`), no test can prove absence but the value is never echoed |

**Remaining work.** The nonce memory lives in the warm instance only: a cold
start forgets it, so a replay across a cold start is tolerated for the short
residual remainder of the timestamp window. A persistent, storage-backed nonce
set would close this. There is no automated secret rotation on unpairing, and no
application-level rate limiting (we rely on the platform's web-trigger limits).

---

## 2. Public web triggers (`/ingest`, `/query`, `/universal`)

All three routes are `webtrigger` modules — unauthenticated HTTP endpoints on the
public internet.

- **`/ingest`** — signed (bridge). Authenticated by HMAC; a request without a
  valid signature is answered `401`. It only validates + queues; the diagnosis
  runs in the consumer, out of the 55 s trigger budget.
- **`/query`** — signed (bridge). Authenticated by HMAC, read-only: one indexed
  SELECT and one `diagnose`. No write.
- **`/universal`** — **not** HMAC-signed. It is the deliberate one-line entry for
  any CI. It is protected by the `projectKey` field in the payload, compared
  against `settings.universalKey`. **Fail-closed**: with no configured key the
  route answers `404`; with an unavailable masking engine it answers `503`; an
  unmasked log never leaves the process.

| Threat | Mitigation in place | Verified by |
|---|---|---|
| Unauthorised ingest/query | HMAC signature required | `apps/brain/test/validate.test.ts`, bridge tests |
| Abusive universal posts | `universalKey` comparison, default off, min length 8 | `packages/core/test/universal.test.ts`, `apps/brain/src/settings.ts` |
| Payload flooding / size abuse | log bounded to 50 KiB (`MAX_LOG_BYTES`), strict field validation | `packages/core/src/universal.ts` (`truncateBytes`), `packages/core/test/universal.test.ts` |

**Remaining work.** The universal key is a **bearer secret sent in cleartext**:
anyone who can observe or guess it can inject logs for the keyed project. It is
stored in cleartext in the `settings` row (see § 4). There is no HMAC on this
route by design, and no rotation. The 8-character minimum is weak for a bearer
token; a longer random key or scoped tokens per project would be stronger.

---

## 3. Secrets in build logs

Build logs routinely contain credentials. The masking engine
(`packages/core/src/mask.ts`) replaces known secret shapes with a stable neutral
token `«[masqué:kind]»`. Masking is **idempotent** (tokens never re-match).

Masked patterns: PEM private-key blocks; GitHub / Atlassian / npm / Slack tokens;
AWS access-key ids; JWTs; `Authorization:` headers; `user:pass@` in URLs and
connection strings; `password`/`secret`/`api-key`/`access-token` assignments;
email addresses; and long hex or base64 blobs that look like key material.

Masking applies on **both** sides:

- **write side** — the Sensor calls `maskSecrets` before building the payload,
  and fails closed if the engine is unreachable (`apps/sensor/src/masking.ts`,
  `apps/sensor/src/buildPayload.ts`);
- **read side** — the universal entry masks the log and the test-case
  message/stack before converting to an ingest payload
  (`packages/core/src/universal.ts` → `universalToIngest`).

As a result, the `raw_excerpt` rows written to Forge SQL contain masked text.

| Threat | Mitigation in place | Verified by |
|---|---|---|
| Secret in the step log | pattern table, applied before payload | `packages/core/test/mask.test.ts` |
| Secret in a test report message/stack | same engine on the read side | `packages/core/test/universal.test.ts`, `apps/sensor/test/buildPayload.test.ts` |
| Double-masking corruption | idempotent tokens | `packages/core/test/mask.test.ts` ("is idempotent") |

**Remaining work.** Masking is regex-based: a novel token format not present in
the table slips through. Only the log body and test-case message/stack are
masked — the freely-editable metadata fields (`repository`, `branch`, `author`,
`stepName`, `commit`) are stored **in cleartext**, so a secret pasted into a
branch name or author is not scrubbed. Email masking is deliberately
over-broad (it also masks legitimate addresses), a false-positive trade-off, not
a leak.

---

## 4. Forge SQL

The Brain keeps its memory in Forge SQL: signature, occurrence, test_stats,
resolution, raw_excerpt, llm_template_cache, outbreak, pairing, settings.
Platform limits: 1 GiB per installation, 5 s per SELECT, all reads hit an
indexed column or the single settings row. There are no foreign keys.

- **Retention.** Only `raw_excerpt` is purged: `expiresAt = now + rawRetentionDays`
  (default 30), and the daily scheduled trigger calls `purgeExpired`.
- **What is stored in clear.** Signatures (hashes), occurrence metadata
  (repository, branch, commit, author, step name, duration), the masked excerpt,
  and the pairing table's **`secretId` reference** — never the bridge secret
  itself, which lives in Forge secret storage.
- **The honest exception.** `settings.universalKey` is stored in cleartext in the
  `settings` row (it must be compared against the incoming `projectKey`).

| Threat | Mitigation in place | Verified by |
|---|---|---|
| Unbounded excerpt growth | `rawRetentionDays` + daily `purgeExpired` | `packages/core/test/store.test.ts`, `apps/brain/test/sqlQueries.test.ts` |
| SQL injection | parameterised statements only (`bindParams`), no string composition | `apps/brain/src/sql.ts`, `apps/brain/src/pure/sqlQueries.ts` |
| Bridge secret in the DB | only the `secretId` is stored | `apps/brain/src/sql.ts` (pairing map) |

**Remaining work.** `signature`, `occurrence`, `test_stats` and `resolution`
rows are never purged and will grow toward the 1 GiB ceiling on a long-lived
install; there is no archive/rollup. The daily purge means an excerpt can live
up to ~24 h past its expiry. The universal key at rest is not protected beyond
the platform storage itself.

---

## 5. LLM (`@forge/llm`)

The manifest declares the `claude` model family; the engine uses the model only
as a **fallback** when no regex pattern recognised an error block (§ 9.5,
`packages/core/src/llm.ts`).

- **What is sent.** The error block's already-masked text (`block.rawText`,
  capped at 4000 characters in the prompt). The model never receives an unmasked
  excerpt, because masking happens upstream (§ 3).
- **Dedup.** The answer is cached by the SHA-256 of the normalized
  `category|errorType|message`, so the same error is never submitted twice
  (`TemplateCache`).
- **No invention rule.** The Rovo agent prompt and the ticket context instruct
  the model: never invent a commit, an author or a ticket — if the memory does
  not know, say so.

| Threat | Mitigation in place | Verified by |
|---|---|---|
| Secret exfiltration via the model | prompt is masked text, 4000-char cap, cached | `packages/core/test/llm.test.ts`, `packages/core/test/mask.test.ts` |
| Hallucinated fix/author/ticket | explicit "never invent" prompt + data-owned context | `apps/brain/test/issueContextText.test.ts`, `apps/brain/test/rovo.test.ts` |
| Model outage breaking the pipeline | deterministic fallback, never throws | `packages/core/test/llm.test.ts` |

**Remaining work.** The cache is in-memory per warm instance, so the same error
may be re-sent after a cold start (mitigated by the deterministic fallback for
recognised categories). We send the masked text but do not independently audit
what the model provider retains; the 4000-char prompt is a defence-in-depth
bound, not a redaction guarantee.

---

## 6. Rovo / MCP

Six actions are exposed both to the Rovo agent and to a MCP server
(`rovo:agent`, `rovo:mcp` in `apps/brain/manifest.yml`): `explain-build-failure`,
`search-failures`, `get-signature`, `list-flaky-tests`, `report-resolution`,
`confirm-resolution`.

- **Who can call them.** A Rovo agent or MCP client **inside the Jira project
  the app is installed on**, with the app's declared Jira scopes
  (`read:jira-work`, `write:jira-work`, `read:jira-user`). The four read actions
  (`*Failure`, `*Failures`, `get-signature`, `list-flaky-tests`) only read; the
  two write actions create a candidate resolution or confirm/reject one.

| Threat | Mitigation in place | Verified by |
|---|---|---|
| Unauthorised external caller | scoped to the installed Jira project via the Forge action/MCP runtime | `apps/brain/test/actions.test.ts`, `apps/brain/test/rovo.test.ts` |
| Write actions beyond scope | `report-resolution`/`confirm-resolution` only touch the `resolution` table; confirmed resolutions are then cited to developers | `apps/brain/test/actions.test.ts` |
| Prompt injection into the agent | narrow action surface; diagnosis cites only stored facts | `apps/brain/test/rovo.test.ts` |

**Remaining work.** A compromised Jira user with project access can write
resolutions via MCP; there is no per-action authorisation finer than the Jira
scope. `confirm-resolution` makes a resolution immediately visible to later
diagnoses — a poisoning vector if the caller is careless, so we rely on the
"candidate → confirm" two-step and human review.

---

## Summary of the biggest gaps

1. The universal entry uses a cleartext bearer `projectKey` (weak, no rotation).
2. Nonce memory and the LLM cache are warm-instance only, not persistent.
3. Metadata fields and the universal key are stored at rest in cleartext;
   `signature`/`occurrence` rows accumulate without an archive policy.