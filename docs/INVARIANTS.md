# INVARIANTS — what the engine must never do

Déjà-vu CI tells a developer *"this failure is not yours"* or *"this one is"*.
Both answers cost trust, so the engine is held to a small set of rules that no
input, no setting and no platform failure is allowed to break. This file lists
those rules, says why each one exists, and points at the test that enforces it.
The last section lists what is **not** covered — an invariant nobody checks is
a wish, not a guarantee.

## Where the rules live

| File | Role |
|---|---|
| `packages/core/test/fakes/invariants.ts` | the rules, written once: `checkDiagnostic`, `checkTicketActions`, plus the builders used by both suites |
| `packages/core/test/fakes/corpus.ts` | the seeded generator of the failure corpus (no dependency, no clock, no network) |
| `packages/core/test/invariants.test.ts` | the rules on the real sample set (`data/sample/occurrences.json`, replayed with `replayWithEngine` + `staticReplayEngine`) and on crafted inputs |
| `packages/core/test/invariants-fuzz.test.ts` | the same rules on 500 generated cases (fixed seed) |
| `apps/brain/test/degradation.test.ts` | the Brain under platform failure, on local doubles (`apps/brain/test/fakes/degradation.ts`) |

Run them with `npx vitest run packages/core/test/invariants.test.ts
packages/core/test/invariants-fuzz.test.ts apps/brain/test/degradation.test.ts`,
or the whole suite with `npx vitest run`.

Every rule is re-derived from the **data** a verdict was built on, never from
the engine's own bookkeeping: a diagnostic that asserts something its evidence
does not support is reported, with the occurrence id, so a failure reads like a
reproduction recipe.

## The invariants

### I1 — No diagnostic without facts
A verdict always carries at least one fact, a confidence inside `0..1`, a title
of at most 90 characters and a readable short id (`S-204`).
*Why:* § 18 requires the facts to be shown next to the answer; a verdict with
no fact is an opinion, and the pull request card has no room for a long title.
*Covered by:* `checkEvidence` in `fakes/invariants.ts`, applied to every
diagnostic of the sample replay and of the corpus
(`never renders a diagnostic without facts`, `never renders a diagnostic that
breaks a rule`).

### I2 — `flaky` needs a same-commit success
A failure is called unstable only with at least `flakyMinOccurrences`
occurrences on at least `flakyMinBranches` branches inside `flakyWindowDays`,
**and** a success at the very same commit after a failure.
*Why:* § 10.1. The same-commit success is what separates a flaky test from a
test that is genuinely broken on `main`; without it the engine would tell
developers to retry a failure they caused.
*Covered by:* `checkFlaky` (facts and thresholds) and `evidenceViolations`
(re-derived from the raw pool, in `fakes/corpus.ts`). On the sample set the
stricter form is checked too: every `flaky` verdict is backed by occurrences
actually stored in memory, inside the window
(`never calls a failure unstable without a same-commit success`).

### I3 — `already-fixed` cites a real resolution
The verdict names a commit and an author, and a *candidate* resolution is never
dressed up as a confirmed one (confidence stays below the confirmed level until
a human confirms).
*Why:* § 10.5 and CI-12 — the Brain deduces a fix, a human confirms it. Telling
a developer "Marie fixed this, rebase" when Marie never did is the most
expensive mistake the product can make.
*Covered by:* `checkAlreadyFixed`, plus `never cites a fix without a resolution
behind it` and `tells a confirmed fix from a candidate one`.

### I4 — `new` never claims a fix
A first-seen failure carries no resolution and asks for a fix, never for a
rebase onto an unknown commit.
*Why:* the "new" verdict is the one that says "this is yours"; it must not
point at a fix that does not exist.
*Covered by:* `checkNew`, `never claims a fix on a new failure`.

### I5 — An outbreak needs several repositories
When the infrastructure verdict cites repositories, it cites at least
`outbreakRepos` distinct ones inside `outbreakWindowMin`, and the cited list
matches the cited count. `detectOutbreak` returns nothing below that.
*Why:* § 10.3 — an epidemic is what makes a failure *not* the developer's fault
across a whole workspace; one repository failing alone is not an epidemic.
*Covered by:* `checkInfrastructure`, `never blames the infrastructure without
several repositories`, `requires several repositories inside the window for an
outbreak`, and the corpus' `outbreak` scenarios.

### I6 — Below the confidence line, the answer is `uncertain`
Any verdict that excuses the pull request (`flaky`, `infrastructure`) rendered
under `minConfidenceNotYourFault` becomes `uncertain`, proposes `none`, and
keeps its facts.
*Why:* § 18 "Prudence" — the product would rather say "I don't know, here are
the facts" than excuse a failure it cannot prove is external.
*Covered by:* `checkPrudence`, `never excuses a pull request below the
confidence threshold`, `falls back to uncertain below the confidence
threshold`, and the whole corpus run twice: once at the default line (0.75),
once at a stricter line (0.9).

### I7 — The same failure always gets the same identifier
`signatureOf` is a pure digest: the same block gives the same 16-hex id, two
replays of the same dataset give the same ids, and a failure whose stack carries
a different line number keeps its signature.
*Why:* § 9.2, § 9.3 — the signature is the key of the memory, of the ticket and
of the URL. A fingerprint that moves with the noise splits one problem into
many, and breaks "one ticket per problem".
*Covered by:* `gives the same identifier to the same signature, on every
replay` and `gives the same identifier to the same failure, noise aside` (the
corpus asserts one single signature per failure shape).

### I8 — One ticket per family, one synthesis comment per day
A family never gets two creations, all its actions target one single issue key,
and the number of synthesis comments never exceeds the number of distinct days
on which the family had occurrences. A family silent for a fortnight is
proposed for closure, without a new comment.
*Why:* § 11 and CI-07 — the product's promise is one ticket per problem and no
noise: a comment per occurrence would drown the very people it is meant to
help.
*Covered by:* `checkTicketActions` on the sample replay and on every corpus
scenario, plus `opens at most one ticket per family and comments once per day`
and `proposes closure after a fortnight of silence, without a comment`.

### I9 — Nothing survives the configured retention
`purgeExpired(now)` removes every raw excerpt whose expiry has passed, reports
how many it removed, and removes nothing twice.
*Why:* CI-18 — raw logs may contain more than the masked excerpt should, and
the retention is a promise made to the workspace owner.
*Covered by:* `keeps every raw excerpt until the configured retention expires`.

### I10 — The Brain degrades, it never breaks
Every platform failure becomes an explicit result — `{ ok: false, error }` or an
empty state — and never an exception escaping to the platform, and never a
silent partial write:

| Failure | Required behaviour |
|---|---|
| SQL connection refused, SELECT over budget | `{ ok: false, error }`, nothing written |
| SQL write that stops halfway | `{ ok: false, error }`; what landed stays readable, the failure is loud |
| Redelivery of the same message | converges on the same rows, no duplicate |
| Missing row (no signature, no resolution, no outbreak, no settings) | empty state, pipeline still answers |
| Jira 403 / 429 / 500 | `{ ok: false, error }`, no ticket recorded as applied, memory untouched |
| Malformed Jira comment list | no date invented, no exception |
| Model absent, throwing, or answering invalid JSON | deterministic fallback, original block kept, same error never submitted twice |
| Truncated payload or log cut mid-line | explicit refusal (`validateIngestPayload`) or explicit empty state |
| Action whose memory is unreachable | `{ ok: false, error: "internal error: …" }` via `guard` |

*Why:* a Forge consumer has 900 s and the platform redelivers; a web trigger has
55 s. An exception means a retry storm, a silent partial write means a memory
nobody can trust.
*Covered by:* every test of `apps/brain/test/degradation.test.ts`, on doubles
that extend the app's existing fakes with one failure switch each.

### I11 — No input makes the engine throw
Extraction, signing and diagnosis accept arbitrary, empty, truncated or
non-UTF-8-shaped text and answer instead of throwing.
*Why:* the engine reads other people's logs; a log is never well behaved.
*Covered by:* `never lets an exception escape the engine` (200 junk logs).

## Not covered, and known weaknesses

Honesty costs less than a false guarantee:

1. **A redelivered message can split a failure in two when the model's answer
   changes.** `consumeIngest` refines an `unknown` block through the model
   *before* signing it. The occurrence id stays deterministic, but the signature
   id does not: if the platform model was absent on the first delivery and
   available on the redelivery (or the `llm_template_cache` row was not
   persisted), the replay guard — which looks the id up *under the new
   signature* — does not recognise the message. Observed on a local double:
   two signatures each claiming one occurrence, one occurrence row, `replays: 0`
   on both passes, and a ghost signature that no row backs. This breaks I7 and
   can break I8 (two families, so two tickets, for one problem). Reproduction is
   in the lot report; fixing it belongs to the owner of `apps/brain/src/pure/
   consume.ts`, not to this test lot.
2. **The two `Store` implementations disagree on the retention boundary.**
   `MemoryStore.purgeExpired` deletes when `expiresAt < now`, while the Forge
   SQL adapter selects `expires_at <= now`: an excerpt expiring exactly at `now`
   survives in memory and is deleted in SQL. Only the memory side is testable
   here, so I9 is verified against `<`.
3. **`close-suggested` is only checked at planner level.** Per-occurrence
   planning always runs with `now` equal to the occurrence's own instant, so a
   fortnight of silence can only be observed by a scheduled run; the corpus
   therefore never produces that action.
4. **The category-only infrastructure verdict needs no second repository.**
   A dependency or infrastructure failure in a single repository is legitimately
   called `infrastructure` (§ 10.3 targets outbreaks). I5 constrains the verdict
   that *cites* repositories, not the category path.
5. **Retention applies to raw excerpts, not to memory rows.** Occurrences and
   signatures are the product's memory and are never purged; I9 is about the raw
   text kept for `rawRetentionDays`.
6. **The platform adapters are not unit-tested.** `apps/brain/src/consumer.ts`,
   `sql.ts` and `ingest.ts` import `@forge/*`, which the repository root does not
   install, so no test can import them from here. In particular a truncated JSON
   *string* throws inside `consumeMessage`'s `JSON.parse` and is caught
   per message by `createConsumerHandler` (`{ success: false, details }`): that
   catch is real but unverified by a test. Same for `createLlmPort`'s probe of
   the platform model, and for the bridge signature check (covered by
   `packages/bridge` tests instead).
7. **`testStats` reads the wall clock.** When no occurrence matches the test
   name it stamps `updatedAt` with `new Date()` instead of an injected instant —
   the only place in the engine that is not deterministic. Unreachable from the
   consumer (it always passes at least the current occurrence), so no test pins
   it down.
8. **The corpus is a net, not a proof.** 500 seeded cases over eight failure
   shapes; a rule that holds here can still be broken by a shape the generator
   does not produce. Adding a shape means adding one entry to `TEMPLATES`.
9. **Out of scope of this lot:** the cost figures (CI-14), the quarantine
   proposal (CI-19), the curation of signatures (CI-17) and the accuracy targets
   of the labelled corpus (≥ 90 % grouping, < 5 % false flaky) — the last one is
   gated by `packages/core/test/corpus.test.ts`.

## Adding an invariant

Write the rule **once**, in `packages/core/test/fakes/invariants.ts`, as a
function returning `Violation[]` re-derived from the data. It is then checked
automatically on the real sample set, on the 500 generated cases, and on both
confidence lines. Add a case to `the rules catch the violations they exist for`
so that the rule itself cannot rot into a no-op.
