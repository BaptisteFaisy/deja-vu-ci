#!/usr/bin/env python3
"""Tests du client A2A de repli (`.github/hermes/a2a.py`).

Aucun réseau : la passerelle est simulée par un serveur HTTP local, et les
chemins de jeton par des fichiers temporaires. Le repli doit être **silencieux
et sûr** : sans jeton, sans daemon, ou sur réponse illisible, il rend `None`
et l'appelant garde son erreur d'origine — jamais d'exception qui remonte.

Lancement : `python3 .github/hermes/test_a2a.py` (bibliothèque standard).
"""

import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("a2a", os.path.join(HERE, "a2a.py"))
a2a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a2a)


class Reponse(object):
    """Ce que le faux serveur renvoie, configurable par test."""

    status = 200
    payload = {
        "result": {
            "task": {
                "status": {"state": "completed"},
                "artifacts": [{"parts": [{"kind": "text", "text": "fichier résolu"}]}],
            }
        }
    }
    last_body = None
    last_headers = None


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - nom imposé par BaseHTTPRequestHandler
        length = int(self.headers.get("Content-Length", "0"))
        Reponse.last_body = self.rfile.read(length).decode("utf-8")
        Reponse.last_headers = dict(self.headers)
        body = json.dumps(Reponse.payload).encode("utf-8")
        self.send_response(Reponse.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def serveur():
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, "http://127.0.0.1:%d" % httpd.server_port


class TestJeton(unittest.TestCase):
    def test_jeton_lu_depuis_fichier_explicite(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "token")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("jeton-test\n")
            os.environ["HERMES_ZC_TOKEN_FILE"] = path
            try:
                self.assertEqual(a2a.zc_token(), "jeton-test")
            finally:
                del os.environ["HERMES_ZC_TOKEN_FILE"]

    def test_jeton_absent_rend_vide(self):
        os.environ["HERMES_ZC_TOKEN_FILE"] = "/non/existent/token"
        try:
            self.assertEqual(a2a.zc_token(), "")
        finally:
            del os.environ["HERMES_ZC_TOKEN_FILE"]

    def test_env_vide_comme_absente(self):
        os.environ["HERMES_ZC_URL"] = ""
        try:
            self.assertEqual(a2a.env("HERMES_ZC_URL", a2a.DEFAULT_URL), a2a.DEFAULT_URL)
        finally:
            del os.environ["HERMES_ZC_URL"]


class TestPrompt(unittest.TestCase):
    def test_conversation_aplatie(self):
        messages = [
            {"role": "system", "content": "tu résous un conflit"},
            {"role": "user", "content": "voici le fichier"},
        ]
        prompt = a2a.messages_vers_prompt(messages)
        self.assertIn("SYSTEM :\ntu résous un conflit", prompt)
        self.assertIn("USER :\nvoici le fichier", prompt)


class TestChat(unittest.TestCase):
    def setUp(self):
        Reponse.status = 200
        Reponse.payload = {
            "result": {
                "task": {
                    "status": {"state": "completed"},
                    "artifacts": [{"parts": [{"kind": "text", "text": "fichier résolu"}]}],
                }
            }
        }
        self.httpd, self.url = serveur()

    def tearDown(self):
        self.httpd.shutdown()

    def test_reponse_normale(self):
        texte, raison = a2a.send_chat(self.url, "hermes", "jeton", "résous", 10)
        self.assertEqual(texte, "fichier résolu")
        self.assertIsNone(raison)
        self.assertEqual(Reponse.last_headers.get("A2A-Version"), "1.0")
        self.assertEqual(Reponse.last_headers.get("Authorization"), "Bearer jeton")
        corps = json.loads(Reponse.last_body)
        self.assertEqual(corps["method"], "SendMessage")
        self.assertEqual(corps["params"]["message"]["parts"][0]["text"], "résous")

    def test_erreur_a2a(self):
        Reponse.payload = {"error": {"code": -32000, "message": "agent inconnu"}}
        texte, raison = a2a.send_chat(self.url, "hermes", "jeton", "résous", 10)
        self.assertIsNone(texte)
        self.assertIn("erreur A2A", raison)

    def test_reponse_vide(self):
        Reponse.payload = {"result": {"task": {"status": {"state": "failed"}, "artifacts": []}}}
        texte, raison = a2a.send_chat(self.url, "hermes", "jeton", "résous", 10)
        self.assertIsNone(texte)
        self.assertIn("réponse vide", raison)

    def test_http_401_ne_leve_pas(self):
        Reponse.status = 401
        texte, raison = a2a.send_chat(self.url, "hermes", "mauvais", "résous", 10)
        self.assertIsNone(texte)
        self.assertIn("injoignable", raison)

    def test_passerelle_absente(self):
        texte, raison = a2a.send_chat("http://127.0.0.1:1", "hermes", "jeton", "résous", 2)
        self.assertIsNone(texte)
        self.assertIn("injoignable", raison)


class TestRepli(unittest.TestCase):
    def test_sans_jeton_rend_none(self):
        os.environ["HERMES_ZC_TOKEN_FILE"] = "/non/existent/token"
        try:
            self.assertIsNone(a2a.hermes_complete([{"role": "user", "content": "x"}]))
        finally:
            del os.environ["HERMES_ZC_TOKEN_FILE"]

    def test_avec_jeton_et_passerelle_morte_rend_none(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "token")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("jeton")
            os.environ["HERMES_ZC_TOKEN_FILE"] = path
            os.environ["HERMES_ZC_URL"] = "http://127.0.0.1:1"
            os.environ["HERMES_AGENT_TIMEOUT"] = "2"
            try:
                self.assertIsNone(a2a.hermes_complete([{"role": "user", "content": "x"}]))
            finally:
                for name in ("HERMES_ZC_TOKEN_FILE", "HERMES_ZC_URL", "HERMES_AGENT_TIMEOUT"):
                    os.environ.pop(name, None)


if __name__ == "__main__":
    unittest.main(verbosity=2, exit=True)
