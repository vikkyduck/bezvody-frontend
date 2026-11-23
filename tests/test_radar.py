"""Тесты еженедельного AI-радара: сборщик radar/render.py и шлюз deploy/radar_gateway.py.

    python3 -m unittest discover -s tests -p 'test_*.py'
"""

from __future__ import annotations

import copy
import importlib.util
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


render = load("radar_render", ROOT / "radar" / "render.py")
gateway = load("radar_gateway", ROOT / "deploy" / "radar_gateway.py")
EXAMPLE = json.loads((ROOT / "radar" / "example-issue.json").read_text(encoding="utf-8"))
URL = "https://nowater.tech/AI-radar/Avito/Goods/17.11-23.11.26"


class RenderTest(unittest.TestCase):
    def test_example_gives_period_url_and_letter(self):
        issue = render.check(EXAMPLE)
        self.assertEqual(issue["slug"], "17.11-23.11.26")
        self.assertEqual(issue["url"], URL)
        letter = render.mail(issue)
        self.assertIn(URL, letter["html"])
        self.assertIn(URL, letter["text"])
        self.assertTrue(letter["text"].rstrip().endswith("Виктория Уткина"))

    def test_page_is_escaped_and_hidden_from_search(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["main_signal"]["what"] = "Продавец пишет <script>alert(1)</script> в описании"
        page = render.page(render.check(issue))
        self.assertNotIn("<script>alert(1)", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertIn('content="noindex, nofollow"', page)

    @unittest.skipUnless(shutil.which("node") or shutil.which("bun"), "нужен node или bun")
    def test_page_gets_nowater_branding(self):
        issue = render.check(EXAMPLE)
        branded = render.brand(render.page(issue), issue["url"])
        self.assertIn("NOWATER:BRAND:BEGIN", branded)
        self.assertIn(f'content="{URL}"', branded)

    def test_typography_rules_are_listed_together(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["subject"] = "Еще один «сдвиг» — недели."
        issue["summary"] = "Ёлка; сервис помогает продавцам"
        with self.assertRaises(render.IssueError) as caught:
            render.check(issue)
        text = str(caught.exception)
        for expected in ("кавычки", "тире", "заголовок с точкой", "двумя точками", "точка с запятой", "помогает"):
            self.assertIn(expected, text)

    def test_sources_need_https_link_and_date(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["main_signal"]["sources"] = [{"title": "Без ссылки", "url": "javascript:alert(1)", "date": "18.11.2026"}]
        with self.assertRaises(render.IssueError) as caught:
            render.check(issue)
        self.assertIn("https://", str(caught.exception))
        self.assertIn("ГГГГ-ММ-ДД", str(caught.exception))

    def test_week_is_seven_days(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["period"]["end"] = "2026-11-24"
        with self.assertRaises(render.IssueError):
            render.check(issue)


class FakeMail:
    def __init__(self, fail: Exception | None = None):
        self.sent: list[tuple[list[str], str]] = []
        self.fail = fail

    def __call__(self, settings, message, to):
        if self.fail:
            raise self.fail
        self.sent.append((to, message["To"]))


class GatewayTest(unittest.TestCase):
    def setUp(self):
        base = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, base)
        self.paths = gateway.Paths(config=base / "etc", state=base / "state", pages=base / "pages")
        for folder in (self.paths.config, self.paths.state, self.paths.pages):
            folder.mkdir()
        (self.paths.config / "mail.json").write_text(json.dumps(
            {"host": "smtp.example.com", "port": 465, "user": "vu@example.com", "password": "x",
             "from": "vu@example.com", "name": "Виктория Уткина"}), encoding="utf-8")
        (self.paths.config / "recipients.txt").write_text("a@example.com\n# комментарий\nb@example.com\n", encoding="utf-8")
        issue = render.check(EXAMPLE)
        self.page = render.page(issue).replace("</head>", "<!-- NOWATER:BRAND:BEGIN --></head>").encode()
        self.letter = json.dumps(render.mail(issue), ensure_ascii=False).encode()

    def run_gateway(self, command: str, data: bytes = b"", mail: FakeMail | None = None) -> str:
        return gateway.run(command, io.BytesIO(data), self.paths, mail or FakeMail())

    def test_full_cycle_publish_test_send_once(self):
        mail = FakeMail()
        self.assertIn(URL, self.run_gateway("publish 17.11-23.11.26", self.page))
        self.assertIn("vu@example.com", self.run_gateway("test 17.11-23.11.26", self.letter, mail))
        self.assertEqual(mail.sent[-1][0], ["vu@example.com"])
        self.assertIn("адресатам: 2", self.run_gateway("send 17.11-23.11.26", self.letter, mail))
        self.assertEqual(mail.sent[-1], (["a@example.com", "b@example.com", "vu@example.com"], "a@example.com, b@example.com"))
        with self.assertRaisesRegex(gateway.GatewayError, "уже отправлено"):
            self.run_gateway("send 17.11-23.11.26", self.letter, mail)
        with self.assertRaisesRegex(gateway.GatewayError, "после отправки"):
            self.run_gateway("publish 17.11-23.11.26", self.page)
        self.assertIn("письмо адресатам: ", self.run_gateway("status 17.11-23.11.26"))

    def test_send_needs_the_same_letter_as_control_copy(self):
        self.run_gateway("publish 17.11-23.11.26", self.page)
        with self.assertRaisesRegex(gateway.GatewayError, "контрольной копией"):
            self.run_gateway("send 17.11-23.11.26", self.letter)
        self.run_gateway("test 17.11-23.11.26", self.letter)
        changed = json.loads(self.letter)
        changed["subject"] = "Другая тема"
        with self.assertRaisesRegex(gateway.GatewayError, "контрольной копией"):
            self.run_gateway("send 17.11-23.11.26", json.dumps(changed).encode())

    def test_letter_must_link_to_its_page(self):
        self.run_gateway("publish 24.11-30.11.26", self.page)
        with self.assertRaisesRegex(gateway.GatewayError, "не для периода"):
            self.run_gateway("test 24.11-30.11.26", self.letter)

    def test_refused_mail_can_be_retried_unclear_result_cannot(self):
        self.run_gateway("publish 17.11-23.11.26", self.page)
        self.run_gateway("test 17.11-23.11.26", self.letter)
        with self.assertRaisesRegex(gateway.GatewayError, "пароль"):
            self.run_gateway("send 17.11-23.11.26", self.letter, FakeMail(gateway.NotSent("неверный пароль")))
        with self.assertRaises(gateway.GatewayError):
            self.run_gateway("send 17.11-23.11.26", self.letter, FakeMail(gateway.GatewayError("разговор оборвался")))
        with self.assertRaisesRegex(gateway.GatewayError, "прервалась"):
            self.run_gateway("send 17.11-23.11.26", self.letter)

    def test_bad_commands_and_pages_are_refused(self):
        for command in ("", "rm -rf /", "publish ../../etc", "publish 17.11-23.11.26 extra", "shell 17.11-23.11.26"):
            with self.assertRaises(gateway.GatewayError):
                self.run_gateway(command, self.page)
        with self.assertRaisesRegex(gateway.GatewayError, "оформления"):
            self.run_gateway("publish 17.11-23.11.26", b"<!doctype html><p>no brand</p>")
        self.assertFalse(self.paths.page("17.11-23.11.26").exists())

    def test_recipients_must_be_addresses(self):
        (self.paths.config / "recipients.txt").write_text("not-an-address\n", encoding="utf-8")
        self.run_gateway("publish 17.11-23.11.26", self.page)
        with self.assertRaisesRegex(gateway.GatewayError, "адрес почты"):
            self.run_gateway("test 17.11-23.11.26", self.letter)


if __name__ == "__main__":
    unittest.main()
