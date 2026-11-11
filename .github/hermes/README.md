# `.github/hermes/` — agent de conflit de repli (daemon ZeroClaw)

Le résolveur de conflits de la file est `.github/fireworks/conflict_agent.py` :
appelé par le balayeur (`pr-auto-merge`) quand une PR est `DIRTY`, il fait
résoudre chaque conflit élémentaire par un modèle, recopie le reste du fichier
intact, pousse sur la branche de la PR et rend compte. Son fournisseur par
défaut est **InferHub** (`combo/cheap`).

Ce dossier ajoute le **second repli** : quand l'API du fournisseur refuse (clé
expirée, quota, `HTTP 412`, modèle retiré), la même question est posée à l'agent
`hermes` du daemon ZeroClaw de la machine du runner, via A2A
(`POST /a2a/hermes`, JSON-RPC `SendMessage`). Un seul pilote de résolution,
deux chemins vers le modèle.

## Fichiers

| Fichier | Rôle |
|---|---|
| `a2a.py` | Client A2A : découverte du jeton, `send_chat`, conversion conversation → prompt, `hermes_complete` |
| `test_a2a.py` | 11 tests (stdlib) : jeton, prompt, réponse normale, erreur A2A, réponse vide, 401, passerelle absente, repli muet |

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `HERMES_ZC_URL` | `http://127.0.0.1:42617` | passerelle du daemon (local au runner) |
| `HERMES_ZC_AGENT` | `hermes` | alias d'agent saisi |
| `HERMES_ZC_TOKEN_FILE` | voir ci-dessous | jeton client A2A |
| `HERMES_AGENT_TIMEOUT` | `300` | secondes d'attente du chat |

Jetons essayés dans l'ordre, jamais écrits dans le dépôt :
`~/.zeroclaw/data/gateway-admin.token`, `~/.config/zeroclaw-serveur/token`,
`/opt/zeroclaw/ephem/data/gateway-admin.token`.

## Comportement garanti

- **Aucune exception** : sans jeton, sans daemon ou sur réponse illisible,
  `hermes_complete` rend `None` et l'appelant conserve son erreur d'origine.
- **Aucun push supplémentaire** : le repli ne change rien au périmètre
  d'écriture — la branche de la PR, point. Ni `main`, ni `.github/`, ni
  `.mergify.yml`, ni les gardes.
- **Mêmes garde-fous** : cooldown et plafonds de `quota.py` s'appliquent avant
  le choix du fournisseur ; une résolution qui ne passe pas la porte de
  compilation (`compilation_gate.py`) n'est jamais poussée.
- **Le succès se juge sur l'état réel de la PR** (`mergeable_state`), jamais sur
  le récit du modèle.

## Vérification locale

```bash
python3 .github/hermes/test_a2a.py            # 11 tests, aucun réseau
# sonde vivante (machine du runner, daemon allumé) :
python3 - <<'PY'
import sys; sys.path.insert(0, '.github/hermes')
import a2a
print(a2a.send_chat('http://127.0.0.1:42617', 'hermes', a2a.zc_token(),
                    'Réponds exactement: PONG', 60))
PY
```

Sans daemon sur la machine du runner, le repli est simplement indisponible :
le conflit est commenté et étiqueté pour intervention humaine, la CI ne devient
jamais rouge à cause de l'agent.
