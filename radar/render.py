#!/usr/bin/env python3
"""Выпуск AI-радара Авито Товаров: страница для nowater.tech и письмо из одного файла JSON.

    python3 -I radar/render.py ВЫПУСК.json --out ПАПКА

В папке появятся:
  page.html          - страница выпуска, ее Ева присылает Виктории на просмотр и публикует шлюзом;
  mail.json          - тема, HTML и текст письма, их шлюз отправляет (radar/README.md);
  mail-preview.html  - письмо как HTML-файл, чтобы посмотреть его в браузере.

Письмо - обложка выпуска в оформлении nowater.tech: главный вывод, главный сигнал целиком,
карта остальных сигналов и кнопка на страницу. Сводная таблица и шум остаются на странице.

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
HEADINGS = {"subject", "title"}


class IssueError(Exception):
    """Выпуск нельзя собрать. Текст понятен человеку."""


# ---------- проверка ----------

def _text(value: Any, where: str, problems: list[str], *, required: bool = True) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            problems.append(f"{where}: пусто")
        return ""
    if not isinstance(value, str):
        problems.append(f"{where}: нужен текст")
        return ""
    value = value.strip()
    for pattern, why in FORBIDDEN:
        found = pattern.search(value)
        if found:
            problems.append(f"{where}: {why} (\"{_around(value, found.start())}\")")
    if where.rsplit(".", 1)[-1] in HEADINGS and value.endswith("."):
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


def _sources(items: Any, where: str, problems: list[str], *, required: bool) -> list[dict[str, str]]:
    if not isinstance(items, list) or (required and not items):
        problems.append(f"{where}: нужен хотя бы один источник со ссылкой")
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
    clean: dict[str, Any] = {
        "audience": _text(issue.get("audience") or "Авито Товары", "audience", problems),
        "subject": subject,
        "summary": _text(issue.get("summary"), "summary", problems),
        "limits": _text(issue.get("limits"), "limits", problems, required=False),
        "preheader": _text(issue.get("preheader"), "preheader", problems, required=False),
        "main": {
            "title": _text(main.get("title"), "main_signal.title", problems),
            **{key: _text(main.get(key), f"main_signal.{key}", problems) for key in ("what", "why", "product", "question")},
            "sources": _sources(main.get("sources"), "main_signal.sources", problems, required=True),
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
        clean["signals"].append({
            "title": _text(item.get("title"), f"{place}.title", problems),
            **{key: _text(item.get(key), f"{place}.{key}", problems) for key in ("text", "contour", "feature")},
            "sources": _sources(item.get("sources"), f"{place}.sources", problems, required=True),
        })
    rows = issue.get("table") or []
    if not isinstance(rows, list) or not rows:
        problems.append("table: нужна сводная таблица для Продукта хотя бы из одной строки")
        rows = []
    for n, row in enumerate(rows, 1):
        row = row if isinstance(row, dict) else {}
        clean["table"].append({key: _text(row.get(key), f"table[{n}].{key}", problems)
                               for key in ("signal", "segment", "contour", "feature", "question")})
    noise = issue.get("noise") or []
    if not isinstance(noise, list):
        problems.append("noise: нужен список")
        noise = []
    for n, item in enumerate(noise, 1):
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


def _p(text: str) -> str:
    return "".join(f"<p>{H(part)}</p>" for part in _lines(text))


def _source_links(sources: list[dict[str, str]]) -> str:
    return "".join(
        f'<a href="{H(s["url"], quote=True)}" target="_blank" rel="noopener noreferrer">{H(s["title"])}, {H(s["date"])} ↗</a>'
        for s in sources)


def _table_html(rows: list[dict[str, str]]) -> str:
    names = ["Сигнал", "Сегмент селлеров", "Контур Авито", "Идея фичи", "Вопрос для проверки на клиентах"]
    keys = ["signal", "segment", "contour", "feature", "question"]
    top = "".join(f"<th>{n}</th>" for n in names)
    body = "".join("<tr>" + "".join(f"<td>{H(r[k])}</td>" for k in keys) + "</tr>" for r in rows)
    return f"<table><tr>{top}</tr>{body}</table>"


def page(issue: dict[str, Any]) -> str:
    fonts = "".join(re.findall(r"@font-face\{[^}]*\}", FONTS_FROM.read_text(encoding="utf-8")))
    if not fonts:
        raise IssueError(f"в {FONTS_FROM.name} не нашлись шрифты Manrope для страницы")
    m = issue["main"]
    short = "".join(
        f'<article class="card" id="signal-{n}"><span class="eyebrow">СИГНАЛ 0{n}</span><h3>{H(s["title"])}</h3>{_p(s["text"])}'
        f'<p><strong>Контур Авито:</strong> {H(s["contour"])}. <strong>Идея фичи:</strong> {H(s["feature"])}</p>'
        f'<div class="sources">{_source_links(s["sources"])}</div></article>'
        for n, s in enumerate(issue["signals"], 2))
    noise = "".join(f"<li><strong>{H(x['topic'])}</strong> - {H(x['reason'])}</li>" for x in issue["noise"])
    limits = f'<div class="note"><strong>Ограничения</strong><p>{H(issue["limits"])}</p></div>' if issue["limits"] else ""
    links = ['<a href="#main">Главный сигнал</a>']
    if issue["signals"]:
        links.append('<a href="#signals">Еще сигналы</a>')
    links.append('<a href="#product">Для Продукта</a>')
    if issue["noise"]:
        links.append('<a href="#noise">Шум</a>')
    title = f"AI-радар {issue['audience']} | {issue['period_text']}"
    return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{H(title)}</title><meta name="description" content="{H(issue['subject'], quote=True)}"><meta name="robots" content="noindex, nofollow">
<style>{fonts}{CSS}</style></head><body>
<header><nav><a class="brand" href="#top">NOWATER.TECH</a><div class="links">{''.join(links)}</div></nav></header>
<main class="wrap" id="top">
<section class="hero"><span class="eyebrow">AI-РАДАР / {H(issue['audience'].upper())} / {issue['start']:%d.%m}-{issue['end']:%d.%m.%Y}</span>
<h1>{H(issue['subject'])}</h1><p class="lead">{H(issue['summary'])}</p>{limits}<button id="print">Печать / PDF</button></section>
<section class="section" id="main"><span class="eyebrow">ГЛАВНЫЙ СИГНАЛ НЕДЕЛИ</span><h2>{H(m['title'])}</h2><div class="cols"><div>
<h3>Что происходит</h3>{_p(m['what'])}<h3>Почему это важно для выручки</h3>{_p(m['why'])}
<h3>Что предложить Продукту</h3>{_p(m['product'])}</div><aside>
<div class="note"><strong>Вопрос клиенту на созвон</strong><p>{H(m['question'])}</p></div>
<div class="sources">{_source_links(m['sources'])}</div></aside></div></section>
{f'<section class="section" id="signals"><span class="eyebrow">ЕЩЕ СИГНАЛЫ НЕДЕЛИ</span>{short}</section>' if short else ''}
<section class="section" id="product"><span class="eyebrow">СВОДНАЯ ТАБЛИЦА ДЛЯ ПЕРЕДАЧИ В ПРОДУКТ</span><div class="table-wrap">{_table_html(issue['table'])}</div></section>
{f'<section class="section" id="noise"><span class="eyebrow">ЧТО ОТСЕЯЛИ КАК ШУМ</span><ul>{noise}</ul></section>' if noise else ''}
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
# Обложка выпуска в оформлении nowater.tech: уголь, один розовый акцент, заголовки весом 400,
# подписи прописными с разрядкой, прямые углы, тонкие линии. Те же значения, что в src/styles.css.
# Верстка для почты: таблицы, стили прямо на элементах, без картинок. Блок <style> и условные
# комментарии для классического Outlook - улучшения: если почтовая программа их вырежет,
# письмо читается так же. Manrope в почте чаще всего не загрузится, тогда работает системный шрифт.

BG, PANEL, INK, PROSE, SECOND, MUTED, ACCENT, LINE = (
    "#131417", "#1A1C21", "#EEF2F8", "#C7CCD5", "#A7ADB8", "#8C929D", "#E4A9CE", "#313336")
FONT = "Manrope,-apple-system,'Segoe UI',Arial,sans-serif"
TABLE = 'role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"'
MAIL_WIDTH, MAIL_PAD = 600, 24


def _font(size: int, line: int, weight: int = 400, color: str = INK, extra: str = "") -> str:
    return f"font-family:{FONT};font-size:{size}px;line-height:{line}px;font-weight:{weight};color:{color};{extra}"


def _caps(text: str, color: str = MUTED, top: int = 0, spacing: str = "0.11em") -> str:
    """Мелкая подпись прописными. Набрана прописными в тексте: text-transform почта может вырезать."""
    return f'<p style="margin:{top}px 0 0 0;{_font(11, 16, 600, color, f"letter-spacing:{spacing};")}">{H(text.upper())}</p>'


def _para(text: str, top: int = 10, size: int = 16, line: int = 26, color: str = PROSE) -> str:
    """Абзацы письма. Перевод строки в тексте выпуска начинает новый абзац."""
    return "".join(f'<p style="margin:{top if i == 0 else 12}px 0 0 0;{_font(size, line, 400, color)}">{H(part)}</p>'
                   for i, part in enumerate(_lines(text)))


def _zone(inner: str, *, top: int = 30, bottom: int = 32, rule: bool = True) -> str:
    """Зона письма во всю ширину с полями и тонкой линией сверху."""
    border = f"border-top:1px solid {LINE};" if rule else ""
    return (f'<table {TABLE}><tr><td style="padding:0 {MAIL_PAD}px;"><table {TABLE}><tr>'
            f'<td style="{border}padding:{top}px 0 {bottom}px 0;">{inner}</td></tr></table></td></tr></table>')


def _count(n: int, one: str, few: str, many: str) -> str:
    """1 сигнал, 3 сигнала, 5 сигналов."""
    if n % 10 == 1 and n % 100 != 11:
        return one
    return few if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else many


def _mail_sources(sources: list[dict[str, str]]) -> str:
    links = ", ".join(
        f'<a href="{H(s["url"], quote=True)}" target="_blank" style="color:{ACCENT};text-decoration:underline;">{H(s["title"])}</a>, {H(s["date"])}'
        for s in sources)
    return f'<p style="margin:12px 0 0 0;{_font(13, 21, 400, MUTED)}">Источник: {links}</p>'


def mail(issue: dict[str, Any]) -> dict[str, str]:
    m, url, signals = issue["main"], issue["url"], issue["signals"]
    period = f"{issue['start']:%d.%m}-{issue['end']:%d.%m.%Y}"
    total, ideas, skipped = 1 + len(signals), len(issue["table"]), len(issue["noise"])
    facts = [(total, _count(total, "сигнал недели", "сигнала недели", "сигналов недели")),
             (ideas, _count(ideas, "идея для Продукта", "идеи для Продукта", "идей для Продукта"))]
    if skipped:
        facts.append((skipped, _count(skipped, "тема в шуме", "темы в шуме", "тем в шуме")))
    more = (f"еще {len(signals)} {_count(len(signals), 'сигнал', 'сигнала', 'сигналов')}, " if signals else "")
    preheader = issue["preheader"] or f"Главный сигнал: {m['title']}. На странице {more}таблица для Продукта"

    def link(anchor: str, label: str, style: str) -> str:
        return f'<a href="{url}#{anchor}" target="_blank" style="{style}">{label}</a>'

    # --- шапка и навигация по разделам страницы ---
    nav = [("main", "Главный сигнал")] + ([("signals", "Еще сигналы")] if signals else []) + [("product", "Для Продукта")]
    nav += [("noise", "Шум")] if skipped else []
    slash = f' <span style="color:{LINE};">/</span> '  # обычные пробелы: строка переносится между пунктами
    header = (
        f'<table {TABLE}><tr><td style="padding:0 {MAIL_PAD}px;"><table {TABLE}><tr>'
        f'<td style="padding:20px 0 18px 0;{_font(13, 20, 800, INK, "letter-spacing:0.02em;")}">NOWATER.TECH</td>'
        f'<td align="right" style="padding:20px 0 18px 0;{_font(12, 20, 600, MUTED)}">AI-радар</td></tr></table>'
        f'<table {TABLE}><tr><td style="border-top:1px solid {LINE};border-bottom:1px solid {LINE};padding:11px 0 12px 0;">'
        f'<p style="margin:0;{_font(12, 20, 600, SECOND)}">'
        + slash.join(link(a, t, f"color:{SECOND};text-decoration:none;white-space:nowrap;") for a, t in nav)
        + "</p></td></tr></table></td></tr></table>")

    # --- первый экран: что за выпуск и каков его объем ---
    cells = "".join(
        f'<td width="{100 // len(facts)}%" valign="top" style="padding:0 {0 if i == len(facts) - 1 else 12}px 0 0;">'
        f'<table {TABLE}><tr><td style="border-top:2px solid {ACCENT};padding:12px 0 0 0;">'
        f'<p style="margin:0;{_font(30, 34, 400, INK)}">{n}</p>{_caps(label, top=4)}</td></tr></table></td>'
        for i, (n, label) in enumerate(facts))
    hero = _zone(
        _caps(f"AI-радар / {issue['audience']} / {period}", spacing="0.15em")
        + f'<h1 class="rh1" style="margin:18px 0 0 0;{_font(34, 38, 400, INK, "letter-spacing:-0.02em;")}">{H(issue["subject"])}</h1>'
        + f'<table {TABLE} style="margin-top:28px;"><tr>{cells}</tr></table>',
        top=30, bottom=30, rule=False)

    # --- главный вывод: отдельная плашка ---
    summary = (f'<table {TABLE}><tr><td style="padding:0 {MAIL_PAD}px 30px {MAIL_PAD}px;"><table {TABLE}><tr>'
               f'<td bgcolor="{PANEL}" style="background-color:{PANEL};padding:22px 22px 24px 22px;">'
               + _caps("Главный вывод недели") + _para(issue["summary"], top=10, size=17, line=27, color=INK)
               + "</td></tr></table></td></tr></table>")

    # --- главный сигнал целиком ---
    question = (f'<table {TABLE} style="margin-top:14px;"><tr>'
                f'<td width="2" bgcolor="{ACCENT}" style="background-color:{ACCENT};width:2px;font-size:0;line-height:0;">&nbsp;</td>'
                f'<td bgcolor="{PANEL}" style="background-color:{PANEL};padding:18px 20px 20px 20px;">'
                + _caps("Вопрос клиенту на созвон", ACCENT) + _para(m["question"], top=8, size=19, line=27, color=INK)
                + "</td></tr></table>")
    main = _zone(
        f'<table {TABLE}><tr><td width="34" valign="top" style="width:34px;{_font(12, 16, 600, ACCENT)}">01</td>'
        f'<td valign="top">{_caps("Главный сигнал недели", spacing="0.15em")}</td></tr></table>'
        + f'<h2 style="margin:14px 0 0 0;{_font(27, 32, 400, INK, "letter-spacing:-0.02em;")}">{H(m["title"])}</h2>'
        + _caps("Что происходит", top=26) + _para(m["what"]) + _mail_sources(m["sources"])
        + f'<table {TABLE} style="margin-top:26px;"><tr><td style="border-top:1px solid {LINE};padding:22px 0 0 0;">'
        + _caps("Почему это важно для выручки") + _para(m["why"]) + "</td></tr></table>"
        + f'<table {TABLE} style="margin-top:26px;"><tr><td bgcolor="{PANEL}" style="background-color:{PANEL};padding:20px 22px 22px 22px;">'
        + _caps("Что предложить Продукту") + _para(m["product"], color=INK) + "</td></tr></table>"
        + question)

    # --- карта остальных сигналов: строка ведет в свой раздел страницы ---
    rows = "".join(
        f'<table {TABLE}><tr><td width="34" valign="top" style="width:34px;border-top:1px solid {LINE};padding:19px 0 18px 0;{_font(12, 24, 600, ACCENT)}">{n:02d}</td>'
        f'<td valign="top" style="border-top:1px solid {LINE};padding:16px 0 18px 0;">'
        f'<p style="margin:0;{_font(18, 25, 400, INK)}">{link(f"signal-{n}", H(s["title"]), f"color:{INK};text-decoration:none;")}</p>'
        f'<p style="margin:5px 0 0 0;{_font(13, 20, 400, MUTED)}">{H(s["contour"])}</p></td>'
        f'<td width="24" valign="top" align="right" style="width:24px;border-top:1px solid {LINE};padding:16px 0 0 0;{_font(18, 25, 400, ACCENT)}">&rarr;</td></tr></table>'
        for n, s in enumerate(signals, 2))
    signal_map = _zone(_caps("Еще сигналы недели", spacing="0.15em") + f'<div style="margin-top:18px;">{rows}</div>',
                       bottom=14) if signals else ""

    # --- переход на страницу ---
    on_page = ([f"{len(signals)} {_count(len(signals), 'сигнал', 'сигнала', 'сигналов')} с источниками"] if signals else [])
    on_page.append(f"сводная таблица для Продукта на {ideas} {_count(ideas, 'идею', 'идеи', 'идей')} фич")
    if skipped:
        on_page.append(f"{skipped} {_count(skipped, 'тема', 'темы', 'тем')}, которые отсеяли как шум")
    on_page_text = "На странице выпуска: " + ", ".join(on_page) + "."
    button = (f'<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:18px;"><tr>'
              f'<td align="center" bgcolor="{ACCENT}" style="background-color:{ACCENT};mso-padding-alt:15px 26px;">'
              f'<a href="{url}" target="_blank" style="display:inline-block;padding:15px 26px;{_font(15, 20, 700, BG)}text-decoration:none;mso-padding-alt:0;">'
              f"Открыть выпуск на сайте &rarr;</a></td></tr></table>")
    cta = (f'<table {TABLE}><tr><td style="padding:14px {MAIL_PAD}px 34px {MAIL_PAD}px;"><table {TABLE}><tr>'
           f'<td bgcolor="{PANEL}" style="background-color:{PANEL};border-top:2px solid {ACCENT};padding:22px 22px 24px 22px;">'
           + _caps("Полный выпуск") + _para(on_page_text, top=8, size=15, line=24, color=SECOND) + button
           + f'<p style="margin:14px 0 0 0;{_font(12, 18, 400, MUTED, "word-break:break-all;")}">'
             f'<a href="{url}" target="_blank" style="color:{MUTED};text-decoration:underline;">{url}</a></p>'
           + "</td></tr></table></td></tr></table>")

    limits = _zone(_caps("Ограничения") + _para(issue["limits"], top=8, size=14, line=22, color=SECOND)) if issue["limits"] else ""
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
        f'<style>body{{margin:0;padding:0;background-color:{BG};}}h1,h2,p{{mso-line-height-rule:exactly;}}'
        f'@media only screen and (max-width:480px){{.rh1{{font-size:30px !important;line-height:34px !important;}}}}</style></head>'
        f'<body style="margin:0;padding:0;background-color:{BG};"><div lang="ru" dir="ltr" style="margin:0;padding:0;background-color:{BG};">{hidden}'
        f'<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" width="{MAIL_WIDTH}"><tr><td><![endif]-->'
        f'<div style="max-width:{MAIL_WIDTH}px;margin:0 auto;background-color:{BG};">'
        + header + hero + summary + main + signal_map + cta + limits + footer
        + "</div><!--[if mso]></td></tr></table><![endif]--></div></body></html>")

    text = [f"NOWATER.TECH / AI-радар / {issue['audience']} / {period}", "", issue["subject"], "",
            "Главный вывод недели", issue["summary"], "", f"Выпуск на сайте: {url}", "",
            f"Главный сигнал недели: {m['title']}", "",
            "Что происходит. " + "\n\n".join(_lines(m["what"])), "Источник: " + ", ".join(f"{s['title']}, {s['date']}, {s['url']}" for s in m["sources"]),
            "", "Почему это важно для выручки. " + "\n\n".join(_lines(m["why"])),
            "", "Что предложить Продукту. " + "\n\n".join(_lines(m["product"])), "",
            f"Вопрос клиенту на созвон. {m['question']}"]
    if signals:
        text += ["", "Еще сигналы недели"] + [f"{n:02d}. {s['title']} - {s['contour']}: {url}#signal-{n}" for n, s in enumerate(signals, 2)]
    text += ["", on_page_text, url]
    if issue["limits"]:
        text += ["", f"Ограничения. {issue['limits']}"]
    text += ["", SIGNATURE]
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
