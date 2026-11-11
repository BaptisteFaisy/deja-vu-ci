# Masking — what is masked, what is not, and why

Error excerpts travel from the Sensor (Bitbucket) to the Brain (Jira) and are
stored in the Brain memory. Before anything is kept, `maskSecrets`
(`packages/core/src/mask.ts`) replaces secret- and PII-looking spans with a
stable neutral token `«[masqué:kind]»`.

Masking is **best-effort, not a guarantee**. It is a regex table plus a few
validators; a credential in a shape no rule anticipates can slip through. This
document is deliberately honest about the limits — a false sense of coverage is
worse than a written limit.

## What is masked

| Kind | Token | Examples |
|---|---|---|
| Private keys | `«[masqué:private-key]»` | `-----BEGIN … PRIVATE KEY-----` blocks |
| Provider tokens | `«[masqué:token]»` | GitHub `ghp_`/`gho_`/`ghs_`/`github_pat_`, Atlassian `ATATT3…`/`ATBP…`, npm `npm_…`, Slack `xox…`, GitLab `glpat-…`, quoted `Authorization: Bearer/Basic "…"` |
| AWS access key ids | `«[masqué:aws-key]»` | `AKIA…`, `ASIA…` (16 uppercase alphanumerics) |
| Google API keys | `«[masqué:google-key]»` | `AIza…` (39 characters) |
| JWT | `«[masqué:jwt]»` | three base64url segments `eyJ…` |
| URL credentials | `«[masqué:url-credentials]»` | `scheme://user:pass@host`, and empty-user `redis://:pass@host` |
| Passwords / secrets | `«[masqué:password]»` | `password=…`, `api_key: …`, and JDBC/connection query params `?password=…` |
| Email addresses | `«[masqué:email]»` | `name@domain.tld` |
| IBAN | `«[masqué:iban]»` | two letters + two check digits + alphanumeric tail, validated by mod-97 |
| Card numbers | `«[masqué:card-number]»` | 13–19 digits, validated by Luhn + a leading industry digit |
| Phone numbers | `«[masqué:phone]»` | international format with an explicit leading `+`, ≥ 7 digits |
| Secret-looking blobs | `«[masqué:secret-blob]»` | long hex (≥ 33) and base64-ish (≥ 33, mixed case + digit) runs |

The rules run in a fixed order; the token of one rule never matches another, so
masking is **idempotent** — masking an already-masked text changes nothing
(`masked` is `0` on the second pass).

## PII beyond secrets

- **Email addresses** are masked in full, so the local part (often a person's
  name) is removed too. This is the main PII surface in CI logs and it is
  covered.
- **User identifiers in URLs** (`user:pass@host`, `?user=…&password=…`) are
  masked: the credential and the surrounding span become a token.
- **Postal addresses**: **not masked.** A precise postal address is very rare in
  a build log, and a rule broad enough to catch free-text addresses would
  shred ordinary paths and sentences (high false-positive cost for near-zero
  signal). We chose not to pretend to cover it.
- **Free-text person names** inside a log message (not in an email or URL):
  **not masked.** There is no reliable way to distinguish a name from an
  identifier, a variable, or a test fixture without over-masking. This is a
  real limit, stated plainly.
- **IP addresses and hostnames**: **not masked.** They are usually
  infrastructure, not personal data, and masking them would destroy the
  diagnostic value of network errors. Connection *credentials* inside a URL are
  masked; the host itself is kept.

## Extending the table

`maskSecrets(text, options?)` accepts `options.extraPatterns`: an array of
`{ kind, re, validate? }` **appended** to the defaults. Extra patterns never
remove or reorder a default rule, and idempotence is preserved as long as an
extra pattern does not match the neutral tokens. Use it for a secret shape
specific to your stack:

```ts
maskSecrets(text, { extraPatterns: [{ kind: 'acme-key', re: /\bACME-[A-Z0-9]{8}\b/g }] });
```

## False positives

The card-number and IBAN rules carry validators (Luhn, mod-97) and the phone
rule requires an explicit `+`, so ordinary numbers, timestamps, durations and
commit shas are left alone. The long-blob rules require a mix of cases and a
digit, so plain words and short hex ids are not touched. Masking is applied to
raw excerpts before normalization; the accuracy harness (`npm run eval`) is the
regression guard that proves masking does not break error extraction.
