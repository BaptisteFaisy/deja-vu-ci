#!/usr/bin/env python3
"""Fournisseur de modèle du résolveur de conflits et repli local hermes.

Deux responsabilités, aucune logique de rebase :

1. **choisir le fournisseur** (`provider_settings`) : InferHub par défaut
   (`combo/cheap`, API compatible OpenAI), noms d'environnement génériques
   `MODEL_*` prioritaires sur les noms historiques `FIREWORKS_*`.
2. **charger le repli** (`charger_a2a`) : le client A2A du daemon ZeroClaw
   (`.github/hermes/a2a.py`), lu dans l'arbre ou sur `origin/main` quand le
   balayeur extrait l'agent seul dans un fichier temporaire.

Chargé par `_charger("fournisseur")` depuis `conflict_agent.py`.
"""

import importlib.machinery
import importlib.util
import os
import subprocess
import tempfile

MODEL_DEFAULT = "combo/cheap"
API_DEFAULT = "https://api.inferhub.dev/v1/chat/completions"


def env_or(name, default):
    """Variable d'environnement ou défaut (une variable vide compte absente)."""
    return os.environ.get(name) or default


def _charger_module(chemin, source=None):
    """Charge un module Python depuis un chemin (ou un texte source)."""
    try:
        if source is None:
            spec = importlib.util.spec_from_file_location("a2a", chemin)
        else:
            spec = importlib.util.spec_from_loader(
                "a2a", importlib.machinery.SourceFileLoader("a2a", chemin)
            )
            with open(chemin, "w", encoding="utf-8") as fh:
                fh.write(source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except Exception:  # noqa: BLE001 - un repli cassé ne doit rien casser
        return None


def _a2a_depuis_main():
    """Le module de repli lu sur `origin/main`, comme les modules voisins.

    Le balayeur extrait ce script seul dans un fichier temporaire : le voisin
    `hermes/a2a.py` n'est donc pas à côté. On le relit sur la branche protégée
    (jamais sur la branche de la PR — un juge ne s'écrit pas dans le prétoire).
    """
    try:
        proc = subprocess.run(
            ["git", "show", "origin/main:.github/hermes/a2a.py"],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    cible = os.path.join(tempfile.gettempdir(), "deja-vu-a2a-%d.py" % os.getpid())
    return _charger_module(cible, proc.stdout)


def _charger_a2a():
    """Charge `.github/hermes/a2a.py` (repli local) sans dépendre du sys.path.

    Deux chemins : le voisin dans l'arbre (exécution normale), sinon la copie
    lue sur `origin/main` (le balayeur extrait ce script seul). Sans aucun des
    deux, le repli est simplement indisponible.
    """
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "hermes", "a2a.py")
    if os.path.exists(chemin):
        module = _charger_module(chemin)
        if module is not None:
            return module
    return _a2a_depuis_main()


a2a = _charger_a2a()


def _charger(nom):
    """Module voisin : import direct, sinon `origin/main` (branche antérieure)."""
    try:
        return __import__(nom)
    except ImportError:
        pass
    try:
        proc = subprocess.run(["git", "show", "origin/main:.github/fireworks/"
                               "%s.py" % nom], capture_output=True, text=True,
                              timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    module = types.ModuleType(nom)
    exec(compile(proc.stdout, "%s.py" % nom, "exec"), module.__dict__)
    return module


def provider_settings():
    """Clé, modèle et URL du fournisseur de résolution.

    Priorité : noms génériques (`MODEL_*`), puis noms historiques
    (`FIREWORKS_*`), puis les défauts du module. Une variable vide compte comme
    absente (GitHub injecte `""` et non `unset`).
    """
    key = env_or("MODEL_API_KEY", "") or env_or("FIREWORKS_API_KEY", "")
    model = env_or("MODEL_NAME", "") or env_or("FIREWORKS_MODEL", "") or MODEL_DEFAULT
    api_url = env_or("MODEL_API_URL", "") or env_or("FIREWORKS_BASE_URL", "") or API_DEFAULT
    return key, model, api_url


a2a = _charger_a2a()
