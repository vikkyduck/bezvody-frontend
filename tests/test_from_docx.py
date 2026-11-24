"""Перенос документа выпуска в файл выпуска: слово в слово, без пересказа."""
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "radar"))
import from_docx  # noqa: E402
import render  # noqa: E402

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def p(text, style="", link=None):
    head = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    tail = f'<w:hyperlink r:id="rId1"><w:r><w:t>{link}</w:t></w:r></w:hyperlink><w:r><w:t>).</w:t></w:r>' if link else ""
    return f'<w:p>{head}<w:r><w:t xml:space="preserve">{text}</w:t></w:r>{tail}</w:p>'


def table(rows):
    return "<w:tbl>" + "".join("<w:tr>" + "".join(f"<w:tc>{p(c)}</w:tc>" for c in row) + "</w:tr>" for row in rows) + "</w:tbl>"


def docx(path, extra=""):
    body = "".join([
        p("Слабые сигналы селлеров. Выпуск 7", "Heading1"),
        p("Тема письма: Площадка меняет правила торга"),
        p("Главный вывод недели", "Heading2"), p("Площадки забирают торг у продавца. Вторая фраза вывода."),
        p("Главный сигнал недели: торг становится настройкой", "Heading2"),
        p("Что происходит. Площадка объявила о запуске агента ", link="Источник, 17.11.2026"),
        p("Почему это важно для выручки. Выигрывает малый бизнес."), p("Гипотеза для проверки: агент удерживает продавца."),
        p("Возможные фичи для продукта. "), p("Правила торга в ассистенте."),
        p('Возможный вопрос клиенту: "Как у вас устроены ответы о цене?"'),
        p("Еще 1 сигнал недели", "Heading2"), p("Возврат решает алгоритм. По данным площадки, спор закрывается без фото ", link="Обзор"),
        p("Сводная таблица возможных продуктовых фич", "Heading2"),
        table([["Сигнал", "Сегмент", "Контур", "Идея", "Вопрос"], ["Торг (анонс)", "Малый бизнес", "Ассистент", "Правила торга", "Как вы торгуетесь?"],
               ["Возврат (обзор)", "Ресейлеры", "Доставка", "Подсказка", "Как прошел возврат?"]]),
        p("Что отсеяли как шум", "Heading2"), p("Новость без влияния на селлеров."), extra])
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", f'<w:document {NS}><w:body>{body}</w:body></w:document>')
        z.writestr("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="hyperlink" Target="https://example.com/a" TargetMode="External"/></Relationships>')


class FromDocxTest(unittest.TestCase):
    def run_script(self, extra=""):
        tmp = Path(tempfile.mkdtemp())
        docx(tmp / "issue.docx", extra)
        code = from_docx.main([str(tmp / "issue.docx"), "--start", "2026-11-24", "--out", str(tmp / "issue.json")])
        return code, tmp / "issue.json"

    def test_text_goes_word_for_word_and_issue_builds(self):
        code, out = self.run_script()
        self.assertEqual(code, 0)
        issue = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(issue["number"], 7)
        self.assertEqual(issue["period"], {"start": "2026-11-24", "end": "2026-11-30"})
        self.assertEqual(issue["main_signal"]["title"], "Торг становится настройкой")
        self.assertEqual(issue["main_signal"]["what"], "Площадка объявила о запуске агента [Источник, 17.11.2026](https://example.com/a)).")
        self.assertEqual(issue["main_signal"]["why"], "Выигрывает малый бизнес.\nГипотеза для проверки: агент удерживает продавца.")
        self.assertEqual(issue["signals"][0]["title"], "Возврат решает алгоритм")
        self.assertEqual(issue["table"][1]["question"], "Как прошел возврат?")
        # Подписи колонок таблицы идут на страницу словами автора.
        self.assertEqual(issue["labels"]["col_segment"], "Сегмент")
        self.assertIn("<th>Сегмент</th>", render.page(render.check(issue)))

    def test_line_breaks_tabs_and_brackets_in_links_survive(self):
        tmp = Path(tempfile.mkdtemp())
        extra = ('<w:p><w:r><w:t>Вторая</w:t><w:tab/><w:t>новость</w:t><w:br/><w:t>без влияния (</w:t></w:r>'
                 '<w:hyperlink r:id="rId2"><w:r><w:t>Статья</w:t></w:r></w:hyperlink><w:r><w:t>).</w:t></w:r></w:p>')
        docx(tmp / "issue.docx", extra)
        # ссылка со скобками в адресе
        src = tmp / "issue.docx"; dst = tmp / "issue2.docx"
        with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename.endswith(".rels"):
                    data = data.replace(b"</Relationships>", b'<Relationship Id="rId2" Type="hyperlink" Target="https://example.com/a_(b)" TargetMode="External"/></Relationships>')
                zout.writestr(item.filename, data)
        out = tmp / "issue.json"
        self.assertEqual(from_docx.main([str(dst), "--start", "2026-11-24", "--out", str(out)]), 0)
        issue = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(issue["noise"][1], "Вторая новость\nбез влияния ([Статья](https://example.com/a_%28b%29)).")
        render.check(issue)
        letter = render.mail(render.check(issue))  # сборщик принимает файл без правок
        self.assertIn("Торг становится настройкой", letter["text"])

    def test_map_and_figure_lines_are_optional(self):
        code, out = self.run_script(p("Карта сути: Торг / Возврат") + p("Цифра недели: от 4 990 рублей / настройка у сервиса / Пояснение одной фразой"))
        self.assertEqual(code, 0)
        issue = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual([issue["main_signal"]["short"], issue["signals"][0]["short"]], ["Торг", "Возврат"])
        self.assertEqual(issue["figure"], {"value": "от 4 990 рублей", "caption": "настройка у сервиса", "note": "Пояснение одной фразой"})

    def test_unknown_parts_stop_the_script(self):
        code, out = self.run_script(p("Новый раздел", "Heading2") + p("Абзац, который некуда положить."))
        self.assertEqual(code, 1)
        self.assertFalse(out.exists())

    def test_verify_reports_a_lost_paragraph(self):
        tmp = Path(tempfile.mkdtemp()); docx(tmp / "issue.docx")
        blocks = from_docx.read(tmp / "issue.docx")
        issue = from_docx.build(blocks, from_docx.dt.date(2026, 11, 24), "Авито Товары")
        issue["noise"] = ["Новость пересказана другими словами."]
        self.assertEqual(from_docx.verify(blocks, issue), ["Новость без влияния на селлеров."])


if __name__ == "__main__":
    unittest.main()
