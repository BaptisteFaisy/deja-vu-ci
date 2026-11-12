# GOLDEN — the reference snapshot of the memory

`data/golden/` is the **reference snapshot** of the Déjà-vu memory after a
replay of the sample game (`data/sample/occurrences.json`, CI-11). It freezes
what the real engine produces end to end — extraction, signatures, statuses,
diagnostics, ticket plan, cost — so that any drift of the memory shows up as a
red CI, with the exact field that moved.

## What is inside

Five generated JSON files, metadata only, sorted and byte-stable (the same
replay always produces the same bytes):

| File | Content |
|---|---|
| `meta.json` | snapshot layout version, dataset name and SHA-256, reference instant, counts |
| `signatures.json` | one entry per signature: id, family, category, status, occurrences, first/last seen, ticket key |
| `diagnostics.json` | spread of the diagnostics per kind (`byKind`) and one entry per occurrence: id, signature, kind, action, confidence |
| `tickets.json` | the ticket plan in chronological order: kind, family, signature, issue key, labels |
| `cost.json` | the four cost counters: red builds, CI minutes lost, people affected, retries (30-day window) |

No free text (diagnostic titles, ticket summaries) and **no raw log excerpt**
ever enters the snapshot: the generator and the test both reject a snapshot
in which one identifiable line of a sample log reappears verbatim
(`findRawLogLeaks`). The sample game is fictional, but the snapshot stays
metadata-only by design — the same rule as the live memory
(`docs/DATA-MINIMIZATION.md`).

## How to regenerate

The files are generated, **never hand-edited**:

```bash
npm run build && node tools/gen/golden.mjs          # rewrite data/golden/
node tools/gen/golden.mjs --check                   # compare without writing; exit 1 on drift
```

The generator replays the sample dataset through the compiled engine
(`packages/core/dist`) at a reference instant derived from the dataset itself
(its last occurrence), never from the wall clock. `--check` is meant for CI
and for reviewers: on drift it prints which file and which field moved, then
the command above.

## What guards it in CI

`packages/core/test/golden-memory.test.ts` replays the sample game with the
**real** engine (TypeScript sources, no build needed) and compares the whole
snapshot with the committed files — plus three properties: the directory holds
exactly the five files (nothing stale), two consecutive replays give the same
bytes (determinism), and no raw log line leaks. A failure message names the
drift and quotes the regeneration command, because a golden test nobody knows
how to regenerate is a golden test that gets disabled.

## Drift: regression or intended change?

The snapshot moving is a **signal**, not a verdict:

- **Regression (the usual case).** You touched the engine — normalization,
  signatures, diagnosis, flakiness, tickets, cost — and the memory of the
  sample game changed. Read the drift: one identifier moving means the
  signature recipe changed; one status moving means the status machine
  changed; one counter moving means the accounting changed. If the change was
  not intended, fix the code, not the snapshot.
- **Intended algorithm change.** The drift is the point of the PR. State it in
  the PR body (what moved, why, and the migration for existing memories:
  signatures are identifiers in Forge SQL, so a changed signature recipe must
  say what happens to stored rows and open tickets), then regenerate and
  commit the new snapshot **in the same PR**. Reviewers diff `data/golden/`
  to see the blast radius at a glance.
- **Sample game change.** `meta.json` pins the SHA-256 of
  `data/sample/occurrences.json`: if the dataset moves, the snapshot must be
  regenerated in the same PR, and `tools/check-dataset.mjs` must stay green.

Never regenerate "to make CI green" without explaining the drift: that is how
a golden test dies.

## Difference with the signature golden test

Another golden test watches the **signature identifiers themselves**
(`packages/core/test/signature-golden.test.ts`: `signatureOf` / `familyOf`
over fixed error blocks — finer-grained, owned by the signature-stability
effort, see `docs/SIGNATURE-VERSIONING.md`). This snapshot is wider and
coarser at the same time: it watches the **whole memory** after a full replay
(statuses, diagnostics, ticket plan, cost), but only through metadata. The
signature golden test tells you *the recipe of an identifier changed*; this
one tells you *the behaviour of the product changed*. A signature-recipe
change trips both — that is intended.
