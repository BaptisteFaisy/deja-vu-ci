#!/usr/bin/env python3
"""Client A2A du daemon ZeroClaw — agent de secours du résolveur de conflits.

Le résolveur de conflits (`.github/fireworks/conflict_agent.py`) interroge par
défaut l'API Fireworks. Quand cette API refuse (clé expirée, HTTP 412,
modèle retiré), ce module fournit le **repli local** : le daemon ZeroClaw de
la machine du runner, alias d'agent `hermes`, via le protocole A2A
(`POST /a2a/<agent>`, JSON-RPC `SendMessage`).

Le jeton du client n'est jamais écrit dans le dépôt : il est lu dans
`~/.zeroclaw/data/gateway-admin.token` (daemon local), puis
`~/.config/zeroclaw-serveur/token` et
`/opt/zeroclaw/ephem/data/gateway-admin.token` (daemon du serveur). Sans
jeton, le repli est proprement indisponible et l'appelant garde son erreur
d'origine.

Configuration par variables d'environnement (toutes optionnelles) :

  HERMES_ZC_URL        défaut http://127.0.0.1:42617
  HERMES_ZC_AGENT      défaut hermes
  HERMES_ZC_TOKEN_FILE  défaut ~/.config/zeroclaw-serveur/token
  HERMES_AGENT_TIMEOUT défaut 300 (secondes d'attente du chat)
"""

import json
import os
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1:42617"
DEFAULT_AGENT = "hermes"
DEFAULT_TIMEOUT_S = 300
TOKEN_FILES = (
    "~/.zeroclaw/data/gateway-admin.token",
    "~/.config/zeroclaw-serveur/token",
    "/opt/zeroclaw/ephem/data/gateway-admin.token",
)


def env(name, default):
    """Variable d'environnement ou défaut (une variable vide compte comme absente)."""
    return os.environ.get(name) or default


def zc_token():
    """Jeton du client A2A, lu dans les fichiers connus. Vide si introuvable."""
    explicit = env("HERMES_ZC_TOKEN_FILE", "")
    candidates = [explicit] if explicit else list(TOKEN_FILES)
    for path in candidates:
        try:
            with open(os.path.expanduser(path), encoding="utf-8") as handle:
                token = handle.read().strip()
            if token:
                return token
        except OSError:
            continue
    return ""


def send_chat(url, agent, token, prompt, timeout_s):
    """Message JSON-RPC `SendMessage` vers l'agent A2A.

    Rend (texte, None) quand l'agent répond, (None, raison) sinon. Jamais
    d'exception : un agent injoignable doit se lire comme un échec propre.
    """
    body = {
        "jsonrpc": "2.0",
        "id": "deja-vu-conflit",
        "method": "SendMessage",
        "params": {
            "message": {
                "role": "ROLE_USER",
                "messageId": "deja-vu-conflit",
                "parts": [{"kind": "text", "text": prompt}],
            }
        },
    }
    request = urllib.request.Request(
        "%s/a2a/%s" % (url.rstrip("/"), agent),
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "A2A-Version": "1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            payload = json.loads(response.read().decode("utf-8", "replace") or "{}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, "passerelle injoignable : %r" % (exc,)
    if "error" in payload:
        return None, "erreur A2A : %s" % json.dumps(payload["error"])[:300]
    task = (payload.get("result") or {}).get("task") or {}
    texts = [
        part.get("text", "")
        for artifact in task.get("artifacts") or []
        for part in artifact.get("parts") or []
        if isinstance(part, dict)
    ]
    state = ((task.get("status") or {}).get("state")) or "?"
    if not texts:
        return None, "réponse vide (état %s)" % state
    return "\n".join(texts), None


def messages_vers_prompt(messages):
    """Une conversation chat devient un seul prompt pour l'agent A2A."""
    blocs = []
    for message in messages:
        role = message.get("role", "user")
        blocs.append("%s :\n%s" % (role.upper(), message.get("content", "")))
    return "\n\n".join(blocs)


def hermes_complete(messages, timeout_s=None):
    """Repli local : interroge l'agent `hermes` du daemon.

    Rend le texte de l'agent, ou None quand le repli est indisponible (pas de
    jeton, daemon éteint, agent muet). L'appelant garde alors son erreur.
    """
    token = zc_token()
    if not token:
        return None
    url = env("HERMES_ZC_URL", DEFAULT_URL)
    agent = env("HERMES_ZC_AGENT", DEFAULT_AGENT)
    timeout = (
        int(env("HERMES_AGENT_TIMEOUT", str(DEFAULT_TIMEOUT_S)))
        if timeout_s is None
        else timeout_s
    )
    texte, raison = send_chat(url, agent, token, messages_vers_prompt(messages), timeout)
    if texte is None:
        print("hermes-agent : repli indisponible (%s)" % raison, flush=True)
        return None
    return texte
