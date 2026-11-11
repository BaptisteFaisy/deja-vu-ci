#!/usr/bin/env python3
"""Tests du choix du fournisseur de l'agent de conflit — stdlib uniquement.

Le fournisseur par défaut est InferHub (`combo/cheap`) depuis le 11/11 : la clé
Fireworks du dépôt rendait HTTP 412. Les noms d'environnement génériques
(`MODEL_API_KEY`, `MODEL_API_URL`, `MODEL_NAME`) ont la priorité sur les noms
historiques `FIREWORKS_*`, eux-mêmes prioritaires sur les défauts du code.

Lance : python3 test_provider.py (depuis .github/fireworks/).
"""
import os
import unittest
from unittest import mock

import conflict_agent


class ProviderDefaultTest(unittest.TestCase):
    """Fournisseur par défaut : InferHub, API compatible OpenAI."""

    def test_defaut_inferhub(self):
        self.assertEqual(conflict_agent.MODEL_DEFAULT, "combo/cheap")
        self.assertIn("api.inferhub.dev", conflict_agent.API_DEFAULT)
        self.assertTrue(conflict_agent.API_DEFAULT.endswith("/chat/completions"))

    def test_provider_settings_par_defaut(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for name in ("MODEL_API_KEY", "MODEL_NAME", "MODEL_API_URL",
                         "FIREWORKS_API_KEY", "FIREWORKS_MODEL", "FIREWORKS_BASE_URL"):
                os.environ.pop(name, None)
            key, model, url = conflict_agent.provider_settings()
        self.assertEqual(key, "")
        self.assertEqual(model, "combo/cheap")
        self.assertEqual(url, conflict_agent.API_DEFAULT)

class ProviderEnvTest(unittest.TestCase):
    """Priorité des variables : noms génériques, puis historiques, puis défaut."""

    def test_cle_generique_prioritaire(self):
        with mock.patch.dict(os.environ, {"MODEL_API_KEY": "generique",
                                          "FIREWORKS_API_KEY": "historique"}):
            key, _, _ = conflict_agent.provider_settings()
        self.assertEqual(key, "generique")

    def test_cle_historique_en_repli(self):
        with mock.patch.dict(os.environ, {"FIREWORKS_API_KEY": "historique"}):
            os.environ.pop("MODEL_API_KEY", None)
            key, _, _ = conflict_agent.provider_settings()
        self.assertEqual(key, "historique")

    def test_modele_generique_prioritaire(self):
        with mock.patch.dict(os.environ, {"MODEL_NAME": "combo/cheap",
                                          "FIREWORKS_MODEL": "accounts/x"}):
            _, model, _ = conflict_agent.provider_settings()
        self.assertEqual(model, "combo/cheap")

    def test_modele_historique_en_repli(self):
        with mock.patch.dict(os.environ, {"FIREWORKS_MODEL": "accounts/x"}):
            os.environ.pop("MODEL_NAME", None)
            _, model, _ = conflict_agent.provider_settings()
        self.assertEqual(model, "accounts/x")

    def test_url_generique_prioritaire(self):
        with mock.patch.dict(os.environ, {"MODEL_API_URL": "https://x/y",
                                          "FIREWORKS_BASE_URL": "https://old/z"}):
            _, _, url = conflict_agent.provider_settings()
        self.assertEqual(url, "https://x/y")

    def test_variables_vides_ignorees(self):
        # GitHub injecte une variable absente comme "" : elle ne doit pas
        # écraser le défaut (régression du 28/10, modèle "" → 400).
        with mock.patch.dict(os.environ, {"MODEL_NAME": "", "FIREWORKS_MODEL": "",
                                          "MODEL_API_URL": "", "MODEL_API_KEY": ""}):
            key, model, url = conflict_agent.provider_settings()
        self.assertEqual(key, "")
        self.assertEqual(model, "combo/cheap")
        self.assertEqual(url, conflict_agent.API_DEFAULT)



class ChargementSansFichierTest(unittest.TestCase):
    """Le module peut être chargé par `exec`, sans `__file__` (le balayeur)."""

    def test_racine_sans_fichier(self):
        # Le balayeur exécute le module sans __file__ : la racine doit alors
        # retomber sur le dépôt courant, sans lever NameError (bug du 11/11).
        import types
        module = types.ModuleType("fournisseur_sans_fichier")
        ici = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(ici, "fournisseur.py"), encoding="utf-8") as handle:
            source = handle.read()
        exec(compile(source, "fournisseur.py", "exec"), module.__dict__)
        self.assertNotIn("__file__", module.__dict__)
        racine = module._racine_module()
        self.assertTrue(racine.endswith(os.path.join(".github", "fireworks")))
        # Depuis la racine du dépôt (cas du balayeur), le chemin existe bien.
        depot = os.path.abspath(os.path.join(ici, "..", ".."))
        self.assertTrue(os.path.isdir(os.path.join(depot, ".github", "fireworks")))

    def test_racine_avec_fichier(self):
        import fournisseur
        racine = fournisseur._racine_module()
        self.assertTrue(os.path.isdir(racine))
        self.assertTrue(os.path.exists(os.path.join(racine, "..", "hermes", "a2a.py")))


if __name__ == "__main__":
    unittest.main()
