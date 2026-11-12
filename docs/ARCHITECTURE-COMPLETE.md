# Complete architecture — Déjà-vu CI, as the tree stands today

`docs/ARCHITECTURE.md` explains the **design** and why it is shaped this way
(twin apps, signed bridge, Forge limits). This page is its complement: the
architecture **as it is today**, in one place — the three packages, the two
Forge applications, the public site, the universal entry and its integrations,
and the security layer. Where the two documents differ, the code is the source
of truth; the divergences observed while writing this page are listed in
[`ETAT-LIVRAISON.md`](ETAT-LIVRAISON.md) § 7.

Base: `main` at commit `37389bf`, 2026-11-12.

---

## 1. The whole system in one picture

```
   Bitbucket Cloud                       any other CI                        a browser
   (a workspace)              (GitHub Actions · GitLab · Jenkins ·               |
        |                      CLI `deja-vu` · Python SDK · cron)                |
        |  build-status events            |                                     |
        v                                 |  POST /universal                    |
  +--------------+                        |  (per-project key,                  |
  |   SENSOR     |                        |   fail-closed)                      |
  | apps/sensor  |                        |                                     |
  |  (Bitbucket) |                        |                                     |
  |  no durable  |   POST /ingest         |                                     |
  |  data        |   POST /query          v                                     |
  +------+-------+   (signed bridge)  +--------------------------------+         |
         |           HMAC-SHA256      |            BRAIN               |         |
         |           ts + nonce       |          apps/brain            |         |
         |           5 MB cap         |            (Jira)              |         |
         |                           |  web triggers -> queue -> SQL   |         |
         |                           |  consumer: signature,          |         |
         |                           |  diagnosis, ticket plan         |         |
         |                           |  scheduler: daily synthesis,   |         |
         |                           |  purge, outbreaks               |         |
         |                           |  UI Kit 2: project page,        |         |
         |                           |  issue panel, settings          |         |
         |                           |  Rovo agent + MCP (7 actions)   |         |
         |                           +---------------+----------------+         |
         |                                           |                          |
         |                                   Forge SQL (9 tables,               |
         |                                   2 indexes, no FK)                  |
         |                                   + Forge secret storage             |
         |                                                                      |
         |                        +---------------------------------------------+
         |                        |  PUBLIC SITE  site/ (GitHub Pages)
         +------------------------+  committed bundle; the REAL engine
           (same verdicts, same    (packages/core) + the REAL dataset,
            words, via             replayed in the browser; no network
            packages/present)

  All four surfaces — PR card, Jira screens, agent/MCP, browser — call the
  same engine. The engine has no Forge import, no React import, and only
  depends on node:* at runtime.
```

---

## 2. Three packages, zero platform import

| Package | Role | Runtime dependencies | Key modules |
|---|---|---|---|
| `packages/core` (`@dejavu/core`) | The whole engine | `node:*` only | `mask`, `extract`, `normalize`, `categorize`, `sign` (what the error is) · `flaky`, `outbreak`, `diagnose` (what it means) · `resolutions`, `tickets`, `cost` (what to do) · `curate`, `quarantine` (manual curation, CI-17/CI-19) · `store`, `replay`, `engine`, `llm`, `universal` (where it lives) · `minimize` (pure, not wired yet) · `signature-version`, `cascade`, `calibrate` (identifier longevity) |
| `packages/bridge` (`@dejavu/bridge`) | The signed bridge Sensor → Brain | `node:crypto` | `signPayload`, `verifyRequest`, `BRIDGE_HEADERS`, `SecretSet`, `rotateSecret` |
| `packages/present` (`@dejavu/present`) | The shared vocabulary of the screens | none (pure) | `lang`, `labels` (English **and** French), `format`, `screens`, `invoke` |

The frozen contract (`docs/CONTRACTS.md`, `packages/core/src/types.ts`) fixes
the signature of every exported function; the barrel `packages/core/src/index.ts`
re-exports everything, so a new module is available to both apps without
touching a shared file.

---

## 3. The two Forge applications

### Sensor (`apps/sensor`, Bitbucket, runtime `nodejs22.x`)

| Module | What it does |
|---|---|
| `trigger` (`avi:bitbucket:created:build-status`, `…:updated:build-status`) | A build turned red: find the pipeline, read the log tail by partial request and the test reports, extract, mask, sign, forward |
| `bitbucket:repoPullRequestCard` | The card asks the Brain at display time (`POST /query`) — always fresh, a query that finds nothing costs nothing |
| `bitbucket:workspaceSettingsMenuPage` | Pairing with a Brain, watched repositories, maximum excerpt size |

Scopes: `read:repository:bitbucket`, `read:pipeline:bitbucket`,
`read:pullrequest:bitbucket`, `storage:app`. Outbound fetch: only
`*.webtrigger.atlassian.app`. **No durable data.** UI Kit does not exist for
Bitbucket: both screens render one Custom UI static folder (committed esbuild
bundle). All testable logic lives in `src/pure/`.

### Brain (`apps/brain`, Jira, runtime `nodejs22.x`)

| Module | What it does |
|---|---|
| `webtrigger` × 3 | `/ingest` (signed), `/query` (signed), `/universal` (project key) — verify, queue, answer `202` immediately; the 55 s budget is never spent on analysis |
| `consumer` | The real work: extraction → signature → diagnosis → Forge SQL → ticket plan → Jira updates → PR-card cache. Idempotent |
| `scheduledTrigger` (daily) | Daily synthesis, suggested closures, raw-excerpt purge (`purgeExpired`), outbreak detection |
| `sql` (engine `mysql`) | The nine tables of the memory; DDL is the exported constant `SQL_SCHEMA` |
| `llm` (model `claude`) | Fallback normalisation only, cached by normalised-text hash |
| `jira:projectPage`, `jira:issuePanel`, `jira:projectSettingsPage` | UI Kit 2 (`render: native`), one hosted resource (`src/frontend.tsx`), one resolver (`uiResolverHandler`) dispatching `memory-page`, `issue-context`, `settings`, `save-settings`, `replay-sample`, `curate-merge`, `curate-split`, `quarantine-proposal` |
| `jira:issueContext` (text) | What the Rovo agent reads about a ticket |
| `rovo:agent` + `action` × 7 + `rovo:mcp` | The six actions of § 13 plus `propose-quarantine` (CI-19), exposed identically to Rovo and to MCP clients |

Scopes: `read:jira-work`, `write:jira-work`, `read:jira-user`, `storage:app`.
No outbound fetch. All the logic comes from `@dejavu/core`; `src/pure/` holds
everything testable without a Forge import.

---

## 4. The public site (`site/`)

GitHub Pages — the real engine in the browser. `site/public/` is **committed**
(bundle, style sheet, page, fingerprint); the `site` workflow only uploads it,
and `site/test/bundle.test.mjs` fails the CI if the committed bundle drifts
from `site/src`, `packages/core`, `packages/present` or the dataset. Nothing
is fetched, nothing is sent, no CDN, no telemetry. English and French
(`?lang=`), one-click replay (`?demo=1`). The browser gets its SHA-256 from a
hand-written, test-verified implementation (`site/src/lib/sha256.ts`), so the
identifiers it displays are exactly the product's.

## 5. The universal entry and its integrations (`integrations/`, `tools/`)

One door for any CI: `POST /universal` with a per-project key. The payload is
validated, capped at 50 KiB, masked, and then follows exactly the Sensor's
path. Shipped as copy-paste pieces, all best-effort (the caller's build never
fails because of the report):

| Piece | File |
|---|---|
| Shell one-liner | `tools/universal-entry.sh` |
| GitHub Action (composite, no install) | `integrations/github-action/action.yml` |
| GitLab CI snippet (`after_script`) | `integrations/gitlab/gitlab-ci.yml` |
| Jenkins snippet (`post { failure }`) | `integrations/jenkins/Jenkinsfile` |
| npm CLI (`deja-vu report`, `--dry-run`, `--json`) | `integrations/cli/` |
| Python SDK (standard library only) | `integrations/python/deja_vu_ci.py` |
| Log adapters (GitHub/GitLab/Jenkins formats) | `integrations/adapters/` |
| Machine-readable contract | `docs/openapi.yaml` |

## 6. The security layer

- **Signed bridge** — HMAC-SHA256 over `"<ts>.<nonce>.<body>"`, constant-time
  comparison, 300 s skew window, nonce replay guard, 5 MB body cap. Rotation
  without downtime through a `SecretSet` (the retired key verifies during an
  overlap the operator closes). Secret lives in the Forge secret storage.
- **Masking** — `maskSecrets` replaces secret- and PII-looking spans with a
  stable neutral token, before anything leaves the source; idempotent,
  extensible by appended patterns, never replaceable. Its limits are written
  down (`docs/MASKING.md`).
- **Fail closed** — no configured universal key → `404`; no masking engine →
  `503`; the Sensor's masking failure blocks the send.
- **Retention** — raw excerpts are the only bulky rows and carry an expiry
  (`rawRetentionDays`, 30 by default), purged by the daily scheduler;
  signatures and statistics are the product and are kept.
- **Minimisation** — `minimizeExcerpt` (`hash-only` / `masked-snippet` /
  `full`) is pure, tested, and deliberately **not wired yet**.
- **Honesty** — the threat model (`docs/THREAT-MODEL.md`), the security status
  (`docs/SECURITE-ETAT.md`), the SBOM (`docs/SBOM.json`, generated by
  `tools/sbom.mjs`) and the third-party licences (`docs/THIRD-PARTY.md`) state
  what is tested, what is not, and the three next moves.

## 7. The memory (Forge SQL, Brain side)

Nine tables — `signature`, `occurrence`, `test_stats`, `resolution`,
`raw_excerpt`, `llm_template_cache`, `outbreak`, `pairing`, `settings` — two
indexes (`signature.family_id`, `occurrence(signature_id, occurred_at)`), no
foreign keys (the platform does not have them; the store layer enforces
integrity). The pivot: **signature** = `sha256(category | errorType |
normalisedMessage | reducedStack)` truncated to 16 hex — *the same error*;
**family** = the same hash without the stack — *the same problem*, and the
uniqueness key of the Jira ticket. Identifiers are versioned
(`algorithmVersion`, golden lock, migration planner —
`docs/SIGNATURE-VERSIONING.md`).

## 8. One engine, four surfaces

The same functions produce the verdict shown on the Bitbucket card, on the
Jira panel, in the browser and by the agent — because all four call
`packages/core`. The replay path exists twice on purpose: `loadEngine()`
(dynamic imports, proves separability at runtime, used by `tools/replay.mjs`)
and `staticReplayEngine()` (static assembly, bundleable, used by the Brain's
seed button and by the site). Both are validated by the same `assertEngine()`
contract.

## 9. The repository pipeline

Required checks on `main`: `ci` (types, full test suite, docs sanity, guard
self-tests), `ci-budget` (no job beyond five minutes), `couche0` (declared
`## Scope` + forbidden patterns). `site` publishes on push to `main` only;
`pr-auto-merge` sweeps the PR states; `stale-base-guard` and `triage-rouge`
inform. Mergify is the only merge pilot (squash, merge-update); the conflict,
scope and test agents write to PR branches only, behind a compilation gate and
a circuit breaker. Details: `docs/PIPELINE.md`.

## 10. Where everything lives

```
packages/core        the engine (26 src files + 25 test files)
packages/bridge      the signed bridge (src + 3 test files)
packages/present     the shared vocabulary (5 modules + barrel, 2 test files)
apps/sensor          Forge app, Bitbucket: src/, src/pure/, src/ui/, static/, 12 test files
apps/brain           Forge app, Jira: src/, src/pure/, src/ui/, src/rovo/, src/actions/, 22 test files
site                 public site: src/, public/ (committed bundle), 5 test files
integrations         github-action/, gitlab/, jenkins/, cli/, python/, adapters/
data                 sample/occurrences.json (40+8 rows, 14 days), labeled/100-failures.json (27 groups)
tools                replay, eval, build-site, gen/, sbom, manifest validation, universal entry, triage
examples/flaky-repo  the demo repository to push on a real Bitbucket
docs                 the documentation (this page included)
```
