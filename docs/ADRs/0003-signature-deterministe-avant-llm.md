# ADR 0003 — The deterministic signature comes before the model

- **Status:** accepted
- **Date:** 11 November 2026
- **Scope:** the core of the product — how an error becomes an identity

## Context

The whole product rests on one question: **are these two failures the same error?** Everything
downstream depends on the answer — the flaky detection, the unique ticket per family, the
resolution that is cited months later, the cost ranking, the regression detection.

The specification (§ 9) is explicit: *"the method is deterministic; the language model only
intervenes as a fallback."*

That choice has a cost. The model can recognise an error format nobody thought of. A purely
deterministic method cannot: when no known pattern matches, the block stays unclassified.

Forge's own limits make the temptation stronger: an LLM module is available, it is fast, and it
would "solve" the unknown-error case in one call. But the LLM budget is 100 requests per minute
per installation, and — more importantly — an identity that changes when the model changes is not
an identity.

## Decision

**The signature is computed deterministically, always. The model is a fallback, cached, and can
never change an existing identity.**

The pipeline, in this order:

1. **Extract** (§ 9.1) — test reports first, then the log patterns (JUnit, pytest, Jest, Go,
   Cargo, npm, Gradle, Maven, TypeScript, ESLint, Docker, out of memory, timeout, network), else
   the last 80 non-empty lines. At most **3 distinct blocks**, **50 KB** in total.
2. **Normalize** (§ 9.2) — timestamps, durations, dates, memory addresses, UUIDs, commit hashes,
   temporary paths, container names, ports, **line numbers** (the file and the function are
   kept), isolated numbers, ANSI colour codes. The stack is reduced to the **first 5 lines
   belonging to the project**.
3. **Categorize** (§ 9.4) — the eight categories: test, compile, style, dependency,
   infrastructure, timeout, config, unknown.
4. **Sign** (§ 9.3) —
   - **signature** = `sha256(category | errorType | normalizedMessage | reducedStack)`, truncated
     to 16 hex characters: *the same error*;
   - **family** = the same hash **without the stack**: *the same problem*, and the uniqueness key
     of the Jira ticket (§ 11).
5. **LLM fallback, only if step 3 recognised nothing** (§ 9.5) — the model returns a canonical
   template and a category. The result is **cached by normalised text** (`sha256`), so the same
   raw error is never submitted twice. If the model answers off-format, the deterministic
   fallback applies. **No exception ever escapes.**

In short: **the model can label an unknown error, it can never rename a known one.**

## Consequences

**Good.**

- **Stable identities.** The same failure produces the same signature today, tomorrow, and after
  a model update. A ticket key, a URL and a cited resolution stay valid for months.
- **Reproducible.** The replay of the sample dataset is deterministic, and so is the accuracy
  evaluation: two runs of the same corpus give the same numbers, which is what makes a measured
  grouping rate meaningful.
- **Cheap and fast.** Most errors never reach the model: patterns and normalisation are local
  computation. The 100 requests/minute budget is spent only on the unknown cases.
- **Privacy.** The model sees only the error block that no pattern recognised — never the whole
  log, and never the secret, which is masked before anything is sent.
- **Explainable.** Every signature can be re-derived by hand from the category, the type, the
  normalised message and the reduced stack. A developer can argue with it.

**Bad, and accepted.**

- **Unknown formats need a human.** The app will classify a strange error as `unknown` rather
  than guess. It then says so plainly — "uncertain", with the facts — instead of inventing a
  confident answer.
- **A too-specific message creates two signatures.** This is the known edge case of § 19: two
  signatures are born, the manual merge corrects it, and the normalisation rules are enriched.
  The two-level model (signature and family) limits the damage.
- **The fallback needs a guard.** The cache and the off-format guard exist precisely because an
  LLM call must never be able to break the ingestion path.

**Alternatives rejected.**

- *Ask the model first, for every error* — rejected: 100 requests/minute would not survive a
  busy day, the identities would drift with the model, and the diagnostics would stop being
  reproducible.
- *Let the model name the errors, then map the names to the deterministic signatures* — rejected:
  the mapping is exactly the unstable link we are trying to remove.
- *Drop the model entirely* — rejected: it is a useful fallback for formats nobody anticipated,
  and it is free as long as it stays in second position.
