# Judges' guide — Déjà-vu CI

Everything you need to try the product, without a Bitbucket account and without an Atlassian
tenant.

---

## 0. What exists right now — read this first

The project is built by eight parallel lots. The table below is the honest status of every piece
at the time this file was written. **Nothing in this guide promises more than this table.**

| Piece | Where | Status |
|---|---|---|
| Frozen domain types and contract | `packages/core/src/types.ts`, `docs/CONTRACTS.md` | **shipped** |
| Signed bridge (HMAC, nonce, window) | `packages/bridge/src/index.ts` | **shipped** |
| Masking, extraction, normalisation, signature | `packages/core/src/{mask,extract,normalize,categorize,sign}.ts` | shipped |
| Flaky, outbreaks, diagnosis | `packages/core/src/{flaky,outbreak,diagnose}.ts` | shipped |
| Resolutions, tickets, cost | `packages/core/src/{resolutions,tickets,cost}.ts` | shipped |
| Store, replay, LLM fallback, universal entry | `packages/core/src/{store,replay,llm,universal}.ts` | shipped |
| Sensor app (Bitbucket) | `apps/sensor/**` | shipped |
| Brain app (server) | `apps/brain/src/*.ts`, `apps/brain/manifest.yml` | shipped |
| Brain UI, Rovo agent, MCP actions | `apps/brain/src/{ui,rovo,actions}/**` | shipped |
| Sample dataset, labelled corpus, tools | `data/**`, `tools/**` | shipped |
| Public site (GitHub Pages, in-browser demo) | `site/**`, `.github/workflows/site.yml` | shipped |

The parallel lots land as separate pull requests. **Once they are merged, every command below
works as written** — the commands are the contract the lots were built against
(`docs/CONTRACTS.md`).

---

## 0. Path 0 — nothing to install (30 seconds)

**https://baptistefaisy.github.io/deja-vu-ci/** — open it, click **Replay the sample set**.

The page runs the real engine (`packages/core`, unmodified) on the real sample dataset, in your
browser: signatures, diagnostics with their facts, the ticket plan and the cost appear in one
click, with no account, no clone and no network call. It is the fastest honest look at what the
engine decides; the paths below show the same numbers with the repository in your hands, and the
installed apps show them where developers live (Jira and Bitbucket).

`?demo=1` replays on load; `?lang=fr` switches the interface to French.

---

## 1. Path A — without Bitbucket (2 minutes)

This is the path every judge should take first: it needs nothing but Node.

```bash
git clone https://github.com/BaptisteFaisy/deja-vu-ci.git
cd deja-vu-ci
npm ci
npm run replay
```

**What you see** (the replay runs the bundled 40-failure, 14-day sample set against an in-memory
store):

1. a **signatures** table — id (`S-204` style), family, category, status, occurrence count, first
   and last seen;
2. a **diagnostics** table — one row per failure, with the diagnostic kind, its confidence, the
   facts that justify it and the suggested action;
3. a **ticket actions** table — what the app would replay in Jira (create / update / comment /
   reopen), with the ticket key when one exists;
4. a **counters** block — one count per expected diagnostic, so you can check the recipe at a
   glance.

Nothing is sent anywhere: the replay is local, offline, and deterministic — the same command
always prints the same thing.

```bash
npm run eval
```

The accuracy evaluation measures, on the 100-failure hand-labelled corpus:

- **grouping accuracy** — the share of failures correctly grouped into the same signature
  (target: ≥ 0.90);
- **false "flaky" rate** — the share of signatures wrongly declared flaky (target: < 0.05);
- **category accuracy** — the share of failures with the right category;
- the list of mismatches, for the curious.

**Sending your own error, from any CI** — the universal entry:

```bash
tools/universal-entry.sh --project-key CI --repository my-repo --branch main --log-file step.log
```

The excerpt is validated, masked and capped at 50 KB, then follows exactly the same path as the
Sensor. GitHub Actions, GitLab CI and Jenkins are the intended first users.

**From an Atlassian tenant** (optional): install the Brain app, then open the project page
"CI Memory" and press *Replay the sample dataset*. The 40 failures are injected into the real
SQL storage, and the Rovo agent and the MCP tools are usable immediately.

---

## 2. Path B — with Bitbucket

Requires a Bitbucket Cloud workspace with Pipelines and a Jira project.

1. **Install the Brain** (Jira app): it registers the web trigger, the SQL storage, the LLM
   fallback, the project page, the issue panel, the settings page, the Rovo agent and the MCP
   server.
2. **Install the Sensor** (Bitbucket app): it registers the build-status triggers, the
   pull-request card and the workspace settings page.
3. **Pair them**: in the Brain's project settings, generate a pairing secret; in the Sensor's
   workspace settings, paste that secret and the Brain's web-trigger URL. The Brain answers with
   the workspace key. The secret is stored in the Forge secret storage and is never printed.
4. **Push a commit** on the demo repository `examples/flaky-repo/` — it contains a deliberately
   random test, a real regression, and a dependency pointing at a cut-off registry.
5. **Watch**: the pull-request card shows the diagnostic within seconds of the build turning red;
   the same diagnostic appears on the linked Jira ticket.

---

## 3. What each step should show

| Step | Expected display |
|---|---|
| A flaky test fails | "Known flaky — seen 17 times on 9 branches, ticket PAY-88. Probably unrelated to your PR." Action: **retry**. |
| An error that was fixed before | "Already seen, already fixed — same error on `main`, fixed by <author> in `<commit>`. Your branch predates that fix." Action: **rebase**. |
| A brand-new error | "New — first appearance, the step passed on the previous commit. Suspect changed files: …" Action: **fix**. |
| A registry outage | "Infrastructure — package registry unreachable, 6 other repositories failed the same way for 10 minutes." Action: **wait**. |
| A signature that comes back | Status becomes **regression**, the original ticket is reopened, the author of the fix is mentioned. |
| A log excerpt containing a token | The token is masked **before** leaving Bitbucket; the excerpt stored on the Jira side shows the neutral placeholder. |
| The Rovo agent | "Why is the build of PAY-123 red?" returns the same diagnostic as the pull-request card. |

---

## 4. The nine-point recipe (§ 20) and the command that checks it

| # | Recipe point | How to check it | Command |
|---|---|---|---|
| 1 | Two failures differing only by a timestamp and a line number get the **same signature** | Replay the sample set and compare the two signature ids | `npm run replay` |
| 2 | A failure followed by a success on the same commit, repeated on three branches, flips the signature to **flaky** and creates **one** ticket | Replay and read the ticket actions: one `create` for that family | `npm run replay` |
| 3 | A tenth occurrence updates that ticket without creating another and without more than one comment per day | Replay and check the ticket action list: `update`, no second `create`, one `comment` per day | `npm run replay` |
| 4 | An error never seen before gets the diagnostic **new** and quotes the changed files present in the stack | Replay and read the "new" rows and their `suspects` | `npm run replay` |
| 5 | A package download error gets the diagnostic **infrastructure** | Replay and read the "infrastructure" rows | `npm run replay` |
| 6 | A resolved signature that reappears becomes a **regression** and reopens its ticket | Replay and look for a `reopen` action | `npm run replay` |
| 7 | An excerpt containing an access token arrives **masked** on the Jira side | Check the stored excerpt: the token is replaced by a neutral placeholder | `npm run replay` (masking is applied in the same path) |
| 8 | `explain-build-failure` returns the **same** diagnostic as the pull-request card | Compare the agent answer and the card for the same commit | in the tenant: ask Rovo, then open the card |
| 9 | The sample set, replayed on a site **without** Bitbucket, produces the **four** diagnostics | Read the counters block | `npm run replay` |

**Recipe point 8 needs a tenant**: it compares two surfaces (the Rovo agent and the pull-request
card) on the same failure. The other eight points are verified by the replay alone.

---

## 5. Where to look in the code

| Question | File |
|---|---|
| How is an error turned into a signature? | `packages/core/src/{extract,normalize,sign}.ts` |
| How is a diagnostic decided? | `packages/core/src/diagnose.ts`, `packages/core/src/flaky.ts` |
| How is a ticket kept unique? | `packages/core/src/tickets.ts` |
| How is the bridge signed and verified? | `packages/bridge/src/index.ts` |
| What exactly is stored? | `packages/core/src/store.ts` (`SQL_SCHEMA`) |
| How does the engine get tested without a tenant? | `packages/core/src/replay.ts`, `tools/replay.mjs` |
| Where are the Forge modules declared? | `apps/sensor/manifest.yml`, `apps/brain/manifest.yml` |
| What is the Rovo agent and its six actions? | `apps/brain/src/rovo/`, `apps/brain/src/actions/` |

---

## 6. Known limitations — stated up front

- **The knowledge base is only as good as the history it has seen.** A brand-new error is "new"
  simply because nothing similar was recorded; the app says so plainly instead of guessing.
- **The diagnostic never accuses without evidence.** Below the configured confidence threshold, the
  answer is "uncertain" plus the facts, never "not your fault".
- **Logs are read from the tail.** A log of tens of megabytes is never read whole; if the error is
  far above the last 50 KB, the app may not see it.
- **Test reports only exist if the pipeline produces them.** Without them, the analysis falls back
  to log patterns.
- **One Jira ticket per family, not per failure.** This is the intended behaviour (§ 11), but it
  surprises anyone used to one ticket per occurrence.
- **The comments are discreet by design**: one summary comment per day and per ticket, never one
  per occurrence.
