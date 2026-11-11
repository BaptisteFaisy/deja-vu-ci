#!/usr/bin/env python3
"""Triage d'un test rouge — donne un verdict à l'agent de réparation.

Appelé par `.github/workflows/triage-rouge.yml` (lu sur `main`, jamais sur la
PR : un juge ne s'écrit pas dans le prétoire) :

    python3 tools/triage_test.py --log /tmp/run.log --diff /tmp/diff.txt \
        --racine "$GITHUB_WORKSPACE" --verifier --json /tmp/verdict.json

Trois questions, dans cet ordre :

1. **Quel test est tombé ?**  Les lignes `FAIL`/`×` du journal vitest donnent le
   fichier et le nom du test.
2. **Est-ce dans le périmètre de la PR ?**  Si le fichier de test (ou le module
   qu'il importe) figure dans le diff, le verdict est `perimetre` : la PR a
   probablement cassé son propre test. Sinon `hors-perimetre`.
3. **Le test passe-t-il seul ?**  Avec `--verifier`, le fichier est rejoué
   isolément. S'il passe seul mais tombe dans la suite complète, c'est une
   dépendance d'ordre entre tests : verdict `pollution`.

Sortie : un rapport lisible sur stdout (40 premières lignes reprises dans le
commentaire de PR) et le verdict JSON dans `--json`. Le code de sortie vaut 0
quand un verdict a pu être rendu, 3 quand rien n'est exploitable (le workflow
n'appelle alors pas l'agent). Bibliothèque standard uniquement.
"""

import argparse
import json
import os
import re
import subprocess
import sys

# Lignes de vitest : « FAIL  path/to/file.test.ts > suite > test » et « × test ».
FAIL_FILE = re.compile(r"FAIL\s+(\S+\.(?:test|spec)\.[tj]sx?)")
FAIL_TEST = re.compile(r"FAIL\s+\S+\s*>\s*(.+?)\s*$")
CROSS_TEST = re.compile(r"[×✗]\s+(.+?)\s*(\d+\s*m?s)?$")
SUITE_FILE = re.compile(r"❯\s+(\S+\.(?:test|spec)\.[tj]sx?)")


def lire(path):
    """Contenu d'un fichier, vide s'il est absent (jamais d'exception)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def fichiers_en_echec(log):
    """Fichiers de test tombés, dans l'ordre d'apparition, sans doublon."""
    found = []
    for pattern in (FAIL_FILE, SUITE_FILE):
        for match in pattern.finditer(log):
            path = match.group(1)
            if path not in found:
                found.append(path)
    return found


def tests_en_echec(log):
    """Noms de tests tombés (ligne `FAIL … > nom` ou puce `× nom`)."""
    names = []
    for line in log.splitlines():
        match = FAIL_TEST.search(line) or CROSS_TEST.search(line.strip())
        if not match:
            continue
        name = match.group(1).strip()
        if name and name not in names:
            names.append(name)
    return names[:20]


def perimetre(diff):
    """Fichiers modifiés par la PR. """
    return {line.strip() for line in diff.splitlines() if line.strip()}


def normaliser(path):
    """Chemin relatif débarrassé de son préfixe d'atelier."""
    clean = path.replace("\\", "/")
    for prefix in ("./", "/home/runner/work/"):
        if clean.startswith(prefix):
            clean = clean[len(prefix):]
    return clean


def nom_sans_extension(path):
    """Nom de fichier sans suffixe de test ni extension (`sign.test.ts` → `sign`)."""
    name = os.path.basename(path)
    name = re.sub(r"\.(test|spec)\.[tj]sx?$", "", name)
    name = re.sub(r"\.[A-Za-z0-9]+$", "", name)
    return name


def dans_le_perimetre(fichiers, changes):
    """Vrai si un fichier de test, ou le module qu'il exerce, figure dans le diff.

    Trois indices, du plus sûr au plus large : le fichier lui-même, le nom du
    module (la convention du dépôt est `src/x.ts` ↔ `test/x.test.ts`), puis le
    dossier commun.
    """
    change_names = {nom_sans_extension(c) for c in changes}
    change_dirs = {re.sub(r"/[^/]+$", "", c) for c in changes}
    for path in fichiers:
        clean = normaliser(path)
        if clean in changes:
            return True
        name = nom_sans_extension(clean)
        if name and name in change_names:
            return True
        folder = re.sub(r"/[^/]+$", "", clean)
        if folder and any(d.startswith(folder) or folder.startswith(d) for d in change_dirs):
            return True
    return False


def rejouer_seul(racine, fichier, timeout=240):
    """Rejoue un fichier de test isolément : True s'il passe seul."""
    cible = normaliser(fichier)
    if not os.path.exists(os.path.join(racine, cible)):
        return None
    commande = ["npx", "vitest", "run", cible, "--reporter=dot"]
    try:
        run = subprocess.run(
            commande, cwd=racine, capture_output=True, text=True, timeout=timeout
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return run.returncode == 0


def construire_verdict(log, diff, racine, verifier):
    """Verdict : `pollution`, `perimetre`, `hors-perimetre` ou `inconnu`."""
    fichiers = fichiers_en_echec(log)
    tests = tests_en_echec(log)
    changes = perimetre(diff)

    if not fichiers and not tests:
        return {
            "genre": "inconnu",
            "raison": "aucun test en échec identifié dans le journal",
            "fichiers": [],
            "tests": tests,
            "rejoue_seul": None,
        }

    dedans = dans_le_perimetre(fichiers, changes) if fichiers else False
    seul = rejouer_seul(racine, fichiers[0], ) if (verifier and fichiers) else None

    if seul is True and len(fichiers) >= 1:
        genre = "pollution"
        raison = "le fichier passe quand il est rejoué seul : dépendance d'ordre entre tests"
    elif dedans:
        genre = "perimetre"
        raison = "le test (ou le module qu'il exerce) est modifié par cette PR"
    elif fichiers:
        genre = "hors-perimetre"
        raison = "le test tombé n'est pas dans le périmètre de la PR"
    else:
        genre = "inconnu"
        raison = "nom de test identifié, fichier introuvable"

    return {
        "genre": genre,
        "raison": raison,
        "fichiers": [normaliser(f) for f in fichiers],
        "tests": tests,
        "rejoue_seul": seul,
    }


def rapport(verdict):
    """Rapport lisible, repris tel quel dans le commentaire de PR."""
    lines = [
        "verdict : %s — %s" % (verdict["genre"], verdict["raison"]),
        "fichier(s) en échec : %s" % (", ".join(verdict["fichiers"]) or "aucun"),
    ]
    if verdict["tests"]:
        lines.append("test(s) : %s" % "; ".join(verdict["tests"][:6]))
    if verdict["rejoue_seul"] is not None:
        lines.append(
            "rejoué seul : %s" % ("vert" if verdict["rejoue_seul"] else "rouge")
        )
    if verdict["genre"] == "pollution":
        lines.append(
            "indice pour l'agent : ne pas modifier le test tombé — chercher l'état "
            "partagé (module global, cache, fixture) laissé par un autre test."
        )
    elif verdict["genre"] == "perimetre":
        lines.append(
            "indice pour l'agent : le correctif appartient au code de la PR, "
            "pas au test ; ne pas affaiblir l'assertion."
        )
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", required=True, help="journal du run en échec")
    parser.add_argument("--diff", default="", help="liste des fichiers de la PR")
    parser.add_argument("--racine", default=".", help="racine de l'atelier")
    parser.add_argument("--verifier", action="store_true", help="rejouer le test seul")
    parser.add_argument("--json", default="", help="fichier de verdict JSON")
    args = parser.parse_args(argv)

    log = lire(args.log)
    diff = lire(args.diff) if args.diff else ""
    if not log.strip():
        print("journal vide ou illisible : aucun verdict possible")
        return 3

    verdict = construire_verdict(log, diff, args.racine, args.verifier)
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as handle:
                json.dump(verdict, handle, ensure_ascii=False, indent=2)
        except OSError as error:
            print("verdict JSON non écrit : %s" % error)
    print(rapport(verdict))
    return 0 if verdict["genre"] != "inconnu" else 3


if __name__ == "__main__":
    sys.exit(main())
