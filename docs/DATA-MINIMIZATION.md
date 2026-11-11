# Data minimization of raw excerpts

The Brain keeps a raw excerpt of each failure for a configurable retention
(`rawRetentionDays`, § 16 `raw_excerpt`). Keeping the full raw text is the
least-minimizing choice: it may still hold a secret no mask caught, or PII, for
the whole retention window. `minimizeExcerpt` (`packages/core/src/minimize.ts`)
reduces an excerpt to the strict minimum a retention policy allows.

## The function

```ts
minimizeExcerpt(excerpt, policy, options?): MinimizedExcerpt
```

- `excerpt`: `{ text: string; fingerprint?: string }` — the raw text, plus an
  optional precomputed fingerprint.
- `policy`: `'hash-only' | 'masked-snippet' | 'full'`.
- `options.maxChars`: the character budget of a `masked-snippet`
  (default `512`).

It is **pure**: it never mutates its input and depends on no clock or storage.

| Policy | Keeps | Use it when |
|---|---|---|
| `hash-only` | the fingerprint only; the text is dropped | you only need to correlate/dedupe, not to read the excerpt |
| `masked-snippet` | fingerprint + a masked, truncated excerpt | the default: enough to debug, bounded in size |
| `full` | fingerprint + the full masked excerpt | an operator explicitly needs the whole text |

Secrets are masked before anything is retained — **even under `full`** a raw
secret never persists. The fingerprint is derived from the **raw** text
(SHA-256, first 16 hex), so the same excerpt yields the same fingerprint under
every policy; `hash-only` still allows correlation without keeping the text.

The result reports what happened (`masked`, `truncated`, `bytes`) so a caller
can log the minimization decision without logging the excerpt.

## Branch point (not wired yet)

This module is intentionally **not** called by the apps in this lot. The natural
branch points, for a follow-up lot to choose and wire:

- **Consumer** (`apps/brain/src/pure/consume.ts`, `consumeBlock`): where the
  raw excerpt is saved (`store.saveRawExcerpt`). Apply `minimizeExcerpt` to
  `block.rawText` before building the `RawExcerpt`, choosing the policy from
  `Settings` (a new field, e.g. `excerptPolicy`).
- **Retention sweep** (`purgeExpired`): an alternative is to store full and
  minimize on the way down — re-minimize an excerpt to `hash-only` once it
  passes a soft TTL, before the hard `expiresAt` purge.

The Store contract (`saveRawExcerpt`) and the `RawExcerpt` shape are unchanged:
`minimizeExcerpt` returns a `text` the caller stores as-is. Wiring it is a
settings + one-call-site change, deliberately left out of this lot so the
minimization policy can be decided with the product owner.

`minimizeExcerpt` is exported from `packages/core/src/minimize.ts`. It is not
re-exported by the package barrel yet (the barrel is owned by another lot); a
follow-up adds `export * from './minimize.js'` to `packages/core/src/index.ts`
when it wires the call site.
