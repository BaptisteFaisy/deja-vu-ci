#!/usr/bin/env python3
"""Injecte les identifiants d'apps réels et le runtime officiel dans les manifestes.

Les apps ont été créées le 2026-11-11 par `forge create` (Developer Space
« laddition ») : ce script remplace les espaces réservés des deux manifestes par
leurs identifiants, et aligne le runtime sur le modèle officiel généré ce jour
(nodejs24.x, 256 Mio, arm64).
"""
import pathlib
import sys

APPS = {
    "apps/brain/manifest.yml": "ari:cloud:ecosystem::app/2abacda7-8c4f-4b29-9c97-7209dd240894",
    "apps/sensor/manifest.yml": "ari:cloud:ecosystem::app/f4c98609-1c94-4e98-9e26-89cec008d6d7",
}

RUNTIME_ACTUEL = """  runtime:
    name: nodejs20.x"""
RUNTIME_CIBLE = """  runtime:
    name: nodejs24.x
    memoryMB: 256
    architecture: arm64"""

PLACEHOLDER = "ari:cloud:ecosystem::app/REPLACE-WITH-THE-REAL-APP-ID"


def injecter(racine: pathlib.Path) -> int:
    """Écrit les identifiants et le runtime ; rend le nombre de fichiers modifiés."""
    touches = 0
    for relatif, app_id in APPS.items():
        fichier = racine / relatif
        if not fichier.exists():
            print(f"absent : {relatif}", file=sys.stderr)
            continue
        texte = fichier.read_text(encoding="utf-8")
        avant = texte
        if PLACEHOLDER in texte:
            texte = texte.replace(PLACEHOLDER, app_id)
        elif app_id not in texte:
            print(f"{relatif} : ni espace réservé ni identifiant connu — laissé tel quel")
        if RUNTIME_ACTUEL in texte:
            texte = texte.replace(RUNTIME_ACTUEL, RUNTIME_CIBLE)
        if texte != avant:
            fichier.write_text(texte, encoding="utf-8")
            touches += 1
            print(f"{relatif} : identifiant posé, runtime nodejs24.x")
        else:
            print(f"{relatif} : déjà à jour")
    return touches


if __name__ == "__main__":
    racine = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    injecter(racine)
