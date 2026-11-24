#!/usr/bin/env python3
"""Выпуск AI-радара Авито Товаров: страница для nowater.tech и письмо из одного файла JSON.

    python3 -I radar/render.py ВЫПУСК.json --out ПАПКА

В папке появятся:
  page.html          - страница выпуска, ее Ева присылает Виктории на просмотр и публикует шлюзом;
  mail.json          - тема, HTML и текст письма, их шлюз отправляет (radar/README.md);
  mail-preview.html  - письмо как HTML-файл, чтобы посмотреть его в браузере.

Письмо - выпуск целиком в оформлении nowater.tech, разложенный по блокам: главный вывод,
главный сигнал, остальные сигналы, сводная таблица, шум и кнопка на страницу.

Текст выпуска сборщик не сокращает, не переставляет и не пересказывает: каждое поле JSON
попадает в письмо и на страницу слово в слово. Ссылки внутри текста записываются как
[текст](https://адрес) и остаются на своем месте в предложении.

Скрипт ничего не публикует и не отправляет. Перед сборкой он проверяет текст по правилам
Виктории (буква "е", короткий дефис, прямые кавычки, без точки с запятой, без точки в конце
заголовка, без "помогает" и "способствует") и форму выпуска. Нарушения печатаются списком,
и файлы не создаются.

Формат JSON - radar/example-issue.json. Нужен node или bun: оформление nowater.tech
(значки, превью ссылки) добавляет scripts/brand-publications.mjs.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FONTS_FROM = ROOT / "reports" / "seller-signals-2026-10-26.html"
BASE_URL = "https://nowater.tech/AI-radar/Avito/Goods/"
SIGNATURE = "Виктория Уткина"
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
          "июля", "августа", "сентября", "октября", "ноября", "декабря"]

# Правила текста. Каждое - что искать и как объяснить человеку.
FORBIDDEN = [
    (re.compile("[ёЁ]"), "буква с двумя точками, нужно \"е\""),
    (re.compile("[‒–—―−]"), "длинное или среднее тире, нужен короткий дефис \" - \""),
    (re.compile("[«»„“”‟‘’‚‹›]"), "кавычки не прямые, нужны \"\""),
    (re.compile(";"), "точка с запятой"),
    (re.compile(r"(?i)помога|способству"), "слова \"помогает\" и \"способствует\" запрещены"),
    (re.compile("[\U0001F000-\U0001FAFF☀-➿️]"), "эмодзи"),
]
HEADINGS = {"subject", "title", "name", "badge"}

# Ссылка внутри текста выпуска: [текст](https://адрес). Скобки и пробелы в адресе кодируются.
LINK = re.compile(r"\[([^\[\]\n]+)\]\((https?://[^\s()<>\"']+)\)")

# Подписи разделов. Они совпадают с заголовками в тексте выпуска. Если заголовки в выпуске
# другие, упаковщик передает их в поле labels: сборщик подписи не придумывает.
LABELS = {
    "summary": "Главный вывод недели",
    "main": "Главный сигнал недели",
    "what": "Что происходит",
    "why": "Почему это важно для выручки",
    "product": "Возможные фичи для продукта",
    "question": "Возможный вопрос клиенту",
    "signals": "",  # пусто: "Еще 3 сигнала недели" по числу сигналов
    "table": "Сводная таблица возможных продуктовых фич",
    "noise": "Что отсеяли как шум",
    "limits": "Ограничения",
    "col_signal": "Сигнал",
    "col_segment": "Сегмент селлеров",
    "col_contour": "Контур Авито",
    "col_feature": "Идея фичи",
    "col_question": "Вопрос для понимания актуальности у клиентов",
}
TABLE_KEYS = ["signal", "segment", "contour", "feature", "question"]


class IssueError(Exception):
    """Выпуск нельзя собрать. Текст понятен человеку."""


# ---------- проверка ----------

def _visible(text: str) -> str:
    """Текст, как его видит читатель: от ссылки остается ее подпись."""
    return LINK.sub(lambda found: found.group(1), text)


def _plain(text: str) -> str:
    """Текст для письма без HTML: адрес ссылки идет в скобках после подписи."""
    return LINK.sub(lambda found: f"{found.group(1)} ({found.group(2)})", text)


def _text(value: Any, where: str, problems: list[str], *, required: bool = True, heading: bool = False) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            problems.append(f"{where}: пусто")
        return ""
    if not isinstance(value, str):
        problems.append(f"{where}: нужен текст")
        return ""
    value = value.strip()
    visible = _visible(value)  # правила текста не касаются адресов ссылок
    if "](" in visible:
        problems.append(f"{where}: ссылка записана с ошибкой, нужен вид [текст](https://адрес), скобки и пробелы в адресе кодируются")
    for pattern, why in FORBIDDEN:
        found = pattern.search(visible)
        if found:
            problems.append(f"{where}: {why} (\"{_around(visible, found.start())}\")")
    if (heading or where.rsplit(".", 1)[-1] in HEADINGS) and visible.endswith("."):
        problems.append(f"{where}: заголовок с точкой в конце")
    return value


def _around(text: str, index: int) -> str:
    return text[max(0, index - 20): index + 20].replace("\n", " ")


def _date(value: Any, where: str, problems: list[str]) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(value))
    except ValueError:
        problems.append(f"{where}: дата нужна в виде ГГГГ-ММ-ДД, сейчас \"{value}\"")
        return None


def _sources(items: Any, where: str, problems: list[str], *, linked: bool) -> list[dict[str, str]]:
    """Источники списком. Список не нужен, если ссылки на источники стоят в самом тексте (linked)."""
    if items is None or items == []:
        if not linked:
            problems.append(f"{where}: нужен хотя бы один источник со ссылкой: списком sources или ссылкой [текст](https://адрес) в тексте")
        return []
    if not isinstance(items, list):
        problems.append(f"{where}: нужен список источников")
        return []
    result = []
    for n, item in enumerate(items, 1):
        place = f"{where}[{n}]"
        if not isinstance(item, dict):
            problems.append(f"{place}: нужен объект с title, url и date")
            continue
        title = _text(item.get("title"), f"{place}.title", problems)
        url = str(item.get("url") or "").strip()
        if not re.fullmatch(r"https?://[^\s\"'<>]+", url):
            problems.append(f"{place}.url: нужна ссылка, начинающаяся с https://")
        day = _date(item.get("date"), f"{place}.date", problems)
        result.append({"title": title, "url": url, "date": _human_date(day) if day else ""})
    return result


def check(issue: Any) -> dict[str, Any]:
    """Проверенный выпуск или IssueError со всеми нарушениями сразу."""
    problems: list[str] = []
    if not isinstance(issue, dict):
        raise IssueError("выпуск должен быть объектом JSON, как в radar/example-issue.json")
    period = issue.get("period") if isinstance(issue.get("period"), dict) else {}
    start = _date(period.get("start"), "period.start", problems)
    end = _date(period.get("end"), "period.end", problems)
    if start and end and (end - start).days != 6:
        problems.append("period: неделя - это 7 дней, например 2026-11-17 и 2026-11-23")
    subject = _text(issue.get("subject"), "subject", problems)
    if subject and len(subject.split()) > 10:
        problems.append("subject: тема длиннее 10 слов")
    main = issue.get("main_signal") if isinstance(issue.get("main_signal"), dict) else {}
    if not main:
        problems.append("main_signal: нет главного сигнала недели")
    name = _text(issue.get("name") or "AI-радар", "name", problems)
    number = issue.get("number")
    if number is not None and (isinstance(number, bool) or not isinstance(number, int) or number < 1):
        problems.append("number: номер выпуска - целое число от 1")
        number = None
    labels = dict(LABELS)
    custom = issue.get("labels")
    if custom is not None and not isinstance(custom, dict):
        problems.append("labels: нужен объект с подписями разделов")
    for key, value in (custom or {}).items() if isinstance(custom, dict) else []:
        if key not in LABELS:
            problems.append(f"labels.{key}: такой подписи нет, есть: {', '.join(LABELS)}")
        else:
            labels[key] = _text(value, f"labels.{key}", problems, heading=True)
    main_texts = {key: _text(main.get(key), f"main_signal.{key}", problems) for key in ("what", "why", "product", "question")}
    clean: dict[str, Any] = {
        "name": name,
        "edition": f"{name}. Выпуск {number}" if number else name,
        "labels": labels,
        "audience": _text(issue.get("audience") or "Авито Товары", "audience", problems),
        "subject": subject,
        "summary": _text(issue.get("summary"), "summary", problems),
        "limits": _text(issue.get("limits"), "limits", problems, required=False),
        "preheader": _text(issue.get("preheader"), "preheader", problems, required=False),
        "main": {
            "title": _text(main.get("title"), "main_signal.title", problems),
            "badge": _text(main.get("badge"), "main_signal.badge", problems, required=False),
            **main_texts,
            "sources": _sources(main.get("sources"), "main_signal.sources", problems,
                                linked=any(LINK.search(value) for value in main_texts.values())),
        },
        "signals": [],
        "table": [],
        "noise": [],
    }
    signals = issue.get("signals") or []
    if not isinstance(signals, list) or len(signals) > 3:
        problems.append("signals: от 0 до 3 коротких сигналов")
        signals = []
    for n, item in enumerate(signals, 1):
        item = item if isinstance(item, dict) else {}
        place = f"signals[{n}]"
        text = _text(item.get("text"), f"{place}.text", problems)
        clean["signals"].append({
            "title": _text(item.get("title"), f"{place}.title", problems),
            "text": text,
            # Контур и идея фичи отдельными полями не обязательны: в тексте выпуска они могут стоять
            # в самом абзаце сигнала, и тогда повторять их не нужно.
            **{key: _text(item.get(key), f"{place}.{key}", problems, required=False) for key in ("badge", "contour", "feature")},
            "sources": _sources(item.get("sources"), f"{place}.sources", problems, linked=bool(LINK.search(text))),
        })
    rows = issue.get("table") or []
    if not isinstance(rows, list) or not rows:
        problems.append("table: нужна сводная таблица для Продукта хотя бы из одной строки")
        rows = []
    for n, row in enumerate(rows, 1):
        row = row if isinstance(row, dict) else {}
        clean["table"].append({key: _text(row.get(key), f"table[{n}].{key}", problems) for key in TABLE_KEYS})
    noise = issue.get("noise") or []
    if not isinstance(noise, list):
        problems.append("noise: нужен список")
        noise = []
    for n, item in enumerate(noise, 1):
        if isinstance(item, str):  # пункт одной фразой, как в тексте выпуска
            clean["noise"].append({"text": _text(item, f"noise[{n}]", problems)})
            continue
        item = item if isinstance(item, dict) else {}
        clean["noise"].append({key: _text(item.get(key), f"noise[{n}].{key}", problems) for key in ("topic", "reason")})
    if problems:
        raise IssueError("Выпуск не собран, поправьте:\n- " + "\n- ".join(problems))
    assert start and end
    clean["start"], clean["end"] = start, end
    clean["slug"] = f"{start:%d.%m}-{end:%d.%m.%y}"
    clean["url"] = BASE_URL + clean["slug"]
    clean["period_text"] = f"{_human_date(start, year=start.year != end.year)} - {_human_date(end)}"
    return clean


def _human_date(day: dt.date, *, year: bool = True) -> str:
    return f"{day.day} {MONTHS[day.month - 1]}" + (f" {day.year}" if year else "")


# ---------- страница ----------

CSS = (
    "*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:85px}"
    "body{margin:0;background:#0c0d10;color:#eef2f8;font:16px/1.65 Manrope,Arial,sans-serif}"
    "a{color:#e4a9ce}button{font:inherit;background:#e4a9ce;border:0;color:#131417;padding:12px 20px;cursor:pointer;font-weight:700}"
    "header{border-bottom:1px solid #34353c;background:#0c0d10ed;position:sticky;top:0;z-index:2}"
    "nav,.wrap{max-width:1120px;margin:auto;padding:22px 32px}nav{display:flex;justify-content:space-between;gap:20px;align-items:center}"
    ".brand{color:#eef2f8;text-decoration:none;font-weight:700}nav .links{display:flex;gap:22px;font-size:13px}"
    "h1{font-size:clamp(38px,6vw,72px);line-height:1.04;font-weight:400;margin:28px 0}"
    "h2{font-size:clamp(25px,3vw,38px);line-height:1.15;font-weight:400}h3{font-size:21px;font-weight:500;line-height:1.3}"
    ".eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;color:#e4a9ce}.lead{font-size:21px;max-width:850px}"
    ".muted{color:#a7adb8}.hero{padding:52px 0 38px}.section{padding:34px 0;border-top:1px solid #303138}"
    ".note{padding:20px 24px;border-left:3px solid #e4a9ce;background:#19191e;margin:24px 0}"
    ".cols{display:grid;grid-template-columns:1.3fr 1fr;gap:32px}.card{background:#131417;border:1px solid #303138;padding:26px;margin:16px 0}"
    ".sources a{display:block;margin:8px 0}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}"
    "td,th{border:1px solid #35363d;padding:14px;text-align:left;vertical-align:top}th{color:#e4a9ce;font-weight:700}"
    ".tag{display:inline-block;margin:14px 0 0;padding:3px 9px;border:1px solid #e4a9ce;color:#e4a9ce;font-size:11px;line-height:1.45;font-weight:700;letter-spacing:.08em}"
    ".lead p{margin:12px 0 0}.card h3{margin:14px 0 0}"
    "footer{padding:36px 0;color:#a7adb8;font-size:13px}"
    "@media(max-width:650px){.wrap,nav{padding:18px}.cols{grid-template-columns:1fr}nav .links{gap:12px;font-size:12px}"
    ".hero{padding:24px 0}.lead{font-size:18px}.card{padding:22px}h1{font-size:40px}nav .links a:first-child{display:none}}"
    "@media print{header,button{display:none}body{background:white;color:black}a,.eyebrow,.muted,th{color:#444}"
    ".wrap{max-width:none;padding:0}.card,.note{background:#fafafa;border-color:#999}"
    "a[href^=\"http\"]:after{content:\" (\" attr(href) \")\";font-size:9px;word-break:break-all}}"
)
H = html.escape


def _lines(text: str) -> list[str]:
    """Текст выпуска по абзацам: абзацы разделяет перевод строки."""
    return [part.strip() for part in text.split("\n") if part.strip()]


def _rich(text: str, link_style: str = "") -> str:
    """Текст выпуска в HTML: все экранировано, ссылки [текст](адрес) остаются на своем месте."""
    out, last = [], 0
    style = f' style="{link_style}"' if link_style else ""
    for found in LINK.finditer(text):
        out.append(H(text[last:found.start()]))
        out.append(f'<a href="{H(found.group(2), quote=True)}" target="_blank" rel="noopener noreferrer"{style}>{H(found.group(1))}</a>')
        last = found.end()
    out.append(H(text[last:]))
    return "".join(out)


def _p(text: str) -> str:
    return "".join(f"<p>{_rich(part)}</p>" for part in _lines(text))


def _signals_label(issue: dict[str, Any]) -> str:
    n = len(issue["signals"])
    return issue["labels"]["signals"] or f"Еще {n} {_count(n, 'сигнал', 'сигнала', 'сигналов')} недели"


def _count(n: int, one: str, few: str, many: str) -> str:
    """1 сигнал, 3 сигнала, 5 сигналов."""
    if n % 10 == 1 and n % 100 != 11:
        return one
    return few if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else many


def _source_links(sources: list[dict[str, str]]) -> str:
    return "".join(
        f'<a href="{H(s["url"], quote=True)}" target="_blank" rel="noopener noreferrer">{H(s["title"])}, {H(s["date"])} ↗</a>'
        for s in sources)


def _table_html(rows: list[dict[str, str]], labels: dict[str, str]) -> str:
    top = "".join(f"<th>{H(labels['col_' + key])}</th>" for key in TABLE_KEYS)
    body = "".join("<tr>" + "".join(f"<td>{_rich(r[k])}</td>" for k in TABLE_KEYS) + "</tr>" for r in rows)
    return f"<table><tr>{top}</tr>{body}</table>"


def page(issue: dict[str, Any]) -> str:
    fonts = "".join(re.findall(r"@font-face\{[^}]*\}", FONTS_FROM.read_text(encoding="utf-8")))
    if not fonts:
        raise IssueError(f"в {FONTS_FROM.name} не нашлись шрифты Manrope для страницы")
    m, L = issue["main"], issue["labels"]

    def tag(text: str) -> str:
        return f'<p class="tag">{H(text.upper())}</p>' if text else ""

    def card(n: int, s: dict[str, Any]) -> str:
        extra = " ".join(f"<strong>{H(L[label])}:</strong> {_rich(s[key])}."
                         for key, label in (("contour", "col_contour"), ("feature", "col_feature")) if s[key])
        return (f'<article class="card" id="signal-{n}"><span class="eyebrow">СИГНАЛ 0{n}</span>{tag(s["badge"])}'
                f'<h3>{H(s["title"])}</h3>{_p(s["text"])}' + (f"<p>{extra}</p>" if extra else "")
                + (f'<div class="sources">{_source_links(s["sources"])}</div>' if s["sources"] else "") + "</article>")

    short = "".join(card(n, s) for n, s in enumerate(issue["signals"], 2))
    noise = "".join(f"<li>{_rich(x['text'])}</li>" if "text" in x
                    else f"<li><strong>{H(x['topic'])}</strong> - {_rich(x['reason'])}</li>" for x in issue["noise"])
    limits = f'<div class="note"><strong>{H(L["limits"])}</strong>{_p(issue["limits"])}</div>' if issue["limits"] else ""
    links = ['<a href="#main">Главный сигнал</a>']
    if issue["signals"]:
        links.append('<a href="#signals">Еще сигналы</a>')
    links.append('<a href="#product">Таблица фич</a>')
    if issue["noise"]:
        links.append('<a href="#noise">Шум</a>')
    title = f"{issue['edition']} | {issue['audience']} | {issue['period_text']}"
    main_sources = f'<div class="sources">{_source_links(m["sources"])}</div>' if m["sources"] else ""
    return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{H(title)}</title><meta name="description" content="{H(issue['subject'], quote=True)}"><meta name="robots" content="noindex, nofollow">
<style>{fonts}{CSS}</style></head><body>
<header><nav><a class="brand" href="#top">NOWATER.TECH</a><div class="links">{''.join(links)}</div></nav></header>
<main class="wrap" id="top">
<section class="hero"><span class="eyebrow">{H(issue['edition'].upper())} / {H(issue['audience'].upper())} / {issue['start']:%d.%m}-{issue['end']:%d.%m.%Y}</span>
<h1>{H(issue['subject'])}</h1><span class="eyebrow">{H(L['summary'].upper())}</span><div class="lead">{_p(issue['summary'])}</div>{limits}<button id="print">Печать / PDF</button></section>
<section class="section" id="main"><span class="eyebrow">{H(L['main'].upper())}</span>{tag(m['badge'])}<h2>{H(m['title'])}</h2><div class="cols"><div>
<h3>{H(L['what'])}</h3>{_p(m['what'])}<h3>{H(L['why'])}</h3>{_p(m['why'])}
<h3>{H(L['product'])}</h3>{_p(m['product'])}</div><aside>
<div class="note"><strong>{H(L['question'])}</strong>{_p(m['question'])}</div>
{main_sources}</aside></div></section>
{f'<section class="section" id="signals"><span class="eyebrow">{H(_signals_label(issue).upper())}</span>{short}</section>' if short else ''}
<section class="section" id="product"><span class="eyebrow">{H(L['table'].upper())}</span><div class="table-wrap">{_table_html(issue['table'], L)}</div></section>
{f'<section class="section" id="noise"><span class="eyebrow">{H(L["noise"].upper())}</span><ul>{noise}</ul></section>' if noise else ''}
<footer>{SIGNATURE} / "БЕЗ ВОДЫ" / NOWATER.TECH<br>Выпуск за {H(issue['period_text'])}</footer></main>
<script>document.querySelector('#print').addEventListener('click',()=>window.print())</script></body></html>
"""


def brand(page_html: str, url: str) -> str:
    """Значки, превью ссылки и og-теги nowater.tech - тем же скриптом, что у всех отчетов."""
    runner = shutil.which("node") or shutil.which("bun")
    if not runner:
        raise IssueError("нужен node или bun: без них не добавить оформление nowater.tech")
    done = subprocess.run([runner, str(ROOT / "scripts" / "brand-publications.mjs"), "--stdin", "--url", url],
                          input=page_html, text=True, capture_output=True, cwd=ROOT, timeout=60)
    if done.returncode != 0 or "NOWATER:BRAND:BEGIN" not in done.stdout:
        raise IssueError("оформление nowater.tech не добавилось: " + (done.stderr.strip() or "пустой ответ"))
    return done.stdout


# ---------- письмо ----------
# Выпуск целиком в оформлении nowater.tech: уголь, один розовый акцент, заголовки весом 400,
# подписи прописными с разрядкой, прямые углы, тонкие линии. Те же значения, что в src/styles.css.
# Письмо устроено как страница: у каждого раздела выпуска своя зона со своим видом (плашка, линия,
# номер, метка). Текст в зонах - поля выпуска слово в слово.
# Верстка для почты: таблицы, стили прямо на элементах, без картинок. Блок <style> и условные
# комментарии для классического Outlook - улучшения: если почтовая программа их вырежет,
# письмо читается так же. Manrope в почте чаще всего не загрузится, тогда работает системный шрифт.

BG, PANEL, INK, PROSE, SECOND, MUTED, ACCENT, LINE = (
    "#131417", "#1A1C21", "#EEF2F8", "#C7CCD5", "#A7ADB8", "#8C929D", "#E4A9CE", "#313336")
FONT = "Manrope,-apple-system,'Segoe UI',Arial,sans-serif"
TABLE = 'role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"'
MAIL_WIDTH, MAIL_PAD = 600, 24
MAIL_LINK = f"color:{ACCENT};text-decoration:underline;"


def _font(size: int, line: int, weight: int = 400, color: str = INK, extra: str = "") -> str:
    return f"font-family:{FONT};font-size:{size}px;line-height:{line}px;font-weight:{weight};color:{color};{extra}"


def _caps(text: str, color: str = MUTED, top: int = 0, spacing: str = "0.11em") -> str:
    """Мелкая подпись прописными. Набрана прописными в тексте: text-transform почта может вырезать."""
    return f'<p style="margin:{top}px 0 0 0;{_font(11, 16, 600, color, f"letter-spacing:{spacing};")}">{H(text.upper())}</p>'


# Подпись в начале фразы: "Гипотеза для проверки:", "Метрики проверки:", "Ограничения:".
# Одно-три слова с прописной буквы и двоеточие. В письме такая подпись выделяется, слова не меняются.
RUN_IN = re.compile(r"(^|(?<=[.!?] ))([А-ЯA-Z][а-яa-z]+(?: [а-яa-zА-ЯA-Z]+){0,2}:)(?= )")
SOURCES_TAIL = re.compile(r"^(.*[.!?])\s+(Источники?:\s.+)$", re.S)
FIRST_SENTENCE = re.compile(r"^(.+?[.!?])\s+(?=[А-ЯA-Z\"])(.+)$", re.S)


def _mail_rich(text: str, *, labels: bool = False) -> str:
    """Текст выпуска для письма: ссылки на месте, подписи в начале фраз выделены. Слова не меняются."""
    markup = _rich(text, MAIL_LINK)
    if not labels:
        return markup
    # Подписи ищем только вне ссылок: текст ссылки и ее адрес не трогаем.
    parts = re.split(r"(<a\b.*?</a>)", markup)
    strong = f'<strong style="font-weight:600;color:{INK};">'
    return "".join(part if part.startswith("<a") else RUN_IN.sub(lambda m: f"{m.group(1)}{strong}{m.group(2)}</strong>", part)
                   for part in parts)


def _para(text: str, top: int = 10, size: int = 16, line: int = 26, color: str = PROSE, *, labels: bool = False) -> str:
    """Абзацы письма. Перевод строки в тексте выпуска начинает новый абзац."""
    return "".join(f'<p style="margin:{top if i == 0 else 12}px 0 0 0;{_font(size, line, 400, color)}">{_mail_rich(part, labels=labels)}</p>'
                   for i, part in enumerate(_lines(text)))


def _zone(inner: str, *, top: int = 30, bottom: int = 32, rule: bool = True) -> str:
    """Зона письма во всю ширину с полями и тонкой линией сверху."""
    border = f"border-top:1px solid {LINE};" if rule else ""
    return (f'<table {TABLE}><tr><td bgcolor="{BG}" style="background-color:{BG};padding:0 {MAIL_PAD}px;"><table {TABLE}><tr>'
            f'<td style="{border}padding:{top}px 0 {bottom}px 0;">{inner}</td></tr></table></td></tr></table>')


def _panel(inner: str, *, top: int = 0, accent: str = "") -> str:
    """Плашка. accent: "left" - розовая линия слева, "top" - сверху."""
    side = (f'<td width="2" bgcolor="{ACCENT}" style="background-color:{ACCENT};width:2px;font-size:0;line-height:0;">&nbsp;</td>'
            if accent == "left" else "")
    edge = f"border-top:2px solid {ACCENT};" if accent == "top" else ""
    return (f'<table {TABLE} style="margin-top:{top}px;"><tr>{side}'
            f'<td bgcolor="{PANEL}" style="background-color:{PANEL};{edge}padding:20px 22px 22px 22px;">{inner}</td></tr></table>')


def _note(inner: str, *, top: int = 14) -> str:
    """Врезка с тонкой линией слева: фраза, которая стоит особняком от основного текста."""
    return (f'<table {TABLE} style="margin-top:{top}px;"><tr>'
            f'<td width="1" bgcolor="{LINE}" style="background-color:{LINE};width:1px;font-size:0;line-height:0;">&nbsp;</td>'
            f'<td style="padding:2px 0 3px 16px;">{inner}</td></tr></table>')


def _badge(text: str, *, filled: bool, top: int = 0) -> str:
    """Метка сигнала. Текст метки приходит из выпуска, сборщик его не придумывает."""
    if not text:
        return ""
    back, ink = (ACCENT, BG) if filled else (BG, ACCENT)
    return (f'<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:{top}px;"><tr>'
            f'<td bgcolor="{back}" style="background-color:{back};border:1px solid {ACCENT};padding:3px 9px;'
            f'{_font(11, 16, 700, ink, "letter-spacing:0.08em;")}">{H(text.upper())}</td></tr></table>')


def _button(label: str, href: str, *, top: int = 24) -> str:
    return (f'<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:{top}px;"><tr>'
            f'<td align="center" bgcolor="{ACCENT}" style="background-color:{ACCENT};mso-padding-alt:15px 26px;">'
            f'<a href="{href}" target="_blank" style="display:inline-block;padding:15px 26px;{_font(15, 20, 700, BG)}text-decoration:none;mso-padding-alt:0;">'
            f"{label} &rarr;</a></td></tr></table>")


def _mail_sources(sources: list[dict[str, str]]) -> str:
    if not sources:
        return ""
    links = ", ".join(
        f'<a href="{H(s["url"], quote=True)}" target="_blank" style="{MAIL_LINK}">{H(s["title"])}</a>, {H(s["date"])}'
        for s in sources)
    return f'<p style="margin:12px 0 0 0;{_font(13, 21, 400, MUTED)}">{"Источник" if len(sources) == 1 else "Источники"}: {links}</p>'


def mail(issue: dict[str, Any]) -> dict[str, str]:
    m, url, signals, L = issue["main"], issue["url"], issue["signals"], issue["labels"]
    period = f"{issue['start']:%d.%m}-{issue['end']:%d.%m.%Y}"
    total, ideas, skipped = 1 + len(signals), len(issue["table"]), len(issue["noise"])
    facts = [(total, _count(total, "сигнал недели", "сигнала недели", "сигналов недели")),
             (ideas, _count(ideas, "идея фичи", "идеи фич", "идей фич"))]
    if skipped:
        facts.append((skipped, _count(skipped, "тема в шуме", "темы в шуме", "тем в шуме")))
    preheader = issue["preheader"] or f"{L['main']}: {m['title']}"
    signals_label = _signals_label(issue)

    def link(anchor: str, label: str, style: str) -> str:
        return f'<a href="{url}#{anchor}" target="_blank" style="{style}">{label}</a>'

    # --- шапка и навигация по разделам страницы ---
    # На узком экране название переносится по словам, а номер выпуска не отрывается от слова "Выпуск".
    edition = H(issue["edition"]).replace(" Выпуск ", " Выпуск&nbsp;")
    nav = [("main", "Главный сигнал")] + ([("signals", "Еще сигналы")] if signals else []) + [("product", "Таблица фич")]
    nav += [("noise", "Шум")] if skipped else []
    slash = f' <span style="color:{LINE};">/</span> '  # обычные пробелы: строка переносится между пунктами
    header = (
        f'<table {TABLE}><tr><td bgcolor="{BG}" style="background-color:{BG};padding:0 {MAIL_PAD}px;"><table {TABLE}><tr>'
        f'<td style="padding:20px 0 18px 0;{_font(13, 20, 800, INK, "letter-spacing:0.02em;")}">NOWATER.TECH</td>'
        f'<td align="right" style="padding:20px 0 18px 12px;{_font(12, 20, 600, MUTED)}">{edition}</td></tr></table>'
        f'<table {TABLE}><tr><td style="border-top:1px solid {LINE};border-bottom:1px solid {LINE};padding:11px 0 12px 0;">'
        f'<p style="margin:0;{_font(12, 20, 600, SECOND)}">'
        + slash.join(link(a, t, f"color:{SECOND};text-decoration:none;white-space:nowrap;") for a, t in nav)
        + "</p></td></tr></table></td></tr></table>")

    # --- первый экран: главный вывод и объем выпуска ---
    # Первая фраза вывода набрана крупно, остальной вывод - обычным текстом. Слова и порядок те же.
    lead_parts = _lines(issue["summary"])
    split = FIRST_SENTENCE.match(lead_parts[0])
    first, rest = (split.group(1), [split.group(2)] + lead_parts[1:]) if split else (lead_parts[0], lead_parts[1:])
    lead = (f'<p style="margin:14px 0 0 0;{_font(20, 30, 400, INK)}">{_mail_rich(first)}</p>'
            + "".join(f'<p style="margin:12px 0 0 0;{_font(16, 26, 400, PROSE)}">{_mail_rich(part)}</p>' for part in rest))
    cells = "".join(
        f'<td width="{100 // len(facts)}%" valign="top" style="padding:0 {0 if i == len(facts) - 1 else 12}px 0 0;">'
        f'<table {TABLE}><tr><td style="border-top:2px solid {ACCENT};padding:12px 0 0 0;">'
        f'<p style="margin:0;{_font(30, 34, 400, INK)}">{n}</p>{_caps(label, top=4)}</td></tr></table></td>'
        for i, (n, label) in enumerate(facts))
    hero = _zone(
        _caps(f"{issue['audience']} / {period}", spacing="0.15em") + _caps(L["summary"], ACCENT, top=22) + lead
        + f'<table {TABLE} style="margin-top:28px;"><tr>{cells}</tr></table>',
        top=30, bottom=34, rule=False)

    # --- главный сигнал ---
    # Фраза "Источники: ..." в конце абзаца уходит отдельной мелкой строкой под текст.
    what_parts = _lines(m["what"])
    tail = SOURCES_TAIL.match(what_parts[-1])
    if tail:
        what_parts[-1] = tail.group(1)
    what = _para("\n".join(what_parts)) + (
        f'<p style="margin:12px 0 0 0;{_font(13, 21, 400, MUTED)}">{_mail_rich(tail.group(2))}</p>' if tail else "")
    # "Почему важно": первый абзац - текст, следующие (гипотеза) - врезки.
    why_parts = _lines(m["why"])
    why = _para(why_parts[0]) + "".join(_note(_para(part, top=0, size=15, line=24, color=INK, labels=True), top=16) for part in why_parts[1:])
    # "Возможные фичи": короткая первая фраза - название фичи, она выделена.
    product_parts = _lines(m["product"])
    name = FIRST_SENTENCE.match(product_parts[0])
    if name and len(_visible(name.group(1))) <= 60:
        head = (f'<p style="margin:10px 0 0 0;{_font(16, 26, 400, INK)}"><strong style="font-weight:600;color:{INK};">'
                f'{_mail_rich(name.group(1))}</strong> {_mail_rich(name.group(2))}</p>')
    else:
        head = _para(product_parts[0], color=INK)
    product = head + "".join(f'<p style="margin:12px 0 0 0;{_font(15, 24, 400, PROSE)}">{_mail_rich(part, labels=True)}</p>'
                             for part in product_parts[1:])
    main = _zone(
        f'<table {TABLE}><tr><td width="34" valign="top" style="width:34px;{_font(12, 16, 600, ACCENT)}">01</td>'
        f'<td valign="top">{_caps(L["main"], spacing="0.15em")}</td></tr></table>'
        + _badge(m["badge"], filled=True, top=16)
        + f'<h1 class="rh1" style="margin:14px 0 0 0;{_font(32, 36, 400, INK, "letter-spacing:-0.02em;")}">{H(m["title"])}</h1>'
        + _caps(L["what"], top=26) + what + _mail_sources(m["sources"])
        + _caps(L["why"], top=26) + why
        + _panel(_caps(L["product"]) + product, top=24)
        + _panel(_caps(L["question"], ACCENT) + _para(m["question"], top=8, size=19, line=27, color=INK), top=14, accent="left")
        + _button("Главный сигнал на сайте", f"{url}#main"))

    # --- остальные сигналы: первый абзац - текст, следующие абзацы - врезки ---
    def row(n: int, s: dict[str, Any]) -> str:
        parts = _lines(s["text"])
        notes = "".join(_note(_para(part, top=0, size=15, line=23, color=INK)) for part in parts[1:])
        extra = "".join(_caps(L[label], top=14) + _para(s[key], top=4, size=15, line=23, color=INK)
                        for key, label in (("contour", "col_contour"), ("feature", "col_feature")) if s[key])
        more = (f'<p style="margin:14px 0 0 0;{_font(13, 20, 600, ACCENT)}">'
                + link(f"signal-{n}", "Подробнее на сайте &rarr;", MAIL_LINK) + "</p>")
        return (f'<table {TABLE}><tr><td width="34" valign="top" style="width:34px;border-top:1px solid {LINE};padding:23px 0 0 0;{_font(12, 16, 600, ACCENT)}">{n:02d}</td>'
                f'<td valign="top" style="border-top:1px solid {LINE};padding:20px 0 24px 0;">' + _badge(s["badge"], filled=False)
                + f'<h2 style="margin:{12 if s["badge"] else 0}px 0 0 0;{_font(21, 27, 400, INK, "letter-spacing:-0.01em;")}">{H(s["title"])}</h2>'
                + _para(parts[0], top=8, size=15, line=23) + notes + extra + _mail_sources(s["sources"]) + more + "</td></tr></table>")

    signal_list = _zone(_caps(signals_label, spacing="0.15em") + '<div style="margin-top:18px;">'
                        + "".join(row(n, s) for n, s in enumerate(signals, 2)) + "</div>", bottom=8) if signals else ""

    # --- сводная таблица: строка таблицы - плашка. На широком экране колонки стоят в два столбца,
    # на телефоне сами встают друг под друга: столбцы - блоки inline-block с предельной шириной.
    def cell(r: dict[str, str], key: str, first: bool) -> str:
        return (_caps(L["col_" + key], top=0 if first else 14)
                + _para(r[key], top=4, size=15, line=23, color=INK if key == "feature" else PROSE))

    def card(n: int, r: dict[str, str]) -> str:
        column = "display:inline-block;width:100%;max-width:246px;vertical-align:top;"
        return _panel(
            f'<table {TABLE}><tr><td width="34" valign="top" style="width:34px;{_font(12, 25, 600, ACCENT)}">{n + 1:02d}</td>'
            f'<td valign="top" style="{_font(17, 25, 400, INK)}">{_mail_rich(r["signal"])}</td></tr></table>'
            f'<div style="margin-top:2px;font-size:0;line-height:0;">'
            f'<div style="{column}padding:14px 16px 0 0;">{cell(r, "segment", True)}{cell(r, "contour", False)}</div>'
            f'<div style="{column}padding:14px 0 0 0;">{cell(r, "feature", True)}{cell(r, "question", False)}</div></div>',
            top=18 if n == 0 else 12)

    table = _zone(_caps(L["table"], spacing="0.15em") + "".join(card(n, r) for n, r in enumerate(issue["table"])))

    # --- шум ---
    def noise_html(x: dict[str, str]) -> str:
        if "text" in x:
            return _mail_rich(x["text"])
        return f'<strong style="font-weight:600;color:{INK};">{H(x["topic"])}</strong> - {_mail_rich(x["reason"])}'

    noise = _zone(_caps(L["noise"], spacing="0.15em") + "".join(
        f'<table {TABLE} style="margin-top:{16 if i == 0 else 12}px;"><tr>'
        f'<td width="34" valign="top" style="width:34px;{_font(12, 24, 600, ACCENT)}">{i + 1:02d}</td>'
        f'<td valign="top" style="{_font(15, 24, 400, PROSE)}">{noise_html(x)}</td></tr></table>'
        for i, x in enumerate(issue["noise"]))) if skipped else ""

    limits = _zone(_caps(L["limits"]) + _para(issue["limits"], top=8, size=14, line=22, color=SECOND)) if issue["limits"] else ""

    # --- переход на страницу ---
    cta = (f'<table {TABLE}><tr><td bgcolor="{BG}" style="background-color:{BG};padding:0 {MAIL_PAD}px 34px {MAIL_PAD}px;">'
           + _panel(_caps("Выпуск на сайте") + _button("Весь выпуск на сайте", url, top=14)
                    + f'<p style="margin:14px 0 0 0;{_font(12, 18, 400, MUTED, "word-break:break-all;")}">'
                      f'<a href="{url}" target="_blank" style="color:{MUTED};text-decoration:underline;">{url}</a></p>', accent="top")
           + "</td></tr></table>")
    footer = _zone(
        f'<p style="margin:0;{_font(12, 19, 600, SECOND)}">{SIGNATURE} / "БЕЗ ВОДЫ" / NOWATER.TECH</p>'
        f'<p style="margin:6px 0 0 0;{_font(12, 19, 400, MUTED)}">Выпуск за {H(issue["period_text"])}</p>',
        top=22, bottom=40)

    hidden = (f'<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:{BG};mso-hide:all;" '
              f'aria-hidden="true">{H(preheader)} {"&#847;&zwnj;&nbsp;&#8199;&shy; " * 30}</div>')
    body = (
        f'<!doctype html><html lang="ru" dir="ltr" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">'
        f'<meta name="supported-color-schemes" content="dark"><title>{H(issue["subject"])}</title>'
        f'<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->'
        f'<style>body{{margin:0;padding:0;background-color:{BG};}}h1,h2,h3,p{{mso-line-height-rule:exactly;}}'
        f'@media only screen and (max-width:480px){{.rh1{{font-size:28px !important;line-height:32px !important;}}}}</style></head>'
        f'<body style="margin:0;padding:0;background-color:{BG};"><div lang="ru" dir="ltr" style="margin:0;padding:0;background-color:{BG};">{hidden}'
        f'<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" width="{MAIL_WIDTH}"><tr><td><![endif]-->'
        f'<div style="max-width:{MAIL_WIDTH}px;margin:0 auto;background-color:{BG};">'
        + header + hero + main + signal_list + table + noise + limits + cta + footer
        + "</div><!--[if mso]></td></tr></table><![endif]--></div></body></html>")

    def flat(value: str) -> str:
        return "\n\n".join(_lines(_plain(value)))

    def sources_text(sources: list[dict[str, str]]) -> list[str]:
        if not sources:
            return []
        return [("Источник: " if len(sources) == 1 else "Источники: ") + ", ".join(f"{s['title']}, {s['date']}, {s['url']}" for s in sources)]

    text = [f"NOWATER.TECH / {issue['edition']} / {issue['audience']} / {period}", "", issue["subject"], "",
            L["summary"], flat(issue["summary"]), "", f"Выпуск на сайте: {url}", "",
            f"{L['main']}: {m['title']}", "",
            f"{L['what']}. " + flat(m["what"]), *sources_text(m["sources"]),
            "", f"{L['why']}. " + flat(m["why"]),
            "", f"{L['product']}. " + flat(m["product"]),
            "", f"{L['question']}: " + flat(m["question"])]
    if signals:
        text += ["", signals_label]
        for n, s in enumerate(signals, 2):
            text += ["", f"{n:02d}. {s['title']}. " + flat(s["text"])]
            text += [f"{L['col_' + key]}: " + flat(s[key]) for key in ("contour", "feature") if s[key]]
            text += sources_text(s["sources"])
    text += ["", L["table"]]
    for n, r in enumerate(issue["table"], 1):
        text += ["", *[f"{L['col_' + key]}: " + flat(r[key]) for key in TABLE_KEYS]]
    if skipped:
        text += ["", L["noise"], *["- " + (flat(x["text"]) if "text" in x else f"{x['topic']} - {flat(x['reason'])}") for x in issue["noise"]]]
    if issue["limits"]:
        text += ["", f"{L['limits']}. " + flat(issue["limits"])]
    text += ["", f"Выпуск на сайте: {url}", "", SIGNATURE]
    return {"period": issue["slug"], "url": url, "subject": issue["subject"], "html": body, "text": "\n".join(text) + "\n"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Страница и письмо AI-радара из JSON выпуска")
    parser.add_argument("issue", type=Path, help="файл выпуска в формате radar/example-issue.json")
    parser.add_argument("--out", type=Path, required=True, help="папка для page.html, mail.json и mail-preview.html")
    args = parser.parse_args(argv)
    try:
        issue = check(json.loads(args.issue.read_text(encoding="utf-8")))
        page_html = brand(page(issue), issue["url"])
        letter = mail(issue)
    except (IssueError, OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "page.html").write_text(page_html, encoding="utf-8")
    (args.out / "mail.json").write_text(json.dumps(letter, ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "mail-preview.html").write_text(letter["html"], encoding="utf-8")
    print(json.dumps({"period": issue["slug"], "url": issue["url"], "subject": issue["subject"],
                      "files": ["page.html", "mail.json", "mail-preview.html"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
