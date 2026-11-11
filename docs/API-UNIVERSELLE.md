# Universal API — Déjà-vu CI

The **universal entry** is the one door through which any CI — GitHub Actions,
GitLab CI, Jenkins, CircleCI, a cron job — can feed the Brain a failing build
without Bitbucket. One authenticated `POST` to `/universal`, and the excerpt
follows the exact same path as the Bitbucket Sensor.

This file is the human companion of `docs/openapi.yaml` (the machine-readable
contract).

## Try it on YOUR repo, in three commands

Pick your log, point the reporter at your Brain, send it:

```bash
# 1. Tell the reporter where the Brain lives and who you are.
export DEJAVU_BRAIN_URL=https://dejavu.webtrigger.atlassian.app/universal
export DEJAVU_PROJECT_KEY=<BRAIN_KEY>

# 2. Produce the failing step log (whatever your build command is).
make test 2>&1 | tee build.log || true

# 3. Report it (the shell one-liner ships with the repo).
bash tools/universal-entry.sh --file build.log
```

Or with the npm CLI (single binary, zero dependencies):

```bash
npm install -g deja-vu-ci
deja-vu report --url "$DEJAVU_BRAIN_URL" --key "$DEJAVU_PROJECT_KEY" \
  --repo owner/name --log build.log
```

Add `--dry-run` to see the payload that would be sent, and `--json` for a
machine-readable result.

## Trust model

- **Authentication** is a per-project key in the body (`projectKey`), compared
  to the Brain's `universalKey` setting. It is *not* the signed bridge: the
  `x-dejavu-signature` / `x-dejavu-timestamp` / `x-dejavu-nonce` HMAC headers
  are used by `/ingest` (Sensor → Brain), not by `/universal`.
- **Fail closed.** Without a configured `universalKey` the route answers `404`;
  without the masking engine it answers `503` and refuses to ingest an
  unmasked journal.
- **Bounded and masked.** The journal is truncated to 50 KiB and its secrets
  are masked *before* anything leaves the process. An exempt excerpt never
  travels.
- **Best-effort for the CI.** The reporter never fails your pipeline: if the
  Brain is unreachable, the build still finishes. The report is a side note,
  not a gate.

## Limits

| Dimension   | Limit                                      |
| ----------- | ------------------------------------------ |
| Journal     | 50 KiB (51200 bytes), tail-kept            |
| Request body| 5 MiB (Forge payload limit)                |
| Response    | `202 Accepted` (queued), never a diagnosis |
| Rate        | no explicit per-key quota on the Brain side |

The web trigger answers within Forge's 55 s web-trigger budget; the diagnostic
(`new`, `known`, `flaky`, `infrastructure`, …) is computed asynchronously in
the queue and lands on the ticket, not on this call.

## Idempotence

Every reporter and adapter stamps the payload with `idempotencyKey` — a stable
SHA-256 fingerprint of the exact content sent. Retrying the same report yields
the same key, so a replugged step cannot duplicate an occurrence. **Today the
Brain accepts this field but does not deduplicate on it**; the client keeps the
key, and deduplication can land server-side without changing the wire format.

## When the Brain is down

The Brain may be unreachable (network, platform outage, app redeploy). Every
integration treats this the same way:

1. retries transient errors with backoff (a few attempts, then gives up);
2. logs a warning and **continues the build** (never a non-zero exit code for
   a build that is red *by itself*);
3. leaves the door open for a manual replay — which is safe, because the
   `idempotencyKey` keeps a replay from counting twice.

There is no client-side persistence queue by design: we do not accumulate
reports on a broken network to spray them at the Brain later. If you need the
failure recorded, re-run the reporter once the Brain is back.