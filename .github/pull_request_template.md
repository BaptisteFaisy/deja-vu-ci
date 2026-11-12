## Summary

<!-- What does this change and why? 2-4 sentences. Keep it in English: the
     judges are anglophone. -->

## Scope

<!-- REQUIRED by the `couche0` guard. One bullet per modified file, with the
     reason. A modified file missing here, or a declared file absent from the
     diff, refused the PR. Run `git diff --name-only origin/main` to be exact.
     `.lock`, `.png`, `.webp` and `.jpg` files are exempt. Fill the list
     below and delete this comment. Example:

- `packages/core/src/sign.ts` — stable signature for the new kind
-->

## Checks before pushing

- [ ] `npx tsc -p packages/core --noEmit && npx tsc -p packages/bridge --noEmit && npx tsc -p packages/present --noEmit`
- [ ] `npx vitest run --reporter=dot` — the whole suite is green, not just my tests
- [ ] every file < 500 lines, every function < 50 lines
- [ ] no conflict markers (`<<<<<<<`, `>>>>>>>`)
- [ ] `python3 .github/ci-budget/check_timeouts.py` → 0 errors

## Guarded patterns — rejected in added lines

The `couche0` guard rejects, in any added line: force-taking one side of a
merge conflict (`ours` / `theirs`), a force push without the safe
`--force-with-lease` flag, a privileged trigger, a plaintext API key or
token, a hardcoded `sdk.dir` path, and any date earlier than the 26th of
October 2026. Check every comment in this PR: none of these must appear, not
even to describe a rule.