/**
 * Документы: приём, хранение, выдача. Только сервер.
 *
 * Файл кладём на диск рядом с перепиской — в РФ, вне папки приложения
 * (её деплой перезаписывает целиком). Рядом с файлом лежит распознанный
 * текст: разбираем один раз при загрузке, а не на каждый вопрос агенту.
 * Заодно человек сразу видит, что документ прочитался, — а не узнаёт об
 * этом из пустого ответа через пять минут.
 */
import { createServerFn } from "@tanstack/react-start";

import type { StoredWindow } from "./conversations";
import type { StoredProject } from "./projects";
import type { AgentConfig } from "./server-agents";
import {
  MAX_AGENT_FILES,
  MAX_AGENT_BYTES,
  MAX_FILE_BYTES,
  MAX_PDF_NATIVE_BYTES,
  MAX_RAW_BYTES,
  MAX_TEXT_CHARS,
  MAX_WINDOW_BYTES,
  MAX_WINDOW_FILES,
  humanSize,
  kindOf,
  mimeOf,
  rejectReason,
  type Attachment,
  type StoredFile,
} from "./documents";

export type AgentFilesMap = Record<string, StoredFile[]>;

const rid = () => `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ── Диск ──────────────────────────────────────────────────────────────────────

/** Папки две: у человека — материалы его окон, у агента — его постоянные документы. */
const folder = async (scope: "window" | "agent", ownerId: string) => {
  const { dataDir } = await import("./server-data");
  // id мы выдаём сами, но чужой ввод в путь не пускаем ни при каких условиях.
  const safe = ownerId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${dataDir()}/files/${scope === "window" ? "w" : "a"}/${safe}`;
};

/** Текст из простого файла: пробуем UTF-8, а если получилась каша — 1251. */
function plainText(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8");
  const broken = (utf8.match(/�/g) ?? []).length;
  if (broken * 200 <= utf8.length) return utf8;
  try {
    // Выгрузки из 1С и Excel до сих пор приезжают в windows-1251.
    return new TextDecoder("windows-1251").decode(bytes);
  } catch {
    return utf8;
  }
}

// export: телеграм-бот принимает документы тем же путём, что и кабинет, —
// один разбор форматов, одни пределы, никакого второго кода приёма.
export async function saveFile(
  scope: "window" | "agent",
  ownerId: string,
  name: string,
  mime: string,
  bytes: Buffer,
  source?: string,
): Promise<StoredFile> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = await folder(scope, ownerId);
  await mkdir(dir, { recursive: true });

  const id = rid();
  const kind = kindOf(name)!;
  await writeFile(`${dir}/${id}.bin`, bytes);

  // Разбор документа — работа памятью и процессором: стомегабайтная книга
  // разворачивается в сотни мегабайт XML. Пропускаем через очередь, чтобы
  // тридцать одновременных загрузок не сложили сервис.
  const { fileGate } = await import("./server-queue");
  const parsed = await fileGate.run(async () => {
    let text = "";
    let note = "";
    if (kind === "office") {
      try {
        const { officeText } = await import("./server-office");
        text = await officeText(name, bytes);
      } catch (err) {
        note = `не удалось прочитать: ${err instanceof Error ? err.message : "неизвестная ошибка"}`;
      }
    } else if (kind === "text") {
      text = plainText(bytes);
    } else if (kind === "pdf" && bytes.length > MAX_PDF_NATIVE_BYTES) {
      // Такой PDF в запрос к модели целиком не влезет — читаем текст сами.
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const out = await extractText(pdf, { mergePages: true });
        text = String(out.text ?? "").trim();
      } catch {
        text = "";
      }
      if (!text) {
        note =
          "PDF слишком большой, чтобы отдать его модели целиком, а текста внутри не нашлось " +
          "(обычно так со сканами). Пришлите документ в Word или разбейте PDF на части";
      }
    }

    // Очень длинный текст режем при сохранении: в запрос к модели он всё равно
    // не уедет целиком, а вот файл на диске и память сервера съест.
    const LIMIT = 5_000_000;
    if (text.length > LIMIT) {
      text = `${text.slice(0, LIMIT)}\n\n[документ очень большой: сохранены первые ${(LIMIT / 1_000_000).toFixed(0)} млн знаков]`;
      if (!note) note = "документ очень большой — сохранена первая часть текста";
    }

    return { text, note };
  });

  const { text, note } = parsed;
  if (text.trim()) await writeFile(`${dir}/${id}.txt`, text, "utf8");

  return {
    id,
    name,
    ...(source ? { source } : {}),
    mime: mimeOf(name, mime),
    size: bytes.length,
    kind,
    at: new Date().toISOString(),
    chars: text.trim().length,
    note,
  };
}

async function dropFiles(scope: "window" | "agent", ownerId: string, ids: string[]): Promise<void> {
  const { rm } = await import("node:fs/promises");
  const dir = await folder(scope, ownerId);
  for (const raw of ids) {
    // id приходит из браузера, а уходит в путь на диске: всё, кроме букв,
    // цифр и дефиса, режем — иначе «../» удалит не то, что просили.
    const id = raw.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id) continue;
    await rm(`${dir}/${id}.bin`, { force: true });
    await rm(`${dir}/${id}.txt`, { force: true });
  }
}

/** Сколько ещё влезет: считаем вместе с тем, что уже лежит. */
const tooHeavy = (existing: StoredFile[], incoming: number, limit: number) =>
  existing.reduce((n, f) => n + f.size, 0) + incoming > limit;

/** Содержимое для модели: распознанный текст либо сам файл. */
export async function loadForModel(
  scope: "window" | "agent",
  ownerId: string,
  file: StoredFile,
): Promise<{ text: string; base64: string }> {
  const { readFile } = await import("node:fs/promises");
  const dir = await folder(scope, ownerId);
  try {
    // Есть распознанный текст — значит файлом его отдавать не надо: так
    // сделано для тяжёлых PDF, которые в запрос целиком не помещаются.
    if (file.chars > 0)
      return { text: await readFile(`${dir}/${file.id}.txt`, "utf8"), base64: "" };
    if (file.kind === "pdf" || file.kind === "image") {
      return { text: "", base64: (await readFile(`${dir}/${file.id}.bin`)).toString("base64") };
    }
    return { text: "", base64: "" };
  } catch {
    // Файл пропал с диска — молчим и работаем без него: лучше ответ без
    // одного документа, чем упавшее окно.
    return { text: "", base64: "" };
  }
}

/**
 * Готовый разбор — файлом в окно.
 *
 * Тем же путём, что и принесённый человеком документ: тогда агент читает его
 * обычным образом, а человек видит в списке и может скачать. Текст у нас уже
 * на руках, разбирать нечего — пишем сразу и .bin, и .txt.
 */
export async function saveTextAsFile(
  personId: string,
  name: string,
  text: string,
): Promise<StoredFile> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = await folder("window", personId);
  await mkdir(dir, { recursive: true });

  const id = rid();
  // Имя должно оканчиваться на .md — иначе платформа не поймёт, что это текст.
  const safe = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const file = safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`;
  const bytes = Buffer.from(text, "utf8");
  await writeFile(`${dir}/${id}.bin`, bytes);
  await writeFile(`${dir}/${id}.txt`, text, "utf8");

  return {
    id,
    name: file,
    mime: "text/markdown",
    size: bytes.length,
    kind: "text",
    at: new Date().toISOString(),
    chars: text.trim().length,
    note: "",
  };
}

// ── Документы окна (клиент) ───────────────────────────────────────────────────

export type WindowFilesResult = { ok: boolean; error: string; windows: StoredWindow[] };

export const uploadWindowFileServer = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }): Promise<WindowFilesResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.get("code") ?? ""));
    if (!me) return { ok: false, error: "нет доступа", windows: [] };

    const windowId = String(data.get("windowId") ?? "");
    const upload = data.get("file");
    if (!(upload instanceof File)) return { ok: false, error: "файл не приехал", windows: [] };

    const windows = await d.readWindows(me.id);
    const target = windows.find((w) => w.id === windowId);
    if (!target) return { ok: false, error: "разговор не найден", windows };

    if (target.files.length >= MAX_WINDOW_FILES) {
      return {
        ok: false,
        error: `в одном разговоре не больше ${MAX_WINDOW_FILES} документов`,
        windows,
      };
    }

    const bad = rejectReason(upload.name, upload.size);
    if (bad) return { ok: false, error: bad, windows };

    if (tooHeavy(target.files, upload.size, MAX_WINDOW_BYTES)) {
      return {
        ok: false,
        error: `документы разговора весят больше ${humanSize(MAX_WINDOW_BYTES)} — уберите лишние`,
        windows,
      };
    }

    const bytes = Buffer.from(await upload.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "файл слишком большой", windows };

    const saved = await saveFile("window", me.id, upload.name, upload.type, bytes);
    const next = windows.map((w) =>
      w.id === windowId
        ? { ...w, files: [...w.files, saved], updatedAt: new Date().toISOString() }
        : w,
    );
    await d.writeWindows(me.id, next);
    return { ok: !saved.note, error: saved.note, windows: next };
  });

export const deleteWindowFileServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string; fileId: string }) => data)
  .handler(async ({ data }): Promise<WindowFilesResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ok: false, error: "нет доступа", windows: [] };

    const windows = await d.readWindows(me.id);
    const next = windows.map((w) =>
      w.id === data.windowId ? { ...w, files: w.files.filter((f) => f.id !== data.fileId) } : w,
    );
    await d.writeWindows(me.id, next);
    await dropFiles("window", me.id, [data.fileId]);
    return { ok: true, error: "", windows: next };
  });

// ── Документы папки проекта ───────────────────────────────────────────────────
// Лежат там же, где документы окон, — в папке человека: разница только в том,
// кто на них ссылается. Общие для всех окон проекта: принесли один раз.

export type ProjectFilesResult = { ok: boolean; error: string; projects: StoredProject[] };

export const uploadProjectFileServer = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }): Promise<ProjectFilesResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.get("code") ?? ""));
    if (!me) return { ok: false, error: "нет доступа", projects: [] };

    const projectId = String(data.get("projectId") ?? "");
    const upload = data.get("file");
    if (!(upload instanceof File)) return { ok: false, error: "файл не приехал", projects: [] };

    const projects = await d.readProjects(me.id);
    const target = projects.find((p) => p.id === projectId);
    if (!target) return { ok: false, error: "задача не найдена", projects };

    if (target.files.length >= MAX_WINDOW_FILES) {
      return {
        ok: false,
        error: `в одну задачу не больше ${MAX_WINDOW_FILES} документов`,
        projects,
      };
    }

    const bad = rejectReason(upload.name, upload.size);
    if (bad) return { ok: false, error: bad, projects };

    if (tooHeavy(target.files, upload.size, MAX_WINDOW_BYTES)) {
      return {
        ok: false,
        error: `документы задачи весят больше ${humanSize(MAX_WINDOW_BYTES)} — уберите лишние`,
        projects,
      };
    }

    const bytes = Buffer.from(await upload.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES)
      return { ok: false, error: "файл слишком большой", projects };

    const saved = await saveFile("window", me.id, upload.name, upload.type, bytes);
    const next = projects.map((p) =>
      p.id === projectId
        ? { ...p, files: [...p.files, saved], updatedAt: new Date().toISOString() }
        : p,
    );
    await d.writeProjects(me.id, next);
    return { ok: !saved.note, error: saved.note, projects: next };
  });

export const deleteProjectFileServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; projectId: string; fileId: string }) => data)
  .handler(async ({ data }): Promise<ProjectFilesResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ok: false, error: "нет доступа", projects: [] };

    const projects = await d.readProjects(me.id);
    const next = projects.map((p) =>
      p.id === data.projectId ? { ...p, files: p.files.filter((f) => f.id !== data.fileId) } : p,
    );
    await d.writeProjects(me.id, next);
    await dropFiles("window", me.id, [data.fileId]);
    return { ok: true, error: "", projects: next };
  });

/**
 * Ссылки из сообщения — в материалы окна.
 *
 * Человек кидает ссылку и ждёт, что её прочитают. Мы забираем документ и
 * кладём рядом с остальными: агент читает его как обычный файл, а человек
 * видит, что именно было прочитано, и может это скачать.
 *
 * Одну и ту же ссылку второй раз не качаем: она уже лежит в окне.
 */
export async function readLinks(opts: {
  text: string;
  personId: string;
  already: StoredFile[];
}): Promise<StoredFile[]> {
  const { extractUrls, fetchLink } = await import("./server-links");
  const seen = new Set(opts.already.map((f) => f.source).filter(Boolean));
  const urls = extractUrls(opts.text).filter((u) => !seen.has(u));
  if (!urls.length) return [];

  const room = MAX_WINDOW_FILES - opts.already.length;
  const out: StoredFile[] = [];

  for (const url of urls.slice(0, Math.max(0, room))) {
    const got = await fetchLink(url, MAX_FILE_BYTES);
    if (!got.ok) {
      // Неудачу тоже записываем: и человек видит причину, и агент не станет
      // делать вид, что документ прочитан.
      out.push({
        id: rid(),
        name: shortUrl(url),
        source: url,
        mime: "",
        size: 0,
        kind: "text",
        at: new Date().toISOString(),
        chars: 0,
        note: got.reason,
      });
      continue;
    }
    if (!kindOf(got.name)) {
      out.push({
        id: rid(),
        name: shortUrl(url),
        source: url,
        mime: "",
        size: 0,
        kind: "text",
        at: new Date().toISOString(),
        chars: 0,
        note: `по ссылке лежит файл, который мы не читаем (${got.name})`,
      });
      continue;
    }
    out.push(await saveFile("window", opts.personId, got.name, got.mime, got.bytes, url));
  }

  return out;
}

/** Адрес для показа: длинный урл в строке файла нечитаем. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname;
    return `${u.hostname}${tail}`;
  } catch {
    return url.slice(0, 48);
  }
}

/** Окно удалили — уносим и его файлы, чтобы диск не копил мусор. */
export const forgetWindowFiles = (personId: string, files: StoredFile[]) =>
  dropFiles(
    "window",
    personId,
    files.map((f) => f.id),
  );

// ── Документы агента (администратор) ──────────────────────────────────────────

const agentFilesPath = async () => `${(await import("./server-data")).dataDir()}/agent-files.json`;

export async function readAgentFiles(): Promise<AgentFilesMap> {
  const d = await import("./server-data");
  return d.readJson<AgentFilesMap>(await agentFilesPath(), {});
}

export const listAgentFilesServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<AgentFilesMap> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return {};
    return readAgentFiles();
  });

export type AgentFilesResult = { ok: boolean; error: string; files: AgentFilesMap };

export const uploadAgentFileServer = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }): Promise<AgentFilesResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.get("code") ?? ""));
    if (!me || me.role !== "admin") return { ok: false, error: "нет доступа", files: {} };

    const agentId = String(data.get("agentId") ?? "");
    const upload = data.get("file");
    if (!agentId || !(upload instanceof File))
      return { ok: false, error: "файл не приехал", files: await readAgentFiles() };

    const all = await readAgentFiles();
    const mine = all[agentId] ?? [];
    if (mine.length >= MAX_AGENT_FILES) {
      return {
        ok: false,
        error: `у одного агента не больше ${MAX_AGENT_FILES} документов`,
        files: all,
      };
    }

    const bad = rejectReason(upload.name, upload.size);
    if (bad) return { ok: false, error: bad, files: all };

    if (tooHeavy(mine, upload.size, MAX_AGENT_BYTES)) {
      return {
        ok: false,
        error: `документы агента весят больше ${humanSize(MAX_AGENT_BYTES)} — уберите лишние`,
        files: all,
      };
    }

    const bytes = Buffer.from(await upload.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES)
      return { ok: false, error: "файл слишком большой", files: all };

    const saved = await saveFile("agent", agentId, upload.name, upload.type, bytes);
    const next: AgentFilesMap = { ...all, [agentId]: [...mine, saved] };
    await d.writeJson(await agentFilesPath(), next);
    return { ok: !saved.note, error: saved.note, files: next };
  });

export const deleteAgentFileServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; agentId: string; fileId: string }) => data)
  .handler(async ({ data }): Promise<AgentFilesResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { ok: false, error: "нет доступа", files: {} };

    const all = await readAgentFiles();
    const next: AgentFilesMap = {
      ...all,
      [data.agentId]: (all[data.agentId] ?? []).filter((f) => f.id !== data.fileId),
    };
    await d.writeJson(await agentFilesPath(), next);
    await dropFiles("agent", data.agentId, [data.fileId]);
    return { ok: true, error: "", files: next };
  });

// ── Скачивание ────────────────────────────────────────────────────────────────
/**
 * Отдаём файл целиком, но только тому, кому он причитается: свой документ —
 * его хозяину, любой — администратору. Проджект в чужие материалы не ходит,
 * как и в чужую переписку.
 */
export const downloadFileServer = createServerFn({ method: "POST" })
  .validator(
    (data: { code: string; scope: "window" | "agent"; ownerId: string; fileId: string }) => data,
  )
  .handler(
    async ({ data }): Promise<{ ok: boolean; name: string; mime: string; base64: string }> => {
      const deny = { ok: false, name: "", mime: "", base64: "" };
      const d = await import("./server-data");
      const { me } = await d.whoIs(String(data.code ?? ""));
      if (!me) return deny;

      let found: StoredFile | undefined;
      if (data.scope === "agent") {
        if (me.role !== "admin") return deny;
        found = (await readAgentFiles())[data.ownerId]?.find((f) => f.id === data.fileId);
      } else {
        if (me.role !== "admin" && me.id !== data.ownerId) return deny;
        // Ищем и в задачах, и в разговорах. Документ, положенный в задачу,
        // числится в проекте, а байты его лежат в той же папке человека
        // (см. uploadProjectFileServer) — искали бы только по разговорам,
        // человек не смог бы скачать собственный договор.
        const { projects, windows } = await d.readWorkspace(data.ownerId);
        found = [...projects.flatMap((p) => p.files), ...windows.flatMap((w) => w.files)].find(
          (f) => f.id === data.fileId,
        );
      }
      if (!found) return deny;

      const { readFile } = await import("node:fs/promises");
      const dir = await folder(data.scope, data.ownerId);
      try {
        const bytes = await readFile(`${dir}/${found.id}.bin`);
        return { ok: true, name: found.name, mime: found.mime, base64: bytes.toString("base64") };
      } catch {
        return deny;
      }
    },
  );

// ── Сборка для модели ─────────────────────────────────────────────────────────
/**
 * Что не поместилось в запрос — именами документов, как их видит человек.
 *
 * Приписки «обрезано» в тексте вложения читает только модель. Человеку они
 * не видны, а решение по разбору принимает он — значит, о недочитанном
 * документе надо сказать и ему, наверх, в разговор.
 */
export type AttachmentsFit = {
  /** Уехал кусок: агент видел начало документа, но не весь */
  trimmed: string[];
  /** Не уехал вовсе: агент этого документа не видел */
  skipped: string[];
};

export type AttachmentsResult = {
  items: Attachment[];
  fit: AttachmentsFit;
};

/**
 * Что уедет к агенту вместе с вопросом: сначала его постоянные документы,
 * потом материалы окна. Порядок не случаен — методика идёт до фактуры.
 *
 * Бюджет считаем честно и вслух: если материалы не помещаются в запрос,
 * агенту так и говорим — обрезано. Молча терять половину отчёта нельзя,
 * иначе он сделает вывод по куску и не предупредит об этом.
 *
 * Знаковый бюджет здесь — грубый предварительный фильтр, а не последнее слово.
 * Знаки плохо меряют окно модели: выгрузка из 1С даёт вдвое больше токенов,
 * чем страница прозы того же объёма. Поэтому наша задача — не пустить в память
 * заведомо неподъёмный объём, а влезает ли собранное на самом деле, считает
 * настоящим счётчиком fitForModel (server-llm.ts) уже перед отправкой; он же
 * дочитывает по частям то, что в один запрос не помещается. Оттого и trimmed
 * со skipped теперь почти всегда пустые: сюда попадает только то, что не берёт
 * даже чтение по частям.
 *
 * Те же имена возвращаем вызывающему: их показывают человеку в разговоре.
 */
export async function attachmentsFor(opts: {
  agentId: string;
  personId: string;
  windowFiles: StoredFile[];
}): Promise<AttachmentsResult> {
  const agentFiles = (await readAgentFiles())[opts.agentId] ?? [];

  // Встроенные документы агента: не файл на диске, а методика из кода. Так у
  // человека на экране и у агента в запросе один и тот же текст — правится в
  // одном месте и не расходится.
  const builtIn: Attachment[] = [];
  if (opts.agentId === "architect") {
    const { checklistAsText } = await import("./sixpager");
    builtIn.push({
      title: "Структура 6-pager: разделы и вопросы",
      kind: "text",
      text: checklistAsText(),
      base64: "",
      mime: "",
      origin: "agent",
    });
  }
  const queue: {
    scope: "window" | "agent";
    ownerId: string;
    file: StoredFile;
    origin: "agent" | "person";
  }[] = [
    ...agentFiles.map((file) => ({
      scope: "agent" as const,
      ownerId: opts.agentId,
      file,
      origin: "agent" as const,
    })),
    ...opts.windowFiles.map((file) => ({
      scope: "window" as const,
      ownerId: opts.personId,
      file,
      origin: "person" as const,
    })),
  ];

  let textLeft = MAX_TEXT_CHARS;
  let rawLeft = MAX_RAW_BYTES;
  const out: Attachment[] = [...builtIn];
  const fit: AttachmentsFit = { trimmed: [], skipped: [] };
  for (const a of builtIn) textLeft -= a.text.length;

  for (const item of queue) {
    const base = {
      // Откуда документ — часть смысла: агент должен знать, что это прочитано
      // по ссылке клиента, а не прислано файлом.
      title: item.file.source
        ? `${item.file.name} (по ссылке ${item.file.source})`
        : item.file.name,
      kind: item.file.kind,
      mime: item.file.mime,
      origin: item.origin,
    };

    if (item.file.source && item.file.note) {
      out.push({
        ...base,
        text: `Ссылку ${item.file.source} открыть не удалось: ${item.file.note}. Скажите об этом клиенту и попросите прислать файл.`,
        base64: "",
        mime: "",
      });
      continue;
    }

    const loaded = await loadForModel(item.scope, item.ownerId, item.file);

    /**
     * PDF и картинка едут файлом — но только если файл для модели вообще есть.
     *
     * Тяжёлый PDF (больше MAX_PDF_NATIVE_BYTES) мы распознаём в текст ещё при
     * загрузке, и loadForModel нарочно отдаёт его текстом с пустым base64 —
     * так и задумано. Раньше здесь стоял безусловный continue, и такой
     * документ выпадал из запроса целиком: агент писал разбор, ни разу его
     * не увидев, а в списке файл выглядел принятым, «распознано N знаков».
     * Теперь текст такого PDF идёт общей дорогой, ниже.
     */
    const asFile =
      Boolean(loaded.base64) && (item.file.kind === "pdf" || item.file.kind === "image");

    if (asFile) {
      if (item.file.size > rawLeft) {
        out.push({
          ...base,
          text: "(документ не поместился в запрос — уберите лишние файлы из разговора)",
          base64: "",
          mime: "",
        });
        // PDF и картинку режут не по половине — они либо уезжают целиком,
        // либо не уезжают совсем.
        fit.skipped.push(item.file.name);
        continue;
      }
      rawLeft -= item.file.size;
      out.push({ ...base, text: "", base64: loaded.base64 });
      continue;
    }

    const text = loaded.text.trim();
    if (!text) {
      // Ни файла, ни текста: документ пропал с диска или не распознался.
      // Раньше это был молчаливый пропуск — в списке он выглядел принятым.
      fit.skipped.push(item.file.name);
      continue;
    }
    if (text.length > textLeft) {
      out.push({
        ...base,
        text: `${text.slice(0, Math.max(0, textLeft))}\n\n[документ обрезан: целиком он не помещается в запрос]`,
        base64: "",
        mime: "",
      });
      // Бюджет мог кончиться ровно на этом документе: тогда уехала приписка
      // и ни строчки текста. Для человека это разные вещи — «прочитал начало»
      // и «не видел вовсе», поэтому и говорим по-разному.
      if (textLeft > 0) fit.trimmed.push(item.file.name);
      else fit.skipped.push(item.file.name);
      textLeft = 0;
      continue;
    }
    textLeft -= text.length;
    out.push({ ...base, text, base64: "", mime: "" });

    // К шаблону агента прикладываем карту его полей: какие ячейки заполняются
    // руками, что в них стоит примером и где ключевые допущения. Без карты
    // модель гадает адреса по тексту таблицы и промахивается на строку-другую,
    // а с ней называет ровно то, что есть в файле.
    if (item.origin === "agent" && item.file.name.toLowerCase().endsWith(".xlsx")) {
      const brief = await templateBrief(item.ownerId, item.file);
      if (brief && brief.length <= textLeft) {
        textLeft -= brief.length;
        out.push({
          title: `Карта полей шаблона «${item.file.name}»`,
          kind: "text",
          mime: "",
          origin: "agent",
          text: brief,
          base64: "",
        });
      }
    }
  }

  return { items: out, fit };
}

/** Карта полей шаблона словами. Не вышло разобрать — работаем без неё. */
async function templateBrief(agentId: string, file: StoredFile): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const dir = await folder("agent", agentId);
    const raw = await readFile(`${dir}/${file.id}.bin`);
    const { templateFields, fieldsBrief } = await import("./server-xlsx");
    const fields = await templateFields(raw);
    return fields.length ? fieldsBrief(file.name, fields) : "";
  } catch {
    return "";
  }
}

// ── Ответ агента файлом Word ──────────────────────────────────────────────────
/**
 * Разбор нужен человеку на руках: переслать, распечатать, принести на защиту.
 * Собираем .docx по тексту ответа — с заголовками, жирным, списками и
 * таблицами, а не «звёздочками» разметки. Файл не храним: собирается по
 * запросу, значит всегда соответствует тому, что видно на экране.
 */
/**
 * Собрать Word-файл ответа БЕЗ проверки сессии.
 *
 * Ядро выгрузки, общее для кнопки «Скачать в Word» и доставки готового в
 * телеграм и почту: документ во всех трёх местах обязан быть одним и тем же.
 * Прав не проверяет нарочно — они у вызывающих разные (кнопка ходит по коду,
 * доставка запускается сервером для владельца), а ядро одно.
 */
export async function buildAnswerDocx(
  ownerId: string,
  windowId: string,
  messageId: string,
): Promise<{ ok: boolean; name: string; base64: string }> {
  const deny = { ok: false, name: "", base64: "" };
  const d = await import("./server-data");
  const list = await d.readParticipants();

  {
    const windows = await d.readWindows(ownerId);
    const w = windows.find((x) => x.id === windowId);
    if (!w) return deny;

    const at = w.messages.findIndex((m) => m.id === messageId && m.from === "agent");
    const answer = at >= 0 ? w.messages[at] : undefined;
    if (!answer) return deny;

    const owner = list.find((p) => p.id === ownerId);

    // Документ называется задачей, а не репликой из чата: его пересылают
    // финдиректору и кладут на стол, и «посмотри, что тут не так» в этой
    // роли не работает. Название берём из задачи, к которой принадлежит
    // разговор; у старых разговоров задачи может не быть — тогда заголовок.
    const projects = await d.readProjects(ownerId);
    const task = projects.find((p) => p.id === w.projectId)?.title || w.title || "Решение";

    // Вердикт роли — отдельный документ той же задачи, и по одному названию
    // его не отличить от разбора. Роль здесь не имя бота, а должность из
    // методики, поэтому в заголовке ей место.
    const { rolesOf, roleById } = await import("./server-agents");
    const cfgAll = await d.readJson<Record<string, Partial<AgentConfig>>>(
      `${d.dataDir()}/agents.json`,
      {},
    );
    const role = answer.roleId
      ? roleById(rolesOf(w.agentId, cfgAll[w.agentId]), answer.roleId)
      : null;

    const meta = {
      task: role ? `${task} — вердикт: ${role.name}` : task,
      person: owner?.name ?? "",
      company: owner?.company ?? "",
      date: new Date(answer.at).toLocaleDateString("ru-RU"),
    };

    // Ответ с полями модели готовим отдельно: таблица адресов ячеек — разметка
    // для машины, в записке ей делать нечего.
    const { cellsFromMarkdown } = await import("./server-xlsx");
    const isModel = cellsFromMarkdown(answer.text).length > 0;
    const text = await forWord(w.agentId, answer.text);

    const { answerToDocx, docxFileName } = await import("./server-docx");
    const file = await answerToDocx(text, meta);
    // Файл с моделью человек кладёт рядом с таблицей Excel — пусть по имени
    // сразу видно, что это записка, а не сама модель.
    const name = docxFileName(
      isModel ? { ...meta, task: `${meta.task} — пояснительная записка` } : meta,
    );
    return { ok: true, name, base64: file.toString("base64") };
  }
}

/**
 * Готовый разбор — файлом Word по запросу из кабинета.
 *
 * Файл не хранится на диске: собирается по запросу, значит всегда совпадает
 * с тем, что на экране.
 */
export const downloadAnswerServer = createServerFn({ method: "POST" })
  .validator(
    (data: { code: string; windowId: string; messageId: string; personId?: string }) => data,
  )
  .handler(async ({ data }): Promise<{ ok: boolean; name: string; base64: string }> => {
    const deny = { ok: false, name: "", base64: "" };
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return deny;

    // Чужой разбор скачивает только администратор — как и чужую переписку.
    const wanted = data.personId?.trim();
    if (wanted && wanted !== me.id && me.role !== "admin") return deny;
    return buildAnswerDocx(wanted || me.id, data.windowId, data.messageId);
  });

/**
 * Текст ответа для файла Word.
 *
 * Если агент собрал модель, вместо служебной таблицы «лист/ячейка» в записку
 * идёт приложение с человеческими подписями полей — их берём из шаблона.
 * Шаблона нет — таблицу всё равно убираем: адреса ячеек без шаблона не значат
 * ничего.
 */
async function forWord(agentId: string, text: string): Promise<string> {
  const { answerForNote, cellsFromMarkdown, templateFields } = await import("./server-xlsx");
  if (!cellsFromMarkdown(text).length) return text;

  const template = ((await readAgentFiles())[agentId] ?? []).find((f) =>
    f.name.toLowerCase().endsWith(".xlsx"),
  );
  if (!template) return answerForNote(text, []);

  try {
    const { readFile } = await import("node:fs/promises");
    const dir = await folder("agent", agentId);
    const raw = await readFile(`${dir}/${template.id}.bin`);
    return answerForNote(text, await templateFields(raw));
  } catch {
    return answerForNote(text, []);
  }
}

/**
 * Документ — на Google Диск.
 *
 * Одна кнопка на всё, что человек и так может скачать: записка, модель,
 * принесённый им файл. Собираем ровно тот же файл, что ушёл бы в «Загрузки»,
 * и кладём на служебный Диск — Word и Excel превращаются в Google-документы,
 * иначе на Диске лежал бы файл, который надо скачать, чтобы прочитать.
 */
export const toGoogleServer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      kind: "answer" | "model" | "file";
      windowId?: string;
      messageId?: string;
      fileId?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<{ ok: boolean; url: string; note: string }> => {
    const deny = { ok: false, url: "", note: "" };
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return deny;

    const settings = await d.readGoogle();
    if (!settings.account && !settings.oauth) {
      return { ...deny, note: "Google Диск ещё не подключён — это делает администратор" };
    }

    let name = "";
    let mime = "";
    let bytes: Buffer;

    if (data.kind === "file") {
      // Документ задачи или взятый в разговор: лежит в папке человека.
      const { projects, windows } = await d.readWorkspace(me.id);
      const mine = [...projects.flatMap((p) => p.files), ...windows.flatMap((w) => w.files)];
      const file = mine.find((f) => f.id === data.fileId);
      if (!file) return { ...deny, note: "документ не найден" };
      try {
        const { readFile } = await import("node:fs/promises");
        bytes = await readFile(`${await folder("window", me.id)}/${file.id}.bin`);
      } catch {
        return { ...deny, note: "файл не нашёлся на диске" };
      }
      name = file.name;
      mime = file.mime;
    } else if (data.kind === "model") {
      const res = await downloadModelServer({
        data: {
          code: data.code,
          windowId: String(data.windowId ?? ""),
          messageId: String(data.messageId ?? ""),
        },
      });
      if (!res.ok) return { ...deny, note: res.note || "модель собрать не удалось" };
      name = res.name;
      mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      bytes = Buffer.from(res.base64, "base64");
    } else {
      const res = await downloadAnswerServer({
        data: {
          code: data.code,
          windowId: String(data.windowId ?? ""),
          messageId: String(data.messageId ?? ""),
        },
      });
      if (!res.ok) return { ...deny, note: "разбор собрать не удалось" };
      name = res.name;
      mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      bytes = Buffer.from(res.base64, "base64");
    }

    const { uploadToDrive } = await import("./server-google");
    const out = await uploadToDrive({
      settings,
      name,
      mime,
      bytes,
      // Почта записана — открываем документ лично человеку, а не всему свету.
      ...(me.email ? { email: me.email } : {}),
    });
    return out.ok ? { ok: true, url: out.url, note: out.shared } : { ...deny, note: out.error };
  });

/**
 * Заполненная модель из ответа агента.
 *
 * Шаблон — это документ агента: методолог кладёт его в карточке и меняет там
 * же, без выкатки. Агент называет поля, платформа подставляет их в шаблон, а
 * считает по формулам сам Excel — не модель. Поэтому цифры в файле сходятся
 * с методикой компании, а не с тем, как модель сложила числа в уме.
 */
export const downloadModelServer = createServerFn({ method: "POST" })
  .validator(
    (data: { code: string; windowId: string; messageId: string; personId?: string }) => data,
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; name: string; base64: string; filled: number; note: string }> => {
      const deny = { ok: false, name: "", base64: "", filled: 0, note: "" };
      const d = await import("./server-data");
      const { me } = await d.whoIs(String(data.code ?? ""));
      if (!me) return deny;

      const wanted = data.personId?.trim();
      if (wanted && wanted !== me.id && me.role !== "admin") return deny;
      const ownerId = wanted || me.id;

      const { projects, windows } = await d.readWorkspace(ownerId);
      const w = windows.find((x) => x.id === data.windowId);
      const answer = w?.messages.find((m) => m.id === data.messageId && m.from === "agent");
      if (!w || !answer) return deny;

      // Шаблон ищем среди документов агента: первый xlsx и есть модель.
      const template = ((await readAgentFiles())[w.agentId] ?? []).find((f) =>
        f.name.toLowerCase().endsWith(".xlsx"),
      );
      if (!template) {
        return {
          ...deny,
          note: "у агента нет шаблона: администратор кладёт его в карточке агента",
        };
      }

      const { cellsFromMarkdown, fillTemplate } = await import("./server-xlsx");
      const cells = cellsFromMarkdown(answer.text);
      if (!cells.length) {
        return {
          ...deny,
          note: "в этом ответе нет полей модели — попросите агента собрать таблицу",
        };
      }

      const { readFile } = await import("node:fs/promises");
      const dir = await folder("agent", w.agentId);
      let raw: Buffer;
      try {
        raw = await readFile(`${dir}/${template.id}.bin`);
      } catch {
        return { ...deny, note: "шаблон не нашёлся на диске — загрузите его агенту заново" };
      }

      const { file, filled, skipped } = await fillTemplate(raw, cells);
      const project = projects.find((p) => p.id === w.projectId);
      const title = (project?.title || w.title || "модель").replace(/[\\/:*?"<>|]/g, " ").trim();

      return {
        ok: true,
        name: `Финмодель — ${title}.xlsx`.slice(0, 120),
        base64: file.toString("base64"),
        filled,
        // Пропущенное показываем человеку: молча потерянные поля хуже, чем
        // честная строка о том, что часть ответа мимо шаблона.
        note: skipped.length ? `не легло в шаблон: ${skipped.slice(0, 5).join("; ")}` : "",
      };
    },
  );
