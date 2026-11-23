#!/usr/bin/python3 -I
"""Шлюз AI-радара на сервере nowater.tech: Ева публикует выпуск и отправляет письмо,
не видя ни пароля почты, ни списка адресатов.

Работает от пользователя radar. Ставится deploy/setup-radar.sh в /usr/local/sbin/nowater-radar
и запускается как forced command из ключа Евы: никаких других команд по этому ключу выполнить
нельзя. Команда приходит в SSH_ORIGINAL_COMMAND, данные - потоком ввода:

  publish ПЕРИОД  < page.html   страница на https://nowater.tech/AI-radar/Avito/Goods/ПЕРИОД
  test ПЕРИОД     < mail.json   контрольная копия письма только на ящик отправителя
  send ПЕРИОД     < mail.json   письмо по списку адресатов, один раз
  status ПЕРИОД                 что уже сделано

ПЕРИОД - вида 17.11-23.11.26. send отправляет только то же письмо, что ушло контрольной копией:
Виктория видит в своем ящике ровно то, что получат адресаты. После send страница этого
периода не перезаписывается, а второе письмо не уходит. Если отправка прервалась и неясно,
ушло ли письмо, send не повторяется сам: сначала нужно посмотреть ящик (как снять отметку -
radar/README.md).
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import smtplib
import ssl
import sys
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path
from typing import BinaryIO, Callable

PERIOD = re.compile(r"\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}")
EMAIL = re.compile(r"[^@\s<>\"',]+@[^@\s<>\"',]+\.[a-zA-Z]{2,}")
URL = "https://nowater.tech/AI-radar/Avito/Goods/{}"
MAX_PAGE = 8 * 1024 * 1024
MAX_MAIL = 2 * 1024 * 1024


class GatewayError(Exception):
    """Команда не выполнена. Текст понятен человеку."""


class NotSent(GatewayError):
    """Письмо точно не ушло: почта отказала до передачи письма. Отправку можно повторить."""


@dataclass(frozen=True)
class Paths:
    config: Path = Path("/etc/nowater-radar")
    state: Path = Path("/var/lib/nowater-radar/state")
    pages: Path = Path("/var/www/nowater-reports/radar")

    def page(self, period: str) -> Path:
        return self.pages / f"avito-goods-{period}.html"

    def mark(self, period: str, kind: str) -> Path:
        return self.state / f"{period}.{kind}"


Sender = Callable[[dict, EmailMessage, list[str]], None]


def smtp_send(settings: dict, message: EmailMessage, to: list[str]) -> None:
    host, port = settings["host"], int(settings.get("port", 465))
    context = ssl.create_default_context()
    try:
        if port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, context=context, timeout=60)
        else:
            server = smtplib.SMTP(host, port, timeout=60)
            server.starttls(context=context)
    except (smtplib.SMTPException, OSError) as error:
        raise NotSent(f"не удалось подключиться к почтовому серверу {host}:{port}: {error}") from error
    with server:
        try:
            server.login(settings["user"], settings["password"])
        except smtplib.SMTPException as error:
            raise NotSent("почтовый сервер не принял логин или пароль приложения") from error
        try:
            server.send_message(message, to_addrs=to)
        except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as error:
            raise NotSent(f"почтовый сервер отказался принять письмо: {error}") from error
        except (smtplib.SMTPException, OSError) as error:
            raise GatewayError(f"письмо передавалось, но почтовый сервер оборвал разговор: {error}") from error


def read_limited(stream: BinaryIO, limit: int, what: str) -> bytes:
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise GatewayError(f"{what} больше {limit // (1024 * 1024)} МБ")
    if not data:
        raise GatewayError(f"{what}: пустой ввод")
    return data


def settings(paths: Paths) -> tuple[dict, list[str]]:
    try:
        mail = json.loads((paths.config / "mail.json").read_text(encoding="utf-8"))
        lines = (paths.config / "recipients.txt").read_text(encoding="utf-8").splitlines()
    except (OSError, ValueError) as error:
        raise GatewayError("настройки почты не прочитались, запустите deploy/setup-radar.sh") from error
    recipients = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]
    if not all(EMAIL.fullmatch(address) for address in recipients):
        raise GatewayError("в списке адресатов есть строка, которая не похожа на адрес почты")
    if not recipients:
        raise GatewayError("список адресатов пуст")
    if not all(mail.get(key) for key in ("host", "user", "password", "from")):
        raise GatewayError("в настройках почты не хватает сервера, пользователя, пароля или адреса отправителя")
    return mail, recipients


def letter(raw: bytes, period: str) -> tuple[dict, str]:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise GatewayError("письмо должно быть файлом mail.json из radar/render.py") from error
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) and data[k].strip() for k in ("subject", "html", "text")):
        raise GatewayError("в mail.json нужны тема, html и text")
    if "\n" in data["subject"] or "\r" in data["subject"] or len(data["subject"]) > 200:
        raise GatewayError("тема письма должна быть одной строкой до 200 знаков")
    url = URL.format(period)
    if data.get("period") != period or url not in data["text"] or url not in data["html"]:
        raise GatewayError(f"письмо собрано не для периода {period}: в нем нет ссылки {url}")
    canonical = json.dumps({k: data[k] for k in ("subject", "html", "text")}, ensure_ascii=False, sort_keys=True)
    return data, hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def message(mail: dict, data: dict, to: list[str]) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((mail.get("name") or "", mail["from"]))
    msg["To"] = ", ".join(to)
    msg["Subject"] = data["subject"]
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=mail["from"].rsplit("@", 1)[1])
    msg.set_content(data["text"])
    msg.add_alternative(data["html"], subtype="html")
    return msg


def write_atomic(target: Path, data: bytes, mode: int) -> None:
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    with open(temporary, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, mode)
    os.replace(temporary, target)


def log(paths: Paths, **entry: object) -> None:
    entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **entry}
    with open(paths.state / "log", "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def run(command: str, stdin: BinaryIO, paths: Paths, send: Sender = smtp_send) -> str:
    words = command.split()
    if len(words) != 2 or words[0] not in ("publish", "test", "send", "status") or not PERIOD.fullmatch(words[1]):
        raise GatewayError("команды: publish | test | send | status ПЕРИОД, например publish 17.11-23.11.26")
    action, period = words
    url = URL.format(period)
    with open(paths.state / "lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        sent, sending = paths.mark(period, "sent"), paths.mark(period, "sending")

        if action == "status":
            def when(path: Path) -> str:
                return time.strftime("%d.%m.%Y %H:%M", time.localtime(path.stat().st_mtime)) if path.exists() else "нет"
            return "\n".join([
                f"страница {url}: {when(paths.page(period))}",
                f"контрольная копия: {when(paths.mark(period, 'test'))}",
                f"письмо адресатам: {when(sent)}" + (" (отправка прервалась, проверьте ящик)" if sending.exists() else ""),
            ])

        if action == "publish":
            if sent.exists() or sending.exists():
                raise GatewayError("письмо этого периода уже отправлено, страницу после отправки не меняем")
            page = read_limited(stdin, MAX_PAGE, "страница")
            text = page.decode("utf-8")
            if not text.lstrip().lower().startswith("<!doctype html") or "NOWATER:BRAND:BEGIN" not in text:
                raise GatewayError("это не страница из radar/render.py: нет оформления nowater.tech")
            write_atomic(paths.page(period), page, 0o644)
            log(paths, action="publish", period=period, sha256=hashlib.sha256(page).hexdigest(), bytes=len(page))
            return f"опубликовано: {url}"

        data, digest = letter(read_limited(stdin, MAX_MAIL, "письмо"), period)
        if not paths.page(period).exists():
            raise GatewayError(f"сначала опубликуйте страницу: publish {period}")
        mail, recipients = settings(paths)

        if action == "test":
            send(mail, message(mail, data, [mail["from"]]), [mail["from"]])
            write_atomic(paths.mark(period, "test"), digest.encode(), 0o600)
            log(paths, action="test", period=period, sha256=digest, to=mail["from"])
            return f"контрольная копия отправлена на {mail['from']}"

        if sent.exists():
            raise GatewayError("письмо этого периода уже отправлено, второй раз не отправляем")
        if sending.exists():
            raise GatewayError("прошлая отправка прервалась, и неизвестно, ушло ли письмо. Проверьте ящик отправителя")
        tested = paths.mark(period, "test")
        if not tested.exists() or tested.read_text().strip() != digest:
            raise GatewayError("это письмо еще не уходило контрольной копией. Сначала test, потом согласование, потом send")
        write_atomic(sending, digest.encode(), 0o600)
        # Копия отправителю скрытая: так у Виктории в ящике остается письмо в том виде, в каком его получили.
        try:
            send(mail, message(mail, data, recipients), recipients + [mail["from"]])
        except NotSent:
            sending.unlink()
            raise
        write_atomic(sent, digest.encode(), 0o600)
        sending.unlink()
        log(paths, action="send", period=period, sha256=digest, recipients=len(recipients))
        return f"письмо отправлено адресатам: {len(recipients)}, копия на {mail['from']}"


def main() -> int:
    try:
        print(run(os.environ.get("SSH_ORIGINAL_COMMAND", ""), sys.stdin.buffer, Paths()))
        return 0
    except GatewayError as error:
        print(f"ошибка: {error}", file=sys.stderr)
        return 1
    except UnicodeDecodeError:
        print("ошибка: страница должна быть в кодировке UTF-8", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
