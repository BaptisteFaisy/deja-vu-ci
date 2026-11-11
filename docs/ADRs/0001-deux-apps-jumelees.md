# ADR 0001 — Two twin apps instead of one

- **Status:** accepted
- **Date:** 11 November 2026
- **Scope:** architecture of the whole product

## Context

The product has to do two things that live in two different Atlassian products:

- read a **failed Bitbucket Pipelines build**, its step logs and its test reports;
- write and read **Jira tickets**, and serve a **Jira project page**, an **issue panel**, a **Rovo
  agent** and an **MCP server**.

The obvious design is one Forge app doing both. It is not possible: **a Forge app cannot hold
Bitbucket and Jira scopes at the same time**. The two scope families do not combine, and the
multi-app compatibility documentation only lists Jira and Confluence as compatible. This point was
confirmed in the documentation on 10 and 11 November 2026 (§ 17 of the specification), and it is
one of the six points still to be re-validated by a prototype in the first week.

The alternative would be to give up one side: a Jira-only app would have no access to the build
logs, and a Bitbucket-only app would have no place to keep the memory, no tickets, no Rovo, no
MCP.

## Decision

**The product is two twin Forge apps, joined by a signed web trigger.**

| | Sensor (Bitbucket) | Brain (Jira) |
|---|---|---|
| Role | See the red build, read the logs and test reports, extract the error blocks | Compute signatures, remember, diagnose, hold the tickets |
| Modules | Event triggers, pull-request card, workspace settings page | Web trigger, SQL, LLM, project page, issue panel, Rovo agent, actions, MCP |
| Durable data | None | All the memory |

The Sensor sends an `IngestPayload`; the Brain answers a `QueryRequest`. Both go through the
**signed bridge**: HMAC-SHA256 of the body, timestamp, unique nonce, shared secret established
during pairing and stored in the Forge secret storage.

The two apps stay **thin adapters**: all the logic lives in `packages/core`, which imports no
Forge module at all. The apps read Forge events, call the engine, and render its output.

## Consequences

**Good.**

- Each app holds only one scope family: the install is honest about what it can do, and the
  permission screen is short and comprehensible.
- **The Brain is useful alone.** Replay, universal entry, the memory page and the agent work
  without any Bitbucket connection — which is exactly what a judge without Bitbucket needs.
- The Sensor stays stateless: no database to provision, nothing to migrate, nothing to lose.
- The engine is testable without a tenant, because it does not depend on Forge.

**Bad, and accepted.**

- Two apps to install. The pairing must work, and a broken pairing is a support case. The
  specification already anticipates this risk: pairing in three steps, and the Brain alone must
  remain useful (§ 24).
- One extra network hop, one extra failure mode. The bridge is therefore signed, replay-protected
  and bounded.
- The two apps are versioned separately, so a mismatch is possible. The bridge envelope carries a
  version (`v: 1`) for that reason.

**Alternatives rejected.**

- *One Bitbucket app calling a Jira web trigger* — the reverse of the current design. Rejected:
  the memory would live outside Jira, away from the tickets, the agent and the SQL storage.
- *An external service between the two apps* — rejected: it adds an infrastructure to install,
  host and secure, for a product whose whole pitch is to be two Forge apps.
- *Dropping the Bitbucket side and reading the logs from the CI itself* — kept as the **universal
  entry** fallback (CI-16), not as the main path: it loses the pull-request card, the changed
  files and the ancestry comparison.
