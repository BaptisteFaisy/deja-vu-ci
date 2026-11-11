# Security Policy

Déjà-vu CI is a pair of Atlassian Forge apps — the **Sensor** (Bitbucket) and
the **Brain** (Jira) — that recognise a red build, tell in seconds whether it
is new, known, flaky or an infrastructure failure, and keep one Jira ticket per
problem. Because the product ingests build logs, signs requests between two
apps, writes to Jira and stores state in Forge SQL, security is a first-class
concern.

This document describes what we support, what makes a valid report, how to send
one, and how we handle it. The threat model that backs this policy lives in
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md); the current state of testing is
in [`docs/SECURITE-ETAT.md`](docs/SECURITE-ETAT.md).

## Supported scope

We treat the following surfaces as **in scope** for security reports:

- The signed bridge between the Sensor and the Brain
  ([`packages/bridge`](packages/bridge)): the HMAC-SHA256 envelope, its
  nonce and timestamp handling, and the verification of incoming requests.
- The three public web triggers of the Brain — `/ingest`, `/query` and
  `/universal` ([`apps/brain/manifest.yml`](apps/brain/manifest.yml)) — and the
  validation, masking and size bounding they apply before anything is stored.
- Secret masking of build logs ([`packages/core/src/mask.ts`](packages/core/src/mask.ts)),
  applied on the write side (Sensor) and on the read side (universal entry).
- The persistence layer: what is stored in Forge SQL, its retention and purge.
- The LLM call path (`@forge/llm`) and the Rovo/MCP actions.

Out of scope: the public documentation site under `site/**`, the example data and
demo repositories, and anything that requires an attacker to already hold the
Forge install's administrator credentials.

## Supported versions

Déjà-vu CI is pre-release (Codegeist 2026 submission, version `0.1.0`). We
support **only the version built from the `main` branch** of this repository at
the latest commit. The bridge envelope protocol is version `1` and is the only
protocol version we accept. Older commits and forks are not supported and do not
receive fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a suspected vulnerability. Send it
privately to the maintainer contact of this repository:

- **Email:** [`baptiste.faisy@gmail.com`](mailto:baptiste.faisy@gmail.com)

This is the repository's own contact channel. Expect an acknowledgment within
**5 business days** and a first assessment within **14 business days**.

## What makes a valid report

A useful report is short and actionable. Please include, where you can:

1. The affected surface (bridge, a web trigger, masking, storage, LLM, Rovo/MCP).
2. The version or commit you tested.
3. A minimal reproduction or a capture of the payload/headers involved.
4. The impact you believe it has (read, write, replay, secret leak, denial of
   service) and a realistic severity.

We do **not** consider these to be valid security reports: issues that require
the attacker to already be an administrator of the Forge install, theoretical
weaknesses without a concrete path to impact, and reports about dependencies or
platform behaviour that we do not control. Do **not** send real secrets: where a
report needs a token, use an obvious placeholder such as `<SECRET>`.

## Disclosure policy

- We acknowledge every valid report within 5 business days.
- We agree on a fix window with the reporter before any public disclosure.
- After the fix ships, we credit the reporter in the release notes (unless they
  ask to stay anonymous) and document the issue in the changelog.

We follow a strict **fail-closed** philosophy across the product: if a signing
secret is missing, a masking engine is unavailable, or a universal entry key is
not configured, the affected entry refuses the request rather than proceeding
with weaker guarantees.

## Security model in one paragraph

Build logs are masked **before they leave the source** (Sensor) or on entry
(universal). The signed bridge authenticates every `/ingest` and `/query` call
with an HMAC over the body, a timestamp and a nonce. The `/universal` route is a
deliberate, documented exception: it is protected by a project key instead, and
it is closed by default. Stored raw excerpts are masked and purged after a
configurable retention window. Details and the honest list of what is **not**
yet covered are in [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).