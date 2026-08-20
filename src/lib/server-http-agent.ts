/**
 * Агент, живущий за чужим HTTP-API.
 *
 * Готовый сервис можно подключить, не переписывая платформу: платформа шлёт
 * туда вопрос вместе с историей окна и берёт из ответа текст.
 *
 * Форматов в природе два ходовых, и оба поддержаны:
 *   openai — тело { messages: [...] }, ответ choices[0].message.content;
 *   simple — тело { message, history, systemPrompt }, ответ ищем в полях
 *            reply / text / answer / result / output / content.
 *
 * Если сервис отвечает иначе — кнопка «Проверить связь» в админке покажет
 * сырой ответ целиком, и разбор допишется по факту, а не по догадке.
 */
import type { StoredMessage } from "./conversations";

export type HttpAgentSettings = {
  endpoint: string;
  /** Имя заголовка авторизации, обычно Authorization */
  authHeader: string;
  format: "openai" | "simple";
  /** Необязательное имя модели — некоторые сервисы его требуют */
  model?: string;
};

export type HttpCallResult =
  | { ok: true; text: string; raw: string }
  | { ok: false; detail: string; raw: string };

/** Достаём текст из ответа, не ломаясь на незнакомой форме. */
function extractText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";

  const obj = data as Record<string, unknown>;

  // OpenAI-совместимый ответ
  const choices = obj["choices"];
  if (Array.isArray(choices) && choices.length) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.["message"] as Record<string, unknown> | undefined;
    if (typeof message?.["content"] === "string") return message["content"];
    if (typeof first?.["text"] === "string") return first["text"] as string;
  }

  // Ходовые имена полей у самодельных сервисов
  for (const key of ["reply", "text", "answer", "result", "output", "content", "message", "response"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
    // Иногда результат лежит на уровень глубже
    if (v && typeof v === "object") {
      const inner = extractText(v);
      if (inner) return inner;
    }
  }
  return "";
}

export async function callHttpAgent(opts: {
  settings: HttpAgentSettings;
  auth: string;
  systemPrompt: string;
  history: StoredMessage[];
  question: string;
  /** Таймаут: чужой сервис может думать долго, но не бесконечно */
  timeoutMs?: number;
}): Promise<HttpCallResult> {
  const { settings, auth } = opts;
  if (!settings.endpoint) return { ok: false, detail: "адрес сервиса не задан", raw: "" };

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    const name = settings.authHeader.trim() || "Authorization";
    // Bearer подставляем сами, если человек вписал только сам токен.
    headers[name] = name.toLowerCase() === "authorization" && !/^\w+\s/.test(auth) ? `Bearer ${auth}` : auth;
  }

  const body =
    settings.format === "openai"
      ? {
          ...(settings.model ? { model: settings.model } : {}),
          messages: [
            ...(opts.systemPrompt ? [{ role: "system", content: opts.systemPrompt }] : []),
            ...opts.history.map((m) => ({
              role: m.from === "user" ? "user" : "assistant",
              content: m.text,
            })),
            { role: "user", content: opts.question },
          ],
        }
      : {
          message: opts.question,
          systemPrompt: opts.systemPrompt,
          history: opts.history.map((m) => ({ role: m.from, text: m.text })),
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 600_000);

  try {
    const res = await fetch(settings.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = (await res.text()).slice(0, 4000);
    if (!res.ok) return { ok: false, detail: `сервис ответил ${res.status}`, raw };

    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* не JSON — обойдёмся текстом как есть */
    }

    const text = extractText(parsed).trim();
    return text
      ? { ok: true, text, raw }
      : { ok: false, detail: "в ответе не нашлось текста — посмотрите сырой ответ ниже", raw };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка";
    return { ok: false, detail, raw: "" };
  } finally {
    clearTimeout(timer);
  }
}
