import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
//
// Сверяем ХОСТ, а не origin целиком. TLS обрывается на nginx, приложение
// получает запрос как http://, а браузер присылает Origin: https:// — сравнение
// строк не сходится. Современные браузеры спасает заголовок Sec-Fetch-Site,
// который проверяется раньше, а вот Safari до 16.4 его не шлёт: там на КАЖДЫЙ
// запрос прилетало бы «Forbidden». Чужой сайт по-прежнему не пройдёт — у него
// другой хост.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: (origin, ctx) => {
    try {
      return new URL(origin).host === new URL(ctx.request.url).host;
    } catch {
      return false;
    }
  },
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
