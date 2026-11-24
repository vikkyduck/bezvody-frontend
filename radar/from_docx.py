#!/usr/bin/env python3
"""Документ выпуска (Word) -> файл выпуска для render.py. Слова автора переносятся без правок.

    python3 -I radar/from_docx.py ВЫПУСК.docx --start 2026-11-17 --out issue.json

Зачем: раскладывать текст по полям руками или языковой моделью нельзя, потому что фраза может
быть пересказана. Скрипт ничего не сочиняет и не сокращает. В конце он сверяет результат с документом
и останавливается с ошибкой, если хоть один абзац или ячейка таблицы не перенесены дословно.

Что скрипт ждет в документе (как в выпуске 6):
    Заголовок 1    Слабые сигналы селлеров. Выпуск 6
    абзац          Тема письма: ...
    Заголовок 2    Главный вывод недели                    -> суть
    Заголовок 2    Главный сигнал недели: заголовок-вывод
    абзацы         Что происходит. ... / Почему это важно для выручки. ... /
                   Возможные фичи для продукта. ... / Возможный вопрос клиенту: ...
    Заголовок 2    Еще 3 сигнала недели                    -> абзац на сигнал: "Заголовок. Текст"
    Заголовок 2    Сводная таблица ...                     -> таблица из пяти колонок
    Заголовок 2    Что отсеяли как шум                     -> абзац на пункт
    Заголовок 2    Ограничения                             -> необязательно

Две необязательные строки в любом месте документа дают письму карту сути и цифру недели:
    Карта сути: Торг / Решение о возврате / Допуск ИИ-агентов / Проверка товара
    Цифра недели: от 4 990 рублей / настройка у avitofoer / пояснение одной фразой
В карте слов столько же, сколько сигналов вместе с главным. Без этих строк письмо соберется без карты и цифры.

Нужен только Python 3.9+, внешних пакетов нет.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
LINK = re.compile(r"\[([^\[\]\n]+)\]\((https?://[^\s()<>\"']+)\)")
TABLE_KEYS = ["signal", "segment", "contour", "feature", "question"]
MAP, FIGURE, SUBJECT = "Карта сути:", "Цифра недели:", "Тема письма:"
WHAT, WHY, PRODUCT, QUESTION = "Что происходит.", "Почему это важно для выручки.", "Возможные фичи для продукта.", "Возможный вопрос клиенту:"


class DocError(Exception):
    pass


def read(path: Path) -> list[dict]:
    """Абзацы и таблицы документа по порядку. Ссылка записывается как [текст](адрес)."""
    with zipfile.ZipFile(path) as z:
        body = ET.fromstring(z.read("word/document.xml")).find(W + "body")
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("word/_rels/document.xml.rels")).iter(REL + "Relationship")}

    def text(p: ET.Element) -> str:
        parts = []
        for child in p:
            words = "".join(t.text or "" for t in child.iter(W + "t"))
            if child.tag == W + "hyperlink" and rels.get(child.get(R + "id")):
                parts.append(f"[{words}]({rels[child.get(R + 'id')]})")
            elif child.tag in (W + "r", W + "hyperlink", W + "ins", W + "smartTag"):
                parts.append(words)
        return "".join(parts).strip()

    blocks = []
    for el in body:
        if el.tag == W + "p":
            style = el.find(f"{W}pPr/{W}pStyle")
            if text(el):
                blocks.append({"kind": "p", "style": style.get(W + "val") if style is not None else "", "text": text(el)})
        elif el.tag == W + "tbl":
            rows = [["\n".join(filter(None, (text(p) for p in tc.iter(W + "p")))) for tc in tr.iter(W + "tc")] for tr in el.iter(W + "tr")]
            blocks.append({"kind": "table", "rows": rows})
    return blocks


def _after(text: str, label: str) -> str:
    return text[len(label):].strip()


def build(blocks: list[dict], start: dt.date, audience: str) -> dict:
    problems: list[str] = []
    head = next((b for b in blocks if b["kind"] == "p" and b["style"].lower().startswith("heading1")), None)
    found = re.fullmatch(r"(.+?)\.\s*Выпуск\s+(\d+)", head["text"]) if head else None
    if not found:
        raise DocError('Первый заголовок документа должен быть вида "Слабые сигналы селлеров. Выпуск 6"')
    issue: dict = {"period": {"start": start.isoformat(), "end": (start + dt.timedelta(days=6)).isoformat()},
                   "name": found.group(1), "number": int(found.group(2)), "audience": audience}
    main: dict = {}
    signals, noise, limits, table, summary = [], [], [], [], []
    section, field = "", ""
    for b in blocks:
        if b is head:
            continue
        if b["kind"] == "table":
            if len(b["rows"]) < 2 or any(len(r) != 5 for r in b["rows"]):
                problems.append("Сводная таблица: нужны строка подписей и пять колонок в каждой строке")
            else:
                table = [dict(zip(TABLE_KEYS, row)) for row in b["rows"][1:]]
            continue
        t = b["text"]
        if b["style"].lower().startswith("heading"):
            low = t.lower()
            section = ("main" if low.startswith("главный сигнал") else "summary" if low.startswith("главный вывод") else
                       "signals" if low.startswith("еще") else "table" if low.startswith("сводная таблица") else
                       "noise" if "шум" in low else "limits" if low.startswith("ограничени") else "")
            if not section:
                problems.append(f'Незнакомый раздел "{t}": скрипт не знает, куда его положить')
            if section == "main":
                title = t.split(":", 1)[1].strip() if ":" in t else ""
                main["title"] = title[:1].upper() + title[1:]
            field = ""
        elif t.startswith(SUBJECT):
            issue["subject"] = _after(t, SUBJECT)
        elif t.startswith(MAP):
            issue["_map"] = [x.strip() for x in _after(t, MAP).split(" / ")]
        elif t.startswith(FIGURE):
            parts = [x.strip() for x in _after(t, FIGURE).split(" / ")]
            if len(parts) < 2:
                problems.append('Цифра недели: нужны число и подпись через " / "')
            else:
                issue["figure"] = dict(zip(("value", "caption", "note"), parts))
        elif section == "summary":
            summary.append(t)
        elif section == "main":
            for label, key in ((WHAT, "what"), (WHY, "why"), (PRODUCT, "product"), (QUESTION, "question")):
                if t.startswith(label):
                    field, t = key, _after(t, label)
                    break
            if not field:
                problems.append(f'Главный сигнал: абзац до подписи "{WHAT}": "{t[:50]}..."')
            elif t:
                main[field] = (main[field] + "\n" if main.get(field) else "") + t
        elif section == "signals":
            title, dot, rest = t.partition(". ")
            if not dot:
                problems.append(f'Сигнал без текста после заголовка: "{t[:50]}..."')
            signals.append({"title": title, "text": rest})
        elif section == "noise":
            noise.append(t)
        elif section == "limits":
            limits.append(t)
        else:
            problems.append(f'Абзац вне разделов: "{t[:50]}..."')
    issue["summary"] = "\n".join(summary)
    issue["main_signal"] = main
    issue.update(signals=signals, table=table, noise=noise)
    if limits:
        issue["limits"] = "\n".join(limits)
    shorts = issue.pop("_map", None)
    if shorts is not None:
        if len(shorts) != 1 + len(signals):
            problems.append(f"Карта сути: слов {len(shorts)}, сигналов вместе с главным {1 + len(signals)}")
        else:
            for item, short in zip([main] + signals, shorts):
                item["short"] = short
    for key, name in (("subject", SUBJECT), ("summary", "Главный вывод недели")):
        if not issue.get(key):
            problems.append(f'Нет раздела "{name}"')
    for key, name in (("title", "заголовок после двоеточия"), ("what", WHAT), ("why", WHY), ("product", PRODUCT), ("question", QUESTION)):
        if not main.get(key):
            problems.append(f"Главный сигнал: нет части \"{name}\"")
    if problems:
        raise DocError("Документ не разложен, поправьте:\n- " + "\n- ".join(problems))
    return issue


def _flat(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [x for v in value.values() for x in _flat(v)]
    if isinstance(value, list):
        return [x for v in value for x in _flat(v)]
    return []


def verify(blocks: list[dict], issue: dict) -> list[str]:
    """Каждый абзац и каждая ячейка документа должны стоять в выпуске дословно. Возвращает то, что не найдено."""
    squeeze = lambda s: re.sub(r"\s+", " ", s).strip()
    have = squeeze(" \n ".join(_flat(issue)))
    lost = []
    for b in blocks:
        cells = [b["text"]] if b["kind"] == "p" else [c for row in b["rows"][1:] for c in row]
        if b["kind"] == "p" and b["style"].lower().startswith("heading"):
            cells = [b["text"].split(":", 1)[1]] if b["text"].lower().startswith("главный сигнал") and ":" in b["text"] else []
        for cell in cells:
            for label in (SUBJECT, MAP, FIGURE, WHAT, WHY, PRODUCT, QUESTION):
                if cell.startswith(label):
                    cell = _after(cell, label)
            piece = squeeze(cell)
            # Заголовок главного сигнала начинается с прописной, заголовок сигнала отделен от текста, строки карты и цифры разложены по полям.
            parts = [piece] if piece in have else [x for x in re.split(r"(?<=\.) | / ", piece) if x]
            lost += [p for p in parts if p not in have and p[:1].upper() + p[1:] not in have and p.rstrip(".") not in have]
    return lost


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Документ выпуска (Word) -> файл выпуска для render.py, слово в слово")
    parser.add_argument("docx", type=Path)
    parser.add_argument("--start", required=True, help="первый день недели выпуска, например 2026-11-17. Неделя - 7 дней")
    parser.add_argument("--audience", default="Авито Товары")
    parser.add_argument("--out", type=Path, required=True, help="куда записать файл выпуска")
    args = parser.parse_args(argv)
    try:
        blocks = read(args.docx)
        issue = build(blocks, dt.date.fromisoformat(args.start), args.audience)
        lost = verify(blocks, issue)
        if lost:
            raise DocError("Сверка не пройдена, в выпуск не попало дословно:\n- " + "\n- ".join(x[:120] for x in lost))
    except (DocError, OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(error, file=sys.stderr)
        return 1
    args.out.write_text(json.dumps(issue, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(args.out), "number": issue["number"], "signals": 1 + len(issue["signals"]),
                      "map": "short" in issue["main_signal"], "figure": "figure" in issue, "verified": "слово в слово"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
