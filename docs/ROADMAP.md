# Roadmap — Déjà-vu CI

The submission (Codegeist 2026, deadline 22 December 2026) delivers the MVP of § 6. This document
separates **what is delivered**, **what V1 adds**, **where the product is going**, and **what is
explicitly not in scope**.

---

## 1. Delivered — MVP (§ 6)

| Area | Content |
|---|---|
| Capture | Failed Bitbucket Pipelines build statuses, step logs and test reports (CI-01, CI-02) |
| Secrets | Masking by patterns before anything leaves Bitbucket, 50 KB cap (CI-03) |
| Signature | Signature, family and category, computed deterministically (CI-04) |
| Diagnostics | The four diagnostics with confidence and facts, under 30 s (CI-05) |
| Flaky | Detection per § 10.1 (CI-06) |
| Tickets | One ticket per family, daily summary comment, suggested closure, reopen on regression (CI-07) |
| Surfaces | Diagnostic on the pull request and on the Jira ticket (CI-08) |
| Page | "CI Memory" project page: signatures, statuses, occurrences, search, tabs (CI-09) |
| Agent | Rovo agent and six MCP actions (CI-10) |
| Sample | Replayable sample set, no Bitbucket needed (CI-11) |
| Retention | Adjustable retention of raw excerpts, 30 days by default (CI-18) |

## 2. V1 — the second wave

| Item | Requirement | What it adds |
|---|---|---|
| Resolutions deduced, then confirmed | CI-12 | The app proposes the commit that made the error disappear (between the last failure and the first success, priority to the files in the stack); a human confirms, then the resolution is cited to everyone who meets it again |
| Regression detection | CI-13 | A resolved signature that comes back is flagged as a regression, its ticket is reopened, the author of the fix is mentioned |
| Cost | CI-14 | Red builds, CI minutes lost, people affected, retries, ranked by signature — a number that makes people decide |
| Infrastructure outbreaks | CI-15 | The same signature on three repositories within fifteen minutes opens **one** incident, not ten alerts |
| Universal entry | CI-16 | Any CI (GitHub Actions, GitLab CI, Jenkins) feeds the memory with a one-line command |

**Deliberately still missing:** manual merge or split of signatures (CI-17). It is on the list, but
the two-level model (signature and family) plus the manual merge are a V1 refinement — the honest
status is "planned", not "shipped".

## 3. The vision (§ 25)

The specification pushes the idea to its extreme. These are the directions, not commitments:

- **Predict before the build ends.** As soon as a step prints a known line, the diagnostic falls
  before the build even fails.
- **Proposed quarantine.** For an expensive flaky test, the app drafts the change that isolates it
  and the ticket that commits to fixing it.
- **Cost made visible.** "Flaky tests cost 61 hours of CI and 212 retries this month" — a figure
  that arbitrates.
- **Memory across organisations.** Errors of public tools (registries, base images) recognised
  everywhere, without sharing a line of code.
- **Agents stop going round in circles.** Every code agent queries the memory before touching
  code after a red build.
- **Link with technical debt.** The recurring signatures of a component feed the costing of its
  debt.

## 4. Out of scope — on purpose

These are **not** limitations to be fixed later; they are boundaries the product sets itself.

| Out of scope | Why |
|---|---|
| **Relaunching a pipeline** | The app diagnoses and advises. Acting on the pipeline belongs to the CI, and re-running someone's build without asking is not our call. |
| **Modifying the repository** | Same reason: Déjà-vu CI writes tickets and comments, never code. The only exception in the whole roadmap is a *proposed* quarantine, which stays a proposal. |
| **Judging the quality of the tests** | Whether a test is well written is a human reviewer's job. The app classifies failures, it does not grade tests. |
| **Storing whole logs** | Only the error blocks leave Bitbucket, capped at 50 KB, and raw excerpts are purged after 30 days by default. A memory that keeps everything keeps nothing useful. |
| **One ticket per occurrence** | The opposite of the product. One ticket per family, with the occurrences as a table inside it. |
| **A comment per occurrence in a pull request** | One summary comment per day and per ticket, and no automatic pull-request comment by default. |
| **Mixing Bitbucket and Jira scopes in one app** | The platform does not allow it. Hence two twin apps and a signed bridge — see ADR 0001. |

## 5. Known risks and their answers (§ 24)

| Risk | Answer |
|---|---|
| Logs unreadable from Forge | Test reports; the universal entry called from the pipeline |
| Signatures too fine or too coarse | A hand-labelled corpus of 100 failures, two levels (signature and family), manual merge planned |
| A wrong "this is not your fault" | A confidence threshold, the cautious "uncertain" verdict, the facts always shown |
| Secrets in the logs | Masking before sending, bounded excerpts, short retention |
| Judges without Bitbucket | The replayable sample set and the universal entry |
| Two apps to install | Pairing in three steps; the Brain is useful on its own |

## 6. After the hackathon

The order below is the order we would tackle them in:

1. **Manual merge and split of signatures** (CI-17) — the last missing requirement of § 12.
2. **Normalisers learned per ecosystem** — a public, versioned catalogue of normalisation rules
   (Maven, Gradle, npm, Cargo) instead of the current generic set.
3. **Proposals before the build ends** — the first item of the vision.
4. **Cross-organisation memory of public tools** — the most ambitious item; it implies sharing
   only hashes, never code.
5. **Marketplace publication** — the app is designed to be published: two apps, clear scopes, no
   external service.

## Sonde InferHub A — mémoire des erreurs publiques

Les erreurs d'outils publics sont reconnues partout, sans partager une ligne de code.
