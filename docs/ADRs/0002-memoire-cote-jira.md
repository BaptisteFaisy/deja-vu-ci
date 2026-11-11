# ADR 0002 — The memory lives on the Jira side

- **Status:** accepted
- **Date:** 11 November 2026
- **Scope:** data ownership, storage, product surfaces

## Context

Every occurrence of a failure has to be remembered: the signature, the branches it appeared on,
the commits that fixed it, the cost it caused, the ticket that tracks it. The memory is what
turns "a red build" into "a known problem".

The specification gives three reasons for putting that memory on the Jira side (§ 7):

1. that is where the tickets live;
2. that is where the Rovo agent and the MCP server live;
3. that is where the people who need the answer work.

Forge SQL is available on the Jira side, and it is the only durable storage we get inside the
platform: 1 GiB per installation in production, 5 s per SELECT, no foreign keys.

## Decision

**All the durable data lives in the Brain (Jira app), in Forge SQL. The Sensor (Bitbucket app)
holds no durable data whatsoever.**

The Brain owns the nine tables of § 16:

`signature`, `occurrence`, `test_stats`, `resolution`, `raw_excerpt`, `llm_template_cache`,
`outbreak`, `pairing`, `settings`.

The Sensor is stateless: it reads a Forge event, masks it, and forwards it. Everything it sends is
reproducible from the event that triggered it.

**Raw excerpts are the exception to "keep everything".** They are the only bulky rows, so they
carry an expiry date (`raw_excerpt.expires_at`) and are purged by the scheduled trigger after a
configurable period — 30 days by default (CI-18). Signatures, occurrences, statistics and
resolutions are kept indefinitely: they are small and they are the product.

Two indexes, and only two, are enough for every screen query: one on `signature.family_id`, one
on `occurrence(signature_id, occurred_at)`. Foreign keys are impossible in Forge SQL, so the
referential integrity is enforced by the store layer.

## Consequences

**Good.**

- One place to look for the truth: the "CI Memory" page, the issue panel, the Rovo agent and the
  MCP tools all read the same rows.
- No synchronisation, no dual write, no divergence between two databases.
- The retention policy is enforceable: one scheduled trigger purges what must expire.
- The Brain remains a complete product on its own, without Bitbucket.

**Bad, and accepted.**

- **Every occurrence crosses the bridge**, so the bridge is on the critical path. Its limits are
  therefore strict: signed, replay-protected, bounded to 5 MB, with the payload itself capped at
  50 KB of error blocks.
- **Forge SQL is not a database.** No foreign keys, no joins with guarantees, a 5 s budget per
  SELECT and 1 GiB per installation. The store layer therefore does the work the database cannot
  do, and the screen queries are indexed and paginated.
- **The pairing secret is a row of this database** (`pairing.secret_id` references a secret held
  in the Forge secret storage). The row holds a reference, never the secret itself.
- **Deletion is coarse.** A purge removes raw excerpts, not signatures. That is deliberate: the
  memory is the product.

**Alternatives rejected.**

- *Store the memory on the Bitbucket side* — rejected: no tickets, no agent, no SQL with the
  people who need it, and the Sensor would have to own a durable store it does not need.
- *Store the memory in both apps* — rejected: two sources of truth, two conflict resolutions, and
  the pull-request card would have to merge two answers.
- *Keep the logs in an external store* — rejected: an infrastructure to operate, and it would
  violate the "only the error blocks leave Bitbucket" rule that protects secrets.
