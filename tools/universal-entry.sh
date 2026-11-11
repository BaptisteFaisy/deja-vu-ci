#!/usr/bin/env bash
# tools/universal-entry.sh — Envoie un journal de build au Cerveau Déjà-vu CI (§ 15, CI-16).
#
# Commande d'une ligne à ajouter en fin de pipeline pour toute CI tierce
# (GitHub Actions, GitLab CI, Jenkins, CircleCI) :
#
#   bash tools/universal-entry.sh --file /tmp/build.log
#
# La clé propre au projet est lue dans la variable d'environnement
# `DEJAVU_PROJECT_KEY` (jamais passée en argument de ligne de commande : elle
# apparaîtrait dans les tables de processus et les journaux de build).
#
# Comportement garanti :
#   - masquage local des secrets avant tout appel réseau ;
#   - journal borné à 50 Ko (limite Forge) ;
#   - ne fait JAMAIS échouer la CI de l'appelant (exit 0 garanti, sauf --strict).

set -u

URL="${DEJAVU_BRAIN_URL:-https://dejavu.webtrigger.atlassian.app/universal}"
KEY="${DEJAVU_PROJECT_KEY:-}"
REPO="${DEJAVU_REPO:-${GITHUB_REPOSITORY:-${CI_PROJECT_PATH:-unknown-repo}}}"
BRANCH="${DEJAVU_BRANCH:-${GITHUB_REF_NAME:-${CI_COMMIT_REF_NAME:-unknown-branch}}}"
COMMIT="${DEJAVU_COMMIT:-${GITHUB_SHA:-${CI_COMMIT_SHA:-unknown-commit}}}"
AUTHOR="${DEJAVU_AUTHOR:-${GITHUB_ACTOR:-${GITLAB_USER_LOGIN:-unknown-author}}}"
STEP="${DEJAVU_STEP:-ci-step}"

FILE=""
STRICT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --key) echo "Avertissement : préférez exporter DEJAVU_PROJECT_KEY plutôt que --key" >&2; KEY="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --commit) COMMIT="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    -h|--help)
      echo "Usage : DEJAVU_PROJECT_KEY=xxx $0 --file <log-path> [--repo <owner/name>] [--branch <b_name>]"
      exit 0
      ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

if [ -z "$KEY" ]; then
  echo "[deja-vu] clé de projet DEJAVU_PROJECT_KEY absente — envoi ignoré" >&2
  if [ "$STRICT" -eq 1 ]; then exit 1; fi
  exit 0
fi

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "[deja-vu] fichier de journal introuvable : ${FILE:-<non renseigné>} — envoi ignoré" >&2
  if [ "$STRICT" -eq 1 ]; then exit 1; fi
  exit 0
fi

# 50 Ko au plus (dernières lignes si le fichier dépasse)
TAIL_BYTES=51200
RAW=$(tail -c "$TAIL_BYTES" "$FILE")

# Masquage minimaliste des secrets usuels avant la sortie de la machine
SAFE_LOG=$(printf '%s' "$RAW" \
  | sed -E 's/(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/[masque:token]/g' \
  | sed -E 's/(xox[baprs]-[A-Za-z0-9-]{10,})/[masque:token]/g' \
  | sed -E 's/(Bearer[[:space:]]+)[A-Za-z0-9_.-]{15,}/\1[masque:token]/g' \
  | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[masque:email]/g')

PAYLOAD=$(python3 -c "
import json, sys
data = {
    'projectKey': sys.argv[1],
    'repository': sys.argv[2],
    'branch': sys.argv[3],
    'commit': sys.argv[4],
    'author': sys.argv[5],
    'step': sys.argv[6],
    'log': sys.stdin.read(),
}
print(json.dumps(data))
" "$KEY" "$REPO" "$BRANCH" "$COMMIT" "$AUTHOR" "$STEP" <<< "$SAFE_LOG" 2>/dev/null || echo "")

if [ -z "$PAYLOAD" ]; then
  echo "[deja-vu] impossible de composer la charge utile — envoi ignoré" >&2
  if [ "$STRICT" -eq 1 ]; then exit 1; fi
  exit 0
fi

CODE=$(curl -s -m 15 -o /dev/null -w '%{http_code}' \
  -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" 2>/dev/null || true)
CODE="${CODE:-000}"

if [ "$CODE" = "200" ] || [ "$CODE" = "202" ]; then
  echo "[deja-vu] extrait de journal envoyé avec succès au Cerveau (HTTP $CODE)"
  exit 0
else
  echo "[deja-vu] Cerveau injoignable ou refus (HTTP $CODE) — la CI continue normalement" >&2
  if [ "$STRICT" -eq 1 ]; then exit 1; fi
  exit 0
fi
