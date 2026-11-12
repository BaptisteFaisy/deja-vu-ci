# Déjà-vu CI — GitHub Actions integration

A composite action that reports a failing step of a GitHub Actions workflow to
the [Déjà-vu CI](https://github.com/Tradoooo/deja-vu-ci) universal entry.
No `npm install`, no third-party tooling: `curl` + `bash`, exactly what the
runners already have.

## Usage

```yaml
name: CI

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: make build

      - name: Test
        id: test
        run: make test 2>&1 | tee /tmp/test.log

      - name: Report red builds to Déjà-vu CI
        if: failure()
        uses: Tradoooo/deja-vu-ci/integrations/github-action@main
        with:
          brain-url: ${{ secrets.DEJAVU_BRAIN_URL }}
          secret-key: ${{ secrets.DEJAVU_PROJECT_KEY }}
          log-file: /tmp/test.log

      - name: Use the report
        if: failure()
        run: |
          echo "signature was ${{ steps.test.outputs.signature }}"
```

### Inputs

| Input       | Required | Default               | Notes                                    |
| ----------- | -------- | --------------------- | ---------------------------------------- |
| `brain-url` | yes      | —                     | URL of the Brain `/universal` trigger.   |
| `secret-key`| yes      | —                     | Per-project key. Masked, never printed.  |
| `repository`| no       | `GITHUB_REPOSITORY`   | `owner/name`.                            |
| `branch`    | no       | `GITHUB_REF_NAME`     | Branch name.                             |
| `commit`    | no       | `GITHUB_SHA`          | Commit SHA.                              |
| `step`      | no       | `github.job`          | Step name.                               |
| `log-file`  | no       | —                     | Path to the failed step log (exclusive). |
| `log`       | no       | —                     | Inline log text (exclusive).             |
| `outcome`   | no       | —                     | Only `failure` is reported.              |

### Outputs

| Output       | Description                                              |
| ------------ | -------------------------------------------------------- |
| `signature`  | Stable SHA-256 fingerprint of the payload just sent.     |
| `diagnostic` | `accepted (HTTP 2xx)`, or `HTTP <code>` with the body.   |

## Behaviour

- Post only what failed: pass `outcome` or guard the step with `if: failure()`.
- The journal is capped at 50 KiB before leaving the runner.
- The request carries a stable `idempotencyKey` (the same content keeps the
  same key across retries, so a replay never duplicates an occurrence once the
  Brain deduplicates on it).
- The action **never fails your workflow**: if the Brain is unreachable, your
  pipeline keeps going. The `diagnostic` output tells the following steps what
  happened.