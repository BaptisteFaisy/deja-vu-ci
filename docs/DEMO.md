# Demo script — Déjà-vu CI (under 5 minutes)

The video is in **English** (§ 21 of the specification). It shows four failures, one page, one
agent. It never shows a fake screen: every shot below is a real command, on the real sample
dataset.

**Total: 4 min 50 s.** Two cameras are enough: the screen, and a voice-over.

---

## 0. Preparation — the four cases, before recording

All four cases come from the bundled sample dataset (40 failures over 14 days). Prepare them once,
before the shoot, and check that each one is reachable.

```bash
npm ci
npm run replay > /tmp/replay.txt
```

The four cases are the four expected diagnostics. To isolate one case at a time, use the sample
dataset directly and grep the replay output:

```bash
# Case 1 — known flaky test (same signature, several branches, a success on the same commit)
grep -n -i "flaky" /tmp/replay.txt

# Case 2 — already seen, already fixed (a confirmed resolution on another branch)
grep -n -i "already-fixed" /tmp/replay.txt

# Case 3 — brand-new error (first appearance, suspect files in the stack)
grep -n -i "new" /tmp/replay.txt

# Case 4 — infrastructure outage (several repositories failing the same way)
grep -n -i "infrastructure" /tmp/replay.txt
```

For the shot where the four cases are told as a story, prepare the demo repository too — it
contains a deliberately random test, a real regression, and a dependency pointing at a cut-off
registry:

```bash
cd examples/flaky-repo && git log --oneline -5
```

And for the agent shot, prepare the question (you will type it live, but know it works):

```bash
tools/universal-entry.sh --project-key CI --repository demo-repo --branch main --log-file /tmp/agent.log
```

> **Status:** the sample dataset, the demo repository and the tools are delivered by the
> sample-data-and-tools lot (`data/**`, `tools/**`), which lands in parallel with this
> documentation. The commands above are the contract those tools were built against
> (`docs/CONTRACTS.md`); if a command is not yet present in your checkout, wait for that lot to
> merge.

---

## 1. The story (0:00 – 0:30)

**Screen:** a team chat. Three identical questions arrive, one minute apart, from three different
people.

> *« Why is the build red again? »*
> *« Has this error ever happened before? »*
> *« Is it the flaky test again? »*

**Voice-over:**

> Every red build triggers the same investigation. The answer exists — in hundreds of pipeline
> logs nobody re-reads. Déjà-vu CI gives that memory to the team: it recognises the failure, says
> in seconds whether it is new, known, flaky or infrastructure, and keeps **one ticket per
> problem** instead of one per occurrence.

---

## 2. Case 1 — a flaky test, recognised (0:30 – 1:20)

**Screen:** the pull-request card of the demo repository. The build is red.

**What the card shows:**

> **Known flaky** — this test fails at random: seen 17 times on 9 branches, ticket PAY-88.
> Probably unrelated to your PR.
> *Action: retry.*

**Second shot:** the Jira ticket PAY-88 — the single ticket of the problem, with the table of
occurrences (date, repository, branch, link) and the cost.

**Voice-over:**

> First case: a test that fails at random. The app has seen this exact signature seventeen times
> on nine branches, and knows it passed on the same commit after failing. The recommendation is to
> retry — not to touch the code. Notice the ticket: one, for the whole family of failures. Not
> one ticket per occurrence.

---

## 3. Case 2 — an error already fixed (1:20 – 2:10)

**Screen:** another pull request, a different branch, a red build.

**What the card shows:**

> **Already seen, already fixed** — same error on `main` on 3 November, fixed by Marie in
> `abc123` (HTTP client update). Your branch predates that fix.
> *Action: rebase or cherry-pick the fix.*

**Second shot:** the "CI Memory" page, the *Resolutions to confirm* tab — the same commit, with
the human confirmation button. The voice-over mentions that the confirmation is what turns a
guess into a citation.

**Voice-over:**

> Second case: the error is not new, and it has already been fixed. The app compares the branch
> with the commit that solved the problem, and cites the author and the change. The developer
> rebases instead of debugging from scratch.

---

## 4. Case 3 — a brand-new error (2:10 – 2:50)

**Screen:** a third pull request.

**What the card shows:**

> **New** — first appearance. The step passed on the previous commit. Suspect changed files:
> `refund/Limiter.java`.

**Voice-over:**

> Third case: the app has never seen this error. It says so, and it points at the changed file
> that appears in the stack. It does not blame the developer, it shows the facts.

---

## 5. Case 4 — six repositories, one incident (2:50 – 3:20)

**Screen:** the "CI Memory" page, filtered on infrastructure, with the six repositories of the
outbreak listed and a single incident key.

**Voice-over:**

> Fourth case: the package registry is down. Six repositories fail the same way within fifteen
> minutes. The app recognises the pattern, opens **one** incident instead of six alerts, and
> tells everyone to wait rather than to fix.

---

## 6. The cost of the flaky tests (3:20 – 4:00)

**Screen:** the "CI Memory" page, *Cost* tab, 30 days.

**What it shows:** red builds, CI minutes lost, people affected, retries — and the ranking of the
flaky signatures by cost.

**Voice-over:**

> Here is what the flakiness actually costs: forty-one hours of CI and two hundred and twelve
> retries this month. A number that makes people decide.

---

## 7. A code agent that does not go round in circles (4:00 – 4:35)

**Screen:** a terminal, a code agent's log. The build fails. The agent calls
`explain-build-failure`. The answer comes back: *known flaky — retry*.

**Voice-over:**

> When an agent's build fails, it asks. The answer says: known flaky, retry. The agent retries
> instead of modifying healthy code to fix a failure that was never its fault. That is the whole
> point: the agents stop changing code that was not broken.

---

## 8. The architecture (4:35 – 4:50)

**Screen:** `docs/architecture.svg`, full screen.

**Voice-over, over the diagram:**

> Two twin Forge apps: the Sensor on the Bitbucket side, the Brain on the Jira side, joined by a
> signed bridge — HMAC, timestamp, nonce. The Brain holds the memory, the tickets, the Rovo agent
> and the MCP actions.

**End card:** the repository URL, `npm ci && npm run replay`, and the judges' guide
(`docs/JUDGES.md`).

---

## Shooting notes

- **The replay is deterministic**: the same command always prints the same numbers. Record it in
  advance and re-record the screen if a take is noisy.
- **No tenant is needed** for shots 1 to 6 — the replay output and the sample dataset are enough.
  Shots 2, 4 and 5 need a tenant for the card and the page; shoot them on the demo repository.
- **Hide the real names**: use the demo workspace and the demo ticket keys (`PAY-88` in the
  script) rather than anything from a real project.
- **Keep the pace**: the whole point is "a few seconds". Never leave a diagnostic on screen while
  it loads — cut to the answer.
