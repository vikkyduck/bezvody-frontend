"""Тесты еженедельного AI-радара: сборщик radar/render.py и шлюз deploy/radar_gateway.py.

    python3 -m unittest discover -s tests -p 'test_*.py'
"""

from __future__ import annotations

import copy
import html
import importlib.util
import io
import json
import re
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


def visible(markup: str) -> str:
    """Текст, который видит читатель: без тегов, с раскрытыми сущностями, пробелы схлопнуты."""
    inline = re.sub(r"</?(?:a|strong|span)\b[^>]*>", "", markup)  # ссылка и выделение не рвут фразу
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", inline)))


def fields(issue: dict) -> list[str]:
    """Все тексты выпуска по абзацам, как их видит читатель."""
    main = issue["main_signal"]
    texts = [issue["subject"], issue["summary"], issue.get("limits", ""), main["title"]]
    texts += [main[key] for key in ("what", "why", "product", "question")]
    for signal in issue["signals"]:
        texts += [signal[key] for key in ("title", "text", "contour", "feature") if signal.get(key)]
    for row in issue["table"]:
        texts += list(row.values())
    for item in issue["noise"]:
        texts += [item] if isinstance(item, str) else list(item.values())
    return [part.strip() for text in texts for part in render._visible(text).split("\n") if part.strip()]


class RenderTest(unittest.TestCase):
    def test_example_gives_period_url_and_letter(self):
        issue = render.check(EXAMPLE)
        self.assertEqual(issue["slug"], "17.11-23.11.26")
        self.assertEqual(issue["url"], URL)
        letter = render.mail(issue)
        self.assertIn(URL, letter["html"])
        self.assertIn(URL, letter["text"])
        self.assertTrue(letter["text"].rstrip().endswith("Виктория Уткина"))

    def test_page_carries_the_issue_word_for_word(self):
        # Страница - полный выпуск: каждый абзац каждого поля стоит на ней целиком, со ссылками.
        page = visible(render.page(render.check(EXAMPLE)))
        for part in fields(EXAMPLE):
            self.assertIn(re.sub(r"\s+", " ", part), page)
        for address in ("https://example.com/source", "https://example.com/second", "https://example.com/third", "https://example.com/noise"):
            self.assertIn(f'href="{address}"', render.page(render.check(EXAMPLE)))

    def test_letter_takes_its_words_from_the_issue(self):
        # Письмо короче выпуска, но своих слов в текст не добавляет: каждая его фраза стоит в выпуске.
        issue = render.check(EXAMPLE)
        corpus = " ".join(re.sub(r"\s+", " ", render._visible(render.SOURCE_BRACKETS.sub("", part))) for part in fields(EXAMPLE))
        content = render._letter(issue)
        pieces = [content["essence"], content["figure"]["caption"], *content["main"].values()]
        for signal in content["signals"]:
            pieces += [signal["title"], signal["text"], signal["feature"], signal["question"]]
        for piece in filter(None, pieces):
            self.assertIn(piece, corpus + " " + EXAMPLE["main_signal"]["badge"] + " " + EXAMPLE["figure"]["caption"])
        shown = visible(render.mail(issue)["html"])
        for piece in filter(None, pieces):
            self.assertIn(piece if piece != content["main"]["badge"] else piece.upper(), shown)

    def test_letter_is_first_level_of_the_pyramid(self):
        issue = render.check(EXAMPLE)
        markup = render.mail(issue)["html"]
        shown = visible(markup)
        # Суть сверху, под ней три цифры со временем чтения, диаграмма, цифра недели.
        for expected in ("NOWATER.TECH", render.BG, render.ACCENT, 'lang="ru"', "Весь выпуск на сайте"):
            self.assertIn(expected, markup)
        self.assertRegex(shown, r"СУТЬ Пример сути недели одной фразой: что меняется в поведении платящих селлеров\. 3 СИГНАЛА НЕДЕЛИ 3 ИДЕИ ФИЧ 1 МИНУТА ЧТЕНИЯ")
        self.assertIn("СИГНАЛЫ НЕДЕЛИ ПО КОНТУРАМ АВИТО Операции и автоматизация Сигнал 01 Доверие и защита сделок Сигналы 02, 03", shown)
        self.assertIn("ЦИФРА НЕДЕЛИ от 4 990 рублей Пример фразы из выпуска", shown)
        self.assertIn('width="33%" bgcolor="#E4A9CE" height="8"', markup)  # один сигнал из трех
        self.assertIn('width="67%" bgcolor="#E4A9CE" height="8"', markup)  # два сигнала из трех
        # Идея фичи и вопрос у каждого сигнала - из его строки сводной таблицы.
        self.assertIn("ИДЕЯ ФИЧИ Идея фичи второго сигнала ВОЗМОЖНЫЙ ВОПРОС КЛИЕНТУ \"Второй вопрос клиенту?\"", shown)
        # Второго уровня в письме нет: вторых абзацев, источников, сводной таблицы, шума, оговорок.
        for absent in ("читается на странице", "example.com", "Профи-ресейлеры", "ШУМ", "шум", "Пример ограничений", "ВЫВОД", "<th"):
            self.assertNotIn(absent, markup)
        self.assertEqual(set(re.findall(r'href="(https?://[^"/]+)', markup)), {"https://nowater.tech"})
        # Почта: только таблицы разметки, без картинок, скриптов и современной сетки.
        tables = re.findall(r"<table\b[^>]*>", markup)
        self.assertTrue(tables)
        self.assertTrue(all('role="presentation"' in tag for tag in tables))
        for forbidden in ("<img", "<script", "display:flex", "display:grid", "var(--"):
            self.assertNotIn(forbidden, markup)
        self.assertLess(len(markup.encode("utf-8")), 80 * 1024)

    def test_long_paragraph_gives_its_first_sentence_without_sources(self):
        issue = copy.deepcopy(EXAMPLE)
        long = ("По данным одного источника, ассистент предлагает покупателю два варианта без загрузки фото "
                "([Источник, 15.11.2026](https://example.com/a), [обзор](https://example.com/b)), площадка механику не подтвердила. "
                + "Второе предложение стоит на странице и в письмо не идет, потому что абзац длинный и упаковщик его не разбил на части. " * 2)
        issue["signals"][0]["text"] = long.strip()
        shown = visible(render.mail(render.check(issue))["html"])
        self.assertIn("варианта без загрузки фото, площадка механику не подтвердила.", shown)
        self.assertNotIn("Второе предложение", shown)
        # Сокращение не рвет фразу на сокращениях вроде "тыс." и "т.е."
        issue["signals"][0]["text"] = ("Продавцы платят от 5 тыс. Рублей в месяц, т.е. Сумма заметная для малого бизнеса, и это подтверждает "
                                       "[источник](https://example.com/a). " + "Вторая фраза длинного абзаца остается на странице выпуска. " * 4).strip()
        shown = visible(render.mail(render.check(issue))["html"])
        self.assertIn("т.е. Сумма заметная для малого бизнеса, и это подтверждает источник.", shown)
        self.assertNotIn("Вторая фраза", shown)

    def test_letter_without_matching_table_still_builds(self):
        # Если строк таблицы не столько же, сколько сигналов, диаграммы нет, а фича главного сигнала берется из его текста.
        issue = copy.deepcopy(EXAMPLE)
        issue["table"] = issue["table"][:1]
        issue.pop("figure")
        shown = visible(render.mail(render.check(issue))["html"])
        self.assertNotIn("ПО КОНТУРАМ", shown)
        self.assertNotIn("ЦИФРА НЕДЕЛИ", shown)
        self.assertIn("ВОЗМОЖНЫЕ ФИЧИ ДЛЯ ПРОДУКТА Одна фича и ее контур Авито Товаров.", shown)
        self.assertIn("ИДЕЯ ФИЧИ Идея фичи одной строкой", shown)

    def test_letter_links_lead_to_existing_page_sections(self):
        issue = render.check(EXAMPLE)
        page = render.page(issue)
        anchors = set(re.findall(re.escape(URL) + r"#([a-z0-9-]+)", render.mail(issue)["html"]))
        self.assertEqual(anchors, {"main", "signals", "product", "signal-2", "signal-3"})
        for anchor in anchors | {"noise"}:
            self.assertIn(f'id="{anchor}"', page)

    def test_links_inside_text_stay_in_place_on_the_page(self):
        issue = render.check(EXAMPLE)
        link = '<a href="https://example.com/second" target="_blank" rel="noopener noreferrer"'
        self.assertIn(link + ">Пример второго источника, 20.11.2026</a>).", render.page(issue))
        # Правила текста не касаются адреса ссылки.
        changed = copy.deepcopy(EXAMPLE)
        changed["signals"][0]["text"] = "Суть ([источник](https://example.com/a;b?x=1—2))."
        render.check(changed)
        # Ссылка с ошибкой не превращается в текст молча.
        changed["signals"][0]["text"] = "Суть ([источник](https://example.com/a b))."
        with self.assertRaisesRegex(render.IssueError, "ссылка записана с ошибкой"):
            render.check(changed)

    def test_signal_needs_a_source_in_list_or_in_text(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["signals"][0]["text"] = "Суть практики без единой ссылки."
        with self.assertRaisesRegex(render.IssueError, r"signals\[1\]\.sources: нужен хотя бы один источник"):
            render.check(issue)
        issue["signals"][0]["sources"] = [{"title": "Источник списком", "url": "https://example.com/list", "date": "2026-11-19"}]
        self.assertIn("Источник списком", render.page(render.check(issue)))

    def test_contour_and_feature_are_not_repeated_on_the_page(self):
        # У первого сигнала контур и идея стоят в самом абзаце, у второго - отдельными полями.
        self.assertEqual(render.page(render.check(EXAMPLE)).count("<strong>Контур Авито:</strong>"), 1)

    def test_edition_labels_and_badges_come_from_the_issue(self):
        issue = copy.deepcopy(EXAMPLE)
        issue.update(name="Слабые сигналы селлеров", number=6, labels={"product": "Что предложить Продукту"})
        clean = render.check(issue)
        letter, page = render.mail(clean), render.page(clean)
        for where in (visible(letter["html"]), letter["text"]):
            self.assertIn("Слабые сигналы селлеров. Выпуск 6", where)
            self.assertIn("Еще 2 сигнала недели".upper() if where != letter["text"] else "Еще 2 сигнала недели", where)
        self.assertIn("ЧТО ПРЕДЛОЖИТЬ ПРОДУКТУ", visible(letter["html"]))
        self.assertIn("<h3>Что предложить Продукту</h3>", page)
        self.assertNotIn(render.LABELS["product"], page)
        self.assertIn(EXAMPLE["main_signal"]["badge"].upper(), visible(letter["html"]))
        self.assertIn(EXAMPLE["main_signal"]["badge"].upper(), visible(page))
        issue["labels"] = {"unknown": "Подпись"}
        with self.assertRaisesRegex(render.IssueError, "labels.unknown"):
            render.check(issue)
        issue["labels"], issue["number"] = {}, "шесть"
        with self.assertRaisesRegex(render.IssueError, "number"):
            render.check(issue)

    def test_own_words_of_the_letter_are_polite(self):
        # Свои слова сборщика - только названия разделов и ссылок. Без команд читателю.
        markup = visible(render.mail(render.check(EXAMPLE))["html"])
        for phrase in ("Главный сигнал на сайте", "Подробнее на сайте", "Весь выпуск на сайте",
                       "На странице выпуска - источники и сводная таблица возможных продуктовых фич."):
            self.assertIn(phrase, markup)
        for harsh in ("Открыть", "Разобрать", "Читать", "Нажмите", "Перейти"):
            self.assertNotIn(harsh, markup)

    def test_letter_is_escaped(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["main_signal"]["why"] = "Продавец пишет <script>alert(1)</script> в описании"
        markup = render.mail(render.check(issue))["html"]
        self.assertNotIn("<script", markup)
        self.assertIn("&lt;script&gt;", markup)

    def test_line_break_starts_a_paragraph_and_letter_takes_the_first(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["main_signal"]["why"] = "Первый абзац о сегменте.\nВторой абзац о гипотезе."
        clean = render.check(issue)
        self.assertIn("<p>Первый абзац о сегменте.</p><p>Второй абзац о гипотезе.</p>", render.page(clean))
        letter = render.mail(clean)
        self.assertEqual(letter["html"].count("абзац о"), 1)
        self.assertIn("Первый абзац о сегменте.", letter["text"])
        self.assertNotIn("Второй абзац", letter["text"])

    def test_preheader_is_optional(self):
        issue = copy.deepcopy(EXAMPLE)
        issue.pop("preheader", None)
        self.assertIn('aria-hidden="true">Пример сути недели одной фразой', render.mail(render.check(issue))["html"])
        issue["preheader"] = "Своя строка превью для списка писем"
        self.assertIn("Своя строка превью для списка писем", render.mail(render.check(issue))["html"])

    def test_page_is_escaped_and_hidden_from_search(self):
        issue = copy.deepcopy(EXAMPLE)
        issue["main_signal"]["why"] = "Продавец пишет <script>alert(1)</script> в описании"
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
