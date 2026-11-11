#!/usr/bin/env python3
"""Traitement de texte du résolveur de conflits — fonctions pures, aucun réseau.

Extrait de `conflict_agent.py` pour que celui-ci reste sous la barre des 500
lignes : découpage des hunks, prompt d'un conflit élémentaire, extraction du
fichier résolu, contrôle des marqueurs. Chargé par `_charger("texte")`, donc lu
sur `origin/main` quand le balayeur extrait l'agent seul dans un fichier
temporaire. Les tests passent par les alias du module principal.
"""

import re

def split_hunks(text):
    """Découpe un fichier marqué : ("clean", txt) / ("hunk", dict).

    Gère diff et diff3 (avec ou sans base). En rebase, le premier bloc
    ("head") est main (destination) et le second ("saved") la branche.
    """
    segments, buf = [], []
    lines = text.split("\n")
    n, i = len(lines), 0
    while i < n:
        if not lines[i].startswith("<<<<<<<"):
            buf.append(lines[i])
            i += 1
            continue
        if buf:
            segments.append(("clean", "\n".join(buf)))
            del buf[:]
        head, base, saved = [], None, []
        i += 1
        while (i < n and lines[i] != "======="
               and not lines[i].startswith("|||||||")):
            head.append(lines[i])
            i += 1
        if i < n and lines[i].startswith("|||||||"):
            base = []
            i += 1
            while i < n and lines[i] != "=======":
                base.append(lines[i])
                i += 1
        if i < n and lines[i] == "=======":
            i += 1
        while i < n and not lines[i].startswith(">>>>>>>"):
            saved.append(lines[i])
            i += 1
        i += 1
        segments.append(("hunk", {"head": head, "base": base, "saved": saved}))
    if buf:
        segments.append(("clean", "\n".join(buf)))
    return segments


def build_hunk_messages(path, hunk):
    """Prompt de résolution pour UN conflit élémentaire (rebase)."""
    system = ("Tu résous UN conflit de fusion git (un seul morceau de "
              "fichier). Tu rends UNIQUEMENT le texte résolu de ce morceau, "
              "sans aucun marqueur, en gardant les deux intentions (jamais "
              "un bord choisi à l'aveugle). Tu ne réponds que par le texte, "
              "dans un seul bloc de code.")
    parts = ["Fichier : %s (extrait)" % path,
             "--- Version de la branche (à garder en priorité en cas de doute) ---",
             "\n".join(hunk["saved"])]
    if hunk["base"] is not None:
        parts += ["--- Version ancêtre commun ---", "\n".join(hunk["base"])]
    parts += ["--- Version de main ---", "\n".join(hunk["head"]),
              "Rends le morceau résolu, dans un seul bloc de code."]
    return [{"role": "system", "content": system},
            {"role": "user", "content": "\n".join(parts)}]


def extract_file(text):
    """Extrait le fichier résolu : bloc de code, sinon texte brut."""
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    match = re.search(r"```[^\n]*\n(.*?)```", cleaned, flags=re.S)
    body = match.group(1) if match else cleaned
    return body.strip("\n") + "\n"


def still_marked(content):
    """Vrai s'il reste des marqueurs de conflit git."""
    for line in content.splitlines():
        if line.startswith("<<<<<<< ") or line == "<<<<<<<":
            return True
        if line.startswith(">>>>>>> ") or line == ">>>>>>>":
            return True
        if line == "=======":
            return True
    return False
