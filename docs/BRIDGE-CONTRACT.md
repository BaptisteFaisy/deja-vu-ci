# BRIDGE-CONTRACT — the Sensor ↔ Brain wire contract

This document is the written contract of the signed bridge between the **Sensor**
(the Bitbucket Forge app) and the **Brain** (the Jira Forge app). It describes the
exact bytes on the wire, the order in which they are produced and checked, the
limits, the versioning policy and the compatibility matrix.

Normative sources: `docs/CONTRACTS.md` (section E) and `packages/core/src/types.ts`
are frozen and win over this file in case of divergence. Executable proof:
`packages/bridge/test/contract.test.ts` and `packages/bridge/test/versioning.test.ts`.

Implementation: `packages/bridge/src/index.ts` (transport), `apps/sensor/src/pure/payload.ts`
(payload building and masking), `apps/brain/src/pure/validate.ts` (shape and version),
`apps/brain/src/pure/nonce.ts` (replay cache), `apps/brain/src/pure/consume.ts` (ingestion).

---

## 1. Transport

The Sensor is the only client; the Brain exposes three signed routes on its web
trigger: `/ingest` (a failing build), `/query` (the PR card), `/universal` (the
one-line entry for any other CI). All three share the same envelope, the same
headers and the same verification path.

| Item | Value |
|---|---|
| Method | `POST` |
| Body | one JSON envelope (§ 2), UTF-8 |
| `content-type` | `application/json` (any `*+json` accepted; anything else refused) |
| `x-dejavu-signature` | HMAC-SHA256, lowercase hex (64 chars) |
| `x-dejavu-timestamp` | Unix seconds, exact integer string |
| `x-dejavu-nonce` | 32 lowercase hex chars (16 random bytes) |

Header lookup is **case-insensitive** on the Brain side (proxies do not preserve
case). The three headers are mandatory; a missing or empty one is refused.

## 2. Envelope

```json
{
  "v": 1,
  "nonce": "0123456789abcdef0123456789abcdef",
  "ts": 1762848000,
  "payload": { "...": "IngestPayload or QueryRequest" }
}
```

| Field | Type | Rule |
|---|---|---|
| `v` | `1` (number) | frozen envelope version; strict numeric equality, never coerced |
| `nonce` | string | must equal the `x-dejavu-nonce` header |
| `ts` | number (Unix s) | must equal the `x-dejavu-timestamp` header |
| `payload` | object | the application payload (§ 6); the transport never inspects it |

## 3. Signing order

The Sensor signs in exactly this order — **masking happens before signing**:

1. collect the failing step (log tail, test reports);
2. **mask the secrets** of every excerpt (`maskSecrets` of `@dejavu/core`,
   fail-closed: no masker available → nothing is sent);
3. build the `IngestPayload`: error blocks bounded to 50 KiB and 3 blocks,
   branch history bounded to 100 commits;
4. `body = JSON.stringify({ v: 1, nonce, ts, payload })`;
5. `stringToSign = "<ts>.<nonce>.<body>"`;
6. `signature = HMAC-SHA256(activeSecret, stringToSign)` as lowercase hex;
7. send `body` with the three headers above.

Because step 2 precedes steps 4–6, the HMAC only ever covers masked text: a
plaintext secret never reaches the signed body, the headers, or the wire.
Signing the timestamp and the nonce **together with** the body prevents
replaying a signature on another body and aging a timestamp without breaking
the HMAC. The same payload signed with the same clock, the same nonce and the
same key produces **byte-identical** body and signature (deterministic HMAC).

## 4. Verification order

`verifyRequest` checks, in this exact order, and returns an explicit reason on
the first failure (it never throws):

| # | Check | Refusal reason |
|---|---|---|
| 1 | shared secret non-empty | `secret du pont vide` |
| 2 | body ≤ 5 MiB | `corps trop gros` |
| 3 | three headers present | `en-tête de signature incomplet` |
| 4 | content type is JSON | `type de contenu inattendu` |
| 5 | timestamp is an exact integer string | `horodatage illisible` |
| 6 | \|now − ts\| ≤ window (§ 5) | `horodatage hors fenêtre (±N s)` |
| 7 | HMAC matches (constant time, any key of the set) | `signature invalide` |
| 8 | nonce not already consumed (§ 5) | `nonce déjà consommé (rejeu)` |
| 9 | body parses, `v === 1`, envelope nonce/ts agree with headers | `corps JSON illisible` / `enveloppe incohérente avec les en-têtes` |

The order is part of the contract: the size check runs before any parsing, the
HMAC before the nonce cache (an attacker cannot probe nonce state without a
valid signature), and the envelope read last (defense in depth — a body that
disagrees with its headers already failed the HMAC).

## 5. Time window and nonce

- **Window**: `ts` must be within ±300 s of the Brain's clock
  (`DEFAULT_MAX_SKEW_S = 300`); the Brain may widen it per call (`maxSkewS`).
- **Nonce**: 16 random bytes, hex-encoded (32 chars), drawn per request.
- **Replay cache** (`apps/brain/src/pure/nonce.ts`): bounded TTL map, entries
  expire after 600 000 ms (twice the window), at most 100 000 entries with
  oldest-first eviction, injectable clock. It lives in the warm instance: a
  cold start forgets nonces, but a replay then still needs a valid signature
  inside the timestamp window — the two guards bound each other.

## 6. Payloads

### 6.1 `IngestPayload` (`/ingest`, `/universal` after conversion)

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | `1` (number) | yes | payload version (§ 7), strict equality |
| `workspace` | string | yes | Bitbucket workspace, also the pairing key |
| `repository` | string | yes | |
| `branch` | string | yes | |
| `commit` | string | yes | |
| `author` | string | yes | |
| `prId` | number | no | |
| `stepName` | string | yes | |
| `stepUuid` | string | no | |
| `buildUrl` | string | no | |
| `buildNumber` | number | no | |
| `durationS` | number | yes | finite, ≥ 0 |
| `failedAt` | string | yes | ISO-8601 UTC, parseable |
| `errorBlocks` | string[] | yes | masked, ≤ 3 blocks, ≤ 50 KiB total |
| `testCases` | `FailedTestCase[]` | no | masked message and stack |
| `branchHistory` | string[] | no | ≤ 100 commit hashes, newest first |
| `containsResolution` | `{ commit: string; contains: boolean }` | no | ancestor verdict (§ 10.2) |
| `changedFiles` | string[] | no | |
| `linkedIssueKey` | string | no | |

### 6.2 `QueryRequest` (`/query`)

`{ kind: 'pr-card', repository: string, branch: string, commit?: string }` —
the `kind` field is its switch: an unknown kind is refused explicitly.

## 7. Versioning policy

Two independent switches, one rule: **never accept silently**.

- **Envelope `v`** (transport): frozen at `1`. Any other value — newer, older,
  missing, or a coercible string — is refused by `verifyRequest`, even when the
  envelope is perfectly signed.
- **Payload `version`** (application): the Brain accepts exactly the number `1`
  (`validateIngestPayload`). Anything else yields `{ ok: false, error:
  'payload.version must be 1' }` — an actionable message that names the field
  and the version the Brain speaks. No coercion (`'1'` is refused), no
  exception (garbage payloads return a refusal, never a throw).
- **Tolerant reader within a known version**: unknown extra fields are ignored
  and stripped from the validated value. Additive optional fields therefore do
  **not** require a version bump; any semantic change does.
- **Upgrade path**: the Brain must ship support for version N+1 **before** any
  Sensor emits it (expand → migrate → contract). During the overlap the Brain
  accepts both versions explicitly, never by tolerance.

## 8. Compatibility matrix (Sensor ↔ Brain)

Envelope level (`v`), whatever the payload:

| Sensor sends `v` | Brain (speaks `v: 1`) |
|---|---|
| `1` | accepted |
| `0`, `2`, `'1'`, missing | **refused at transport** (`enveloppe incohérente avec les en-têtes`) |

Payload level (`payload.version`), envelope `v: 1` and signature valid:

| Sensor sends `version` | Brain (speaks `1`) | Outcome |
|---|---|---|
| older (`0`) | refused | explicit `400`, message names `version` |
| equal (`1`) | **accepted** | validated, queued, ingested |
| newer (`2`, `3`, …) | refused | explicit `400` — the Brain must be upgraded first |
| missing / `'1'` / `null` / non-number | refused | explicit `400`, no coercion |

A refused payload is answered, never dropped silently: the Sensor sees an
explicit status and the operator sees an actionable error.

## 9. Size ceilings

| Ceiling | Value | Level | Behaviour |
|---|---|---|---|
| Body | 5 MiB (`5 × 1024 × 1024` bytes) | bridge | exactly 5 MiB accepted, one byte more refused (`corps trop gros`) |
| Error blocks | 50 KiB total, 3 blocks | Sensor payload | oversized block **truncated** on a UTF-8 boundary, never dropped |
| Branch history | 100 commits | Sensor payload | extra hashes cut, newest kept |

## 10. Key rotation

The shared secret is one key (legacy string) or an ordered set
(`{ secrets: [active, ...retired] }`). `rotateSecret(current, next)` puts
`next` first: it signs new messages, while every retired key still in the set
verifies in-flight messages (overlap window). Dropping a retired key from the
set closes the window. Signing always uses the first key; verification tries
each key in constant time. Secrets live in the Forge secret storage, are
selected per pairing (workspace), and are never logged.

## 11. Refusal taxonomy → HTTP answers of the Brain

| Stage | Failure | Answer |
|---|---|---|
| pairing | no secret found for the workspace | `503` "not paired yet" |
| bridge (§ 4) | any transport refusal | `401` with the explicit reason |
| shape/version (§ 7) | invalid payload | `400` with the field-level error |
| success | payload validated and queued | `202` |

Refusal reasons never leak the secret, the expected nonce, or any hex run of
16+ characters (asserted by `packages/bridge/test/attacks.test.ts`).

## 12. Executable contract

| Test file | Proves |
|---|---|
| `packages/bridge/test/contract.test.ts` | the end-to-end chain: real sample-dataset excerpt → masking → payload → signature → verification → validation → **real ingestion into the in-memory store** via the Brain's pure consumer; exact round trip; unknown payload version refused; both size ceilings at ±1 byte; signature stability; masking strictly before signing; replay refused at the bridge and idempotent in the memory |
| `packages/bridge/test/versioning.test.ts` | envelope and payload version policy, the compatibility matrix above, tolerant reader, no coercion, never throws, never accepts silently |
| `packages/bridge/test/bridge.test.ts` | happy path, header case, envelope/header agreement |
| `packages/bridge/test/attacks.test.ts` | every attack refused with an explicit, non-leaking reason |
| `packages/bridge/test/rotation.test.ts` | rotation, overlap window, single-key compatibility |
