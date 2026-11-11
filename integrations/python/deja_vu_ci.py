"""Déjà-vu CI — Python SDK for the universal entry.

A single-file, standard-library-only client (`urllib`, `hmac`, `hashlib`) that
reports a failing build to the Brain's `/universal` web trigger from any CI.

Guarantees shared with the other integrations:

* idempotence — every payload carries a stable SHA-256 fingerprint of the exact
  content sent, so retrying the same report yields the same key;
* retries with backoff on transient failures (network error, HTTP >= 500);
* a per-attempt timeout;
* the caller's build is never failed because of the Brain: the report is
  best-effort, and `report()` returns a result object instead of raising on a
  refused or unreachable Brain (it only raises on invalid arguments).

Usage::

    from deja_vu_ci import report

    result = report(
        url="https://dejavu.webtrigger.atlassian.app/universal",
        key="<BRAIN_KEY>",
        repo="owner/name",
        log=open("build.log").read(),
    )
    print(result["ok"], result["status"], result["idempotency_key"])
"""

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request

# The Brain bounds the journal to 50 KiB before it leaves the machine.
LOG_CAP = 51200

_BACKOFF = (0.5, 1.0, 2.0)


def sign(payload, secret):
    """Return the HMAC-SHA256 hex of ``payload`` keyed by ``secret``.

    This is the signed-bridge primitive (same construction as
    ``packages/bridge``). The universal entry itself authenticates with a
    per-project key in the body, so ``sign`` is exposed for teams that later
    switch to the signed bridge and want one client for both.
    """
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def fingerprint(payload):
    """Stable SHA-256 idempotency fingerprint of a JSON payload."""
    data = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _canonical(key, repo, log, branch, commit, author, step, failed_at):
    payload = {
        "projectKey": key,
        "repository": repo,
        "branch": branch,
        "log": log[:LOG_CAP],
    }
    if commit:
        payload["commit"] = commit
    if author:
        payload["author"] = author
    if step:
        payload["step"] = step
    if failed_at:
        payload["failedAt"] = failed_at
    return payload


def _post(url, body, timeout):
    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return int(response.status), response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return int(err.code), err.read().decode("utf-8", "replace")
    except urllib.error.URLError as err:
        raise OSError(str(err.reason)) from err


def report(url, key, repo, log, branch="unknown-branch", commit=None, author=None,
           step=None, failed_at=None, timeout=20.0, retries=3, dry_run=False):
    """Send one failing-build report to the universal entry.

    Returns a dict with ``ok``, ``status``, ``attempts``, ``idempotency_key``
    and ``diagnostic``. Raises ``ValueError`` only for invalid arguments.
    """
    if not url:
        raise ValueError("url is required")
    if not key:
        raise ValueError("key is required")
    if not repo:
        raise ValueError("repo is required")
    if not log:
        raise ValueError("log is required")

    payload = _canonical(key, repo, log, branch, commit, author, step, failed_at)
    idem = fingerprint(payload)
    payload["idempotencyKey"] = idem
    body = json.dumps(payload, ensure_ascii=False)

    if dry_run:
        return {"ok": True, "status": 0, "attempts": 0,
                "idempotency_key": idem, "diagnostic": "dry run", "payload": payload}

    status = 0
    response_body = ""
    attempts = 0
    for attempt in range(1, retries + 1):
        attempts = attempt
        try:
            status, response_body = _post(url, body, timeout)
        except OSError as err:
            if attempt < retries:
                time.sleep(_BACKOFF[min(attempt - 1, len(_BACKOFF) - 1)])
                continue
            return {"ok": False, "status": 0, "attempts": attempts,
                    "idempotency_key": idem, "diagnostic": str(err)}
        if status < 500:
            break
        if attempt < retries:
            time.sleep(_BACKOFF[min(attempt - 1, len(_BACKOFF) - 1)])

    ok = status in (200, 202)
    return {
        "ok": ok,
        "status": status,
        "attempts": attempts,
        "idempotency_key": idem,
        "diagnostic": response_body.strip() if ok else (response_body.strip() or "refused"),
    }