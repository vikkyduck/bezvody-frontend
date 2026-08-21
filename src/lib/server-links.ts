/**
 * Ссылки, которые присылает клиент. Только сервер.
 *
 * Человек кидает в окно ссылку на таблицу или отчёт и ждёт, что агент её
 * прочитает. Раньше агент честно отвечал, что доступа к внешним файлам у него
 * нет, — и человек шёл копировать содержимое руками. Теперь платформа сама
 * забирает документ по ссылке и кладёт его в окно как обычный материал:
 * видно, что именно прочитано, и можно скачать.
 *
 * Забираем МЫ, со своего сервера в РФ, а не модель откуда-то снаружи. Поэтому
 * работают и Яндекс.Диск, и Google Docs, и внутренние ссылки компании, если
 * они открыты по ссылке.
 *
 * Главная опасность здесь — не чужой сайт, а свой: по адресу из чужих рук
 * сервер может сходить сам себе в потроха (127.0.0.1, метаданные облака,
 * соседние сервисы на этой же машине). Поэтому каждый адрес проверяется до
 * запроса, и каждый редирект — заново.
 */

export type LinkResult =
  { ok: true; name: string; mime: string; bytes: Buffer } | { ok: false; reason: string };

/** Сколько ссылок разбираем из одного сообщения: остальное — уже не вопрос, а список. */
export const MAX_LINKS_PER_MESSAGE = 5;

const AGENT = "BezVody-Platform/1.0 (+https://id.withoutwater.ru)";
const TIMEOUT_MS = 90_000;

// ── Поиск ссылок в тексте ─────────────────────────────────────────────────────

/** Адреса из сообщения человека. Знаки препинания в конце — не часть ссылки. */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'»„“]+/gi) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const clean = raw.replace(/[.,;:!?)\]}]+$/, "");
    if (clean.length > 8 && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, MAX_LINKS_PER_MESSAGE);
}

// ── Проверка адреса ───────────────────────────────────────────────────────────

/** Внутренние адреса наружу не пускаем: там наши же сервисы и ключи. */
function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return (
      v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")
    );
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // метаданные облака
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // операторский NAT
    a >= 224
  );
}

async function addressIsSafe(host: string): Promise<boolean> {
  const { lookup } = await import("node:dns/promises");
  try {
    const all = await lookup(host, { all: true });
    return all.length > 0 && all.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

// ── Известные хранилища ───────────────────────────────────────────────────────
/**
 * Ссылка на Google Docs или Яндекс.Диск ведёт не на файл, а на страницу
 * просмотра — скачав её, получишь разметку редактора, а не документ.
 * У обоих есть честный адрес выгрузки, им и пользуемся.
 */
async function resolveKnownHosts(
  url: string,
): Promise<{ url: string; name?: string } | { error: string }> {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();

  if (host === "docs.google.com") {
    const id = /\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname)?.[1];
    if (!id) return { url };
    if (u.pathname.includes("/spreadsheets/"))
      return {
        url: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
        name: "Таблица Google.xlsx",
      };
    if (u.pathname.includes("/presentation/"))
      return {
        url: `https://docs.google.com/presentation/d/${id}/export/pptx`,
        name: "Презентация Google.pptx",
      };
    if (u.pathname.includes("/document/"))
      return {
        url: `https://docs.google.com/document/d/${id}/export?format=docx`,
        name: "Документ Google.docx",
      };
    return { url };
  }

  if (host === "drive.google.com") {
    const id = /\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (id) return { url: `https://drive.google.com/uc?export=download&id=${id}` };
    return { url };
  }

  if (host.endsWith("disk.yandex.ru") || host.endsWith("disk.yandex.com") || host === "yadi.sk") {
    // У публичной ссылки Яндекс.Диска адрес файла выдаёт открытый API.
    const api = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(url)}`;
    try {
      const res = await fetch(api, {
        headers: { "user-agent": AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok)
        return {
          error:
            res.status === 404
              ? "ссылка Яндекс.Диска недоступна или закрыта"
              : `Яндекс.Диск ответил ${res.status}`,
        };
      const data = (await res.json()) as { href?: string };
      if (!data.href) return { error: "Яндекс.Диск не отдал файл" };
      return { url: data.href };
    } catch {
      return { error: "Яндекс.Диск не отвечает" };
    }
  }

  return { url };
}

// ── Имя и тип ─────────────────────────────────────────────────────────────────

const byMime: [RegExp, string][] = [
  [/pdf/, "pdf"],
  [/wordprocessingml|msword/, "docx"],
  [/spreadsheetml|ms-excel/, "xlsx"],
  [/presentationml|ms-powerpoint/, "pptx"],
  [/csv/, "csv"],
  [/json/, "json"],
  [/png/, "png"],
  [/jpe?g/, "jpg"],
  [/gif/, "gif"],
  [/webp/, "webp"],
];

function nameFor(url: string, disposition: string, mime: string, fallback?: string): string {
  const fromHeader = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition)?.[1];
  if (fromHeader) {
    try {
      return decodeURIComponent(fromHeader).replace(/["']/g, "").trim();
    } catch {
      return fromHeader.replace(/["']/g, "").trim();
    }
  }
  if (fallback) return fallback;

  const u = new URL(url);
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;

  const ext = byMime.find(([re]) => re.test(mime))?.[1] ?? "txt";
  const base = (last || u.hostname).replace(/[^\wа-яё.\- ]/gi, "").slice(0, 60) || "страница";
  return `${base}.${ext}`;
}

/** Веб-страница — это текст, а не разметка: скрипты и стили агенту не нужны. */
async function htmlToText(html: string): Promise<string> {
  const { decodeEntities } = await import("./server-office");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|table|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "— ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title ? `${decodeEntities(title)}\n\n${text}` : text;
}

// ── Забор ─────────────────────────────────────────────────────────────────────

export async function fetchLink(url: string, maxBytes: number): Promise<LinkResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, reason: "адрес не разобрать" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { ok: false, reason: "открываем только http и https" };
  }

  const known = await resolveKnownHosts(url);
  if ("error" in known) return { ok: false, reason: known.error };
  let current = known.url;
  const suggestedName = known.name;

  let res: Response | null = null;
  // Редиректы проходим руками: каждый новый адрес проверяем так же строго,
  // как первый — иначе внешняя ссылка уводит нас на внутренний адрес.
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:")
      return { ok: false, reason: "переадресация не туда" };
    if (!(await addressIsSafe(u.hostname))) return { ok: false, reason: "адрес недоступен" };

    try {
      res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const detail =
        err instanceof Error && err.name === "TimeoutError"
          ? "сайт не ответил вовремя"
          : "сайт не отвечает";
      return { ok: false, reason: detail };
    }

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return { ok: false, reason: "переадресация без адреса" };
      current = new URL(next, current).toString();
      continue;
    }
    break;
  }

  if (!res) return { ok: false, reason: "слишком много переадресаций" };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "доступ закрыт — откройте документ по ссылке или пришлите файлом" };
  }
  if (!res.ok) return { ok: false, reason: `сайт ответил ${res.status}` };

  const mime = (res.headers.get("content-type") ?? "").toLowerCase();
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared && declared > maxBytes) {
    return { ok: false, reason: `файл по ссылке больше ${Math.round(maxBytes / 1024 / 1024)} МБ` };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    return { ok: false, reason: "не удалось скачать файл" };
  }
  if (bytes.length > maxBytes) {
    return { ok: false, reason: `файл по ссылке больше ${Math.round(maxBytes / 1024 / 1024)} МБ` };
  }
  if (!bytes.length) return { ok: false, reason: "по ссылке пусто" };

  // Google на закрытый документ отдаёт не файл, а страницу входа.
  const looksHtml =
    mime.includes("text/html") ||
    bytes.subarray(0, 200).toString("utf8").trimStart().toLowerCase().startsWith("<!doctype html");
  if (looksHtml && suggestedName) {
    return { ok: false, reason: "документ закрыт: откройте доступ «всем, у кого есть ссылка»" };
  }

  if (looksHtml) {
    const text = await htmlToText(bytes.toString("utf8"));
    if (!text) return { ok: false, reason: "на странице не нашлось текста" };
    return {
      ok: true,
      name: nameFor(current, "", "text/plain"),
      mime: "text/plain",
      bytes: Buffer.from(text, "utf8"),
    };
  }

  return {
    ok: true,
    name: nameFor(current, res.headers.get("content-disposition") ?? "", mime, suggestedName),
    mime: mime.split(";")[0] ?? "application/octet-stream",
    bytes,
  };
}
