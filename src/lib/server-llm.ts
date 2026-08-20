/**
 * Вызов модели. Только сервер.
 *
 * Ходим через транзит на DO-дроплете: с РФ-адреса api.anthropic.com отвечает
 * 403. Ключ живёт на этом сервере и в браузер не попадает.
 *
 * Стримим и берём финальное сообщение: 6-pager — длинный ответ, и обычный
 * запрос успел бы упереться в таймаут раньше, чем модель договорит.
 */
import type { StoredMessage } from "./conversations";

/** Локальный вход в транзит — тот же, через который ходит Kotu. */
const BASE_URL = process.env["ANTHROPIC_BASE_URL"]?.trim() || "http://127.0.0.1:8444/anthropic";

export type AskResult =
  | { ok: true; text: string }
  | { ok: false; reason: "no-key" | "not-configured" | "failed"; detail?: string };

export async function askAgent(opts: {
  systemPrompt: string;
  model: string;
  history: StoredMessage[];
  question: string;
}): Promise<AskResult> {
  const { readApiKey } = await import("./server-data");
  const apiKey = await readApiKey();
  if (!apiKey) return { ok: false, reason: "no-key" };
  if (!opts.systemPrompt.trim()) return { ok: false, reason: "not-configured" };

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, baseURL: BASE_URL });

  // История разговора: платформа не помнит контекст за модель — он передаётся
  // целиком каждый раз, иначе агент забудет, о чём шла речь двумя репликами выше.
  const messages = [
    ...opts.history.map((m) => ({
      role: m.from === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    })),
    { role: "user" as const, content: opts.question },
  ];

  try {
    const stream = client.messages.stream({
      model: opts.model,
      max_tokens: 32000,
      system: opts.systemPrompt,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages,
    });
    const final = await stream.finalMessage();

    if (final.stop_reason === "refusal") {
      return { ok: false, reason: "failed", detail: "модель отказалась отвечать на этот запрос" };
    }

    const text = final.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return text ? { ok: true, text } : { ok: false, reason: "failed", detail: "модель вернула пустой ответ" };
  } catch (err) {
    // Наружу отдаём короткую причину: подробности с ключами и адресами
    // остаются в журнале сервера, а не на экране клиента.
    const detail = err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка";
    console.error("Вызов модели не удался:", detail);
    return { ok: false, reason: "failed", detail };
  }
}
