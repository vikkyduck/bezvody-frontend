#!/usr/bin/python3 -I
"""Наблюдатель AI-радара на сервере nowater.tech: согласование выпуска через GitHub.

Раз в несколько минут смотрит в репозиторий сайта и сам нажимает кнопки шлюза (deploy/radar_gateway.py):

  выпуск лежит в ветке radar-issue/ПЕРИОД   -> страница публикуется, Виктории уходит контрольная копия.
                                               Новая правка в ветке - новая контрольная копия.
  выпуск влит в main (это "ок" Виктории)    -> письмо уходит адресатам, один раз.

Выпуск - папка radar/issues/ПЕРИОД с готовыми page.html и mail.json из radar/render.py. Наблюдатель
ничего не собирает и не запускает код из репозитория: он только читает два файла и передает их шлюзу.

Защита от отправки без согласования:
  - адресатам уходит только то письмо, которое уже уходило контрольной копией из ветки. Если в main
    оказалось другое письмо, оно уходит контрольной копией, а адресатам не уходит;
  - письмо периода уходит один раз, это держит шлюз;
  - выпуск старше 10 дней не трогается: старые папки в репозитории ничего не запускают.

Работает от пользователя radar, ставится deploy/setup-radar-watch.sh. Пароля почты и адресатов не видит.
"""

from __future__ import annotations

import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

PERIOD = re.compile(r"\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}")
REMOTE = "https://github.com/vikkyduck/bezvody-frontend"
REPO = Path(os.environ.get("RADAR_REPO", "/var/lib/nowater-radar/repo"))
STATE = Path(os.environ.get("RADAR_STATE", "/var/lib/nowater-radar/state"))
GATEWAY = os.environ.get("RADAR_GATEWAY", "/usr/local/sbin/nowater-radar")
FRESH_DAYS = 10


def git(*args: str, binary: bool = False):
    done = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, timeout=120)
    if done.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {done.stderr.decode('utf-8', 'replace').strip()}")
    return done.stdout if binary else done.stdout.decode("utf-8")


def fetch() -> None:
    if not (REPO / ".git").exists() and not (REPO / "HEAD").exists():
        REPO.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-q", "--bare", str(REPO)], check=True, timeout=60)
        git("remote", "add", "origin", os.environ.get("RADAR_REMOTE", REMOTE))
    git("fetch", "-q", "--prune", "--depth", "1", "origin",
        "+refs/heads/main:refs/remotes/origin/main", "+refs/heads/radar-issue/*:refs/remotes/origin/radar-issue/*")


def gateway(command: str, data: bytes = b"") -> tuple[bool, str]:
    done = subprocess.run([GATEWAY], input=data, capture_output=True, timeout=300, env={**os.environ, "SSH_ORIGINAL_COMMAND": command})
    return done.returncode == 0, (done.stdout + done.stderr).decode("utf-8", "replace").strip()


def digest(mail: bytes) -> str:
    """Тот же отпечаток письма, что считает шлюз."""
    data = json.loads(mail.decode("utf-8"))
    canonical = json.dumps({k: data[k] for k in ("subject", "html", "text")}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def fresh(period: str, today: dt.date) -> bool:
    try:
        end = dt.datetime.strptime(period.split("-")[1], "%d.%m.%y").date()
    except ValueError:
        return False
    return dt.timedelta(0) <= today - end <= dt.timedelta(days=FRESH_DAYS)


def issue(ref: str, period: str) -> tuple[bytes, bytes] | None:
    try:
        return (git("show", f"{ref}:radar/issues/{period}/page.html", binary=True),
                git("show", f"{ref}:radar/issues/{period}/mail.json", binary=True))
    except RuntimeError:
        return None


def mark(period: str, kind: str) -> Path:
    return STATE / f"{period}.{kind}"


def note(line: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"{stamp} {line}")
    with open(STATE / "watch.log", "a", encoding="utf-8") as handle:
        handle.write(f"{stamp} {line}\n")


def fingerprint(page: bytes, mail: bytes) -> str:
    """Отпечаток выпуска: письмо и страница вместе. Правка только страницы тоже считается новой версией."""
    return hashlib.sha256((digest(mail) + hashlib.sha256(page).hexdigest()).encode()).hexdigest()


def control_copy(period: str, page: bytes, mail: bytes, kind: str) -> bool:
    """Публикует страницу и отправляет контрольную копию. Отметка kind хранит отпечаток выпуска, чтобы не слать его дважды."""
    for command, data in ((f"publish {period}", page), (f"test {period}", mail)):
        ok, answer = gateway(command, data)
        note(f"{period}: {command.split()[0]} - {answer}")
        if not ok:
            return False
    mark(period, kind).write_text(fingerprint(page, mail))
    return True


def handle(period: str, approved: tuple[bytes, bytes] | None, draft: tuple[bytes, bytes] | None) -> None:
    read = lambda kind: mark(period, kind).read_text().strip() if mark(period, kind).exists() else ""
    seen = read("draft")  # последняя версия, которую Виктория получила контрольной копией из ветки
    if approved and fingerprint(*approved) == seen:
        ok, answer = gateway(f"send {period}", approved[1])
        note(f"{period}: send - {answer}")
        return
    # Версия из ветки показывается, только если она отличается от main: выпуск, влитый раньше, чем его
    # увидел наблюдатель, не должен уйти адресатам через ветку с тем же содержанием.
    if draft and fingerprint(*draft) != seen and (not approved or fingerprint(*draft) != fingerprint(*approved)):
        control_copy(period, *draft, "draft")
    elif approved and read("mismatch") != fingerprint(*approved):
        note(f"{period}: в main выпуск, который не уходил контрольной копией из ветки. Адресатам не отправляю, отправляю контрольную копию. "
             "Чтобы отправить адресатам, нужна правка в ветке radar-issue и новое слияние")
        control_copy(period, *approved, "mismatch")


def step(today: dt.date) -> None:
    refs = git("for-each-ref", "--format=%(refname)", "refs/remotes/origin").split()
    drafts = {ref.rsplit("/", 1)[1]: ref for ref in refs if "/radar-issue/" in ref and PERIOD.fullmatch(ref.rsplit("/", 1)[1])}
    listed = git("ls-tree", "--name-only", "refs/remotes/origin/main", "radar/issues/").split()
    merged = {path.rsplit("/", 1)[-1] for path in listed if PERIOD.fullmatch(path.rsplit("/", 1)[-1])}
    for period in sorted(set(drafts) | merged):
        if not fresh(period, today) or mark(period, "sent").exists() or mark(period, "sending").exists():
            continue
        try:  # сломанный выпуск одного периода не останавливает остальные
            handle(period, issue("refs/remotes/origin/main", period) if period in merged else None,
                   issue(drafts[period], period) if period in drafts else None)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            note(f"{period}: ошибка - {error}")


def main() -> int:
    STATE.mkdir(parents=True, exist_ok=True)
    with open(STATE / "watch.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 0
        try:
            fetch()
            step(dt.date.today())
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            note(f"ошибка: {error}")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
