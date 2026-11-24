#!/usr/bin/env python3
"""Выпуск AI-радара Авито Товаров: страница для nowater.tech и письмо из одного файла JSON.

    python3 -I radar/render.py ВЫПУСК.json --out ПАПКА

В папке появятся:
  page.html          - страница выпуска, ее Ева присылает Виктории на просмотр и публикует шлюзом;
  mail.json          - тема, HTML и текст письма, их шлюз отправляет (radar/README.md);
  mail-preview.html  - письмо как HTML-файл, чтобы посмотреть его в браузере.

Страница несет выпуск целиком, слово в слово: сборщик ничего не сокращает и не пересказывает.
Ссылки внутри текста записываются как [текст](https://адрес) и остаются на своем месте.

Письмо построено по пирамиде Минто и несет первый уровень чтения: суть недели, карту сути,
сигналы с заголовками-выводами, цифру недели и вопрос клиенту. В письмо идет первый абзац
каждого поля без ссылок на источники. Идеи фич, источники, сводная таблица и шум читаются на странице.

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
    "summary": "Суть",
    "main": "Главный сигнал недели",
    "what": "Что происходит",
    "why": "Почему это важно для выручки",
    "product": "Возможные фичи для продукта",
    "question": "Возможный вопрос клиенту",
    "signals": "",  # пусто: "Еще 3 сигнала недели" по числу сигналов
    "table": "Сводная таблица возможных продуктовых фич",
    "noise": "Что отсеяли как шум",
    "limits": "Ограничения",
    "figure": "Цифра недели",
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
            "short": _text(main.get("short"), "main_signal.short", problems, required=False, heading=True),
            **main_texts,
            "sources": _sources(main.get("sources"), "main_signal.sources", problems,
                                linked=any(LINK.search(value) for value in main_texts.values())),
        },
        "signals": [],
        "table": [],
        "noise": [],
        "figure": None,
    }
    figure = issue.get("figure")
    if figure is not None:
        figure = figure if isinstance(figure, dict) else {}
        # Цифра недели: число словами выпуска, короткая подпись к нему и, если нужно, одна фраза выпуска о том, что оно значит.
        clean["figure"] = {"value": _text(figure.get("value"), "figure.value", problems, heading=True),
                           "caption": _text(figure.get("caption"), "figure.caption", problems, heading=True),
                           "note": _text(figure.get("note"), "figure.note", problems, required=False)}
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
            "short": _text(item.get("short"), f"{place}.short", problems, required=False, heading=True),
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


# Типограф. Слова не меняются: меняются только пробелы и то, где строке можно переноситься.
#   короткий предлог или союз не остается в конце строки;
#   число не отрывается от слова после него, разряды числа и год после месяца не разрываются;
#   короткое слово с дефисом ("ИИ-агент", "API-ключ") не переносится по дефису.
NBSP = "&nbsp;"
HANGING = re.compile(r"(?<![\w&-])(в|во|и|к|ко|у|о|об|с|со|на|по|за|из|от|до|не|ни|а|но|для|при|без|под|над|про|или)\s+(?=\S)", re.I)
DIGIT_GROUPS = re.compile(r"(?<=\d)\s+(?=\d{3}(?!\d))")
NUMBER_WORD = re.compile(r"(\d+)\s+(?=[а-яА-Яa-zA-Z])")
MONTH_YEAR = re.compile(r"((?:январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]{1,2})\s+(?=\d{4}\b)")
SHORT_COMPOUND = re.compile(r"(?<![\w-])([^\W\d_]{1,3}-[^\W\d_]{2,})(?![\w-])")
LAST_WORDS = re.compile(r"(\S+)\s+(\S+)$")
TAIL_LIMIT = 16  # знаков в связке двух последних слов: длиннее не поместится в строку заголовка на телефоне 320 px


def _typo(text: str, *, tail: bool = False) -> str:
    """Экранированный текст с неразрывными пробелами. tail - связать два последних слова строки."""
    out = H(text)
    out = DIGIT_GROUPS.sub(NBSP, out)
    # Год к следующему слову не привязывается: "с мая 2026 обратная доставка".
    out = NUMBER_WORD.sub(lambda m: m.group(1) + (" " if re.fullmatch(r"(?:19|20)\d\d", m.group(1)) else NBSP), out)
    out = MONTH_YEAR.sub(r"\1" + NBSP, out)
    out = HANGING.sub(r"\1" + NBSP, out)
    if tail:
        def bind(found: re.Match) -> str:
            pair = html.unescape(found.group(1) + " " + found.group(2))
            return found.group(1) + (NBSP if len(pair) <= TAIL_LIMIT else " ") + found.group(2)
        out = LAST_WORDS.sub(bind, out)
    return SHORT_COMPOUND.sub(r'<span style="white-space:nowrap;">\1</span>', out)


def _rich(text: str, link_style: str = "") -> str:
    """Текст выпуска в HTML: все экранировано, ссылки [текст](адрес) остаются на своем месте."""
    out, last = [], 0
    style = f' style="{link_style}"' if link_style else ""
    for found in LINK.finditer(text):
        out.append(_typo(text[last:found.start()]))
        out.append(f'<a href="{H(found.group(2), quote=True)}" target="_blank" rel="noopener noreferrer"{style}>{_typo(found.group(1))}</a>')
        last = found.end()
    out.append(_typo(text[last:]))
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
# Письмо построено по пирамиде Минто и несет первый уровень чтения:
#   суть недели -> карта сути -> сигналы с заголовками-выводами -> вопрос клиенту -> одна кнопка.
# Читатель письма - продажи. Идеи фич, источники, сводная таблица, шум и оговорки читаются на странице.
#
# Оформление - темный вариант nowater.tech, собранный для почты:
#   три цвета текста (светлый, розовый, темный на розовой заливке), серого текста нет;
#   Manrope в почте не загружается, поэтому иерархию держат размер и жирность системного шрифта;
#   подпись блока стоит на своей строке, текст начинается с новой;
#   знаки, которые служили строке в файле, заменяет верстка: двоеточия после подписей, кавычки
#   вокруг вопроса, точка в конце сути и заголовков в письмо не идут.
# Верстка только на таблицах со стилями на самих элементах, без картинок.
# В письмо идет первый абзац каждого поля без ссылок на источники. Слова выпуска не меняются.
# Строка превью идет без хвоста невидимых символов: проверочное письмо с таким хвостом 24.11.2026
# не дошло до ящика на Яндексе, а то же письмо без него дошло. Причина не доказана, риск снят.

BG, PANEL, INK, ACCENT = "#131417", "#1A1C21", "#EEF2F8", "#E4A9CE"
FONT = "Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif"
TABLE = 'role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"'
MAIL_WIDTH, MAIL_PAD = 600, 24
SOURCE_BRACKETS = re.compile(r"\s*\((?:\s*\[[^\[\]\n]+\]\(https?://[^\s()<>\"']+\)\s*(?:,|и)?)+\s*\)")
SOURCES_SENTENCE = re.compile(r"(?:^|(?<=[.!?])\s+)Источники?:\s[^\n]*$")
SENTENCE_END = re.compile(r"(?<=[^\s.]{4})[.!?](?=\s+[А-ЯA-Z\"])")
QUOTED = re.compile(r"&quot;((?:[^&<]|&nbsp;|</?span[^>]*>){2,60}?)&quot;")
LETTER_LIMIT = 260  # абзац длиннее этого упаковщик не разбил: в письмо идет его первая фраза
READING_SPEED = 170  # слов в минуту


def _essence(text: str) -> str:
    """Что из поля выпуска идет в письмо: первый абзац без ссылок на источники."""
    parts = _lines(text)
    first = _visible(SOURCE_BRACKETS.sub("", SOURCES_SENTENCE.sub("", parts[0]))).strip()
    if len(parts) == 1 and len(first) > LETTER_LIMIT:
        end = SENTENCE_END.search(first)
        if end:
            first = first[:end.end()]
    return first


def _display(text: str) -> str:
    """Строка, поставленная крупно или отдельным блоком: без кавычек вокруг и без точки в конце."""
    text = text.strip()
    if len(text) > 2 and text[0] == text[-1] == '"':
        text = text[1:-1].strip()
    return text[:-1] if text.endswith(".") and not text.endswith("..") else text


def _soft(text: str, *, tail: bool = False) -> str:
    """Текст письма в HTML: с типографом, слова в кавычках внутри фразы выделены жирностью вместо кавычек."""
    return QUOTED.sub(r'<strong style="font-weight:700;">\1</strong>', _typo(text, tail=tail))


def _short_period(start: dt.date, end: dt.date) -> str:
    """17-23 ноября, 30 ноября - 6 декабря."""
    if start.month == end.month:
        return f"{start.day}-{end.day} {MONTHS[end.month - 1]}"
    return f"{start.day} {MONTHS[start.month - 1]} - {end.day} {MONTHS[end.month - 1]}"


def _font(size: int, line: int, weight: int = 400, color: str = INK, extra: str = "") -> str:
    return f"font-family:{FONT};font-size:{size}px;line-height:{line}px;font-weight:{weight};color:{color};{extra}"


def _label(text: str, *, top: int = 0, color: str = ACCENT) -> str:
    """Подпись блока: своя строка, обычные буквы, жирная."""
    return f'<p style="margin:{top}px 0 0 0;{_font(13, 18, 700, color)}">{H(text)}</p>'


def _body(text: str, *, top: int = 12) -> str:
    return "".join(f'<p style="margin:{top if i == 0 else 12}px 0 0 0;{_font(17, 27)}">{_soft(part, tail=True)}</p>'
                   for i, part in enumerate(_lines(text)))


def _zone(inner: str, *, top: int = 0, bottom: int = 0) -> str:
    """Зона письма во всю ширину: фон задан на каждой зоне, потому что почта может убрать фон обертки."""
    return (f'<table {TABLE}><tr><td bgcolor="{BG}" style="background-color:{BG};padding:{top}px {MAIL_PAD}px {bottom}px {MAIL_PAD}px;">'
            f"{inner}</td></tr></table>")


def _ask(label: str, question: str, *, top: int, size: int = 17, line: int = 25) -> str:
    """Вопрос клиенту: отдельный блок с розовой линией слева. Это то, что менеджер берет в разговор."""
    return (f'<table {TABLE} style="margin-top:{top}px;"><tr>'
            f'<td width="3" bgcolor="{ACCENT}" style="background-color:{ACCENT};width:3px;font-size:0;line-height:0;">&nbsp;</td>'
            f'<td bgcolor="{PANEL}" style="background-color:{PANEL};padding:20px 22px 22px 22px;">'
            + _label(label)
            + f'<p style="margin:8px 0 0 0;{_font(size, line, 700)}">{_soft(_display(question), tail=True)}</p></td></tr></table>')


def _letter(issue: dict[str, Any]) -> dict[str, Any]:
    """Содержание письма: какие слова выпуска в него идут. Верстка и текстовая версия берут их отсюда."""
    m, signals, table = issue["main"], issue["signals"], issue["table"]
    # Строки сводной таблицы идут в том же порядке, что и сигналы: первая - главный сигнал.
    rows = table if len(table) == 1 + len(signals) else None
    shorts = [m["short"]] + [s["short"] for s in signals]
    figure = issue["figure"]
    return {
        "essence": _essence(issue["summary"]),
        # Карта сути: по два-три слова на сигнал. Есть, только если слова даны у каждого сигнала.
        "map": [(n, short) for n, short in enumerate(shorts, 1)] if all(shorts) else [],
        "main": {"title": m["title"], "what": _essence(m["what"]), "why": _essence(m["why"]), "question": _essence(m["question"])},
        "signals": [{"n": n, "title": s["title"], "text": _essence(s["text"]),
                     "question": _essence(rows[n - 1]["question"]) if rows else ""} for n, s in enumerate(signals, 2)],
        "figure": {"value": figure["value"], "caption": figure["caption"], "note": _essence(figure["note"]) if figure["note"] else ""} if figure else None,
    }


def mail(issue: dict[str, Any]) -> dict[str, str]:
    url, L, c = issue["url"], issue["labels"], _letter(issue)
    m, signals = c["main"], c["signals"]
    period = _short_period(issue["start"], issue["end"])
    preheader = issue["preheader"] or c["essence"]
    signals_label = _signals_label(issue)
    number = issue["edition"][len(issue["name"]) + 2:]  # "Выпуск 6" или пусто

    def reading(minutes: int) -> str:
        return f"{minutes} {_count(minutes, 'минута чтения', 'минуты чтения', 'минут чтения')}"

    # --- шапка: знак, название, строка из трех сведений о выпуске ---
    def head(minutes: int) -> str:
        facts = [x for x in (number, period, reading(minutes)) if x]
        # Первое сведение стоит по левому краю, последнее по правому: края строки совпадают с краями знака,
        # названия и плиток. Среднее занимает все место между ними, поэтому промежутки слева и справа от него равны.
        last = len(facts) - 1

        def fact(i: int, x: str) -> str:
            width = ' width="100%"'
            side = "left" if i == 0 else "right" if i == last else "center"
            if i in (0, last):
                return f'<td align="{side}" valign="top" style="white-space:nowrap;{_font(13, 18)}">{H(x).replace(" ", NBSP)}</td>'
            # Среднее сведение может перенестись на вторую строку: длинный период ("30 ноября - 6 декабря")
            # иначе выталкивает строку за край телефона шириной 320 px.
            return f'<td{width} align="{side}" valign="top" style="padding:0 8px;{_font(13, 18)}">{_typo(x)}</td>'

        cells = "".join(fact(i, x) for i, x in enumerate(facts))
        return _zone(
            f'<table {TABLE}><tr><td style="{_font(13, 18, 700, INK, "letter-spacing:0.02em;")}">NOWATER.TECH</td>'
            f'<td align="right" style="{_font(13, 18)}">{_typo(issue["name"])}</td></tr></table>'
            f'<table {TABLE} style="margin-top:8px;"><tr>{cells}</tr></table>', top=24)

    # --- суть: одна фраза, самая крупная в письме ---
    essence = _zone(
        _label(L["summary"])
        + f'<p style="margin:8px 0 0 0;{_font(26, 33, 700, INK, "letter-spacing:-0.01em;")}">{_soft(_display(c["essence"]), tail=True)}</p>', top=48)

    # --- карта сути: по плитке на сигнал, по две в ряд ---
    # Фон и розовая линия стоят на самой ячейке: ряд читается как одна плашка с двумя колонками,
    # и плитки одного ряда одной высоты, даже если в одной из них слова перенеслись на вторую строку.
    def tile(n: int, short: str, span: str) -> str:
        return (f'<td {span} bgcolor="{PANEL}" valign="top" style="background-color:{PANEL};border-top:2px solid {ACCENT};padding:16px 16px 18px 16px;">'
                f'<p style="margin:0;{_font(13, 18, 700, ACCENT)}">{n:02d}</p>'
                f'<p style="margin:6px 0 0 0;{_font(17, 22, 700)}">{_typo(short)}</p></td>')

    tiles = c["map"]
    rows = []
    for i in range(0, len(tiles), 2):
        pair = tiles[i:i + 2]
        rows.append("<tr>" + ("".join(tile(n, short, 'width="50%"') for n, short in pair) if len(pair) == 2
                             else tile(*pair[0], 'colspan="2"')) + "</tr>")
    between = '<tr><td colspan="2" height="8" style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>'
    card_map = _zone(f'<table {TABLE}>{between.join(rows)}</table>', top=32) if tiles else ""

    # --- главный сигнал: заголовок-вывод, что произошло, почему это важно, цифра, вопрос клиенту ---
    figure = ""
    if c["figure"]:
        f = c["figure"]
        figure = (f'<table {TABLE} style="margin-top:32px;"><tr><td bgcolor="{ACCENT}" style="background-color:{ACCENT};padding:22px 20px 24px 20px;">'
                  + _label(L["figure"], color=BG)
                  + f'<p style="margin:8px 0 0 0;{_font(36, 40, 700, BG, "letter-spacing:-0.02em;")}">{DIGIT_GROUPS.sub(NBSP, H(f["value"]))}</p>'
                  + f'<p style="margin:8px 0 0 0;{_font(17, 24, 700, BG)}">{_typo(_display(f["caption"]))}</p>'
                  + (f'<p style="margin:8px 0 0 0;{_font(17, 25, 400, BG)}">{_typo(_display(f["note"]), tail=True)}</p>' if f["note"] else "")
                  + "</td></tr></table>")
    main = _zone(
        f'<p style="margin:0;{_font(13, 18, 700, ACCENT)}">01</p>'
        f'<h1 style="margin:8px 0 0 0;{_font(26, 32, 700, INK, "letter-spacing:-0.01em;")}">{_typo(_display(m["title"]), tail=True)}</h1>'
        + _body(m["what"]) + _label(L["why"], top=24) + _body(m["why"], top=8)
        + figure + _ask(L["question"], m["question"], top=8 if figure else 24, size=20, line=28), top=56)

    # --- остальные сигналы: заголовок-вывод, одна фраза, вопрос клиенту ---
    def row(s: dict[str, Any]) -> str:
        return (f'<p style="margin:{24 if s["n"] == 2 else 48}px 0 0 0;{_font(13, 18, 700, ACCENT)}">{s["n"]:02d}</p>'
                f'<h2 style="margin:8px 0 0 0;{_font(20, 26, 700)}">{_typo(_display(s["title"]), tail=True)}</h2>'
                + _body(s["text"]) + (_ask(L["question"], s["question"], top=24) if s["question"] else ""))

    signal_list = _zone(_label(signals_label) + "".join(row(s) for s in signals), top=56) if signals else ""

    # --- одна кнопка на весь выпуск и подпись ---
    button = _zone(
        f'<table {TABLE}><tr><td align="center" bgcolor="{ACCENT}" style="background-color:{ACCENT};mso-padding-alt:19px 20px;">'
        f'<a href="{url}" target="_blank" style="display:block;padding:19px 20px;{_font(17, 22, 700, BG)}text-decoration:none;mso-padding-alt:0;">'
        f"Весь выпуск на сайте &rarr;</a></td></tr></table>", top=56)
    sign = _zone(f'<p style="margin:0;{_font(13, 18, 700)}">{SIGNATURE}</p><p style="margin:2px 0 0 0;{_font(13, 18)}">NOWATER.TECH</p>', top=40, bottom=48)

    # Время чтения - по словам готового письма. Считаются слова из букв, цифры и номера не в счет.
    rest = essence + card_map + main + signal_list + button + sign
    shown = html.unescape(re.sub(r"<[^>]+>", " ", head(1) + rest))
    minutes = max(1, round(len(re.findall(r"[^\W\d_]{2,}", shown)) / READING_SPEED))

    hidden = (f'<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:{BG};mso-hide:all;" '
              f'aria-hidden="true">{H(preheader)}</div>')
    body = (
        f'<!doctype html><html lang="ru" dir="ltr" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">'
        f'<meta name="supported-color-schemes" content="dark"><title>{H(issue["subject"])}</title>'
        f'<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->'
        f'<style>body{{margin:0;padding:0;background-color:{BG};}}h1,h2,p{{mso-line-height-rule:exactly;}}</style></head>'
        f'<body style="margin:0;padding:0;background-color:{BG};"><div lang="ru" dir="ltr" style="margin:0;padding:0;background-color:{BG};">{hidden}'
        f'<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" width="{MAIL_WIDTH}"><tr><td><![endif]-->'
        f'<div style="max-width:{MAIL_WIDTH}px;margin:0 auto;background-color:{BG};">'
        + head(minutes) + rest
        + "</div><!--[if mso]></td></tr></table><![endif]--></div></body></html>")

    # Текстовая версия повторяет письмо: подпись на своей строке, под ней текст.
    text = [" / ".join(x for x in ("NOWATER.TECH", issue["name"], number, period, reading(minutes)) if x), "",
            L["summary"], _display(c["essence"]), ""]
    text += [f"{n:02d} {short}" for n, short in tiles] + ([""] if tiles else [])
    text += [f"01 {_display(m['title'])}", m["what"], "", L["why"], m["why"]]
    if c["figure"]:
        f = c["figure"]
        text += ["", L["figure"], f["value"], _display(f["caption"])] + ([_display(f["note"])] if f["note"] else [])
    text += ["", L["question"], _display(m["question"])]
    if signals:
        text += ["", signals_label]
        for s in signals:
            text += ["", f"{s['n']:02d} {_display(s['title'])}", s["text"]]
            text += ["", L["question"], _display(s["question"])] if s["question"] else []
    text += ["", "Весь выпуск на сайте", url, "", SIGNATURE, "NOWATER.TECH"]
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
