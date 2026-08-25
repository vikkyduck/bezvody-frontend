/**
 * Письмо клиенту своими руками: SMTP поверх TLS. Только сервер.
 *
 * Почему без готового пакета. В этом доме протоколы пишут руками — так уже
 * сделаны разбор zip и Office-форматов (server-office), сборка xlsx
 * (server-xlsx), подпись JWT и multipart для Диска (server-google). Причина
 * не в спортивном интересе: почтовая библиотека тянет за собой десятки чужих
 * зависимостей и обновлений, а нужны от неё девять команд и правильно
 * склеенный конверт. Здесь это один файл, который читается целиком за
 * четверть часа, и обновлять в нём нечего.
 *
 * Почему порт 465, а не 587. На 465 соединение зашифровано с первого байта
 * (implicit TLS): открыли сокет — уже говорим по TLS, пароль иначе как в
 * шифре уйти не может. На 587 разговор начинается открытым, и только команда
 * STARTTLS переводит его в шифр. Беда в том, что наивный клиент, не получив
 * на STARTTLS согласия, спокойно продолжает в открытую и отдаёт пароль в
 * эфир, — а чтобы этого не случилось, нужна отдельная ветка кода с отдельной
 * проверкой, и ошибка в ней ничем себя не проявит: письма-то ходят. 465 умеют
 * все живые провайдеры (Яндекс 360, Mail.ru, российские хостинги), поэтому
 * берём его: меньше кода — меньше мест, где протечёт пароль. Понадобится 587 —
 * добавлять STARTTLS осознанно и с проверкой ответа, а не «заодно».
 *
 * Отсюда наружу пароль не уходит никогда: ни в возвращаемое значение, ни в
 * журнал, ни хвостом. С ключами моделей в этом проекте так же.
 *
 * Ничего не бросает: у отправки письма нет права уронить сборку разбора.
 * Возвращает { ok, note }, где note — человеческие слова для клиента.
 */
import type { ConnectionOptions, TLSSocket } from "node:tls";

/** Вложение: имя файла, содержимое в base64 и тип. */
export type MailAttachment = { name: string; base64: string; mime: string };

export type MailRequest = {
  to: string;
  subject: string;
  text: string;
  /**
   * `| undefined` дописано не для красоты: в проекте включён
   * exactOptionalPropertyTypes, и без него ведущий не смог бы написать
   * `{ ..., attachment: мойФайлИлиНичего }` — пришлось бы городить два вызова.
   */
  attachment?: MailAttachment | undefined;
};

export type MailResult = { ok: boolean; note: string };

/** Настройки ящика. Наружу не отдаются: внутри пароль. */
type MailConfig = { host: string; port: number; user: string; pass: string; from: string };

const CRLF = "\r\n";

/**
 * Сроки ожидания. Стоят на каждом шаге отдельно, потому что шаги разные:
 * приветствие приходит сразу, а после точки конца письма сервер может
 * молча думать минуту — там антивирус и антиспам читают вложение.
 */
const GREETING_MS = 30_000;
const STEP_MS = 30_000;
const DELIVERY_MS = 120_000;

// ── Настройки ────────────────────────────────────────────────────────────────

type MailSecret = {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  /** Адрес отправителя: «Без Воды <hello@…>» или просто адрес */
  from?: string;
};

/**
 * Читаем тот же secrets.json, что и ключи моделей, — свою ветку `mail`.
 * Через readJson из server-data, а не своим fs: там уже решено, что
 * отсутствующий файл — это пустые настройки, а не падение. Импорт
 * динамический: иначе node:fs уедет в браузерный бандл.
 */
async function readMailConfig(): Promise<MailConfig | null> {
  const { dataDir, readJson } = await import("./server-data");
  const raw = await readJson<{ mail?: MailSecret }>(`${dataDir()}/secrets.json`, {});
  const mail = raw.mail ?? {};

  // Запасной путь через переменные окружения — как у ключей провайдеров.
  const host = (mail.host ?? process.env["BV_MAIL_HOST"] ?? "").trim();
  const user = (mail.user ?? process.env["BV_MAIL_USER"] ?? "").trim();
  const pass = mail.pass ?? process.env["BV_MAIL_PASS"] ?? "";
  const port = Number(mail.port ?? process.env["BV_MAIL_PORT"] ?? 465) || 465;
  const from = (mail.from ?? process.env["BV_MAIL_FROM"] ?? "").trim() || user;

  // Ящик без пароля — это не «почти настроено», это не настроено.
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from };
}

/** Настроена ли почта. Ответ — да или нет, никаких подробностей наружу. */
export async function mailConfigured(): Promise<boolean> {
  try {
    return (await readMailConfig()) !== null;
  } catch {
    return false;
  }
}

// ── Заголовки и конверт ──────────────────────────────────────────────────────

/**
 * Адрес без имени. В конверт SMTP (MAIL FROM / RCPT TO) идёт только он:
 * красивое «Без Воды <hello@…>» там не принимают, а ошибка выглядит как
 * «сервер отверг адрес» — и ищут её потом не в той стороне.
 */
function addressOf(value: string): string {
  const m = /<([^>]*)>/.exec(value);
  return (m?.[1] ?? value).trim();
}

function looksLikeAddress(value: string): boolean {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);
}

/**
 * Ни в один заголовок не должен попасть перевод строки. Иначе тема письма,
 * пришедшая из формы, дописывает в письмо свои заголовки — это старая
 * дыра под названием header injection, и закрывается она вот этой строчкой.
 */
function oneLine(value: string): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * Кириллица в заголовке по RFC 2047: =?UTF-8?B?…?=
 *
 * Режем по 39 байт на слово: 39 байт (ровно 13 троек, без добивки) дают
 * 52 знака base64, плюс 12 на обёртку — 64 знака. Почему не 45, хотя предел
 * для слова 75: на первой строке перед словом стоит ещё и имя заголовка,
 * и с «Subject: » строка вылезала за положенные письмам 78 знаков — поймали
 * это ровно на такой проверке. Режем по символам, а не по байтам:
 * разорванная посередине буква приезжает получателю вопросиками.
 */
function encodeHeaderText(value: string): string {
  const clean = oneLine(value);
  if (!/[^\u0020-\u007E]/.test(clean)) return clean;

  const words: string[] = [];
  let chunk: Buffer[] = [];
  let size = 0;
  const flush = () => {
    if (!size) return;
    words.push(`=?UTF-8?B?${Buffer.concat(chunk).toString("base64")}?=`);
    chunk = [];
    size = 0;
  };
  for (const ch of clean) {
    const bytes = Buffer.from(ch, "utf8");
    if (size + bytes.length > 39) flush();
    chunk.push(bytes);
    size += bytes.length;
  }
  flush();
  // Длинный заголовок сворачивается переводом строки с пробелом в начале.
  return words.join(`${CRLF} `);
}

/**
 * «Имя <адрес>» для заголовка: имя кодируем, адрес оставляем как есть.
 *
 * Имя есть только тогда, когда были угловые скобки. Без этой проверки голый
 * адрес назначал сам себя именем, и в письме стояло
 * `To: "client@mail.ru" <client@mail.ru>` — не ошибка, но выглядит глупо.
 */
function encodeMailbox(value: string): string {
  const addr = addressOf(value);
  const name = /<[^>]*>/.test(value)
    ? oneLine(value.replace(/<[^>]*>/, ""))
        .replace(/^"|"$/g, "")
        .trim()
    : "";
  if (!name) return addr;
  const shown = /[^\u0020-\u007E]/.test(name)
    ? encodeHeaderText(name)
    : `"${name.replace(/["\\]/g, "")}"`;
  return `${shown} <${addr}>`;
}

/**
 * Дата в виде, положенном письмам. toUTCString даёт почти его, но с «GMT»
 * на конце, а полагается числовое смещение. Меняем хвост — свой календарь
 * с русскими месяцами тут не нужен, в письмах месяцы английские.
 */
function mailDate(when: Date): string {
  return when.toUTCString().replace(/GMT$/, "+0000");
}

/** base64 переносим по 76 знаков: длинные строки почтовые узлы режут сами. */
function wrap76(b64: string): string {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.join(CRLF);
}

/** Имя файла в заголовке: ASCII-запаска для старых почтовиков плюс UTF-8 по RFC 5987. */
function filenameParams(name: string): string {
  const clean = oneLine(name) || "file";
  const ascii = clean.replace(/[^\u0020-\u007E]/g, "_").replace(/["\\;]/g, "_");
  const utf8 = encodeURIComponent(clean).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * Экранирование точки в начале строки — «dot stuffing».
 *
 * Письмо кончается строкой из одной точки, поэтому любая строка самого
 * письма, начинающаяся с точки, обязана уехать удвоенной. Без этого бывает
 * две беды, и обе проверены на поддельном сервере: строка ровно из точки
 * обрывает письмо посередине (сервер при этом бодро отвечает «принято», и
 * клиент получает половину), а строка вида «.Разбор» приезжает без первой
 * точки — приёмник снимает её сам, так велит RFC 5321.
 *
 * Сейчас всё тело у нас в base64, где точка в начале строки не заводится, —
 * экранирование стоит здесь ровно потому, что кодировку однажды поменяют,
 * а обрыв писем посередине ищут долго.
 */
function dotStuff(message: string): string {
  return message
    .split(CRLF)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join(CRLF);
}

/** Чужой base64 бывает с переносами и с приставкой data: — приводим к делу. */
function cleanBase64(raw: string): string | null {
  const clean = String(raw ?? "")
    .replace(/^data:[^,]*,/, "")
    .replace(/\s+/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) return null;
  return clean;
}

/**
 * Всё письмо целиком.
 *
 * Всегда multipart/mixed, даже когда вложения нет: одна дорога вместо двух,
 * и не приходится гадать, какая из них протухла. Заголовки закодированы,
 * тела в base64 — то есть письмо получается чистым ASCII и проходит через
 * узлы, которые до сих пор не умеют 8 бит.
 */
function buildMessage(args: {
  from: string;
  to: string;
  subject: string;
  text: string;
  attachment?: MailAttachment | undefined;
  id: string;
  boundary: string;
  date: Date;
}): string {
  const lines = [
    `From: ${encodeMailbox(args.from)}`,
    `To: ${encodeMailbox(args.to)}`,
    `Subject: ${encodeHeaderText(args.subject)}`,
    `Date: ${mailDate(args.date)}`,
    `Message-ID: ${args.id}`,
    "MIME-Version: 1.0",
    // Заголовок сворачиваем: строка с продолжением начинается с пробела.
    // Письмам положено укладываться в 78 знаков в строке, и заголовок с
    // границей частей — первый, кто из них вылезает.
    "Content-Type: multipart/mixed;",
    ` boundary="${args.boundary}"`,
    "",
    // Это видят только почтовики, не умеющие MIME. По-английски и без букв
    // сверх ASCII — здесь ещё не объявлена кодировка.
    "This is a multi-part message in MIME format.",
    "",
    `--${args.boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(args.text ?? "", "utf8").toString("base64")),
  ];

  if (args.attachment) {
    const body = cleanBase64(args.attachment.base64) ?? "";
    // Тип чистим от кавычек и точек с запятой: он приезжает извне и стоит
    // в заголовке рядом с именем файла.
    const mime =
      oneLine(args.attachment.mime).replace(/[^\w.+/-]/g, "") || "application/octet-stream";
    const ascii = (oneLine(args.attachment.name) || "file")
      .replace(/[^\u0020-\u007E]/g, "_")
      .replace(/["\\;]/g, "_");
    lines.push(
      `--${args.boundary}`,
      `Content-Type: ${mime};`,
      ` name="${ascii}"`,
      "Content-Transfer-Encoding: base64",
      "Content-Disposition: attachment;",
      ` ${filenameParams(args.attachment.name)}`,
      "",
      wrap76(body),
    );
  }

  lines.push(`--${args.boundary}--`, "");
  return lines.join(CRLF);
}

// ── Разговор с сервером ──────────────────────────────────────────────────────

/** Ошибка, у которой уже есть человеческое объяснение для клиента. */
class MailFail extends Error {
  readonly note: string;
  constructor(note: string, detail?: string) {
    super(detail ?? note);
    this.name = "MailFail";
    this.note = note;
  }
}

type Reply = { code: number; text: string };

/**
 * Один ответ сервера из накопленного. Ответ бывает многострочным:
 * продолжение помечено дефисом после кода (`250-PIPELINING`), последняя
 * строка — пробелом (`250 HELP`). Пока не пришла последняя, ответа нет.
 */
function takeReply(buffer: string): { reply: Reply; rest: string } | null {
  let at = 0;
  const collected: string[] = [];
  for (;;) {
    const end = buffer.indexOf(CRLF, at);
    if (end < 0) return null;
    const line = buffer.slice(at, end);
    at = end + CRLF.length;

    const m = /^(\d{3})([ -]?)(.*)$/.exec(line);
    if (!m) {
      // Не SMTP вовсе. Отдаём кодом 0 — выше это станет честным отказом,
      // а не молчаливым ожиданием до самого срока.
      return { reply: { code: 0, text: line }, rest: buffer.slice(at) };
    }
    collected.push(m[3] ?? "");
    if (m[2] !== "-") {
      return {
        reply: { code: Number(m[1]), text: collected.join("\n") },
        rest: buffer.slice(at),
      };
    }
  }
}

type Session = {
  /** Ждём ответ, каким бы он ни был. Молчание дольше срока — отказ. */
  expectAny: (step: string, ms: number) => Promise<Reply>;
  /** Ждём ответ и проверяем код. Не тот код — отказ с готовыми словами. */
  expect: (step: string, ms: number, ok: number[], note: string) => Promise<Reply>;
  /** Строка команды. Пароль сюда попадает — поэтому здесь ничего не пишут в журнал. */
  say: (line: string) => Promise<void>;
  write: (chunk: string) => Promise<void>;
};

function talk(socket: TLSSocket): Session {
  let buffer = "";
  const ready: Reply[] = [];
  let broken: Error | null = null;
  let wake: (() => void) | null = null;

  const pump = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const taken = takeReply(buffer);
      if (!taken) break;
      buffer = taken.rest;
      ready.push(taken.reply);
    }
    pump();
  });
  // Слушатель ошибки нужен постоянный: сокет без него роняет весь процесс
  // необработанным исключением — и это будет не «письмо не ушло», а падение
  // всей платформы из-за чужого почтового сервера.
  socket.on("error", (e: Error) => {
    broken = broken ?? e;
    pump();
  });
  socket.on("close", () => {
    broken = broken ?? new Error("соединение закрыто");
    pump();
  });

  /** true — разбудили ответом, false — вышел срок. */
  const waitAwhile = (ms: number) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve(false);
      }, ms);
      wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });

  const expectAny = async (step: string, ms: number): Promise<Reply> => {
    for (;;) {
      const next = ready.shift();
      if (next) return next;
      if (broken) throw humanError(broken, step);
      if (!(await waitAwhile(ms))) {
        throw new MailFail("сервер почты не ответил", `${step}: тишина ${Math.round(ms / 1000)} с`);
      }
    }
  };

  const expect = async (step: string, ms: number, ok: number[], note: string): Promise<Reply> => {
    const reply = await expectAny(step, ms);
    if (ok.includes(reply.code)) return reply;
    throw new MailFail(
      note,
      `${step}: сервер ответил ${reply.code} ${reply.text.replace(/\s+/g, " ").slice(0, 200)}`,
    );
  };

  /** Пишем и, если сокет захлебнулся, ждём, пока разгребёт: вложение бывает крупным. */
  const write = (chunk: string) =>
    new Promise<void>((resolve) => {
      if (socket.write(chunk)) resolve();
      else socket.once("drain", () => resolve());
    });

  return { expectAny, expect, say: (line) => write(line + CRLF), write };
}

/** Ошибка сокета человеческими словами. Коды у Node говорящие, грех не воспользоваться. */
function humanError(e: unknown, step: string): MailFail {
  const err = e as { code?: string; message?: string };
  const code = String(err?.code ?? "");
  const detail = `${step}: ${code || err?.message || "неизвестная ошибка"}`;

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new MailFail("почтовый сервер не нашёлся по имени — проверьте адрес сервера", detail);
  }
  if (code === "ECONNREFUSED") return new MailFail("почтовый сервер не принял соединение", detail);
  if (code === "ETIMEDOUT" || code === "ECONNRESET") {
    return new MailFail("сервер почты не ответил", detail);
  }
  if (code.startsWith("ERR_TLS") || /CERT|SELF_SIGNED|VERIFY/i.test(code)) {
    return new MailFail("сертификат почтового сервера не прошёл проверку", detail);
  }
  return new MailFail("письмо отправить не удалось", detail);
}

// ── Отправка ─────────────────────────────────────────────────────────────────

async function deliver(cfg: MailConfig, req: MailRequest): Promise<MailResult> {
  const tls = await import("node:tls");
  const { randomUUID } = await import("node:crypto");

  // В конверт — голый адрес, в заголовок — как передали: если ведущий подставит
  // «Мария <maria@…>», клиент увидит в письме своё имя.
  const shown = oneLine(req.to);
  const to = addressOf(shown);
  if (!looksLikeAddress(to)) return { ok: false, note: "адрес получателя не похож на почтовый" };

  const fromAddr = addressOf(cfg.from);
  if (!looksLikeAddress(fromAddr)) {
    return { ok: false, note: "в настройках почты неверный адрес отправителя" };
  }

  if (req.attachment && !cleanBase64(req.attachment.base64)) {
    return { ok: false, note: "вложение не удалось прочитать — файл собрался испорченным" };
  }

  const domain = fromAddr.split("@")[1] || "localhost";
  const message = buildMessage({
    from: cfg.from,
    to: shown,
    subject: req.subject,
    text: req.text,
    attachment: req.attachment,
    id: `<${randomUUID()}@${domain}>`,
    // Граница должна быть заведомо не встречающейся в теле — случайных
    // 80 бит для этого с большим запасом хватает.
    boundary: `----bv-${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    date: new Date(),
  });

  const options: ConnectionOptions = {
    host: cfg.host,
    port: cfg.port,
    // Проверка сертификата включена — и должна быть включена. Выключить её
    // значит согласиться отдать пароль от ящика первому, кто встанет
    // посередине: implicit TLS без проверки имени защищает ровно ни от чего.
    // Отключение оставлено только под переменной окружения и только для
    // проверки на поддельном сервере с самоподписанным сертификатом.
    rejectUnauthorized: process.env["BV_MAIL_INSECURE_TLS"] !== "1",
  };
  // SNI-имя ставим только для настоящего имени: с IP-адресом Node отказывается
  // открывать соединение вовсе.
  if (!/^[\d.]+$/.test(cfg.host) && !cfg.host.includes(":")) options.servername = cfg.host;

  const socket = tls.connect(options);
  const session = talk(socket);

  try {
    // Отдельного ожидания рукопожатия нет намеренно: приветствие сервера всё
    // равно не придёт раньше, а сорванный TLS прилетит сюда же ошибкой сокета.
    await session.expect("приветствие", GREETING_MS, [220], "почтовый сервер не поздоровался");

    await session.say(`EHLO ${domain}`);
    let hello = await session.expectAny("EHLO", STEP_MS);
    if (hello.code !== 250) {
      // Древние и самодельные серверы EHLO не понимают — здороваемся по-старому.
      await session.say(`HELO ${domain}`);
      hello = await session.expect("HELO", STEP_MS, [250], "почтовый сервер не поздоровался");
    }
    const caps = hello.text.toUpperCase();

    // AUTH LOGIN — тот способ, который понимают все. PLAIN берём, только если
    // сервер прямо сказал, что LOGIN у него нет.
    const plainOnly = /AUTH[^\n]*PLAIN/.test(caps) && !/AUTH[^\n]*LOGIN/.test(caps);
    const badPass = "почтовый сервер не принял логин или пароль";
    if (plainOnly) {
      const token = Buffer.from(`\0${cfg.user}\0${cfg.pass}`, "utf8").toString("base64");
      await session.say(`AUTH PLAIN ${token}`);
      await session.expect("вход", STEP_MS, [235], badPass);
    } else {
      await session.say("AUTH LOGIN");
      await session.expect("вход", STEP_MS, [334], badPass);
      await session.say(Buffer.from(cfg.user, "utf8").toString("base64"));
      await session.expect("имя пользователя", STEP_MS, [334], badPass);
      await session.say(Buffer.from(cfg.pass, "utf8").toString("base64"));
      await session.expect("пароль", STEP_MS, [235], badPass);
    }

    await session.say(`MAIL FROM:<${fromAddr}>`);
    await session.expect("отправитель", STEP_MS, [250, 251], "сервер отверг адрес отправителя");

    await session.say(`RCPT TO:<${to}>`);
    await session.expect("получатель", STEP_MS, [250, 251], "сервер отверг адрес");

    await session.say("DATA");
    await session.expect("DATA", STEP_MS, [354], "сервер не принял письмо к передаче");

    // Точка на отдельной строке — конец письма. Всё, что до неё, прошло
    // через экранирование точек.
    await session.write(`${dotStuff(message)}.${CRLF}`);
    await session.expect("письмо", DELIVERY_MS, [250, 251], "сервер отказался принять письмо");

    // QUIT говорим из вежливости и ответа особо не ждём: письмо уже принято,
    // и оборванное прощание ничего не отменяет.
    await session.say("QUIT");
    await session.expectAny("QUIT", 5_000).catch(() => undefined);

    return { ok: true, note: `письмо отправлено на ${to}` };
  } finally {
    // Сокет закрываем всегда. Это и есть ответ на «зависший сокет не должен
    // держать процесс»: какой бы ошибкой ни кончился разговор, открытых
    // соединений и живых таймеров после нас не остаётся.
    socket.destroy();
  }
}

/**
 * Отправить письмо. Не бросает никогда — что бы ни случилось, возвращает
 * { ok, note }, и note написана словами, которые можно показать клиенту.
 */
export async function sendMailServerSide(req: MailRequest): Promise<MailResult> {
  try {
    const cfg = await readMailConfig();
    if (!cfg) return { ok: false, note: "почта не настроена" };
    return await deliver(cfg, req);
  } catch (e) {
    const fail = e instanceof MailFail ? e : humanError(e, "отправка");
    // В журнал — подробность для владелицы, наружу — только человеческие
    // слова. Пароля нет ни там, ни там: он не попадает ни в одно сообщение.
    console.warn(`[почта] не отправлено: ${fail.message}`);
    return { ok: false, note: fail.note };
  }
}
