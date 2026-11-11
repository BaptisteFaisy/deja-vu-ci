#!/usr/bin/env python3
"""Tests du triage de test rouge (`tools/triage_test.py`).

Le triage est un juge : s'il se trompe, l'agent de réparation part dans la
mauvaise direction. Ces tests couvrent les trois verdicts et les codes de
sortie, sans jamais lancer vitest (le rejeu isolé est testé sur un fichier
absent, qui rend `None`).

Lancement : `python3 tools/test_triage.py` (bibliothèque standard uniquement).
"""

import importlib.util
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("triage_test", os.path.join(HERE, "triage_test.py"))
triage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(triage)

VITEST_LOG = """
 FAIL  packages/core/test/sign.test.ts > signature > groups two failures
AssertionError: expected 'a' to be 'b'
 ❯ packages/core/test/sign.test.ts:42:20
   × signature > groups two failures 3ms
 Test Files  1 failed | 29 passed (30)
"""

APP_LOG = """
 ❯ apps/brain/test/actions.test.ts (25 tests | 1 failed)
   × explain-build-failure > rend le diagnostic de la carte 12ms
"""


class TestExtraction(unittest.TestCase):
    def test_fichiers_en_echec(self):
        found = triage.fichiers_en_echec(VITEST_LOG)
        self.assertIn("packages/core/test/sign.test.ts", found)

    def test_fichiers_depuis_puce_seule(self):
        found = triage.fichiers_en_echec(APP_LOG)
        self.assertIn("apps/brain/test/actions.test.ts", found)

    def test_tests_en_echec(self):
        names = triage.tests_en_echec(VITEST_LOG)
        self.assertTrue(any("groups two failures" in n for n in names))

    def test_journal_sans_test(self):
        self.assertEqual(triage.fichiers_en_echec("npm notice run"), [])
        self.assertEqual(triage.tests_en_echec("npm notice run"), [])


class TestPerimetre(unittest.TestCase):
    def test_fichier_lui_meme(self):
        changes = {"packages/core/test/sign.test.ts"}
        self.assertTrue(triage.dans_le_perimetre(["packages/core/test/sign.test.ts"], changes))

    def test_module_exerce(self):
        changes = {"packages/core/src/sign.ts"}
        self.assertTrue(triage.dans_le_perimetre(["packages/core/test/sign.test.ts"], changes))

    def test_sans_rapport(self):
        changes = {"README.md", "docs/ARCHITECTURE.md"}
        self.assertFalse(triage.dans_le_perimetre(["packages/core/test/sign.test.ts"], changes))

    def test_normalisation(self):
        self.assertEqual(triage.normaliser("./packages/core/src/x.ts"), "packages/core/src/x.ts")
        self.assertEqual(triage.nom_sans_extension("a/b/x.test.ts"), "x")
        self.assertEqual(triage.nom_sans_extension("a/b/x.ts"), "x")


class TestVerdicts(unittest.TestCase):
    def verdict(self, log, diff, verifier=False):
        with tempfile.TemporaryDirectory() as root:
            log_path = os.path.join(root, "run.log")
            diff_path = os.path.join(root, "diff.txt")
            with open(log_path, "w", encoding="utf-8") as handle:
                handle.write(log)
            with open(diff_path, "w", encoding="utf-8") as handle:
                handle.write(diff)
            return triage.construire_verdict(
                triage.lire(log_path), triage.lire(diff_path), root, verifier
            )

    def test_perimetre(self):
        verdict = self.verdict(VITEST_LOG, "packages/core/src/sign.ts\n")
        self.assertEqual(verdict["genre"], "perimetre")

    def test_hors_perimetre(self):
        verdict = self.verdict(VITEST_LOG, "README.md\n")
        self.assertEqual(verdict["genre"], "hors-perimetre")

    def test_inconnu(self):
        verdict = self.verdict("npm notice run\n", "README.md\n")
        self.assertEqual(verdict["genre"], "inconnu")

    def test_rejoue_seul_fichier_absent(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIsNone(triage.rejouer_seul(root, "nope/x.test.ts"))

    def test_rapport_contient_le_verdict(self):
        verdict = self.verdict(VITEST_LOG, "README.md\n")
        text = triage.rapport(verdict)
        self.assertIn("hors-perimetre", text)
        self.assertIn("sign.test.ts", text)


class TestMain(unittest.TestCase):
    def run_main(self, log_content, diff_content="", verifier=False):
        with tempfile.TemporaryDirectory() as root:
            log_path = os.path.join(root, "run.log")
            diff_path = os.path.join(root, "diff.txt")
            verdict_path = os.path.join(root, "verdict.json")
            with open(log_path, "w", encoding="utf-8") as handle:
                handle.write(log_content)
            with open(diff_path, "w", encoding="utf-8") as handle:
                handle.write(diff_content)
            argv = [
                "--log", log_path,
                "--diff", diff_path,
                "--racine", root,
                "--json", verdict_path,
            ]
            if verifier:
                argv.append("--verifier")
            code = triage.main(argv)
            written = os.path.exists(verdict_path)
            return code, written

    def test_journal_vide_sort_3(self):
        code, written = self.run_main("")
        self.assertEqual(code, 3)
        self.assertFalse(written)

    def test_verdict_rendu_sort_0(self):
        code, written = self.run_main(VITEST_LOG, "packages/core/src/sign.ts\n")
        self.assertEqual(code, 0)
        self.assertTrue(written)


if __name__ == "__main__":
    unittest.main(verbosity=2, exit=True)
    sys.exit(0)
