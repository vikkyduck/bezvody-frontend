/**
 * Телеграм-бот платформы. Только сервер.
 *
 * Зачем он: руководителю неудобно открывать кабинет ради одного договора.
 * Документ у него уже в телеграме — пусть оттуда и уходит в работу, а разбор
 * возвращается туда же файлом. Кабинет остаётся местом, где видно всё; бот —
 * коротким путём «прислал — получил».
 *
 * Только личные чаты. В группе документ видят все, кто в неё добавлен, а мы
 * работаем с чужими договорами и цифрами — поэтому любое сообщение из группы
 * или канала бот молча пропускает мимо. Это условие владелицы, и оно
 * единственное здесь неотменяемое.
 *
 * Наружу к api.telegram.org ходим через настраиваемый адрес: с РФ-адреса
 * Timeweb прямой маршрут закрыт, и рабочая схема — прокси-воркер Cloudflare.
 * Адрес живёт в настройках (см. set-tg.sh), в коде его нет и быть не должно.
 */
import { createServerFn } from "@tanstack/react-start";

import {
  MAX_WINDOW_BYTES,
  MAX_WINDOW_FILES,
  humanSize,
  rejectReason,
  type StoredFile,
} from "./documents";
import { isProjectOpen } from "./projects";

// ── Настройки ─────────────────────────────────────────────────────────────────
// Лежат там же, где ключи моделей: ${BV_DATA_DIR}/secrets.json, права 600.
// Читаем с диска на каждый запрос — как и ключи: сервис перезапускать не нужно.

type TelegramSecret = {
  /** Токен бота от @BotFather. Наружу не отдаётся никогда */
  botToken?: string;
  /** Имя бота без собаки — из него собирается ссылка t.me */
  botName?: string;
  /** Базовый адрес API. По умолчанию сам Телеграм, на бою — прокси */
  apiBase?: string;
  /** Секрет вебхука: без него чужой POST на /tg/hook притворится Телеграмом */
  hookSecret?: string;
};

type SecretsFile = { telegram?: TelegramSecret };

export type TelegramSettings = {
  token: string;
  botName: string;
  apiBase: string;
  hookSecret: string;
};

const DEFAULT_API_BASE = "https://api.telegram.org";

async function settings(): Promise<TelegramSettings> {
  const { readJson, dataDir } = await import("./server-data");
  const raw = await readJson<SecretsFile>(`${dataDir()}/secrets.json`, {});
  const tg = raw.telegram ?? {};
  return {
    token: tg.botToken?.trim() || process.env["TELEGRAM_BOT_TOKEN"]?.trim() || "",
    botName: (tg.botName?.trim() || process.env["TELEGRAM_BOT_NAME"]?.trim() || "").replace(
      /^@/,
      "",
    ),
    // Прокси-воркер должен повторять оба пути Телеграма: и /bot<token>/<метод>,
    // и /file/bot<token>/<путь> — иначе документы будут приходить, но не качаться.
    apiBase: (
      tg.apiBase?.trim() ||
      process.env["TELEGRAM_API_BASE"]?.trim() ||
      DEFAULT_API_BASE
    ).replace(/\/+$/, ""),
    hookSecret: tg.hookSecret?.trim() || process.env["TELEGRAM_HOOK_SECRET"]?.trim() || "",
  };
}

/** Настроен ли бот настолько, чтобы вообще что-то делать. */
const ready = (cfg: TelegramSettings) => Boolean(cfg.token && cfg.hookSecret);

// ── Разговор с Телеграмом ─────────────────────────────────────────────────────

const detail = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Токен не должен попасть в журнал даже случайно — он есть в адресе запроса. */
const hideToken = (text: string, token: string) => (token ? text.split(token).join("···") : text);

async function api<T>(cfg: TelegramSettings, method: string, payload: unknown): Promise<T | null> {
  if (!cfg.token) return null;
  try {
    const res = await fetch(`${cfg.apiBase}/bot${cfg.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!raw.ok) {
      console.warn(`[телеграм] ${method}: ${raw.description ?? `HTTP ${res.status}`}`);
      return null;
    }
    return (raw.result ?? null) as T | null;
  } catch (err) {
    console.warn(`[телеграм] ${method} не дошёл: ${hideToken(detail(err), cfg.token)}`);
    return null;
  }
}

/**
 * Больше двадцати мегабайт бот скачать не может: это предел getFile у самого
 * Телеграма, а не наша осторожность. Платформа принимает и стомегабайтные
 * файлы — но не отсюда, поэтому честнее сказать об этом сразу, чем сходить
 * за файлом и вернуться с пустыми руками.
 */
const TG_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** Обратно бот отдаёт не больше пятидесяти мегабайт — это предел sendDocument. */
const TG_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

async function download(cfg: TelegramSettings, fileId: string): Promise<Buffer | null> {
  const info = await api<{ file_path?: string }>(cfg, "getFile", { file_id: fileId });
  const path = info?.file_path;
  if (!path) return null;
  try {
    const res = await fetch(`${cfg.apiBase}/file/bot${cfg.token}/${path}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.warn(`[телеграм] файл не отдался: HTTP ${res.status}`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > TG_MAX_DOWNLOAD_BYTES ? null : bytes;
  } catch (err) {
    console.warn(`[телеграм] файл не скачался: ${hideToken(detail(err), cfg.token)}`);
    return null;
  }
}

// ── Связь кабинета и чата ─────────────────────────────────────────────────────
// Один человек — один чат. Кто прислал документ, тот и хозяин задачи, в которую
// он ляжет: иначе чужой документ уедет в чужую работу.

type ChatLink = {
  personId: string;
  chatId: number;
  at: string;
};

const linksFile = async () => `${(await import("./server-data")).dataDir()}/telegram.json`;

async function readLinks(): Promise<ChatLink[]> {
  const { readJson } = await import("./server-data");
  const raw = await readJson<ChatLink[]>(await linksFile(), []);
  return Array.isArray(raw)
    ? raw.filter((l) => l && l.personId && typeof l.chatId === "number")
    : [];
}

async function writeLinks(list: ChatLink[]): Promise<void> {
  const { writeJson } = await import("./server-data");
  await writeJson(await linksFile(), list);
}

/** Чат этого кабинета. Нет связи — некуда писать, и это не ошибка. */
export async function chatOf(personId: string): Promise<number | null> {
  const list = await readLinks();
  return list.find((l) => l.personId === personId)?.chatId ?? null;
}

/** Чей это чат. Незнакомый чат — не повод отвечать что-то содержательное. */
export async function personOfChat(chatId: number): Promise<string | null> {
  const list = await readLinks();
  return list.find((l) => l.chatId === chatId)?.personId ?? null;
}

async function bind(personId: string, chatId: number): Promise<void> {
  const list = await readLinks();
  // Снимаем и старый чат этого человека, и старого хозяина этого чата:
  // «кабинет ↔ чат» — связь один к одному, две записи означали бы, что
  // документ из чата может уехать в два разных кабинета.
  const next = list.filter((l) => l.personId !== personId && l.chatId !== chatId);
  next.push({ personId, chatId, at: new Date().toISOString() });
  await writeLinks(next);
}

async function unbind(personId: string): Promise<boolean> {
  const list = await readLinks();
  const next = list.filter((l) => l.personId !== personId);
  if (next.length === list.length) return false;
  await writeLinks(next);
  return true;
}

// ── Одноразовые метки ─────────────────────────────────────────────────────────
/**
 * Код доступа — это вход в кабинет, и пересылать его в переписку с ботом
 * нельзя ни под каким соусом: чат синхронизируется на все устройства, живёт
 * в облаке Телеграма и переживает увольнение. Поэтому кабинет выдаёт метку —
 * случайную строку, которая ничего не значит сама по себе, живёт четверть часа
 * и сгорает после первого применения.
 *
 * Метки лежат в памяти процесса. Перезапуск сервиса их теряет — и это
 * нормально: человек просто нажимает кнопку в кабинете и получает новую
 * ссылку. Ради пятнадцати минут заводить файл на диске незачем.
 */
const LABEL_TTL_MS = 15 * 60 * 1000;

const labels = new Map<string, { personId: string; until: number }>();

function sweepLabels(): void {
  const now = Date.now();
  for (const [key, value] of labels) if (value.until <= now) labels.delete(key);
}

async function newLabel(personId: string): Promise<string> {
  sweepLabels();
  // Нажали кнопку дважды — живой должна остаться только последняя ссылка:
  // старая где-то в переписке или в буфере обмена, и ей там не место.
  for (const [key, value] of labels) if (value.personId === personId) labels.delete(key);
  const { randomBytes } = await import("node:crypto");
  // hex, а не base64: параметр start у Телеграма принимает только буквы,
  // цифры, дефис и подчёркивание.
  const label = randomBytes(12).toString("hex");
  labels.set(label, { personId, until: Date.now() + LABEL_TTL_MS });
  return label;
}

/** Метка одноразовая: забрали — сразу выкинули, второй раз по ней не войти. */
function takeLabel(label: string): string | null {
  sweepLabels();
  const found = labels.get(label);
  if (!found) return null;
  labels.delete(label);
  return found.personId;
}

// ── Что видит кабинет ─────────────────────────────────────────────────────────

export type TgLinkResult = { ok: boolean; url: string; note: string };
export type TgUnlinkResult = { ok: boolean; note: string };
export type TgStatusResult = { linked: boolean; note: string };

const NOT_SET_UP =
  "Бот ещё не подключён. Это разовая настройка на стороне администратора — " +
  "после неё кнопка заработает сама.";

/**
 * Ссылка на бота с одноразовой меткой.
 *
 * Человек нажимает её в своём кабинете, у него открывается личный чат с ботом
 * с кнопкой «Запустить», бот получает метку и связывает чат с кабинетом.
 * Ничего вводить руками не нужно — и код доступа нигде не звучит.
 */
export const tgLinkServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<TgLinkResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ok: false, url: "", note: "Не узнаю код доступа" };

    const cfg = await settings();
    if (!ready(cfg) || !cfg.botName) return { ok: false, url: "", note: NOT_SET_UP };

    const label = await newLabel(me.id);
    return {
      ok: true,
      url: `https://t.me/${cfg.botName}?start=${label}`,
      note:
        "Ссылка живёт пятнадцать минут и срабатывает один раз. " +
        "Откройте её, нажмите «Запустить» — и присылайте документы прямо в чат.",
    };
  });

/** Отвязать чат: бот перестаёт и принимать документы, и присылать разборы. */
export const tgUnlinkServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<TgUnlinkResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ok: false, note: "Не узнаю код доступа" };

    const chatId = await chatOf(me.id);
    const removed = await unbind(me.id);
    if (!removed) return { ok: true, note: "Телеграм и так не был связан с кабинетом" };

    const cfg = await settings();
    if (chatId !== null && ready(cfg)) {
      await api(cfg, "sendMessage", {
        chat_id: chatId,
        text:
          "Кабинет отвязан от этого чата. Документы отсюда больше не принимаются, " +
          "разборы сюда не приходят. Связать заново можно кнопкой в кабинете.",
      });
    }
    return { ok: true, note: "Телеграм отвязан" };
  });

/** Связан ли кабинет с чатом — чтобы кабинет знал, что писать на кнопке. */
export const tgStatusServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<TgStatusResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { linked: false, note: "Не узнаю код доступа" };

    const cfg = await settings();
    if (!ready(cfg) || !cfg.botName) return { linked: false, note: NOT_SET_UP };

    const chatId = await chatOf(me.id);
    return {
      linked: chatId !== null,
      note: chatId !== null ? "Телеграм связан с кабинетом" : "",
    };
  });

// ── Отдача результата ─────────────────────────────────────────────────────────
/**
 * Обе функции — «отправил и забыл». Телеграм лежит чаще, чем нам хотелось бы:
 * ТСПУ, прокси, лимиты. Если из-за этого не откроется экран или сорвётся ответ
 * агента, человек потеряет работу из-за уведомления — а это несоразмерно.
 * Поэтому здесь ловится всё, наружу не летит ничего, а в журнале остаётся след.
 */

export async function tgSendText(personId: string, text: string): Promise<void> {
  try {
    const cfg = await settings();
    if (!ready(cfg)) return;
    const chatId = await chatOf(personId);
    if (chatId === null) return;
    await api(cfg, "sendMessage", { chat_id: chatId, text: cut(text, 4096) });
  } catch (err) {
    console.warn(`[телеграм] сообщение не ушло: ${detail(err)}`);
  }
}

export async function tgSendDocument(
  personId: string,
  doc: { name: string; base64: string; caption?: string },
): Promise<void> {
  try {
    const cfg = await settings();
    if (!ready(cfg)) return;
    const chatId = await chatOf(personId);
    if (chatId === null) return;

    const bytes = Buffer.from(doc.base64, "base64");
    if (!bytes.length) {
      console.warn("[телеграм] документ пустой — не отправляю");
      return;
    }
    if (bytes.length > TG_MAX_UPLOAD_BYTES) {
      console.warn(
        `[телеграм] документ ${humanSize(bytes.length)} — больше ${humanSize(TG_MAX_UPLOAD_BYTES)}, не отправляю`,
      );
      await tgSendText(
        personId,
        `Разбор получился слишком большим для телеграма (${humanSize(bytes.length)}). Он лежит в кабинете — заберите оттуда.`,
      );
      return;
    }

    await sendDocumentRaw(cfg, chatId, safeName(doc.name), bytes, doc.caption ?? "");
  } catch (err) {
    console.warn(`[телеграм] документ не ушёл: ${detail(err)}`);
  }
}

/**
 * multipart/form-data собираем руками — так же, как для Google Диска.
 * Новых зависимостей ради одного запроса заводить незачем.
 */
async function sendDocumentRaw(
  cfg: TelegramSettings,
  chatId: number,
  name: string,
  bytes: Buffer,
  caption: string,
): Promise<void> {
  const boundary = `bv${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const field = (key: string, value: string) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
    );

  const parts: Buffer[] = [field("chat_id", String(chatId))];
  // Подпись у Телеграма ограничена 1024 знаками — длиннее он молча откажет.
  if (caption.trim()) parts.push(field("caption", cut(caption.trim(), 1024)));
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${name}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  try {
    const res = await fetch(`${cfg.apiBase}/bot${cfg.token}/sendDocument`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts) as unknown as BodyInit,
      signal: AbortSignal.timeout(180_000),
    });
    const raw = (await res.json()) as { ok?: boolean; description?: string };
    if (!raw.ok) {
      console.warn(`[телеграм] sendDocument: ${raw.description ?? `HTTP ${res.status}`}`);
    }
  } catch (err) {
    console.warn(`[телеграм] sendDocument не дошёл: ${hideToken(detail(err), cfg.token)}`);
  }
}

// ── Вебхук ────────────────────────────────────────────────────────────────────

/**
 * Телеграм ждёт ответа несколько секунд, и если не дождался — шлёт то же
 * обновление снова. Скачивание двадцатимегабайтного файла и разбор документа
 * в эти секунды не укладываются никогда. Поэтому отвечаем 200 сразу, а работу
 * делаем после ответа: иначе один документ приедет в задачу трижды.
 *
 * Сам путь /tg/hook разбирается в src/server.ts — до передачи запроса в SSR;
 * тот же адрес прописывается боту в set-tg.sh.
 */
export async function telegramWebhook(request: Request): Promise<Response> {
  const cfg = await settings();

  // Секрет обязателен. Не задан — вебхука для нас не существует: пусть тот,
  // кто стучится, видит обычный 404, а не «сюда можно, но без ключа».
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!ready(cfg) || !(await sameSecret(given, cfg.hookSecret))) {
    return new Response("Not found", { status: 404 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    // Битое тело повторять бессмысленно — говорим «принял» и забываем.
    return accepted();
  }

  void handleUpdate(cfg, update).catch((err) => {
    console.error(`[телеграм] обновление не обработалось: ${detail(err)}`);
  });
  return accepted();
}

const accepted = () => new Response("ok", { status: 200 });

/** Сравнение секретов за одинаковое время: длина утечёт, содержимое — нет. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  if (!given || !expected || given.length !== expected.length) return false;
  const { timingSafeEqual } = await import("node:crypto");
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// ── Разбор обновления ─────────────────────────────────────────────────────────

type TgChat = { id: number; type?: string };
type TgDocument = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};
type TgMessage = {
  message_id?: number;
  chat?: TgChat;
  text?: string;
  document?: TgDocument;
  photo?: unknown[];
};
type TgCallback = { id: string; data?: string; message?: TgMessage };
type TgUpdate = {
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallback;
};

const ONLY_PRIVATE_NOTE =
  "Свяжите кабинет с телеграмом кнопкой в самом кабинете — она откроет этот чат " +
  "по одноразовой ссылке. Кода доступа боту говорить не нужно и не надо.";

async function handleUpdate(cfg: TelegramSettings, update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await onCallback(cfg, update.callback_query);
    return;
  }

  // Правленые сообщения и посты канала не трогаем: документ приезжает новым
  // сообщением, а всё остальное — шум.
  const msg = update.message;
  const chat = msg?.chat;
  if (!msg || !chat || typeof chat.id !== "number") return;

  // Только личка. Групповые и канальные чаты — молча мимо: это условие
  // владелицы, и оно про чужие договоры на общем экране.
  if (chat.type !== "private") return;

  const personId = await personOfChat(chat.id);
  const text = (msg.text ?? "").trim();

  // Ровно «/start» или «/start метка». Не startsWith: иначе любое слово,
  // начинающееся со «/start», уедет в привязку.
  if (text === "/start" || text.startsWith("/start ")) {
    await onStart(cfg, chat.id, text.slice("/start".length).trim());
    return;
  }

  if (!personId) {
    await say(cfg, chat.id, ONLY_PRIVATE_NOTE);
    return;
  }

  if (msg.document) {
    await onDocument(cfg, chat.id, personId, msg.document);
    return;
  }

  if (msg.photo?.length) {
    await say(
      cfg,
      chat.id,
      "Пришлите документ файлом, а не картинкой: со сжатого снимка текст не читается. " +
        "В телеграме это скрепка → «Файл».",
    );
    return;
  }

  await say(
    cfg,
    chat.id,
    "Я принимаю документы: пришлите файл — положу его в задачу и верну разбор сюда же. " +
      "Разговор с агентами идёт в кабинете, там видно всю работу целиком.",
  );
}

async function onStart(cfg: TelegramSettings, chatId: number, label: string): Promise<void> {
  if (!label) {
    const personId = await personOfChat(chatId);
    if (personId) {
      await say(cfg, chatId, "Кабинет уже связан с этим чатом. Присылайте документ файлом.");
      return;
    }
    await say(cfg, chatId, ONLY_PRIVATE_NOTE);
    return;
  }

  const personId = takeLabel(label);
  if (!personId) {
    await say(
      cfg,
      chatId,
      "Эта ссылка уже сработала или устарела — они живут пятнадцать минут. " +
        "Возьмите новую в кабинете, там же, где брали эту.",
    );
    return;
  }

  const d = await import("./server-data");
  const person = (await d.readParticipants()).find((p) => p.id === personId);
  if (!person || !person.active) {
    await say(cfg, chatId, "Кабинет больше не действует. Напишите тому, кто его открывал.");
    return;
  }

  await bind(personId, chatId);
  await say(
    cfg,
    chatId,
    `Здравствуйте, ${person.name}. Кабинет связан с этим чатом.\n\n` +
      "Присылайте документы файлом — я положу их в вашу задачу и верну разбор сюда же. " +
      "Если открытых задач несколько, спрошу, в какую класть.",
  );
}

/** Короткая реплика в чат. Отдельная от tgSendText: здесь чат уже известен. */
async function say(cfg: TelegramSettings, chatId: number, text: string): Promise<void> {
  await api(cfg, "sendMessage", { chat_id: chatId, text: cut(text, 4096) });
}

const cut = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

// ── Приём документа ───────────────────────────────────────────────────────────

/**
 * Имя приезжает из телеграма, то есть от кого угодно. Внутрь пути оно не
 * попадает (файл на диске зовётся выданным нами id), но остаётся в списке и в
 * имени скачиваемого файла — а значит, ни разделителей пути, ни управляющих
 * символов в нём быть не должно. Расширение бережём отдельно: по нему
 * платформа понимает, что за документ, и без него он станет «нечитаемым
 * форматом».
 */
function safeName(raw: string): string {
  const cleaned = (raw || "")
    // Управляющие символы в имени не нужны никому: ни списку, ни заголовку
    // скачивания, ни multipart-заголовку, которым мы отдаём файл обратно.
    .replace(/\p{Cc}/gu, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned) return "документ";
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return cleaned.slice(0, 120);
  return `${cleaned.slice(0, dot).slice(0, 100)}${cleaned.slice(dot).slice(0, 20)}`;
}

/**
 * Что ждёт нажатия кнопки: сам файл не держим, только его номер у Телеграма —
 * иначе десяток присланных отчётов будет висеть в памяти сервиса. Номер файла
 * у Телеграма живёт долго, скачаем по нажатию.
 *
 * Тоже в памяти процесса: перезапуск потеряет ожидание, и человек просто
 * пришлёт документ ещё раз.
 */
const WAIT_TTL_MS = 30 * 60 * 1000;

type Waiting = {
  personId: string;
  fileId: string;
  name: string;
  mime: string;
  /** Задачи в том же порядке, в каком нарисованы кнопки */
  projectIds: string[];
  until: number;
};

const waiting = new Map<string, Waiting>();

function sweepWaiting(): void {
  const now = Date.now();
  for (const [key, value] of waiting) if (value.until <= now) waiting.delete(key);
}

/**
 * Сколько задач показываем кнопками. Больше десяти — это уже не выбор, а
 * простыня в телефоне; у кого задач больше, тому проще открыть кабинет.
 */
const MAX_BUTTONS = 10;

async function onDocument(
  cfg: TelegramSettings,
  chatId: number,
  personId: string,
  doc: TgDocument,
): Promise<void> {
  const name = safeName(doc.file_name ?? "");
  const size = typeof doc.file_size === "number" ? doc.file_size : 0;

  // Размер Телеграм присылает не всегда. Ноль здесь означал бы «файл пустой» —
  // а мы этого пока не знаем; настоящий вес проверим после скачивания.
  const bad = rejectReason(name, size || 1);
  if (bad) {
    await say(cfg, chatId, bad);
    return;
  }
  if (size > TG_MAX_DOWNLOAD_BYTES) {
    await say(
      cfg,
      chatId,
      `${name}: ${humanSize(size)} — больше ${humanSize(TG_MAX_DOWNLOAD_BYTES)}. ` +
        "Телеграм не отдаёт ботам файлы тяжелее. Загрузите такой документ в кабинете.",
    );
    return;
  }

  const d = await import("./server-data");
  const { projects } = await d.readWorkspace(personId);
  const open = projects.filter(isProjectOpen);

  if (!open.length) {
    await say(
      cfg,
      chatId,
      "В кабинете нет открытых задач — документу некуда лечь. " +
        "Заведите задачу в кабинете и пришлите файл снова.",
    );
    return;
  }

  if (open.length === 1) {
    const only = open[0]!;
    await say(cfg, chatId, `Забираю «${name}» в задачу «${only.title}»…`);
    const done = await takeIntoProject(
      cfg,
      chatId,
      personId,
      only.id,
      doc.file_id,
      name,
      mimeOfDoc(doc),
    );
    if (done) await say(cfg, chatId, `Готово: «${name}» лежит в задаче «${only.title}».`);
    return;
  }

  sweepWaiting();
  const shown = open.slice(0, MAX_BUTTONS);
  const key = Math.random().toString(36).slice(2, 8);
  waiting.set(key, {
    personId,
    fileId: doc.file_id,
    name,
    mime: mimeOfDoc(doc),
    projectIds: shown.map((p) => p.id),
    until: Date.now() + WAIT_TTL_MS,
  });

  // В callback_data у Телеграма всего 64 байта, поэтому кладём туда номер
  // кнопки, а не идентификатор задачи: длина известна заранее и не зависит
  // от того, как задачу назвали.
  await api(cfg, "sendMessage", {
    chat_id: chatId,
    text:
      `Куда положить «${name}»?` +
      (open.length > shown.length
        ? `\n\nПоказаны первые ${shown.length} задач из ${open.length} — остальные в кабинете.`
        : ""),
    reply_markup: {
      inline_keyboard: shown.map((p, i) => [
        { text: cut(p.title, 60), callback_data: `d:${key}:${i}` },
      ]),
    },
  });
}

/**
 * Тип тоже приходит от отправителя, и в метаданные документа он попадает
 * как есть — пускаем только то, что похоже на тип. Последнее слово всё равно
 * за платформой: она смотрит на расширение (mimeOf в documents.ts).
 */
const mimeOfDoc = (doc: TgDocument) => {
  const raw = (doc.mime_type ?? "").trim();
  return /^[\w.+-]+\/[\w.+-]+$/.test(raw) ? raw : "application/octet-stream";
};

async function onCallback(cfg: TelegramSettings, cb: TgCallback): Promise<void> {
  const chat = cb.message?.chat;
  // Кнопка могла прилететь и из группы, если сообщение туда переслали.
  if (!chat || typeof chat.id !== "number" || chat.type !== "private") {
    await api(cfg, "answerCallbackQuery", { callback_query_id: cb.id });
    return;
  }

  const parts = (cb.data ?? "").split(":");
  const key = parts[1] ?? "";
  const index = Number(parts[2]);
  sweepWaiting();
  const wait = parts[0] === "d" && key ? waiting.get(key) : undefined;
  const projectId = wait?.projectIds[index];

  const personId = await personOfChat(chat.id);
  if (!wait || !projectId || !personId || wait.personId !== personId) {
    await api(cfg, "answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "Этот документ я уже не жду — пришлите его снова.",
      show_alert: true,
    });
    return;
  }

  // Забираем ожидание сразу: два нажатия подряд не должны положить документ
  // в две задачи.
  waiting.delete(key);
  await api(cfg, "answerCallbackQuery", { callback_query_id: cb.id, text: "Забираю…" });
  // Кнопки убираем, чтобы сообщение не выглядело живым выбором.
  if (typeof cb.message?.message_id === "number") {
    await api(cfg, "editMessageReplyMarkup", {
      chat_id: chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  }

  const d = await import("./server-data");
  const { projects } = await d.readWorkspace(personId);
  const target = projects.find((p) => p.id === projectId);
  if (!target) {
    await say(cfg, chat.id, "Такой задачи в кабинете больше нет — пришлите документ снова.");
    return;
  }

  const done = await takeIntoProject(
    cfg,
    chat.id,
    personId,
    projectId,
    wait.fileId,
    wait.name,
    wait.mime,
  );
  if (done) await say(cfg, chat.id, `Готово: «${wait.name}» лежит в задаче «${target.title}».`);
}

// ── Документ → задача ─────────────────────────────────────────────────────────

/**
 * Разбор документов живёт в server-files.ts и повторять его здесь нельзя:
 * там очередь на тяжёлые работы, распознавание Office, чтение больших PDF и
 * подбор кодировки для выгрузок из 1С. Второй такой же код разъедется с
 * первым на первой же правке.
 *
 * saveFile оттуда экспортирован и берётся динамическим импортом ниже;
 * uploadProjectFileServer не подходит — это серверная функция, ей нужен
 * контекст запроса, которого у вебхука нет.
 */
type SaveFileFn = (
  scope: "window" | "agent",
  ownerId: string,
  name: string,
  mime: string,
  bytes: Buffer,
  source?: string,
) => Promise<StoredFile>;

async function borrowSaveFile(): Promise<SaveFileFn | null> {
  const mod = (await import("./server-files")) as unknown as { saveFile?: SaveFileFn };
  return typeof mod.saveFile === "function" ? mod.saveFile : null;
}

/**
 * Скачать и положить в задачу. Возвращает, дошло ли дело до конца: обо всех
 * причинах «не дошло» человек уже услышал словами.
 */
async function takeIntoProject(
  cfg: TelegramSettings,
  chatId: number,
  personId: string,
  projectId: string,
  fileId: string,
  name: string,
  mime: string,
): Promise<boolean> {
  const saveFile = await borrowSaveFile();
  if (!saveFile) {
    console.error(
      "[телеграм] приём документов выключен: server-files.ts не экспортирует saveFile " +
        "(нужен `export async function saveFile`)",
    );
    await say(
      cfg,
      chatId,
      "Приём документов из телеграма ещё не включён на стороне платформы. " +
        "Загрузите файл в кабинете — там он читается как обычно.",
    );
    return false;
  }

  const bytes = await download(cfg, fileId);
  if (!bytes) {
    await say(cfg, chatId, "Не удалось забрать файл у телеграма. Попробуйте прислать ещё раз.");
    return false;
  }

  const bad = rejectReason(name, bytes.length);
  if (bad) {
    await say(cfg, chatId, bad);
    return false;
  }

  const d = await import("./server-data");
  const projects = await d.readProjects(personId);
  const target = projects.find((p) => p.id === projectId);
  if (!target) {
    await say(cfg, chatId, "Такой задачи в кабинете больше нет — пришлите документ снова.");
    return false;
  }

  // Пределы задачи те же, что и при загрузке из кабинета: путь другой,
  // правила одни.
  if (target.files.length >= MAX_WINDOW_FILES) {
    await say(cfg, chatId, `В одной задаче не больше ${MAX_WINDOW_FILES} документов.`);
    return false;
  }
  const weight = target.files.reduce((n, f) => n + f.size, 0) + bytes.length;
  if (weight > MAX_WINDOW_BYTES) {
    await say(
      cfg,
      chatId,
      `Документы задачи весят больше ${humanSize(MAX_WINDOW_BYTES)} — уберите лишние в кабинете.`,
    );
    return false;
  }

  const saved = await saveFile("window", personId, name, mime, bytes, "телеграм");
  const next = projects.map((p) =>
    p.id === projectId
      ? { ...p, files: [...p.files, saved], updatedAt: new Date().toISOString() }
      : p,
  );
  await d.writeProjects(personId, next);

  if (saved.note) {
    await say(cfg, chatId, `Файл лежит в задаче, но прочитался не полностью: ${saved.note}`);
    return false;
  }
  return true;
}
