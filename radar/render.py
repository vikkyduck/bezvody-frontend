#!/usr/bin/env python3
"""Выпуск AI-радара Авито Товаров: страница для nowater.tech и письмо из одного файла JSON.

    python3 -I radar/render.py ВЫПУСК.json --out ПАПКА

В папке появятся:
  page.html          - страница выпуска, ее Ева присылает Виктории на просмотр и публикует шлюзом;
  mail.json          - тема, HTML и текст письма, их шлюз отправляет (radar/README.md);
  mail-preview.html  - письмо как HTML-файл, чтобы посмотреть его в браузере.

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


def _source_links(sources: list[dict[str, str]]) -> str:
    return "".join(
        f'<a href="{H(s["url"], quote=True)}" target="_blank" rel="noopener noreferrer">{H(s["title"])}, {H(s["date"])} ↗</a>'
        for s in sources)


def _table_html(rows: list[dict[str, str]], cell: str = "", head: str = "") -> str:
    names = ["Сигнал", "Сегмент селлеров", "Контур Авито", "Идея фичи", "Вопрос для проверки на клиентах"]
    keys = ["signal", "segment", "contour", "feature", "question"]
    top = "".join(f"<th{head}>{n}</th>" for n in names)
    body = "".join("<tr>" + "".join(f"<td{cell}>{H(r[k])}</td>" for k in keys) + "</tr>" for r in rows)
    return f"<table><tr>{top}</tr>{body}</table>"


def page(issue: dict[str, Any]) -> str:
    fonts = "".join(re.findall(r"@font-face\{[^}]*\}", FONTS_FROM.read_text(encoding="utf-8")))
    if not fonts:
        raise IssueError(f"в {FONTS_FROM.name} не нашлись шрифты Manrope для страницы")
    m = issue["main"]
    short = "".join(
        f'<article class="card"><span class="eyebrow">СИГНАЛ 0{n}</span><h3>{H(s["title"])}</h3><p>{H(s["text"])}</p>'
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
<h3>Что происходит</h3><p>{H(m['what'])}</p><h3>Почему это важно для выручки</h3><p>{H(m['why'])}</p>
<h3>Что предложить Продукту</h3><p>{H(m['product'])}</p></div><aside>
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

P = 'style="margin:0 0 14px;font:16px/1.55 Arial,sans-serif;color:#131417"'
H2 = 'style="margin:28px 0 10px;font:600 20px/1.3 Arial,sans-serif;color:#131417"'
CELL = ' style="border:1px solid #d5d7dc;padding:8px;font:14px/1.45 Arial,sans-serif;vertical-align:top;text-align:left"'
HEAD = ' style="border:1px solid #d5d7dc;padding:8px;font:600 14px/1.45 Arial,sans-serif;background:#f3f4f6;text-align:left"'


def _mail_sources(sources: list[dict[str, str]]) -> str:
    return "Источник: " + ", ".join(
        f'<a href="{H(s["url"], quote=True)}">{H(s["title"])}</a>, {H(s["date"])}' for s in sources)


def mail(issue: dict[str, Any]) -> dict[str, str]:
    m = issue["main"]
    parts = [
        f"<p {P}>{H(issue['summary'])}</p>",
        f'<p {P}>Выпуск на сайте: <a href="{issue["url"]}">{issue["url"]}</a></p>',
        f"<h2 {H2}>Главный сигнал недели: {H(m['title'])}</h2>",
        f"<p {P}><strong>Что происходит.</strong> {H(m['what'])}<br>{_mail_sources(m['sources'])}</p>",
        f"<p {P}><strong>Почему это важно для выручки.</strong> {H(m['why'])}</p>",
        f"<p {P}><strong>Что предложить Продукту.</strong> {H(m['product'])}</p>",
        f"<p {P}><strong>Вопрос клиенту на созвон.</strong> {H(m['question'])}</p>",
    ]
    text = [issue["summary"], "", f"Выпуск на сайте: {issue['url']}", "",
            f"Главный сигнал недели: {m['title']}", "",
            f"Что происходит. {m['what']}", "Источник: " + ", ".join(f"{s['title']}, {s['date']}, {s['url']}" for s in m["sources"]),
            "", f"Почему это важно для выручки. {m['why']}", "", f"Что предложить Продукту. {m['product']}", "",
            f"Вопрос клиенту на созвон. {m['question']}"]
    if issue["signals"]:
        parts.append(f"<h2 {H2}>Еще сигналы недели</h2>")
        text += ["", "Еще сигналы недели"]
        for s in issue["signals"]:
            parts.append(f"<p {P}><strong>{H(s['title'])}.</strong> {H(s['text'])} Контур Авито: {H(s['contour'])}. "
                         f"Идея фичи: {H(s['feature'])}<br>{_mail_sources(s['sources'])}</p>")
            text += ["", f"{s['title']}. {s['text']} Контур Авито: {s['contour']}. Идея фичи: {s['feature']}",
                     "Источник: " + ", ".join(f"{x['title']}, {x['date']}, {x['url']}" for x in s["sources"])]
    parts.append(f"<h2 {H2}>Сводная таблица для Продукта</h2>")
    parts.append(f'<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">'
                 f'{_table_html(issue["table"], CELL, HEAD)[len("<table>"):]}')
    text += ["", "Сводная таблица для Продукта"]
    for r in issue["table"]:
        text += [f"- {r['signal']} | {r['segment']} | {r['contour']} | {r['feature']} | {r['question']}"]
    if issue["noise"]:
        parts.append(f"<h2 {H2}>Что отсеяли как шум</h2><ul>"
                     + "".join(f'<li {P}>{H(x["topic"])} - {H(x["reason"])}</li>' for x in issue["noise"]) + "</ul>")
        text += ["", "Что отсеяли как шум"] + [f"- {x['topic']} - {x['reason']}" for x in issue["noise"]]
    if issue["limits"]:
        parts.append(f"<p {P}><strong>Ограничения.</strong> {H(issue['limits'])}</p>")
        text += ["", f"Ограничения. {issue['limits']}"]
    parts.append(f"<p {P}>{SIGNATURE}</p>")
    text += ["", SIGNATURE]
    body = ('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>' + H(issue["subject"]) + "</title></head>"
            '<body style="margin:0;padding:24px;background:#ffffff"><div style="max-width:720px">' + "".join(parts) + "</div></body></html>")
    return {"period": issue["slug"], "url": issue["url"], "subject": issue["subject"], "html": body, "text": "\n".join(text) + "\n"}


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
