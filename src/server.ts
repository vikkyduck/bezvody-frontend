import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Вебхук телеграм-бота. Перехватываем до SSR: маршрутов у роутера на него нет,
 * и без этой развилки Телеграм получал бы страницу «не найдено» — а он на
 * такое отвечает повторами того же обновления.
 *
 * Проверка секрета и вся работа — внутри telegramWebhook. Модуль тянем
 * динамически, чтобы серверный вход не тащил его на каждый обычный запрос.
 */
const TELEGRAM_HOOK = "/tg/hook";

async function telegramHook(request: Request): Promise<Response | null> {
  if (request.method !== "POST") return null;
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  if (pathname !== TELEGRAM_HOOK) return null;
  const { telegramWebhook } = await import("./lib/server-telegram");
  return telegramWebhook(request);
}

/**
 * Заголовки кэша. Без них браузер кэширует HTML по «эвристике» — и человек
 * после выкатки видит старый кабинет, пока не догадается нажать Ctrl+Shift+R.
 * Догадываться он не обязан: HTML всегда перепроверяется (no-cache), а файлы
 * из /assets/ с хэшем в имени, наоборот, замораживаются навсегда — при новой
 * сборке у них новое имя, и старые никому не мешают.
 */
function withCacheHeaders(request: Request, response: Response): Response {
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return response;
  }
  // Ассетам нитро уже ставит свой max-age — не дописываем второй заголовок,
  // добавляем immutable только там, где кэша нет вовсе.
  const value = pathname.startsWith("/assets/")
    ? response.headers.has("cache-control")
      ? null
      : "public, max-age=31536000, immutable"
    : (response.headers.get("content-type") ?? "").includes("text/html")
      ? "no-cache"
      : null;
  if (!value) return response;
  try {
    response.headers.set("cache-control", value);
    return response;
  } catch {
    // Заголовки бывают неизменяемыми — тогда пересобираем ответ.
    const headers = new Headers(response.headers);
    headers.set("cache-control", value);
    return new Response(response.body, { status: response.status, headers });
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const hook = await telegramHook(request);
      if (hook) return hook;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withCacheHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
